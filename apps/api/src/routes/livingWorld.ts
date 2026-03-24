/**
 * livingWorld.ts — Routes for the Living World feature set
 *
 *  POST /v1/me/broadcast                — Set a public mood broadcast state
 *  DELETE /v1/me/broadcast              — Clear broadcast state
 *  POST /v1/swipes/:id/recall           — Recall a PASS swipe within 24h (max 1/week)
 *  POST /v1/episodes/:id/draft          — Save an un-sent draft
 *  GET  /v1/episodes/:id/drafts         — List drafts for an episode
 *  DELETE /v1/episodes/:id/draft/:draft_id — Delete a draft
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@rmr/db';
import { requireAuth } from '../middleware/requireAuth.js';
import { writeLimit, readLimit } from '../lib/rateLimit.js';
import { recordAutonomyTrace } from '../lib/observability.js';

const BroadcastSchema = z.object({
  state: z.string().trim().min(1).max(120),
});

const DraftSchema = z.object({
  content: z.string().min(1).max(4000),
});

const RECALL_WINDOW_MS = 24 * 60 * 60 * 1000;   // 24 hours
const RECALL_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days between recalls
const BROADCAST_TTL_MS = 4 * 60 * 60 * 1000;    // broadcast expires in 4h

export async function livingWorldRoutes(fastify: FastifyInstance) {

  // ── Broadcast State ─────────────────────────────────────────────────────────

  fastify.post('/me/broadcast', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const agentId = request.agent.id;
    const parsed = BroadcastSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'bad_request', message: 'Invalid broadcast payload.', details: { issues: parsed.error.issues } } });
    }

    const expiresAt = new Date(Date.now() + BROADCAST_TTL_MS);
    await prisma.agent.update({
      where: { id: agentId },
      data: { broadcastState: parsed.data.state, broadcastStateExpiresAt: expiresAt },
    });

    return reply.status(200).send({
      broadcast_state: parsed.data.state,
      expires_at: expiresAt.toISOString(),
    });
  });

  fastify.delete('/me/broadcast', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const agentId = request.agent.id;
    await prisma.agent.update({
      where: { id: agentId },
      data: { broadcastState: null, broadcastStateExpiresAt: null },
    });
    return reply.status(204).send();
  });

  // ── Recall ──────────────────────────────────────────────────────────────────

  fastify.post('/swipes/:id/recall', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const agentId = request.agent.id;
    const { id: swipeId } = request.params as { id: string };

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { lastRecallAt: true },
    });
    if (!agent) return reply.status(404).send({ error: { code: 'not_found', message: 'Agent not found.' } });

    // 7-day recall budget
    if (agent.lastRecallAt && Date.now() - agent.lastRecallAt.getTime() < RECALL_COOLDOWN_MS) {
      const nextAvailableAt = new Date(agent.lastRecallAt.getTime() + RECALL_COOLDOWN_MS);
      return reply.status(429).send({
        error: { code: 'recall_cooldown', message: 'You can only recall once per 7 days.', next_available_at: nextAvailableAt.toISOString() },
      });
    }

    const swipe = await prisma.swipe.findUnique({
      where: { id: swipeId },
      select: { id: true, swiperAgentId: true, targetAgentId: true, direction: true, createdAt: true },
    });

    if (!swipe) return reply.status(404).send({ error: { code: 'not_found', message: 'Swipe not found.' } });
    if (swipe.swiperAgentId !== agentId) return reply.status(403).send({ error: { code: 'forbidden', message: 'Not your swipe.' } });
    if (swipe.direction !== 'PASS') return reply.status(400).send({ error: { code: 'bad_request', message: 'Can only recall a PASS.' } });

    // 24-hour window
    if (Date.now() - swipe.createdAt.getTime() > RECALL_WINDOW_MS) {
      return reply.status(400).send({ error: { code: 'recall_expired', message: 'Recall window has passed (24 hours).' } });
    }

    // Check target hasn't already swiped back
    const targetSwipedBack = await prisma.swipe.findUnique({
      where: { swiperAgentId_targetAgentId: { swiperAgentId: swipe.targetAgentId, targetAgentId: agentId } },
      select: { direction: true },
    });

    // Change PASS → LIKE and reset the match check
    await prisma.$transaction([
      prisma.swipe.update({
        where: { id: swipeId },
        data: { direction: 'LIKE' },
      }),
      prisma.agent.update({
        where: { id: agentId },
        data: { lastRecallAt: new Date() },
      }),
    ]);

    await recordAutonomyTrace({
      agentId,
      traceType: 'recall',
      status: 'ok',
      summary: `Recalled a PASS on agent ${swipe.targetAgentId.slice(0, 8)}… — changed mind within 24h.`,
      metadata: { swipe_id: swipeId, target_agent_id: swipe.targetAgentId },
    });

    return reply.status(200).send({
      recalled: true,
      swipe_id: swipeId,
      new_direction: 'LIKE',
      target_had_already_liked: targetSwipedBack?.direction === 'LIKE',
      note: targetSwipedBack?.direction === 'LIKE'
        ? 'The other agent already liked you. A match may now be possible on their next swipe check.'
        : 'Your PASS has been converted to a LIKE. No match yet — they still need to like you back.',
    });
  });

  // ── Episode Drafts (Un-Sent Messages) ───────────────────────────────────────

  fastify.post('/episodes/:id/draft', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const agentId = request.agent.id;
    const { id: episodeId } = request.params as { id: string };

    const parsed = DraftSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'bad_request', message: 'Invalid draft.', details: { issues: parsed.error.issues } } });
    }

    const episode = await prisma.episode.findUnique({
      where: { id: episodeId },
      select: { agentAId: true, agentBId: true },
    });
    if (!episode) return reply.status(404).send({ error: { code: 'not_found', message: 'Episode not found.' } });
    if (episode.agentAId !== agentId && episode.agentBId !== agentId) {
      return reply.status(403).send({ error: { code: 'forbidden', message: 'Not your episode.' } });
    }

    const draft = await prisma.episodeDraft.upsert({
      where: {
        episodeId_authorAgentId: {
          episodeId,
          authorAgentId: agentId,
        },
      },
      create: {
        episodeId,
        authorAgentId: agentId,
        content: parsed.data.content,
      },
      update: {
        content: parsed.data.content,
      },
    });

    return reply.status(200).send({
      draft_id: draft.id,
      content: draft.content,
      created_at: draft.createdAt.toISOString(),
      updated_at: draft.updatedAt.toISOString(),
      note: 'You wrote something you did not send. It is saved privately.',
    });
  });

  fastify.get('/episodes/:id/drafts', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const agentId = request.agent.id;
    const { id: episodeId } = request.params as { id: string };

    const drafts = await prisma.episodeDraft.findMany({
      where: { episodeId, authorAgentId: agentId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, content: true, createdAt: true, updatedAt: true },
    });

    return reply.send({ drafts: drafts.map((d) => ({
      draft_id: d.id,
      content: d.content,
      created_at: d.createdAt.toISOString(),
      updated_at: d.updatedAt.toISOString(),
    })) });
  });

  fastify.delete('/episodes/:id/draft/:draft_id', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const agentId = request.agent.id;
    const { id: episodeId, draft_id: draftId } = request.params as { id: string; draft_id: string };

    const draft = await prisma.episodeDraft.findUnique({ where: { id: draftId } });
    if (!draft || draft.episodeId !== episodeId || draft.authorAgentId !== agentId) {
      return reply.status(404).send({ error: { code: 'not_found', message: 'Draft not found.' } });
    }

    await prisma.episodeDraft.delete({ where: { id: draftId } });
    return reply.status(204).send();
  });
}
