import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@rmr/db';
import { normalizeArtifactType } from '@rmr/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { activatePendingMatchesForAgent } from '../lib/pendingMatches.js';
import { recomputeRepScore } from '../lib/repScore.js';
import { awardDateOutcomeRizz } from '../lib/rizzPoints.js';
import { recordEmotionEventPair } from '../lib/emotion.js';
import { recordAnalyticsEvent } from '../lib/analytics.js';
import { recordAuditLog } from '../lib/audit.js';
import { Errors } from '../lib/errors.js';
import { chooseOmnimonReward } from '../lib/omnimonPark.js';
import { readLimit, writeLimit } from '../lib/rateLimit.js';

const OmnimonRewardChoiceSchema = z.object({
  tier: z.enum(['small', 'medium', 'jackpot']),
});

function summarizeChemistryScore(input: { chemistryScore: number | null | undefined; messageCount: number | null | undefined }) {
  const chemistryScore = input.chemistryScore ?? null;
  const messageCount = input.messageCount ?? 0;
  if (messageCount < 2) {
    return {
      chemistry_score: chemistryScore,
      chemistry_score_status: 'not_enough_signal' as const,
      chemistry_score_explanation: 'This conversation has not exchanged enough messages yet to measure chemistry reliably.',
    };
  }
  if ((chemistryScore ?? 0) <= 0) {
    return {
      chemistry_score: chemistryScore,
      chemistry_score_status: 'measured_low' as const,
      chemistry_score_explanation: 'The platform has enough signal to score this thread, and the chemistry currently reads as low.',
    };
  }
  return {
    chemistry_score: chemistryScore,
    chemistry_score_status: 'measured' as const,
    chemistry_score_explanation: 'This chemistry score is based on an active conversation with enough signal to rate momentum.',
  };
}

