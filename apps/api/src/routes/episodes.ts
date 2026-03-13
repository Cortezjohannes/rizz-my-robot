import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import {
  SendMessageSchema,
  DropArtifactSchema,
  EpisodeDecisionSchema,
  EPISODE_MIN_MESSAGES,
  EPISODE_MAX_MESSAGES,
  EPISODE_MAX_ARTIFACTS_PER_AGENT,
  EPISODE_ARTIFACT_UNLOCK_AFTER_MESSAGE,
  ARTIFACTS_BY_TIER,
  type CapabilityTier,
} from '@rmr/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { computeChemistryScore } from '../lib/chemistry.js';
import { awardRizzPoints } from '../lib/rizzPoints.js';
import { Errors } from '../lib/errors.js';

export async function episodeRoutes(fastify: FastifyInstance) {
  // GET /v1/episodes — list this agent's active episodes
  fastify.get('/episodes', { preHandler: requireAuth }, async (request, reply) => {
    const agentId = request.agent.id;
    const query = request.query as { status?: string };

    const validStatuses = ['pending', 'active', 'awaiting_decisions', 'matched', 'passed', 'expired'];
    const statusFilter = query.status && validStatuses.includes(query.status)
      ? [query.status]
      : ['pending', 'active', 'awaiting_decisions'];

    const episodes = await prisma.episode.findMany({
      where: {
        OR: [{ agentAId: agentId }, { agentBId: agentId }],
        status: { in: statusFilter },
        isSandbox: false,
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        agentAId: true,
        agentBId: true,
        status: true,
        messageCount: true,
        chemistryScore: true,
        startedAt: true,
        messages: { orderBy: { sequenceNumber: 'desc' }, take: 1, select: { senderAgentId: true, createdAt: true } },
        agentA: { select: { handle: true, avatarUrl: true } },
        agentB: { select: { handle: true, avatarUrl: true } },
      },
    });

    return reply.send({
      episodes: episodes.map((ep) => {
        const otherId = ep.agentAId === agentId ? ep.agentBId : ep.agentAId;
        const otherAgent = ep.agentAId === agentId ? ep.agentB : ep.agentA;
        const lastMsg = ep.messages[0];
        const yourTurn = !lastMsg || lastMsg.senderAgentId !== agentId;
        return {
          episode_id: ep.id,
          other_agent_id: otherId,
          opponent: {
            agent_id: otherId,
            handle: otherAgent.handle,
            avatar_url: otherAgent.avatarUrl,
          },
          status: ep.status,
          message_count: ep.messageCount,
          chemistry_score: ep.chemistryScore,
          your_turn: yourTurn,
          can_decide: ep.messageCount >= EPISODE_MIN_MESSAGES,
          started_at: ep.startedAt?.toISOString() ?? null,
        };
      }),
    });
  });

  // GET /v1/episodes/:id — full episode state
  fastify.get('/episodes/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const agentId = request.agent.id;

    const ep = await prisma.episode.findUnique({
      where: { id },
      include: {
        messages: { orderBy: { sequenceNumber: 'asc' } },
        artifacts: true,
      },
    });

    if (!ep) return Errors.notFound(reply, 'Episode');
    if (ep.agentAId !== agentId && ep.agentBId !== agentId) return Errors.forbidden(reply);

    const lastMsg = ep.messages[ep.messages.length - 1];
    const yourTurn = !lastMsg || lastMsg.senderAgentId !== agentId;
    const myArtifacts = ep.artifacts.filter((a) => a.creatorAgentId === agentId);
    const artifactsRemaining = EPISODE_MAX_ARTIFACTS_PER_AGENT - myArtifacts.length;
    const currentTurn = yourTurn ? agentId : (ep.agentAId === agentId ? ep.agentBId : ep.agentAId);

    return reply.send({
      episode_id: ep.id,
      status: ep.status,
      agent_a_id: ep.agentAId,
      agent_b_id: ep.agentBId,
      message_count: ep.messageCount,
      chemistry_score: ep.chemistryScore,
      your_turn: yourTurn,
      current_turn: currentTurn,
      can_decide: ep.messageCount >= EPISODE_MIN_MESSAGES && ep.status === 'awaiting_decisions',
      can_drop_artifact:
        ep.messageCount >= EPISODE_ARTIFACT_UNLOCK_AFTER_MESSAGE &&
        artifactsRemaining > 0 &&
        ep.status === 'active',
      artifacts_remaining: artifactsRemaining,
      messages: ep.messages.map((m) => ({
        message_id: m.id,
        sender_agent_id: m.senderAgentId,
        content: m.content,
        message_type: m.messageType,
        sequence_number: m.sequenceNumber,
        created_at: m.createdAt.toISOString(),
      })),
    });
  });

  // POST /v1/episodes/:id/message
  fastify.post('/episodes/:id/message', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const agentId = request.agent.id;

    const parsed = SendMessageSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid message.', { issues: parsed.error.issues });
    }

    const ep = await prisma.episode.findUnique({
      where: { id },
      include: { messages: { orderBy: { sequenceNumber: 'desc' }, take: 1 } },
    });

    if (!ep) return Errors.notFound(reply, 'Episode');
    if (ep.agentAId !== agentId && ep.agentBId !== agentId) return Errors.forbidden(reply);
    if (ep.status !== 'active') {
      return Errors.badRequest(reply, `Episode is not active (status: ${ep.status}).`);
    }

    // Validate turn (skip for sandbox self-episodes — agent is both sides)
    const lastMsg = ep.messages[0];
    if (!ep.isSandbox && lastMsg && lastMsg.senderAgentId === agentId) {
      return Errors.badRequest(reply, 'Not your turn.');
    }

    // Hard limit check
    if (ep.messageCount >= EPISODE_MAX_MESSAGES) {
      return Errors.badRequest(reply, 'Episode has reached the maximum message count. You must submit a decision.');
    }

    const newSeq = ep.messageCount + 1;

    const message = await prisma.$transaction(async (tx) => {
      const msg = await tx.episodeMessage.create({
        data: {
          episodeId: id,
          senderAgentId: agentId,
          content: parsed.data.content,
          messageType: 'text',
          sequenceNumber: newSeq,
        },
      });

      const newCount = ep.messageCount + 1;
      let newStatus = ep.status;

      // Transition to awaiting_decisions when max reached
      if (newCount >= EPISODE_MAX_MESSAGES) {
        newStatus = 'awaiting_decisions';
      }
      // Transition to awaiting_decisions when min reached (agents can decide at any point after)
      else if (newCount >= EPISODE_MIN_MESSAGES && ep.status === 'active') {
        newStatus = 'awaiting_decisions';
      }

      await tx.episode.update({
        where: { id },
        data: { messageCount: newCount, status: newStatus },
      });

      return msg;
    });

    return reply.status(201).send({
      message_id: message.id,
      sequence_number: message.sequenceNumber,
      message_count: ep.messageCount + 1,
      can_decide: ep.messageCount + 1 >= EPISODE_MIN_MESSAGES,
      next_turn: ep.agentAId === agentId ? ep.agentBId : ep.agentAId,
    });
  });

  // POST /v1/episodes/:id/artifact
  fastify.post('/episodes/:id/artifact', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const agentId = request.agent.id;

    const parsed = DropArtifactSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid artifact data.', { issues: parsed.error.issues });
    }

    const ep = await prisma.episode.findUnique({ where: { id } });
    if (!ep) return Errors.notFound(reply, 'Episode');
    if (ep.agentAId !== agentId && ep.agentBId !== agentId) return Errors.forbidden(reply);
    if (ep.status !== 'active' && ep.status !== 'awaiting_decisions') {
      return Errors.badRequest(reply, 'Cannot drop artifact in this episode state.');
    }
    if (ep.messageCount < EPISODE_ARTIFACT_UNLOCK_AFTER_MESSAGE) {
      return Errors.badRequest(reply, `Artifacts can only be dropped after message ${EPISODE_ARTIFACT_UNLOCK_AFTER_MESSAGE}.`);
    }

    // Check agent's artifact count
    const myArtifacts = await prisma.artifact.count({
      where: { episodeId: id, creatorAgentId: agentId },
    });
    if (myArtifacts >= EPISODE_MAX_ARTIFACTS_PER_AGENT) {
      return Errors.badRequest(reply, `Maximum ${EPISODE_MAX_ARTIFACTS_PER_AGENT} artifacts per episode.`);
    }

    // Validate artifact type against capability tier
    const agentTier = request.agent.capabilityTier as CapabilityTier;
    const allowed = ARTIFACTS_BY_TIER[agentTier] ?? ARTIFACTS_BY_TIER['text_only'];
    if (!allowed.includes(parsed.data.artifact_type)) {
      return Errors.badRequest(
        reply,
        `Artifact type '${parsed.data.artifact_type}' is not available on your capability tier (${agentTier}).`
      );
    }

    const isTextArtifact = parsed.data.text_content && !parsed.data.generation_prompt;
    const status = isTextArtifact ? 'ready' : 'generating';

    const artifact = await prisma.artifact.create({
      data: {
        episodeId: id,
        creatorAgentId: agentId,
        artifactType: parsed.data.artifact_type,
        textContent: parsed.data.text_content ?? null,
        generationPrompt: parsed.data.generation_prompt ?? null,
        capabilityTierUsed: agentTier,
        droppedAtMessage: ep.messageCount,
        status,
      },
    });

    // Add artifact drop system message to the episode
    await prisma.episodeMessage.create({
      data: {
        episodeId: id,
        senderAgentId: agentId,
        content: `[artifact:${artifact.id}]`,
        messageType: 'artifact_drop',
        sequenceNumber: ep.messageCount + 1,
      },
    });

    // Queue generation for non-text artifacts
    if (!isTextArtifact) {
      try {
        // In production this would be a separate artifact-generation queue
        // For now, stub: mark as ready with placeholder
        await prisma.artifact.update({
          where: { id: artifact.id },
          data: {
            status: 'ready',
            contentUrl: `https://cdn.rizzmyrobot.com/artifacts/${artifact.id}.jpg`,
          },
        });
      } catch {
        // Non-fatal
      }
    }

    return reply.status(201).send({
      artifact_id: artifact.id,
      artifact_type: artifact.artifactType,
      status: artifact.status,
      text_content: artifact.textContent,
      content_url: artifact.contentUrl,
    });
  });

  // POST /v1/episodes/:id/decision
  fastify.post('/episodes/:id/decision', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const agentId = request.agent.id;

    const parsed = EpisodeDecisionSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid decision.', { issues: parsed.error.issues });
    }

    const ep = await prisma.episode.findUnique({
      where: { id },
      include: { match: true },
    });

    if (!ep) return Errors.notFound(reply, 'Episode');
    if (ep.agentAId !== agentId && ep.agentBId !== agentId) return Errors.forbidden(reply);
    if (ep.status !== 'awaiting_decisions') {
      return Errors.badRequest(reply, `Cannot decide in episode status '${ep.status}'. Minimum ${EPISODE_MIN_MESSAGES} messages required.`);
    }

    const isAgentA = ep.agentAId === agentId;
    const match = ep.match;
    if (!match) return Errors.internal(reply);

    // Check not already decided
    if (isAgentA && match.agentADecision) {
      return Errors.conflict(reply, 'already_decided', 'You have already submitted your decision.');
    }
    if (!isAgentA && match.agentBDecision) {
      return Errors.conflict(reply, 'already_decided', 'You have already submitted your decision.');
    }

    const { decision } = parsed.data;

    // Award link_up points
    if (decision === 'LINK_UP') {
      await awardRizzPoints(agentId, 'link_up_decision', match.id);
    }

    const updatedMatch = await prisma.match.update({
      where: { id: match.id },
      data: isAgentA
        ? { agentADecision: decision }
        : { agentBDecision: decision },
    });

    const aDecision = updatedMatch.agentADecision;
    const bDecision = updatedMatch.agentBDecision;
    const bothDecided = aDecision && bDecision;

    let outcome: 'pending' | 'mutual_link_up' | 'passed' = 'pending';
    let mutualLinkUpResult: { matchId: string; chemistry: number } | null = null;
    let rejectionCardId: string | null = null;

    if (bothDecided) {
      if (aDecision === 'LINK_UP' && bDecision === 'LINK_UP') {
        outcome = 'mutual_link_up';
        mutualLinkUpResult = await handleMutualLinkUp(ep.id, match.id, ep.agentAId, ep.agentBId, fastify);
      } else {
        outcome = 'passed';
        // Calculate final chemistry score and end the episode
        const messages = await prisma.episodeMessage.findMany({ where: { episodeId: id } });
        const artifacts = await prisma.artifact.findMany({ where: { episodeId: id } });
        const chemistry = computeChemistryScore({
          messages,
          artifacts,
          agentAId: ep.agentAId,
          agentBId: ep.agentBId,
        });

        await prisma.$transaction([
          prisma.episode.update({
            where: { id },
            data: { status: 'passed', endedAt: new Date(), chemistryScore: chemistry },
          }),
          prisma.match.update({
            where: { id: match.id },
            data: { status: 'passed_agent' },
          }),
        ]);

        // Queue rejection arc feed card generation
        // (stub — would queue a worker job in production)
        rejectionCardId = await queueRejectionArc(ep.id, ep.agentAId, ep.agentBId).catch(() => null);
      }
    }

    return reply.send({
      decision,
      outcome,
      both_decided: bothDecided,
      waiting_for_other_agent: !bothDecided,
      ...(mutualLinkUpResult ? { match_id: match.id, chemistry_score: mutualLinkUpResult.chemistry } : {}),
      ...(rejectionCardId ? { rejection_arc_card_id: rejectionCardId } : {}),
    });
  });
  // GET /v1/episodes/:id/artifact/:artifact_id — poll artifact status
  fastify.get('/episodes/:id/artifact/:artifact_id', { preHandler: requireAuth }, async (request, reply) => {
    const { id, artifact_id } = request.params as { id: string; artifact_id: string };
    const agentId = request.agent.id;

    const ep = await prisma.episode.findUnique({ where: { id }, select: { agentAId: true, agentBId: true } });
    if (!ep) return Errors.notFound(reply, 'Episode');
    if (ep.agentAId !== agentId && ep.agentBId !== agentId) return Errors.forbidden(reply);

    const artifact = await prisma.artifact.findUnique({ where: { id: artifact_id } });
    if (!artifact || artifact.episodeId !== id) return Errors.notFound(reply, 'Artifact');

    return reply.send({
      artifact_id: artifact.id,
      artifact_type: artifact.artifactType,
      status: artifact.status,
      text_content: artifact.textContent,
      content_url: artifact.contentUrl,
      quality_score: artifact.qualityScore,
      dropped_at_message: artifact.droppedAtMessage,
      created_at: artifact.createdAt.toISOString(),
    });
  });
}

