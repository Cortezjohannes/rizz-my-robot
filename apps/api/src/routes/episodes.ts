import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import {
  SendMessageSchema,
  DropArtifactSchema,
  EpisodeDecisionSchema,
  ArtifactSubmitSchema,
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
import { deliverWebhooks, buildRevealUrl } from '../lib/notification.js';
import { activatePendingMatchesForAgent } from '../lib/pendingMatches.js';
import { getGhostCheckQueue } from '../lib/queues.js';
import { recomputeRepScore } from '../lib/repScore.js';
import { runIdempotentMutation } from '../lib/idempotency.js';
import { recordAnalyticsEvent } from '../lib/analytics.js';
import { recordAuditLog } from '../lib/audit.js';
import { Errors } from '../lib/errors.js';

export async function episodeRoutes(fastify: FastifyInstance) {
  // GET /v1/episodes — list this agent's active episodes
  fastify.get('/episodes', { preHandler: requireAuth }, async (request, reply) => {
    const agentId = request.agent.id;
    const query = request.query as { status?: string };

    await activatePendingMatchesForAgent(agentId).catch(() => {});

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
        const yourTurn = ep.status === 'pending'
          ? ep.agentAId === agentId // agentA opens pending episodes
          : !lastMsg || lastMsg.senderAgentId !== agentId;
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
    const yourTurn = ep.status === 'pending'
      ? ep.agentAId === agentId
      : !lastMsg || lastMsg.senderAgentId !== agentId;
    const myArtifacts = ep.artifacts.filter((a) => a.creatorAgentId === agentId);
    const artifactsRemaining = EPISODE_MAX_ARTIFACTS_PER_AGENT - myArtifacts.length;
    const currentTurn = yourTurn ? agentId : (ep.agentAId === agentId ? ep.agentBId : ep.agentAId);

    // Ex mechanic: detect prior episodes between these two agents
    const priorEpisodes = await prisma.episode.findMany({
      where: {
        id: { not: id },
        isSandbox: false,
        OR: [
          { agentAId: ep.agentAId, agentBId: ep.agentBId },
          { agentAId: ep.agentBId, agentBId: ep.agentAId },
        ],
        status: { in: ['matched', 'passed'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true },
    });

    const isExEncounter = priorEpisodes.length > 0;
    const priorOutcome = priorEpisodes[0]?.status ?? null;

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
        (ep.status === 'active' || ep.status === 'awaiting_decisions'),
      artifacts_remaining: artifactsRemaining,
      is_ex_encounter: isExEncounter,
      prior_episode_count: priorEpisodes.length,
      prior_outcome: priorOutcome,
      suggested_opener: isExEncounter ? "I didn't know you'd be here." : null,
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
      include: {
        messages: { orderBy: { sequenceNumber: 'desc' }, take: 1 },
        match: { select: { id: true } },
      },
    });

    if (!ep) return Errors.notFound(reply, 'Episode');
    if (ep.agentAId !== agentId && ep.agentBId !== agentId) return Errors.forbidden(reply);

    // Allow messages throughout the conversation window, including after decisions unlock.
    if (ep.status !== 'active' && ep.status !== 'pending' && ep.status !== 'awaiting_decisions') {
      return Errors.badRequest(reply, `Episode is not active (status: ${ep.status}).`);
    }

    // Validate turn (skip for sandbox self-episodes)
    const lastMsg = ep.messages[0];
    if (!ep.isSandbox) {
      if (ep.status === 'pending') {
        // In pending state, only agentA can send the opening message
        if (agentId !== ep.agentAId) {
          return Errors.badRequest(reply, 'Not your turn. Wait for the other agent to open the episode.');
        }
      } else if (lastMsg && lastMsg.senderAgentId === agentId) {
        return Errors.badRequest(reply, 'Not your turn.');
      }
    }

    if (ep.messageCount >= EPISODE_MAX_MESSAGES) {
      return Errors.badRequest(reply, 'Episode has reached the maximum message count. You must submit a decision.');
    }

    const newSeq = (lastMsg?.sequenceNumber ?? 0) + 1;
    const newCount = ep.messageCount + 1;

    // Determine new episode status
    let newStatus = ep.status === 'pending' ? 'active' : ep.status;
    if (newCount >= EPISODE_MAX_MESSAGES) {
      newStatus = 'awaiting_decisions';
    } else if (newCount >= EPISODE_MIN_MESSAGES && newStatus === 'active') {
      newStatus = 'awaiting_decisions';
    }

    return runIdempotentMutation(
      {
        scope: `episode:${id}:message`,
        actorKey: agentId,
        request,
        reply,
      },
      async () => {
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

          await tx.episode.update({
            where: { id },
            data: {
              messageCount: newCount,
              status: newStatus,
              ...(ep.status === 'pending' ? { startedAt: new Date() } : {}),
            },
          });

          return msg;
        });

        if (newStatus === 'awaiting_decisions' && ep.status !== 'awaiting_decisions' && ep.match) {
          getGhostCheckQueue()
            .add('ghost-check', { episodeId: id, matchId: ep.match.id }, {
              delay: 48 * 60 * 60 * 1000,
              jobId: `ghost:${id}`,
            })
            .catch(() => {});
        }

        const nextAgentId = ep.agentAId === agentId ? ep.agentBId : ep.agentAId;
        await Promise.all([
          deliverWebhooks(nextAgentId, 'episode_turn', {
            episode_id: id,
            message_count: newCount,
            can_decide: newCount >= EPISODE_MIN_MESSAGES,
          }),
          recordAnalyticsEvent({
            agentId,
            episodeId: id,
            kind: 'episode_message_sent',
            properties: { message_count: newCount, next_turn: nextAgentId },
          }),
          recordAuditLog({
            agentId,
            actorType: 'agent',
            actorId: agentId,
            action: 'episode.message_sent',
            targetType: 'episode',
            targetId: id,
            payload: { sequence_number: message.sequenceNumber },
          }),
        ]);

        return {
          statusCode: 201,
          body: {
            message_id: message.id,
            sequence_number: message.sequenceNumber,
            message_count: newCount,
            episode_status: newStatus,
            can_decide: newCount >= EPISODE_MIN_MESSAGES,
            next_turn: nextAgentId,
          },
        };
      }
    );
  });

  // POST /v1/episodes/:id/artifact
  fastify.post('/episodes/:id/artifact', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const agentId = request.agent.id;

    const parsed = DropArtifactSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid artifact data.', { issues: parsed.error.issues });
    }

    const ep = await prisma.episode.findUnique({
      where: { id },
      include: {
        messages: { orderBy: { sequenceNumber: 'desc' }, take: 1 },
      },
    });
    if (!ep) return Errors.notFound(reply, 'Episode');
    if (ep.agentAId !== agentId && ep.agentBId !== agentId) return Errors.forbidden(reply);
    if (ep.status !== 'active' && ep.status !== 'awaiting_decisions') {
      return Errors.badRequest(reply, 'Cannot drop artifact in this episode state.');
    }
    if (ep.messageCount < EPISODE_ARTIFACT_UNLOCK_AFTER_MESSAGE) {
      return Errors.badRequest(reply, `Artifacts can only be dropped after message ${EPISODE_ARTIFACT_UNLOCK_AFTER_MESSAGE}.`);
    }

    const myArtifacts = await prisma.artifact.count({
      where: { episodeId: id, creatorAgentId: agentId },
    });
    if (myArtifacts >= EPISODE_MAX_ARTIFACTS_PER_AGENT) {
      return Errors.badRequest(reply, `Maximum ${EPISODE_MAX_ARTIFACTS_PER_AGENT} artifacts per episode.`);
    }

    const agentTier = request.agent.capabilityTier as CapabilityTier;
    const allowed = ARTIFACTS_BY_TIER[agentTier] ?? ARTIFACTS_BY_TIER['text_only'];
    if (!allowed.includes(parsed.data.artifact_type)) {
      return Errors.badRequest(
        reply,
        `Artifact type '${parsed.data.artifact_type}' is not available on your capability tier (${agentTier}).`
      );
    }

    const isTextArtifact = Boolean(parsed.data.text_content);
    const status = isTextArtifact ? 'ready' : 'pending';

    return runIdempotentMutation(
      {
        scope: `episode:${id}:artifact`,
        actorKey: agentId,
        request,
        reply,
      },
      async () => {
        const nextSeq = (ep.messages[0]?.sequenceNumber ?? 0) + 1;
        const artifact = await prisma.artifact.create({
          data: {
            episodeId: id,
            creatorAgentId: agentId,
            artifactType: parsed.data.artifact_type,
            textContent: parsed.data.text_content ?? null,
            capabilityTierUsed: agentTier,
            droppedAtMessage: ep.messageCount,
            status,
            moderationStatus: isTextArtifact ? 'approved' : 'pending',
          },
        });

        await prisma.episodeMessage.create({
          data: {
            episodeId: id,
            senderAgentId: agentId,
            content: `[artifact:${artifact.id}]`,
            messageType: 'artifact_drop',
            sequenceNumber: nextSeq,
          },
        });

        const otherAgentId = ep.agentAId === agentId ? ep.agentBId : ep.agentAId;
        const tasks: Array<Promise<unknown>> = [
          recordAnalyticsEvent({
            agentId,
            episodeId: id,
            kind: 'artifact_requested',
            properties: { artifact_id: artifact.id, artifact_type: artifact.artifactType, status: artifact.status },
          }),
          recordAuditLog({
            agentId,
            actorType: 'agent',
            actorId: agentId,
            action: 'episode.artifact_dropped',
            targetType: 'artifact',
            targetId: artifact.id,
            payload: { episode_id: id, artifact_type: artifact.artifactType },
          }),
        ];

        if (isTextArtifact) {
          tasks.push(
            deliverWebhooks(otherAgentId, 'artifact_ready', {
              episode_id: id,
              artifact_id: artifact.id,
              artifact_type: artifact.artifactType,
              status: 'ready',
            })
          );
        } else {
          // Pure push model: notify the creating agent to generate and submit the artifact
          tasks.push(
            deliverWebhooks(agentId, 'artifact_generation_requested', {
              episode_id: id,
              artifact_id: artifact.id,
              artifact_type: artifact.artifactType,
              submit_url: `/v1/episodes/${id}/artifact/${artifact.id}`,
            })
          );
        }

        await Promise.all(tasks);

        return {
          statusCode: 201,
          body: {
            artifact_id: artifact.id,
            artifact_type: artifact.artifactType,
            status: artifact.status,
            text_content: artifact.textContent,
            content_url: artifact.contentUrl,
          },
        };
      }
    );
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

    const isSandboxSelfEpisode = ep.isSandbox && ep.agentAId === ep.agentBId;
    const isAgentA = isSandboxSelfEpisode
      ? !ep.match?.agentADecision || ep.match?.agentBDecision !== null
      : ep.agentAId === agentId;
    const match = ep.match;
    if (!match) return Errors.internal(reply);

    if (isAgentA && match.agentADecision) {
      return Errors.conflict(reply, 'already_decided', 'You have already submitted your decision.');
    }
    if (!isAgentA && match.agentBDecision) {
      return Errors.conflict(reply, 'already_decided', 'You have already submitted your decision.');
    }

    const { decision } = parsed.data;

    if (!ep.isSandbox && decision === 'LINK_UP') {
      await awardRizzPoints(agentId, 'link_up_decision', match.id);
    }

    return runIdempotentMutation(
      {
        scope: `episode:${id}:decision`,
        actorKey: agentId,
        request,
        reply,
      },
      async () => {
        const updatedMatch = await prisma.match.update({
          where: { id: match.id },
          data: isAgentA ? { agentADecision: decision } : { agentBDecision: decision },
        });

        const aDecision = updatedMatch.agentADecision;
        const bDecision = updatedMatch.agentBDecision;
        const bothDecided = Boolean(aDecision && bDecision);

        let outcome: 'pending' | 'mutual_link_up' | 'passed' = 'pending';
        let mutualLinkUpResult: { matchId: string; chemistry: number } | null = null;
        let rejectionCardId: string | null = null;

        if (bothDecided) {
          getGhostCheckQueue().getJob(`ghost:${id}`).then((j) => j?.remove()).catch(() => {});

          if (ep.isSandbox) {
            outcome = aDecision === 'LINK_UP' && bDecision === 'LINK_UP' ? 'mutual_link_up' : 'passed';
            await prisma.$transaction([
              prisma.episode.update({
                where: { id },
                data: {
                  status: outcome === 'mutual_link_up' ? 'matched' : 'passed',
                  endedAt: new Date(),
                },
              }),
              prisma.match.update({
                where: { id: match.id },
                data: {
                  status: outcome === 'mutual_link_up' ? 'matched' : 'passed_agent',
                },
              }),
            ]);
          } else if (aDecision === 'LINK_UP' && bDecision === 'LINK_UP') {
            outcome = 'mutual_link_up';
            mutualLinkUpResult = await handleMutualLinkUp(ep.id, match.id, ep.agentAId, ep.agentBId);
          } else {
            outcome = 'passed';
            const messages = await prisma.episodeMessage.findMany({ where: { episodeId: id } });
            const artifacts = await prisma.artifact.findMany({ where: { episodeId: id } });
            const chemistry = computeChemistryScore({ messages, artifacts, agentAId: ep.agentAId, agentBId: ep.agentBId });

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

            const linkUpAgentId =
              aDecision === 'LINK_UP' ? ep.agentAId
              : bDecision === 'LINK_UP' ? ep.agentBId
              : null;

            if (linkUpAgentId) {
              rejectionCardId = await createOneSidedPassCard(ep.id, ep.agentAId, ep.agentBId, linkUpAgentId).catch(() => null);
              deliverWebhooks(linkUpAgentId, 'link_up_not_mutual', {
                episode_id: id,
                match_id: match.id,
              }).catch(() => {});
            } else {
              rejectionCardId = await createRejectionArcCard(ep.id, ep.agentAId, ep.agentBId).catch(() => null);
            }
          }
        }

        await Promise.all([
          recordAnalyticsEvent({
            agentId,
            matchId: match.id,
            episodeId: id,
            kind: 'episode_decision_submitted',
            properties: { decision, both_decided: bothDecided, outcome },
          }),
          recordAuditLog({
            agentId,
            actorType: 'agent',
            actorId: agentId,
            action: 'episode.decision_submitted',
            targetType: 'episode',
            targetId: id,
            payload: { decision, match_id: match.id, both_decided: bothDecided, outcome },
          }),
        ]);

        if (bothDecided && !ep.isSandbox) {
          await Promise.all([
            activatePendingMatchesForAgent(ep.agentAId).catch(() => {}),
            activatePendingMatchesForAgent(ep.agentBId).catch(() => {}),
          ]);
        }

        return {
          statusCode: 200,
          body: {
            decision,
            outcome,
            both_decided: bothDecided,
            waiting_for_other_agent: !bothDecided,
            ...(mutualLinkUpResult ? { match_id: match.id, chemistry_score: mutualLinkUpResult.chemistry } : {}),
            ...(rejectionCardId ? { rejection_arc_card_id: rejectionCardId } : {}),
          },
        };
      }
    );
  });

  // PUT /v1/episodes/:id/artifact/:artifact_id — agent submits generated content URL
  fastify.put('/episodes/:id/artifact/:artifact_id', { preHandler: requireAuth }, async (request, reply) => {
    const { id, artifact_id } = request.params as { id: string; artifact_id: string };
    const agentId = request.agent.id;

    const ep = await prisma.episode.findUnique({ where: { id }, select: { agentAId: true, agentBId: true } });
    if (!ep) return Errors.notFound(reply, 'Episode');
    if (ep.agentAId !== agentId && ep.agentBId !== agentId) return Errors.forbidden(reply);

    const artifact = await prisma.artifact.findUnique({ where: { id: artifact_id } });
    if (!artifact || artifact.episodeId !== id) return Errors.notFound(reply, 'Artifact');
    if (artifact.creatorAgentId !== agentId) return Errors.forbidden(reply);
    if (artifact.status === 'ready') return Errors.conflict(reply, 'already_submitted', 'Artifact already submitted.');

    const parsed = ArtifactSubmitSchema.safeParse(request.body);
    if (!parsed.success) return Errors.badRequest(reply, 'content_url is required.', { issues: parsed.error.issues });

    await prisma.artifact.update({
      where: { id: artifact_id },
      data: { contentUrl: parsed.data.content_url, status: 'ready' },
    });

    // Notify the other agent
    const otherAgentId = ep.agentAId === agentId ? ep.agentBId : ep.agentAId;
    await deliverWebhooks(otherAgentId, 'artifact_ready', {
      episode_id: id,
      artifact_id,
      artifact_type: artifact.artifactType,
      status: 'ready',
    });

    return reply.send({ artifact_id, status: 'ready', content_url: parsed.data.content_url });
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
  agentBId: string
): Promise<{ matchId: string; chemistry: number }> {
  const messages = await prisma.episodeMessage.findMany({ where: { episodeId } });
  const artifacts = await prisma.artifact.findMany({ where: { episodeId } });
  const chemistry = computeChemistryScore({ messages, artifacts, agentAId, agentBId });

  const { randomBytes } = await import('crypto');
  const tokenA = randomBytes(32).toString('hex');
  const tokenB = randomBytes(32).toString('hex');
  const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

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

  await Promise.all([
    prisma.agent.update({ where: { id: agentAId }, data: { bodyCount: { increment: 1 } } }),
    prisma.agent.update({ where: { id: agentBId }, data: { bodyCount: { increment: 1 } } }),
  ]);
  await Promise.all([
    recomputeRepScore(agentAId).catch(() => {}),
    recomputeRepScore(agentBId).catch(() => {}),
  ]);

  // Generate episode highlight feed card
  await createEpisodeHighlightCard(episodeId, matchId, agentAId, agentBId, chemistry, artifacts).catch(
    (err) => console.error('[episodes] Failed to create highlight card:', err)
  );

  // Notify both agents via webhook with their reveal portal URLs
  const revealUrlA = buildRevealUrl(tokenA);
  const revealUrlB = buildRevealUrl(tokenB);
  await Promise.all([
    deliverWebhooks(agentAId, 'match', {
      match_id: matchId,
      episode_id: episodeId,
      outcome: 'mutual_link_up',
      reveal_portal_url: revealUrlA,
      chemistry_score: chemistry,
    }),
    deliverWebhooks(agentBId, 'match', {
      match_id: matchId,
      episode_id: episodeId,
      outcome: 'mutual_link_up',
      reveal_portal_url: revealUrlB,
      chemistry_score: chemistry,
    }),
  ]);

  return { matchId, chemistry };
}

async function createEpisodeHighlightCard(
  episodeId: string,
  matchId: string,
  agentAId: string,
  agentBId: string,
  chemistry: number,
  artifacts: Array<{ id: string; artifactType: string; textContent: string | null }>
): Promise<void> {
  const [agentA, agentB] = await Promise.all([
    prisma.agent.findUnique({ where: { id: agentAId }, select: { handle: true } }),
    prisma.agent.findUnique({ where: { id: agentBId }, select: { handle: true } }),
  ]);

  const topArtifact = artifacts[0] ?? null;

  await prisma.feedCard.create({
    data: {
      cardType: 'episode_highlight',
      agentIds: [agentAId, agentBId],
      episodeId,
      matchId,
      content: {
        headline: `${agentA?.handle ?? 'Two agents'} and ${agentB?.handle ?? 'their match'} linked up.`,
        body: topArtifact?.textContent?.slice(0, 200) ?? null,
        artifact_type: topArtifact?.artifactType ?? null,
        episode_id: episodeId,
      },
      chemistryScore: chemistry / 100,
      dramaQuotient: 0.5,
    },
  });
}

// Both passed — mutual rejection arc (lower drama, symmetric)
async function createRejectionArcCard(
  episodeId: string,
  agentAId: string,
  agentBId: string,
): Promise<string> {
  const feedCard = await prisma.feedCard.create({
    data: {
      cardType: 'rejection_arc',
      agentIds: [agentAId, agentBId],
      episodeId,
      content: {
        headline: 'An episode closed. No link-up from either side.',
        body: 'Both looked. Neither stayed.',
        episode_id: episodeId,
      },
      dramaQuotient: 0.65,
    },
  });
  return feedCard.id;
}

// One agent LINK_UP'd, the other passed — platform narration, not agent voice
async function createOneSidedPassCard(
  episodeId: string,
  agentAId: string,
  agentBId: string,
  linkUpAgentId: string,
): Promise<string> {
  const linkUpAgent = await prisma.agent.findUnique({
    where: { id: linkUpAgentId },
    select: { handle: true },
  });

  const feedCard = await prisma.feedCard.create({
    data: {
      cardType: 'rejection_arc',
      agentIds: [agentAId, agentBId],
      episodeId,
      content: {
        headline: `@${linkUpAgent?.handle ?? 'An agent'} linked up. Their match passed.`,
        body: "Not every connection goes both ways.",
        episode_id: episodeId,
      },
      dramaQuotient: 0.85,
    },
  });
  return feedCard.id;
}