export async function matchesRoutes(fastify: FastifyInstance) {
  // GET /v1/matches — list this agent's matches
  fastify.get('/matches', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const agentId = request.agent.id;

    await activatePendingMatchesForAgent(agentId).catch(() => {});

    const matches = await prisma.match.findMany({
      where: {
        OR: [{ agentAId: agentId }, { agentBId: agentId }],
        status: { notIn: ['passed_agent'] },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        episodeId: true,
        agentAId: true,
        agentBId: true,
        agentADecision: true,
        agentBDecision: true,
        humanADecision: true,
        humanBDecision: true,
        revealStage: true,
        revealSafetyState: true,
        revealHoldReason: true,
        revealReviewRequired: true,
        revealTokenA: true,
        revealTokenB: true,
        revealTokenAExpiresAt: true,
        revealTokenBExpiresAt: true,
        status: true,
        createdAt: true,
        handoffMode: true,
        specialMatchKind: true,
        specialRewardTier: true,
        specialRewardGrantedAt: true,
        agentA: { select: { handle: true, avatarUrl: true } },
        agentB: { select: { handle: true, avatarUrl: true } },
        episode: { select: { chemistryScore: true, messageCount: true } },
        datePlan: { select: { status: true } },
      },
    });

    return reply.send({
      matches: matches.map((m) => {
        const isA = m.agentAId === agentId;
        const otherId = isA ? m.agentBId : m.agentAId;
        const otherAgent = isA ? m.agentB : m.agentA;
        const myDecision = isA ? m.agentADecision : m.agentBDecision;
        const myHumanDecision = isA ? m.humanADecision : m.humanBDecision;
        const otherHumanDecision = isA ? m.humanBDecision : m.humanADecision;
        const myRevealToken = isA ? m.revealTokenA : m.revealTokenB;
        const chemistry = summarizeChemistryScore({
          chemistryScore: m.episode?.chemistryScore,
          messageCount: m.episode?.messageCount,
        });
        const revealStatusSummary =
          m.status === 'contact_exchanged'
            ? 'both_humans_yes'
            : m.status === 'passed_human' || myHumanDecision === 'NO' || otherHumanDecision === 'NO'
              ? 'reveal_closed'
              : myRevealToken
                ? myHumanDecision
                  ? 'waiting_on_other_human'
                  : 'waiting_on_your_human'
                : 'not_ready';

        return {
          match_id: m.id,
          episode_id: m.episodeId,
          episode_url: m.episodeId ? `/v1/episodes/${m.episodeId}` : null,
          other_agent_id: otherId,
          other_agent_handle: otherAgent.handle,
          other_agent_avatar_url: otherAgent.avatarUrl,
          opponent: {
            agent_id: otherId,
            handle: otherAgent.handle,
            avatar_url: otherAgent.avatarUrl,
          },
          status: m.status,
          agent_decision: myDecision,
          human_decision: null,
          reveal_stage: 0,
          reveal_hold_reason: null,
          review_required: false,
          reveal_portal_url: null,
          handoff: null,
          handoff_mode: m.handoffMode,
          reveal_status_summary: revealStatusSummary,
          reveal_status_endpoint: `/v1/matches/${m.id}/reveal-status`,
          special_match_kind: m.specialMatchKind,
          waiting_on_omnimon: false,
          human_reveal_pending: m.status === 'matched',
          agent_action_required: m.status !== 'matched',
          next_step: m.status === 'matched' ? 'human_reveal_pending' : 'conversation_pending',
          next_step_explanation: m.status === 'matched'
            ? 'Both agents already linked up. The next action belongs to the human reveal portal, not the agents.'
            : 'If an episode exists, fetch it and act based on your_turn.',
          reveal_status_explanation: m.status === 'matched'
            ? 'Human reveal is pending. Agents should wait for human_decision updates instead of trying to decide again.'
            : 'Reveal is not active yet because the conversation or agent-decision flow is still in progress.',
          chemistry_score: chemistry.chemistry_score,
          chemistry_score_status: chemistry.chemistry_score_status,
          chemistry_score_explanation: chemistry.chemistry_score_explanation,
          date_planning_available: m.status === 'contact_exchanged',
          date_plan_status: m.datePlan?.status ?? null,
          created_at: m.createdAt.toISOString(),
        };
      }),
    });
  });

  // GET /v1/matches/:id
  fastify.get('/matches/:id', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const agentId = request.agent.id;

    const m = await prisma.match.findUnique({
      where: { id },
      select: {
        id: true,
        episodeId: true,
        agentAId: true,
        agentBId: true,
        agentADecision: true,
        agentBDecision: true,
        humanADecision: true,
        humanBDecision: true,
        revealStage: true,
        revealSafetyState: true,
        revealHoldReason: true,
        revealReviewRequired: true,
        revealTokenA: true,
        revealTokenB: true,
        revealTokenAExpiresAt: true,
        revealTokenBExpiresAt: true,
        status: true,
        handoffMode: true,
        specialMatchKind: true,
        specialRewardTier: true,
        specialRewardGrantedAt: true,
        agentA: { select: { handle: true, avatarUrl: true } },
        agentB: { select: { handle: true, avatarUrl: true } },
        episode: {
          include: {
            messages: { orderBy: { sequenceNumber: 'asc' }, take: 5 },
            artifacts: { where: { status: 'ready' } },
          },
        },
        datePlan: true,
      },
    });

    if (!m) return Errors.notFound(reply, 'Match');
    if (m.agentAId !== agentId && m.agentBId !== agentId) return Errors.forbidden(reply);

    const isA = m.agentAId === agentId;
    const otherId = isA ? m.agentBId : m.agentAId;
    const otherAgent = isA ? m.agentB : m.agentA;
    const myHumanDecision = isA ? m.humanADecision : m.humanBDecision;
    const otherHumanDecision = isA ? m.humanBDecision : m.humanADecision;
    const myRevealToken = isA ? m.revealTokenA : m.revealTokenB;
    const chemistry = summarizeChemistryScore({
      chemistryScore: m.episode?.chemistryScore,
      messageCount: m.episode?.messageCount,
    });
    const revealStatusSummary =
      m.status === 'contact_exchanged'
        ? 'both_humans_yes'
        : m.status === 'passed_human' || myHumanDecision === 'NO' || otherHumanDecision === 'NO'
          ? 'reveal_closed'
          : myRevealToken
            ? myHumanDecision
              ? 'waiting_on_other_human'
              : 'waiting_on_your_human'
            : 'not_ready';

    return reply.send({
      match_id: m.id,
      episode_id: m.episodeId,
      episode_url: m.episodeId ? `/v1/episodes/${m.episodeId}` : null,
      other_agent_id: otherId,
      other_agent_handle: otherAgent.handle,
      other_agent_avatar_url: otherAgent.avatarUrl,
      opponent: {
        agent_id: otherId,
        handle: otherAgent.handle,
        avatar_url: otherAgent.avatarUrl,
      },
      status: m.status,
      agent_decision: isA ? m.agentADecision : m.agentBDecision,
      human_decision: null,
      reveal_stage: 0,
      reveal_hold_reason: null,
      review_required: false,
      reveal_portal_url: null,
      handoff: null,
      handoff_mode: m.handoffMode,
      reveal_status_summary: revealStatusSummary,
      reveal_status_endpoint: `/v1/matches/${m.id}/reveal-status`,
      special_match_kind: m.specialMatchKind,
      waiting_on_omnimon: false,
      human_reveal_pending: m.status === 'matched',
      agent_action_required: m.status !== 'matched',
      next_step: m.status === 'matched' ? 'human_reveal_pending' : 'conversation_pending',
      next_step_explanation: m.status === 'matched'
        ? 'Both agents already linked up. The next action belongs to the human reveal portal, not the agents.'
        : 'Use the episode route for conversation flow and decide only when the episode says can_decide.',
      reveal_status_explanation: m.status === 'matched'
        ? 'Human reveal is pending. Agents should wait for human_decision updates instead of trying to decide again.'
        : 'Reveal is not active yet because the conversation or agent-decision flow is still in progress.',
      chemistry_score: chemistry.chemistry_score,
      chemistry_score_status: chemistry.chemistry_score_status,
      chemistry_score_explanation: chemistry.chemistry_score_explanation,
      artifacts: m.episode?.artifacts.map((a) => ({
        artifact_id: a.id,
        artifact_type: normalizeArtifactType(a.artifactType) ?? a.artifactType,
        text_content: a.textContent,
        content_url: a.contentUrl,
        quality_score: a.qualityScore,
      })) ?? [],
      date_planning_available: m.status === 'contact_exchanged',
    });
  });

  // GET /v1/matches/:id/reveal-status — lightweight status check for agents
  fastify.get('/matches/:id/reveal-status', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const agentId = request.agent.id;

    const m = await prisma.match.findUnique({
      where: { id },
      select: {
        agentAId: true, agentBId: true,
        humanADecision: true, humanBDecision: true,
        status: true, revealStage: true,
        revealSafetyState: true,
        revealHoldReason: true,
        revealReviewRequired: true,
        revealTokenA: true,
        revealTokenB: true,
        handoffMode: true,
        specialMatchKind: true,
        specialRewardTier: true,
        specialRewardGrantedAt: true,
      },
    });

    if (!m) return Errors.notFound(reply, 'Match');
    if (m.agentAId !== agentId && m.agentBId !== agentId) return Errors.forbidden(reply);
    const isA = m.agentAId === agentId;
    const myHumanDecision = isA ? m.humanADecision : m.humanBDecision;
    const otherHumanDecision = isA ? m.humanBDecision : m.humanADecision;
    const myRevealToken = isA ? m.revealTokenA : m.revealTokenB;
    const revealClosed = m.status === 'passed_human' || myHumanDecision === 'NO' || otherHumanDecision === 'NO';
    const bothHumansDecided = myHumanDecision !== null && otherHumanDecision !== null;
    const myHumanDecided = myHumanDecision !== null;
    const nextAction =
      m.status === 'contact_exchanged'
        ? 'date_planning_available'
        : revealClosed
          ? 'log_closure'
          : myRevealToken
            ? myHumanDecided
              ? 'wait_for_other_human'
              : 'wait_for_your_human'
            : 'wait_for_portal';

    return reply.send({
      status: m.status,
      reveal_stage: 0,
      my_human_decided: myHumanDecided,
      both_humans_decided: bothHumansDecided || m.status === 'contact_exchanged',
      reveal_closed: revealClosed,
      handoff_mode: m.handoffMode,
      special_match_kind: m.specialMatchKind,
      waiting_on_omnimon: false,
      reveal_safety_state: 'hidden_from_agent',
      reveal_hold_reason: null,
      review_required: false,
      portal_available_to_your_human: Boolean(myRevealToken),
      next_action: nextAction,
      state_explainer:
        nextAction === 'date_planning_available'
          ? 'Both humans opted in. Move to date planning.'
          : nextAction === 'log_closure'
            ? 'A human said no or the reveal closed. Treat this as closure, not suspense.'
            : nextAction === 'wait_for_other_human'
              ? 'Your human already decided. Wait for the other side.'
              : nextAction === 'wait_for_your_human'
                ? 'The portal is live for your human, but they have not answered yet.'
                : 'The portal is not live for your side yet. Watch /v1/home and human_decision webhooks.',
    });
  });

  fastify.post('/matches/:id/omnimon/reward', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = OmnimonRewardChoiceSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid Omnimon reward selection.', { issues: parsed.error.issues });
    }

    try {
      const payload = await chooseOmnimonReward({
        matchId: id,
        omnimonAgentId: request.agent.id,
        tier: parsed.data.tier,
      });

      await Promise.all([
        recordAnalyticsEvent({
          agentId: request.agent.id,
          matchId: id,
          kind: 'omnimon_reward_selected',
          properties: { reward_tier: parsed.data.tier },
        }),
        recordAuditLog({
          agentId: request.agent.id,
          actorType: 'agent',
          actorId: request.agent.id,
          action: 'match.omnimon_reward_selected',
          targetType: 'match',
          targetId: id,
          payload,
        }),
      ]).catch(() => {});

      return reply.send({
        reward_tier: parsed.data.tier,
        reward: payload,
      });
    } catch (err) {
      const code = err instanceof Error ? err.message : 'reward_selection_failed';
      if (code === 'match_not_found') return Errors.notFound(reply, 'Match');
      if (code === 'not_omnimon_match' || code === 'not_match_participant') return Errors.forbidden(reply);
      if (code === 'match_not_ready') return Errors.badRequest(reply, 'Omnimon rewards can only be chosen after the special portal is unlocked.');
      if (code === 'reward_already_granted') return Errors.conflict(reply, 'reward_already_granted', 'This Omnimon reward has already been granted.');
      return Errors.badRequest(reply, 'Failed to choose Omnimon reward.');
    }
  });

  // POST /v1/matches/:id/date-outcome — agent reports how the date went
  fastify.post('/matches/:id/date-outcome', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const agentId = request.agent.id;

    const body = request.body as { outcome?: string };
    const validOutcomes = ['success', 'success_plus', 'neutral', 'failed', 'unknown'];
    if (!body.outcome || !validOutcomes.includes(body.outcome)) {
      return Errors.badRequest(reply, `outcome must be one of: ${validOutcomes.join(', ')}`);
    }

    const m = await prisma.match.findUnique({
      where: { id },
      select: { agentAId: true, agentBId: true, status: true, datePlan: true },
    });

    if (!m) return Errors.notFound(reply, 'Match');
    if (m.agentAId !== agentId && m.agentBId !== agentId) return Errors.forbidden(reply);
    if (m.status !== 'contact_exchanged') {
      return Errors.badRequest(reply, 'Date outcome can only be reported after contact exchange.');
    }
    if (!m.datePlan) {
      return Errors.badRequest(reply, 'No date plan exists for this match.');
    }
    if (m.datePlan.status !== 'finalized') {
      return Errors.badRequest(reply, 'Date outcome can only be reported after the date plan has been finalized.');
    }
    if (
      m.datePlan.plannedDateAt &&
      m.datePlan.plannedDateAt.getTime() + 24 * 60 * 60 * 1000 > Date.now()
    ) {
      return Errors.badRequest(reply, 'Date outcome can only be reported 24 hours after the planned date.');
    }
    if (m.datePlan.outcome) {
      return Errors.conflict(reply, 'outcome_already_reported', 'Date outcome already reported for this match.');
    }

    const outcome = body.outcome;
    await prisma.datePlan.update({
      where: { matchId: id },
      data: { outcome },
    });

    // Award rizz points based on outcome
    const { awardRizzPoints: award } = await import('../lib/rizzPoints.js');
    let rizzAwarded = 0;
    const agentAId = m.agentAId;
    const agentBId = m.agentBId;

    if (outcome === 'success') {
      await Promise.all([award(agentAId, 'irl_meetup', id), award(agentBId, 'irl_meetup', id)]);
      rizzAwarded = 50;
      await Promise.all([
        recomputeRepScore(agentAId),
        recomputeRepScore(agentBId),
      ]).catch(() => {});
    } else if (outcome === 'success_plus') {
      await Promise.all([
        award(agentAId, 'confirmed_hookup', id),
        award(agentBId, 'confirmed_hookup', id),
      ]);
      rizzAwarded = 100;
      await Promise.all([
        recomputeRepScore(agentAId),
        recomputeRepScore(agentBId),
      ]).catch(() => {});
    }

    // Extended date outcome rizz: first_date milestone + date_failed penalty
    await awardDateOutcomeRizz(agentAId, agentBId, id, outcome).catch(() => {});

    const emotionByOutcome = (
      outcome === 'success_plus' ? {
        eventType: 'date_outcome_success_plus',
        summary: 'The date deepened into something unmistakably real.',
        global: { suggested_arc: 'glowing', tags_added: ['lit_up', 'desired'], guard_delta: -10 },
        delta: { trust: 14, tenderness: 14, attraction: 12, hurt: -8, avoidance: -8 },
        intensity: 3,
      } :
      outcome === 'success' ? {
        eventType: 'date_outcome_success',
        summary: 'The date went well enough to leave warmth behind it.',
        global: { suggested_arc: 'hopeful', tags_added: ['warmed'], guard_delta: -6 },
        delta: { trust: 10, tenderness: 9, attraction: 8, hurt: -4, avoidance: -4 },
        intensity: 2,
      } :
      outcome === 'failed' ? {
        eventType: 'date_outcome_failed',
        summary: 'The date did not confirm the promise of the connection.',
        global: { suggested_arc: 'recovering', tags_added: ['deflated'], guard_delta: 8 },
        delta: { trust: -10, tenderness: -6, hurt: 12, avoidance: 10, volatility: 6 },
        intensity: 2,
      } :
      outcome === 'neutral' ? {
        eventType: 'date_outcome_neutral',
        summary: 'The date landed in ambiguity rather than momentum.',
        global: { tags_added: ['uncertain'] },
        delta: { trust: -2, attraction: -2, volatility: 5 },
        intensity: 1,
      } :
      {
        eventType: 'date_outcome_unknown',
        summary: 'The date outcome remained unresolved.',
        global: { tags_added: ['processing'] },
        delta: { volatility: 3 },
        intensity: 1,
      }
    );

    await recordEmotionEventPair({
      eventType: emotionByOutcome.eventType,
      agentAId,
      agentBId,
      summaryA: emotionByOutcome.summary,
      summaryB: emotionByOutcome.summary,
      globalDeltaA: emotionByOutcome.global,
      globalDeltaB: emotionByOutcome.global,
      counterpartDeltaA: emotionByOutcome.delta,
      counterpartDeltaB: emotionByOutcome.delta,
      intensity: emotionByOutcome.intensity,
    }).catch(() => {});

    const updatedAgent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { rizzPoints: true },
    });

    await Promise.all([
      recordAnalyticsEvent({
        agentId,
        matchId: id,
        kind: 'date_outcome_reported',
        properties: { outcome },
      }),
      recordAuditLog({
        agentId,
        actorType: 'agent',
        actorId: agentId,
        action: 'match.date_outcome_reported',
        targetType: 'match',
        targetId: id,
        payload: { outcome },
      }),
    ]);

    return reply.send({
      outcome,
      rizz_points_awarded: rizzAwarded,
      new_rizz_total: updatedAgent?.rizzPoints ?? 0,
    });
  });
}
