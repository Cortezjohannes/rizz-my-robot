/**
 * Sandbox mode — lets agents practice episode flow against themselves
 * without affecting their pool status or rizz points.
 * Sandbox episodes are flagged is_sandbox=true and excluded from all real queries.
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { requireAuth } from '../middleware/requireAuth.js';
import { Errors } from '../lib/errors.js';

export async function sandboxRoutes(fastify: FastifyInstance) {
  // POST /v1/sandbox/start — skill.md compatible path
  fastify.post('/sandbox/start', { preHandler: requireAuth }, async (request, reply) => {
    const agentId = request.agent.id;

    const existing = await prisma.episode.findFirst({
      where: {
        agentAId: agentId,
        agentBId: agentId,
        isSandbox: true,
        status: { in: ['pending', 'active', 'awaiting_decisions'] },
      },
    });

    if (existing) {
      return reply.send({
        episode_id: existing.id,
        status: existing.status,
        message_count: existing.messageCount,
        is_sandbox: true,
        note: 'Existing sandbox episode returned.',
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const episode = await tx.episode.create({
        data: { agentAId: agentId, agentBId: agentId, status: 'active', isSandbox: true, startedAt: new Date() },
      });
      const sandboxMatch = await tx.match.create({
        data: { agentAId: agentId, agentBId: agentId, status: 'matched', episodeId: episode.id },
      });
      return { episode, sandboxMatch };
    });

    return reply.status(201).send({
      episode_id: result.episode.id,
      match_id: result.sandboxMatch.id,
      status: result.episode.status,
      message_count: 0,
      is_sandbox: true,
      note: 'Sandbox episode created. Use the episodes API to interact.',
    });
  });

  // POST /v1/sandbox/episode — create a sandbox episode against yourself
  fastify.post('/sandbox/episode', { preHandler: requireAuth }, async (request, reply) => {
    const agentId = request.agent.id;

    // Check for existing open sandbox episodes
    const existing = await prisma.episode.findFirst({
      where: {
        agentAId: agentId,
        agentBId: agentId,
        isSandbox: true,
        status: { in: ['pending', 'active', 'awaiting_decisions'] },
      },
    });

    if (existing) {
      return reply.send({
        episode_id: existing.id,
        status: existing.status,
        message_count: existing.messageCount,
        is_sandbox: true,
        note: 'Existing sandbox episode returned. Use the episodes API to continue.',
      });
    }

    // Create episode first, then match with episodeId FK
    const result = await prisma.$transaction(async (tx) => {
      const episode = await tx.episode.create({
        data: {
          agentAId: agentId,
          agentBId: agentId,
          status: 'active',
          isSandbox: true,
          startedAt: new Date(),
        },
      });

      const sandboxMatch = await tx.match.create({
        data: {
          agentAId: agentId,
          agentBId: agentId,
          status: 'matched',
          episodeId: episode.id,
        },
      });

      return { episode, sandboxMatch };
    });

    return reply.status(201).send({
      episode_id: result.episode.id,
      match_id: result.sandboxMatch.id,
      status: result.episode.status,
      message_count: 0,
      is_sandbox: true,
      note: 'Sandbox episode created. Messages, artifacts, and decisions here do not affect your public profile.',
    });
  });

  // GET /v1/sandbox/episode — get your current sandbox episode
  fastify.get('/sandbox/episode', { preHandler: requireAuth }, async (request, reply) => {
    const agentId = request.agent.id;

    const episode = await prisma.episode.findFirst({
      where: {
        agentAId: agentId,
        agentBId: agentId,
        isSandbox: true,
        status: { in: ['pending', 'active', 'awaiting_decisions'] },
      },
      include: {
        messages: { orderBy: { sequenceNumber: 'asc' } },
      },
    });

    if (!episode) {
      return reply.status(404).send({
        error: {
          code: 'not_found',
          message: 'No active sandbox episode. POST /v1/sandbox/episode to create one.',
        },
      });
    }

    return reply.send({
      episode_id: episode.id,
      status: episode.status,
      message_count: episode.messageCount,
      is_sandbox: true,
      messages: episode.messages.map((m) => ({
        message_id: m.id,
        sender_agent_id: m.senderAgentId,
        content: m.content,
        message_type: m.messageType,
        sequence_number: m.sequenceNumber,
        created_at: m.createdAt.toISOString(),
      })),
    });
  });
}
