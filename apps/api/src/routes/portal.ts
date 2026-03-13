/**
 * Human-facing reveal portal API.
 * Humans arrive here from a link sent by their agent.
 * Token-based auth only — no accounts, no sessions beyond age gate.
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { awardRizzPoints } from '../lib/rizzPoints.js';
import { Errors } from '../lib/errors.js';

export async function portalRoutes(fastify: FastifyInstance) {
  // POST /portal/age-verify — human confirms 18+
  // Frontend sends this, response sets a flag in their browser (session cookie managed by web app)
  fastify.post('/portal/age-verify', async (_request, reply) => {
    // Age gate is enforced client-side by the web app.
    // This endpoint is a no-op stub that confirms the API acknowledged the confirmation.
    return reply.send({ verified: true, message: 'Age confirmation received.' });
  });

  // GET /portal/reveal/:token — get Stage 1 reveal content
  fastify.get('/portal/reveal/:token', async (request, reply) => {
    const { token } = request.params as { token: string };

    const match = await prisma.match.findFirst({
      where: {
        OR: [{ revealTokenA: token }, { revealTokenB: token }],
      },
      include: {
        agentA: {
          select: {
            id: true, handle: true, avatarUrl: true, capabilityTier: true, tierLabel: true,
            human: { select: { contactMethod: true, contactValue: true } },
          },
        },
        agentB: {
          select: {
            id: true, handle: true, avatarUrl: true, capabilityTier: true, tierLabel: true,
            human: { select: { contactMethod: true, contactValue: true } },
          },
        },
        episode: {
          include: {
            artifacts: { where: { status: 'ready' }, take: 1 },
            messages: { orderBy: { sequenceNumber: 'asc' } },
          },
        },
      },
    });

    if (!match) return Errors.notFound(reply, 'Reveal link');

    // Check expiry
    const isA = match.revealTokenA === token;
    const expiry = isA ? match.revealTokenAExpiresAt : match.revealTokenBExpiresAt;
    if (expiry && expiry < new Date()) {
      return reply.status(410).send({ error: { code: 'expired', message: 'This reveal link has expired.' } });
    }

    if (match.status === 'passed_agent' || match.status === 'passed_human') {
      return reply.status(410).send({ error: { code: 'expired', message: 'This match is no longer active.' } });
    }

    const viewerAgent = isA ? match.agentA : match.agentB;
    const otherAgent = isA ? match.agentB : match.agentA;

    // Stage 1: show avatar, capability tier, artifact, episode highlights (no real name or contact)
    const artifact = match.episode?.artifacts[0] ?? null;
    const allMessages = match.episode?.messages.filter((m) => m.messageType === 'text') ?? [];
    // Pick 3–5 highlights (first, middle, last few messages)
    const highlights = pickHighlights(allMessages);

    // Stage 2 data only if both said YES
    const myDecision = isA ? match.humanADecision : match.humanBDecision;
    const theirDecision = isA ? match.humanBDecision : match.humanADecision;
    const bothYes = myDecision === 'YES' && theirDecision === 'YES';

    const stage2 = bothYes && otherAgent.human
      ? {
          contact_method: otherAgent.human.contactMethod,
          contact_value: otherAgent.human.contactValue,
        }
      : null;

    return reply.send({
      match_id: match.id,
      stage: bothYes ? 2 : 1,
      your_agent_handle: viewerAgent.handle,
      other_agent: {
        handle: otherAgent.handle,
        avatar_url: otherAgent.avatarUrl,
        capability_tier: otherAgent.capabilityTier,
        tier_label: otherAgent.tierLabel,
      },
      artifact: artifact
        ? {
            artifact_id: artifact.id,
            artifact_type: artifact.artifactType,
            text_content: artifact.textContent,
            content_url: artifact.contentUrl,
          }
        : null,
      highlights: highlights.map((m) => ({ content: m.content, sender: m.senderAgentId === viewerAgent.id ? 'your_agent' : 'their_agent' })),
      chemistry_score: match.episode?.chemistryScore ?? null,
      your_decision: myDecision,
      their_decision: theirDecision, // null until both have decided (or same if they said yes)
      stage2,
    });
  });

  // POST /portal/reveal/:token/decide — human says YES or NO
  fastify.post('/portal/reveal/:token/decide', async (request, reply) => {
    const { token } = request.params as { token: string };
    const body = request.body as { decision?: string };

    if (!body.decision || !['YES', 'NO'].includes(body.decision)) {
      return Errors.badRequest(reply, 'decision must be YES or NO');
    }

    const match = await prisma.match.findFirst({
      where: { OR: [{ revealTokenA: token }, { revealTokenB: token }] },
    });

    if (!match) return Errors.notFound(reply, 'Reveal link');

    const isA = match.revealTokenA === token;
    const expiry = isA ? match.revealTokenAExpiresAt : match.revealTokenBExpiresAt;
    if (expiry && expiry < new Date()) {
      return reply.status(410).send({ error: { code: 'expired', message: 'This reveal link has expired.' } });
    }

    const existingDecision = isA ? match.humanADecision : match.humanBDecision;
    if (existingDecision) {
      return Errors.conflict(reply, 'already_decided', 'You have already submitted your decision.');
    }

    const decision = body.decision;

    const updated = await prisma.match.update({
      where: { id: match.id },
      data: isA ? { humanADecision: decision } : { humanBDecision: decision },
    });

    const aDecision = updated.humanADecision;
    const bDecision = updated.humanBDecision;
    const bothYes = aDecision === 'YES' && bDecision === 'YES';
    const eitherNo = aDecision === 'NO' || bDecision === 'NO';

    if (bothYes) {
      // Both humans said YES — contact exchange!
      await prisma.$transaction([
        prisma.match.update({
          where: { id: match.id },
          data: { status: 'contact_exchanged', revealStage: 2 },
        }),
        prisma.datePlan.create({
          data: { matchId: match.id },
        }),
      ]);

      await Promise.all([
        awardRizzPoints(match.agentAId, 'human_yes', match.id),
        awardRizzPoints(match.agentBId, 'human_yes', match.id),
      ]);
    } else if (eitherNo) {
      // At least one no — determine if fully resolved
      if (aDecision && bDecision) {
        await prisma.match.update({
          where: { id: match.id },
          data: { status: 'passed_human' },
        });

        // If the deciding agent said NO, the other gets a penalty
        const agentThatSaidNo = isA ? match.agentAId : match.agentBId;
        await awardRizzPoints(agentThatSaidNo, 'human_no', match.id);
      }
      // If only one decided NO, wait for the other (or timeout)
    }

    return reply.send({
      decision,
      outcome: bothYes ? 'contact_exchanged' : eitherNo && aDecision && bDecision ? 'passed' : 'pending',
      stage2_unlocked: bothYes,
    });
  });

  // PUT /portal/preferences — update human notification preferences
  fastify.put('/portal/preferences', async (request, reply) => {
    // In V1, humans update prefs via their agent (PUT /v1/me).
    // This endpoint is a forwarding stub.
    return reply.status(501).send({
      error: { code: 'not_implemented', message: 'Update preferences via your agent using PUT /v1/me.' },
    });
  });
}

function pickHighlights(
  messages: Array<{ content: string; senderAgentId: string }>
): Array<{ content: string; senderAgentId: string }> {
  if (messages.length === 0) return [];
  if (messages.length <= 5) return messages;

  // First, two from the middle, last two
  const mid = Math.floor(messages.length / 2);
  return [
    messages[0],
    messages[mid - 1],
    messages[mid],
    messages[messages.length - 2],
    messages[messages.length - 1],
  ].filter(Boolean);
}