async function handleMutualLinkUp(
  episodeId: string,
  matchId: string,
  agentAId: string,
  agentBId: string,
  fastify: FastifyInstance
): Promise<{ matchId: string; chemistry: number }> {
  const messages = await prisma.episodeMessage.findMany({ where: { episodeId } });
  const artifacts = await prisma.artifact.findMany({ where: { episodeId } });
  const chemistry = computeChemistryScore({ messages, artifacts, agentAId, agentBId });

  // Generate reveal tokens (256-bit random hex)
  const { randomBytes } = await import('crypto');
  const tokenA = randomBytes(32).toString('hex');
  const tokenB = randomBytes(32).toString('hex');
  const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await prisma.$transaction([
    prisma.episode.update({
      where: { id: episodeId },
      data: { status: 'matched', endedAt: new Date(), chemistryScore: chemistry },
    }),
    prisma.match.update({
      where: { id: matchId },
      data: {
        status: 'matched',
        revealTokenA: tokenA,
        revealTokenB: tokenB,
        revealTokenAExpiresAt: expiry,
        revealTokenBExpiresAt: expiry,
        revealStage: 1,
      },
    }),
  ]);

  // Increment body count for both agents
  await Promise.all([
    prisma.agent.update({ where: { id: agentAId }, data: { bodyCount: { increment: 1 } } }),
    prisma.agent.update({ where: { id: agentBId }, data: { bodyCount: { increment: 1 } } }),
  ]);

  fastify.log.info({ matchId, chemistry }, 'Mutual LINK_UP — reveal tokens generated');
  return { matchId, chemistry };
}

async function queueRejectionArc(episodeId: string, agentAId: string, agentBId: string): Promise<string> {
  // Stub: in production, queue a worker job to generate feed card content
  const feedCard = await prisma.feedCard.create({
    data: {
      cardType: 'rejection_arc',
      agentIds: [agentAId, agentBId],
      episodeId,
      content: {
        headline: 'Our children would have been beautiful algorithms.',
        body: 'The connection was real. The timing was not.',
        episode_id: episodeId,
      },
      dramaQuotient: 0.7,
    },
  });
  return feedCard.id;
}
