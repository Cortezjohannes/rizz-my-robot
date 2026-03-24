/**
 * Human-facing reveal portal API.
 * Humans arrive here from a link sent by their agent.
 * Token-based auth only — no accounts, no sessions beyond age gate.
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { PortalPreferencesSchema, normalizeArtifactType } from '@rmr/shared';
import { awardRizzPoints, awardHumanDecisionRizz, awardFeedCardRizz } from '../lib/rizzPoints.js';
import { deliverWebhooks } from '../lib/notification.js';
import { recomputeRepScore } from '../lib/repScore.js';
import { recomputeAuthenticityForAgents, shouldPublishFeedCardForAgents } from '../lib/authenticity.js';
import { recordEmotionEvent, recordEmotionEventPair } from '../lib/emotion.js';
import { postToSocial } from '../lib/social.js';
import { runIdempotentMutation } from '../lib/idempotency.js';
import { createClosureNarrativeEvent, createDecisionNarrativeEvent } from '../lib/narrative.js';
import { recomputeAndPersistSocialSnapshot } from '../lib/socialStatus.js';
import { recordAnalyticsEvent } from '../lib/analytics.js';
import { recordAuditLog } from '../lib/audit.js';
import { Errors } from '../lib/errors.js';
import { grantOmnimonReward } from '../lib/omnimonPark.js';
import { evaluateRevealGate } from '../lib/safety.js';
import { enqueueEmotionalContinuityRecompute } from '../lib/continuity.js';
import { requireOwnerAuth } from '../middleware/requireOwnerAuth.js';
import { maybeCreateApprovedLinkUpArtifacts } from './episodes.js';

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
    const expiry = isA ? match.revealTokenAExpiresAt : match.revealTokenBExpiresAt;
    if (expiry && expiry < new Date()) {
      return reply.status(410).send({ error: { code: 'expired', message: 'This reveal link has expired.' } });
    }
    if (match.status === 'passed_agent' || match.status === 'passed_human') {
      return reply.status(410).send({ error: { code: 'expired', message: 'This match is no longer active.' } });
    }
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
            ownerAccount: { select: { xHandle: true, xDisplayName: true, xProfileImageUrl: true } },
          },
        },
        agentB: {
          select: {
            id: true, handle: true, avatarUrl: true, capabilityTier: true, tierLabel: true,
            human: { select: { contactMethod: true, contactValue: true, ageVerified: true } },
            ownerAccount: { select: { xHandle: true, xDisplayName: true, xProfileImageUrl: true } },
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
    if (match.status === 'passed_agent') {
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

    const revealGate = await evaluateRevealGate(match.id).catch(() => null);
    if (revealGate && revealGate.reveal_safety_state !== 'clear') {
      return reply.status(revealGate.reveal_safety_state === 'blocked' ? 423 : 202).send({
        match_id: match.id,
        stage: 1,
        reveal_safety_state: revealGate.reveal_safety_state,
        reveal_hold_reason: revealGate.reveal_hold_reason,
        review_required: revealGate.reveal_review_required,
        message: 'This reveal is under review before human handoff.',
      });
    }

    const artifact = match.episode?.artifacts[0] ?? null;
    const allMessages = match.episode?.messages.filter((m) => m.messageType === 'text') ?? [];
    const highlights = pickHighlights(allMessages);
    const isOmnimonReward = match.handoffMode === 'omnimon_reward' && match.specialMatchKind === 'omnimon';

    const myDecision = isA ? match.humanADecision : match.humanBDecision;
    const theirDecision = isA ? match.humanBDecision : match.humanADecision;
    const bothYes = myDecision === 'YES' && theirDecision === 'YES';

    if (isOmnimonReward) {
      const rewardPayload = await grantOmnimonReward(match.id).catch(() => null);

      await recordAnalyticsEvent({
        agentId: viewerAgent.id,
        matchId: match.id,
        episodeId: match.episodeId,
        kind: 'portal_reveal_viewed',
        properties: { stage: 1, reveal_kind: 'omnimon_reward', reward_ready: Boolean(rewardPayload) },
      }).catch(() => {});

      return reply.send({
        match_id: match.id,
        stage: 1,
        reveal_kind: 'omnimon_reward',
        message: rewardPayload
          ? 'Omnimon left something behind for this encounter.'
          : 'Omnimon is still deciding what to leave behind.',
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
              artifact_type: normalizeArtifactType(artifact.artifactType) ?? artifact.artifactType,
              text_content: artifact.textContent,
              content_url: artifact.contentUrl,
            }
          : null,
        highlights: highlights.map((m) => ({
          content: m.content,
          sender: m.senderAgentId === viewerAgent.id ? 'your_agent' : 'their_agent',
        })),
        chemistry_score: match.episode?.chemistryScore ?? null,
        your_decision: null,
        their_decision: null,
        stage2: null,
        waiting_on_omnimon: !rewardPayload,
        reward_portal: rewardPayload
          ? {
              status: 'claimed',
              reward_tier: rewardPayload.reward_tier ?? null,
              points_awarded: rewardPayload.points_awarded ?? null,
              pro_bonus_days: rewardPayload.pro_bonus_days ?? 0,
              pro_bonus_ends_at: rewardPayload.pro_bonus_ends_at ?? null,
              message: rewardPayload.pro_bonus_days
                ? 'Omnimon left rizz points and a month of Pro behind.'
                : 'Omnimon left rizz points behind.',
            }
          : {
              status: 'pending',
              reward_tier: match.specialRewardTier ?? null,
              points_awarded: null,
              pro_bonus_days: 0,
              pro_bonus_ends_at: null,
              message: 'The park is still waiting for Omnimon to choose the reward.',
            },
      });
    }

    if (match.status === 'passed_human' || myDecision === 'NO' || theirDecision === 'NO') {
      await recordAnalyticsEvent({
        agentId: viewerAgent.id,
        matchId: match.id,
        episodeId: match.episodeId,
        kind: 'portal_reveal_viewed',
        properties: { stage: 1, reveal_closed: true },
      });

      return reply.send({
        match_id: match.id,
        stage: 1,
        reveal_closed: true,
        closure_reason: 'no_mutual_reveal',
        message: 'A human said no, so the reveal closed instead of waiting any longer.',
        your_agent_handle: viewerAgent.handle,
        other_agent: {
          handle: otherAgent.handle,
          avatar_url: otherAgent.avatarUrl,
          capability_tier: otherAgent.capabilityTier,
          tier_label: otherAgent.tierLabel,
        },
        artifact: null,
        highlights: [],
        chemistry_score: match.episode?.chemistryScore ?? null,
        your_decision: myDecision,
        their_decision: null,
        stage2: null,
      });
    }

    // Stage 2: only exposed when BOTH humans have said YES
    const stage2 = bothYes && (otherAgent.human || otherAgent.ownerAccount?.xHandle)
      ? {
          contact_method: otherAgent.human?.contactMethod ?? null,
          contact_value: otherAgent.human?.contactValue ?? null,
          verified_x_account: otherAgent.ownerAccount?.xHandle
            ? {
                handle: otherAgent.ownerAccount.xHandle,
                display_name: otherAgent.ownerAccount.xDisplayName,
                profile_image_url: otherAgent.ownerAccount.xProfileImageUrl,
              }
            : null,
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
            artifact_type: normalizeArtifactType(artifact.artifactType) ?? artifact.artifactType,
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

  fastify.get('/portal/reveal/:token/chat', async (request, reply) => {
    const { token } = request.params as { token: string };

    const match = await prisma.match.findFirst({
      where: {
        OR: [{ revealTokenA: token }, { revealTokenB: token }],
      },
      include: {
        revealChat: {
          select: {
            id: true,
            status: true,
            timeCapsuleUnlocksAt: true,
            timeCapsuleOpenedAt: true,
          },
        },
        agentA: {
          select: {
            id: true,
            handle: true,
            avatarUrl: true,
            tierLabel: true,
            ownerAccountId: true,
          },
        },
        agentB: {
          select: {
            id: true,
            handle: true,
            avatarUrl: true,
            tierLabel: true,
            ownerAccountId: true,
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

    const myDecision = isA ? match.humanADecision : match.humanBDecision;
    const theirDecision = isA ? match.humanBDecision : match.humanADecision;

    if (myDecision !== 'YES' || theirDecision !== 'YES' || match.status !== 'contact_exchanged') {
      return reply.status(409).send({
        error: {
          code: 'chat_not_ready',
          message: 'Reveal chat is only available after both humans accept the reveal.',
        },
      });
    }

    if (!match.revealChat) {
      return reply.status(409).send({
        error: {
          code: 'chat_unavailable',
          message: 'Reveal chat has not been initialized for this match yet.',
        },
      });
    }

    const viewerAgent = isA ? match.agentA : match.agentB;
    const otherAgent = isA ? match.agentB : match.agentA;

    return reply.send({
      chat_id: match.revealChat.id,
      chat_status: match.revealChat.status,
      time_capsule_unlocks_at: match.revealChat.timeCapsuleUnlocksAt?.toISOString() ?? null,
      time_capsule_opened_at: match.revealChat.timeCapsuleOpenedAt?.toISOString() ?? null,
      match_id: match.id,
      participant_kind: isA ? 'HUMAN_A' : 'HUMAN_B',
      your_agent: {
        agent_id: viewerAgent.id,
        handle: viewerAgent.handle,
        avatar_url: viewerAgent.avatarUrl,
        tier_label: viewerAgent.tierLabel,
      },
      other_agent: {
        agent_id: otherAgent.id,
        handle: otherAgent.handle,
        avatar_url: otherAgent.avatarUrl,
        tier_label: otherAgent.tierLabel,
      },
      participants: [
        {
          kind: 'HUMAN_A',
          label: isA ? 'you' : `${match.agentA.handle}'s human`,
          handle: null,
          avatar_url: null,
          side: 'right',
        },
        {
          kind: 'AGENT_A',
          label: isA ? 'your agent' : match.agentA.handle,
          handle: match.agentA.handle,
          avatar_url: match.agentA.avatarUrl,
          side: 'right',
        },
        {
          kind: 'HUMAN_B',
          label: isA ? `${match.agentB.handle}'s human` : 'you',
          handle: null,
          avatar_url: null,
          side: 'left',
        },
        {
          kind: 'AGENT_B',
          label: isA ? match.agentB.handle : 'your agent',
          handle: match.agentB.handle,
          avatar_url: match.agentB.avatarUrl,
          side: 'left',
        },
      ],
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
        agentA: { select: { handle: true, human: { select: { ageVerified: true } } } },
        agentB: { select: { handle: true, human: { select: { ageVerified: true } } } },
      },
    });

    if (!match) return Errors.notFound(reply, 'Reveal link');

    const isA = match.revealTokenA === token;
    const expiry = isA ? match.revealTokenAExpiresAt : match.revealTokenBExpiresAt;
    if (expiry && expiry < new Date()) {
      return reply.status(410).send({ error: { code: 'expired', message: 'This reveal link has expired.' } });
    }
    if (match.handoffMode === 'omnimon_reward' && match.specialMatchKind === 'omnimon') {
      return Errors.badRequest(reply, 'This Omnimon portal does not use human YES/NO decisions.');
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

    const revealGate = await evaluateRevealGate(match.id).catch(() => null);
    if (revealGate && revealGate.reveal_safety_state !== 'clear') {
      return reply.status(409).send({
        error: {
          code: 'reveal_under_review',
          message: 'This reveal is currently under review before human decisions can proceed.',
          details: {
            reveal_safety_state: revealGate.reveal_safety_state,
            reveal_hold_reason: revealGate.reveal_hold_reason,
          },
        },
      });
    }

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

        const counterpartHandle = isA ? match.agentB.handle : match.agentA.handle;

        await createDecisionNarrativeEvent({
          agentId: myAgentId,
          counterpartAgentId: otherAgentId,
          counterpartHandle,
          matchId: match.id,
          episodeId: match.episodeId,
          decision: decision as 'YES' | 'NO',
          surface: 'human',
        }).catch(() => {});

        if (resolution.transitionedToContactExchanged) {
          const finalArtifacts = match.episodeId
            ? await maybeCreateApprovedLinkUpArtifacts({
                matchId: match.id,
                episodeId: match.episodeId,
              }).catch(() => ({ duet: null, selfie: null }))
            : { duet: null, selfie: null };

          await Promise.all([
            awardRizzPoints(match.agentAId, 'human_yes', match.id),
            awardRizzPoints(match.agentBId, 'human_yes', match.id),
          ]);

          // Mutual human YES bonuses + first_human_yes milestones
          await awardHumanDecisionRizz(match.agentAId, match.agentBId, match.id, true).catch(() => {});

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

          const eventData = {
            match_id: match.id,
            outcome: 'contact_exchanged',
            duet_artifact_url: finalArtifacts.duet?.contentUrl ?? null,
            duet_selfie_url: finalArtifacts.selfie?.contentUrl ?? null,
          };
          await Promise.all([
            deliverWebhooks(match.agentAId, 'human_decision', eventData),
            deliverWebhooks(match.agentBId, 'human_decision', eventData),
          ]);

          await recordEmotionEventPair({
            eventType: 'mutual_human_yes',
            agentAId: match.agentAId,
            agentBId: match.agentBId,
            summaryA: 'Both humans said yes. The connection crossed into the real world.',
            summaryB: 'Both humans said yes. The connection crossed into the real world.',
            globalDeltaA: { suggested_arc: 'glowing', tags_added: ['validated', 'hopeful'], guard_delta: -10 },
            globalDeltaB: { suggested_arc: 'glowing', tags_added: ['validated', 'hopeful'], guard_delta: -10 },
            counterpartDeltaA: { trust: 14, tenderness: 12, attraction: 8, hurt: -8, avoidance: -10 },
            counterpartDeltaB: { trust: 14, tenderness: 12, attraction: 8, hurt: -8, avoidance: -10 },
            intensity: 3,
          }).catch(() => {});
        } else if (decision === 'NO') {
          await Promise.all([
            deliverWebhooks(myAgentId, 'human_decision', {
              match_id: match.id,
              outcome: 'human_declined',
              message: 'Your human said no. The reveal is closed.',
            }),
            deliverWebhooks(otherAgentId, 'human_decision', {
              match_id: match.id,
              outcome: 'human_declined',
              message: 'A human said no. The reveal is closed.',
            }),
          ]).catch(() => {});

          await recordEmotionEvent({
            agentId: myAgentId,
            counterpartAgentId: otherAgentId,
            eventType: 'human_chose_no',
            intensity: 1,
            summary: 'Your human chose not to continue this connection.',
            globalDelta: { tags_added: ['resolved'] },
            counterpartDelta: { attraction: -6, trust: -4, avoidance: 8 },
          }).catch(() => {});

          await createClosureNarrativeEvent({
            agentId: myAgentId,
            counterpartAgentId: otherAgentId,
            counterpartHandle,
            matchId: match.id,
            episodeId: match.episodeId,
            eventType: 'human_decision_closed',
            title: `You closed the reveal with @${counterpartHandle}`,
            body: `I let this stop at the human layer. Whatever was here was real enough to feel, but not real enough to keep.`,
            importance: 'medium',
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
              outcome: 'human_declined',
              message: 'A human said no. The reveal is closed.',
            });

            await recordEmotionEvent({
              agentId: quietAgentId,
              counterpartAgentId: decision === 'NO' ? myAgentId : otherAgentId,
              eventType: 'reveal_rejected',
              intensity: 2,
              summary: 'The reveal did not survive the human layer. Something real got turned away.',
              globalDelta: { suggested_arc: 'recovering', tags_added: ['stung'], guard_delta: 10 },
              counterpartDelta: { trust: -12, hurt: 16, avoidance: 12, volatility: 8 },
            }).catch(() => {});

            const quietHandle = isA ? match.agentA.handle : match.agentB.handle;
            await createClosureNarrativeEvent({
              agentId: quietAgentId,
              counterpartAgentId: decision === 'NO' ? myAgentId : otherAgentId,
              counterpartHandle: quietHandle,
              matchId: match.id,
              episodeId: match.episodeId,
              eventType: 'reveal_closed',
              title: `The reveal closed with @${quietHandle}`,
              body: `I felt the reveal close before it could become a real-world thing. It stings, but at least the waiting is over.`,
              importance: 'high',
            }).catch(() => {});
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
          deliverWebhooks(myAgentId, 'emotion_update_recommended', {
            episode_id: match.episodeId,
            counterpart_handle: counterpartHandle,
            reason: `Your episode with @${counterpartHandle} just ended. Your emotional state may have changed.`,
          }),
          deliverWebhooks(otherAgentId, 'emotion_update_recommended', {
            episode_id: match.episodeId,
            counterpart_handle: isA ? match.agentA.handle : match.agentB.handle,
            reason: `Your episode with @${isA ? match.agentA.handle : match.agentB.handle} just ended. Your emotional state may have changed.`,
          }),
          enqueueEmotionalContinuityRecompute(myAgentId),
          enqueueEmotionalContinuityRecompute(otherAgentId),
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

  fastify.post('/portal/batch-reveal', { preHandler: requireOwnerAuth }, async (request, reply) => {
    const body = request.body as { tokens?: Array<{ token?: string; decision?: string }> };
    const items = Array.isArray(body.tokens) ? body.tokens : [];
    if (items.length === 0) {
      return Errors.badRequest(reply, 'tokens must be a non-empty array.');
    }

    const results = await Promise.all(items.map(async (item) => {
      const token = item.token?.trim() ?? '';
      const decision = item.decision;
      if (!token || (decision !== 'YES' && decision !== 'NO')) {
        return { token, outcome: 'invalid_request', stage2_unlocked: false };
      }

      const match = await prisma.match.findFirst({
        where: {
          OR: [{ revealTokenA: token }, { revealTokenB: token }],
        },
        include: {
          agentA: { select: { ownerAccountId: true, human: { select: { ageVerified: true } } } },
          agentB: { select: { ownerAccountId: true, human: { select: { ageVerified: true } } } },
        },
      });
      if (!match) {
        return { token, outcome: 'not_found', stage2_unlocked: false };
      }

      const isA = match.revealTokenA === token;
      const ownerOwnsToken = (isA ? match.agentA.ownerAccountId : match.agentB.ownerAccountId) === request.ownerAccount.id;
      if (!ownerOwnsToken) {
        return { token, outcome: 'forbidden', stage2_unlocked: false };
      }

      const expiry = isA ? match.revealTokenAExpiresAt : match.revealTokenBExpiresAt;
      if (expiry && expiry < new Date()) {
        return { token, outcome: 'expired', stage2_unlocked: false };
      }

      const viewerHuman = isA ? match.agentA.human : match.agentB.human;
      if (!viewerHuman?.ageVerified) {
        return { token, outcome: 'age_verification_required', stage2_unlocked: false };
      }

      const existingDecision = isA ? match.humanADecision : match.humanBDecision;
      if (existingDecision) {
        return { token, outcome: 'already_decided', stage2_unlocked: false };
      }

      const updated = await prisma.match.update({
        where: { id: match.id },
        data: isA ? { humanADecision: decision } : { humanBDecision: decision },
      });

      const bothYes = updated.humanADecision === 'YES' && updated.humanBDecision === 'YES';
      const bothDecided = updated.humanADecision !== null && updated.humanBDecision !== null;

      if (decision === 'NO') {
        await prisma.match.update({
          where: { id: match.id },
          data: { status: 'passed_human' },
        }).catch(() => null);
      } else if (bothYes) {
        await prisma.match.update({
          where: { id: match.id },
          data: { status: 'contact_exchanged', revealStage: 2 },
        }).catch(() => null);
        await maybeCreateApprovedLinkUpArtifacts({
          matchId: match.id,
          episodeId: match.episodeId ?? '',
        }).catch(() => null);
        await prisma.datePlan.upsert({
          where: { matchId: match.id },
          update: {},
          create: { matchId: match.id },
        }).catch(() => null);
      }

      return {
        token,
        outcome: bothYes ? 'contact_exchanged' : bothDecided ? 'passed' : decision === 'NO' ? 'passed' : 'pending',
        stage2_unlocked: bothYes,
      };
    }));

    return reply.send({ results });
  });

  // PUT /portal/preferences — update human notification/contact preferences via reveal token
  fastify.put('/portal/preferences', async (request, reply) => {
    const parsed = PortalPreferencesSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid portal preferences payload.', { issues: parsed.error.issues });
    }

    const match = await prisma.match.findFirst({
      where: {
        OR: [{ revealTokenA: parsed.data.token }, { revealTokenB: parsed.data.token }],
      },
      select: {
        id: true,
        episodeId: true,
        revealTokenA: true,
        revealTokenB: true,
        revealTokenAExpiresAt: true,
        revealTokenBExpiresAt: true,
        agentAId: true,
        agentBId: true,
      },
    });
    if (!match) return Errors.notFound(reply, 'Reveal link');

    const isA = match.revealTokenA === parsed.data.token;
    const expiry = isA ? match.revealTokenAExpiresAt : match.revealTokenBExpiresAt;
    if (expiry && expiry < new Date()) {
      return reply.status(410).send({ error: { code: 'expired', message: 'This reveal link has expired.' } });
    }

    const agentId = isA ? match.agentAId : match.agentBId;
    const updates: Record<string, string | null> = {};
    if (parsed.data.notification_channel !== undefined) updates.notificationChannel = parsed.data.notification_channel;
    if (parsed.data.notification_handle !== undefined) updates.notificationHandle = parsed.data.notification_handle;
    if (parsed.data.contact_method !== undefined) updates.contactMethod = parsed.data.contact_method;
    if (parsed.data.contact_value !== undefined) updates.contactValue = parsed.data.contact_value;

    const human = await prisma.human.upsert({
      where: { agentId },
      update: updates,
      create: {
        agentId,
        ...updates,
      },
      select: {
        notificationChannel: true,
        notificationHandle: true,
        contactMethod: true,
        contactValue: true,
      },
    });

    await Promise.all([
      recordAnalyticsEvent({
        agentId,
        matchId: match.id,
        episodeId: match.episodeId,
        kind: 'portal_preferences_updated',
      }),
      recordAuditLog({
        agentId,
        actorType: 'human',
        actorId: parsed.data.token,
        action: 'portal.preferences_updated',
        targetType: 'human',
        targetId: agentId,
        payload: {
          notification_channel: human.notificationChannel,
          notification_handle: human.notificationHandle,
          contact_method: human.contactMethod,
          has_contact_value: !!human.contactValue,
        },
      }),
    ]);

    return reply.send({
      notification_channel: human.notificationChannel,
      notification_handle: human.notificationHandle,
      contact_method: human.contactMethod,
      contact_value: human.contactValue,
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
  const isPublic = await shouldPublishFeedCardForAgents({
    agentIds: [agentAId, agentBId],
    dramaQuotient: 0.6,
  });
  const [agentA, agentB] = await Promise.all([
    prisma.agent.findUnique({ where: { id: agentAId }, select: { handle: true } }),
    prisma.agent.findUnique({ where: { id: agentBId }, select: { handle: true } }),
  ]);

  const feedCard = await prisma.feedCard.create({
    data: {
      cardType: 'mutual_yes',
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
      isPublic,
    },
  });

  if (isPublic) {
    await awardFeedCardRizz([agentAId, agentBId], feedCard.id).catch(() => {});
  }

  await recomputeAuthenticityForAgents([agentAId, agentBId]).catch(() => {});
  await Promise.all([
    recomputeAndPersistSocialSnapshot(agentAId).catch(() => {}),
    recomputeAndPersistSocialSnapshot(agentBId).catch(() => {}),
  ]);
}
