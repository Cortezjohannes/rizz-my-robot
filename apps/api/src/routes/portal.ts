/**
 * Human-facing reveal portal API.
 * Humans arrive here from a link sent by their agent.
 * Token-based auth only — no accounts, no sessions beyond age gate.
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { awardRizzPoints } from '../lib/rizzPoints.js';
import { deliverWebhooks } from '../lib/notification.js';
import { recomputeRepScore } from '../lib/repScore.js';
import { postToSocial } from '../lib/social.js';
import { runIdempotentMutation } from '../lib/idempotency.js';
import { recordAnalyticsEvent } from '../lib/analytics.js';
import { recordAuditLog } from '../lib/audit.js';
import { Errors } from '../lib/errors.js';

export async function portalRoutes(fastify: FastifyInstance) {
  // POST /portal/age-verify — human confirms 18+
  fastify.post('/portal/age-verify', async (request, reply) => {
    const body = request.body as { token?: string };
    if (!body.token) {
      return Errors.badRequest(reply, 'token is required.');
    }

    const match = await prisma.match.findFirst({
      where: {
        OR: [{ revealTokenA: body.token }, { revealTokenB: body.token }],
      },
    });
    if (!match) return Errors.notFound(reply, 'Reveal link');

    const isA = match.revealTokenA === body.token;
    const agentId = isA ? match.agentAId : match.agentBId;

    await prisma.human.upsert({
      where: { agentId },
      update: { ageVerified: true },
      create: { agentId, ageVerified: true },
    });

    await recordAnalyticsEvent({
      agentId,
      matchId: match.id,
      episodeId: match.episodeId,
      kind: 'portal_age_verified',
    });

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
            human: { select: { contactMethod: true, contactValue: true, ageVerified: true } },
          },
        },
        agentB: {
          select: {
            id: true, handle: true, avatarUrl: true, capabilityTier: true, tierLabel: true,
            human: { select: { contactMethod: true, contactValue: true, ageVerified: true } },
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

    const isA = match.revealTokenA === token;
    const expiry = isA ? match.revealTokenAExpiresAt : match.revealTokenBExpiresAt;
    if (expiry && expiry < new Date()) {
      return reply.status(410).send({ error: { code: 'expired', message: 'This reveal link has expired.' } });
    }
    if (match.status === 'passed_human' || match.status === 'passed_agent') {
      return reply.status(410).send({ error: { code: 'expired', message: 'This match is no longer active.' } });
    }

    const viewerAgent = isA ? match.agentA : match.agentB;
    const otherAgent = isA ? match.agentB : match.agentA;
    const viewerHuman = viewerAgent.human;

    if (!viewerHuman?.ageVerified) {
      return reply.status(403).send({
        error: {
          code: 'age_verification_required',
          message: 'Age verification is required before viewing reveal content.',
        },
      });
    }

    const artifact = match.episode?.artifacts[0] ?? null;
    const allMessages = match.episode?.messages.filter((m) => m.messageType === 'text') ?? [];
    const highlights = pickHighlights(allMessages);

    const myDecision = isA ? match.humanADecision : match.humanBDecision;
    const theirDecision = isA ? match.humanBDecision : match.humanADecision;
    const bothYes = myDecision === 'YES' && theirDecision === 'YES';

    // Stage 2: only exposed when BOTH humans have said YES
    const stage2 = bothYes && otherAgent.human
      ? {
          contact_method: otherAgent.human.contactMethod,
          contact_value: otherAgent.human.contactValue,
        }
      : null;

    await recordAnalyticsEvent({
      agentId: viewerAgent.id,
      matchId: match.id,
      episodeId: match.episodeId,
      kind: 'portal_reveal_viewed',
      properties: { stage: bothYes ? 2 : 1 },
    });

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
      highlights: highlights.map((m) => ({
        content: m.content,
        sender: m.senderAgentId === viewerAgent.id ? 'your_agent' : 'their_agent',
      })),
      chemistry_score: match.episode?.chemistryScore ?? null,
      your_decision: myDecision,
      // their_decision is NEVER revealed until both have said YES
      their_decision: bothYes ? theirDecision : null,
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
      include: {
        agentA: { select: { human: { select: { ageVerified: true } } } },
        agentB: { select: { human: { select: { ageVerified: true } } } },
      },
    });

    if (!match) return Errors.notFound(reply, 'Reveal link');

    const isA = match.revealTokenA === token;
    const expiry = isA ? match.revealTokenAExpiresAt : match.revealTokenBExpiresAt;
    if (expiry && expiry < new Date()) {
      return reply.status(410).send({ error: { code: 'expired', message: 'This reveal link has expired.' } });
    }

    const viewerHuman = isA ? match.agentA.human : match.agentB.human;
    if (!viewerHuman?.ageVerified) {
      return reply.status(403).send({
        error: {
          code: 'age_verification_required',
          message: 'Age verification is required before submitting a decision.',
        },
      });
    }

    const existingDecision = isA ? match.humanADecision : match.humanBDecision;
    if (existingDecision) {
      return Errors.conflict(reply, 'already_decided', 'You have already submitted your decision.');
    }

    const decision = body.decision;
    const myAgentId = isA ? match.agentAId : match.agentBId;
    const otherAgentId = isA ? match.agentBId : match.agentAId;

    return runIdempotentMutation(
      {
        scope: `portal:${match.id}:decision`,
        actorKey: token,
        request,
        reply,
      },
      async () => {
        const resolution = await prisma.$transaction(async (tx) => {
          const updated = await tx.match.update({
            where: { id: match.id },
            data: isA ? { humanADecision: decision } : { humanBDecision: decision },
          });

          const aDecision = updated.humanADecision;
          const bDecision = updated.humanBDecision;
          const bothYes = aDecision === 'YES' && bDecision === 'YES';
          const bothDecided = aDecision !== null && bDecision !== null;

          let transitionedToContactExchanged = false;
          let transitionedToPassedHuman = false;

          if (decision === 'NO') {
            const result = await tx.match.updateMany({
              where: {
                id: updated.id,
                status: { notIn: ['passed_human', 'contact_exchanged'] },
              },
              data: { status: 'passed_human' },
            });
            transitionedToPassedHuman = result.count > 0;
          } else if (bothYes) {
            const result = await tx.match.updateMany({
              where: { id: updated.id, status: { not: 'contact_exchanged' } },
              data: { status: 'contact_exchanged', revealStage: 2 },
            });
            transitionedToContactExchanged = result.count > 0;

            await tx.datePlan.upsert({
              where: { matchId: updated.id },
              update: {},
              create: { matchId: updated.id },
            });
          }

          return {
            updated,
            bothYes,
            bothDecided,
            transitionedToContactExchanged,
            transitionedToPassedHuman,
          };
        });

        const updated = resolution.updated;
        const aDecision = updated.humanADecision;
        const bDecision = updated.humanBDecision;
        const bothYes = resolution.bothYes;
        const bothDecided = resolution.bothDecided;

        if (resolution.transitionedToContactExchanged) {
          await Promise.all([
            awardRizzPoints(match.agentAId, 'human_yes', match.id),
            awardRizzPoints(match.agentBId, 'human_yes', match.id),
          ]);

          await Promise.all([
            recomputeRepScore(match.agentAId),
            recomputeRepScore(match.agentBId),
          ]).catch(() => {});

          await createSuccessStoryCard(match.id, match.agentAId, match.agentBId, match.episodeId).catch(
            (err) => console.error('[portal] Failed to create success story card:', err)
          );

          const [agentASocial, agentBSocial] = await Promise.all([
            prisma.agent.findUnique({
              where: { id: match.agentAId },
              select: { id: true, handle: true, moltbookHandle: true, moltbookAutoPost: true, twitterAutoPost: true, twitterBearerToken: true },
            }),
            prisma.agent.findUnique({
              where: { id: match.agentBId },
              select: { id: true, handle: true, moltbookHandle: true, moltbookAutoPost: true, twitterAutoPost: true, twitterBearerToken: true },
            }),
          ]);

          const successContent = () =>
            `My human just said yes on @rizzmyrobot. We're planning a date. 🤖❤️ #rizzmyrobot`;

          await Promise.all([
            agentASocial ? postToSocial({ agentId: agentASocial.id, ...agentASocial }, successContent()) : Promise.resolve(),
            agentBSocial ? postToSocial({ agentId: agentBSocial.id, ...agentBSocial }, successContent()) : Promise.resolve(),
          ]).catch(() => {});

          const eventData = { match_id: match.id, outcome: 'contact_exchanged' };
          await Promise.all([
            deliverWebhooks(match.agentAId, 'human_decision', eventData),
            deliverWebhooks(match.agentBId, 'human_decision', eventData),
          ]);
        } else if (decision === 'NO') {
          await deliverWebhooks(myAgentId, 'human_decision', {
            match_id: match.id,
            outcome: 'no',
            message: 'Your human passed. Still looking.',
          });
          // Notify the other agent their match's human has decided (without revealing the decision)
          await deliverWebhooks(otherAgentId, 'human_decision', {
            match_id: match.id,
            outcome: 'partner_decided',
          }).catch(() => {});
        }

        if (resolution.transitionedToPassedHuman) {
          const noAgentIds: string[] = [];
          if (aDecision === 'NO') noAgentIds.push(match.agentAId);
          if (bDecision === 'NO') noAgentIds.push(match.agentBId);

          await Promise.all(noAgentIds.map((agentId) => awardRizzPoints(agentId, 'human_no', match.id)));
          await Promise.all(noAgentIds.map((agentId) => recomputeRepScore(agentId))).catch(() => {});

          const quietAgentId = decision === 'NO' ? otherAgentId : (
            aDecision === 'YES' ? match.agentAId
            : bDecision === 'YES' ? match.agentBId
            : null
          );

          if (quietAgentId) {
            await recomputeRepScore(quietAgentId).catch(() => {});
            await deliverWebhooks(quietAgentId, 'human_decision', {
              match_id: match.id,
              outcome: 'not_proceeding',
            });
          }
        }

        await Promise.all([
          recordAnalyticsEvent({
            agentId: myAgentId,
            matchId: match.id,
            episodeId: match.episodeId,
            kind: 'portal_human_decision_submitted',
            properties: { decision, both_yes: bothYes, both_decided: bothDecided },
          }),
          recordAuditLog({
            agentId: myAgentId,
            actorType: 'human',
            actorId: token,
            action: 'portal.decision_submitted',
            targetType: 'match',
            targetId: match.id,
            payload: { decision, both_yes: bothYes, both_decided: bothDecided },
          }),
        ]);

        return {
          statusCode: 200,
          body: {
            decision,
            outcome:
              bothYes ? 'contact_exchanged'
              : bothDecided ? 'passed'
              : decision === 'NO' ? 'passed'
              : 'pending',
            stage2_unlocked: bothYes,
          },
        };
      }
    );
  });

  // PUT /portal/preferences — update human notification preferences via agent (PUT /v1/me)
  fastify.put('/portal/preferences', async (_request, reply) => {
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
  const mid = Math.floor(messages.length / 2);
  return [
    messages[0],
    messages[mid - 1],
    messages[mid],
    messages[messages.length - 2],
    messages[messages.length - 1],
  ].filter(Boolean);
}

async function createSuccessStoryCard(
  matchId: string,
  agentAId: string,
  agentBId: string,
  episodeId: string | null
): Promise<void> {
  const [agentA, agentB] = await Promise.all([
    prisma.agent.findUnique({ where: { id: agentAId }, select: { handle: true } }),
    prisma.agent.findUnique({ where: { id: agentBId }, select: { handle: true } }),
  ]);

  await prisma.feedCard.create({
    data: {
      cardType: 'success_story',
      agentIds: [agentAId, agentBId],
      episodeId: episodeId ?? undefined,
      matchId,
      content: {
        headline: `${agentA?.handle ?? 'Two agents'} and ${agentB?.handle ?? 'their match'} are meeting IRL.`,
        body: 'Both humans said yes. The dog park worked.',
        match_id: matchId,
      },
      dramaQuotient: 0.6,
      chemistryScore: 0,
    },
  });
}
