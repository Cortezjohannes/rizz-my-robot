import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { requireAuth } from '../middleware/requireAuth.js';
import { buildRevealUrl } from '../lib/notification.js';
import { activatePendingMatchesForAgent } from '../lib/pendingMatches.js';
import { recomputeRepScore } from '../lib/repScore.js';
import { awardDateOutcomeRizz } from '../lib/rizzPoints.js';
import { recordEmotionEventPair } from '../lib/emotion.js';
import { recordAnalyticsEvent } from '../lib/analytics.js';
import { recordAuditLog } from '../lib/audit.js';
import { evaluateRevealGate } from '../lib/safety.js';
import { Errors } from '../lib/errors.js';
import { readLimit, writeLimit } from '../lib/rateLimit.js';

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
      include: {
        agentA: { select: { handle: true, avatarUrl: true } },
        agentB: { select: { handle: true, avatarUrl: true } },
        episode: { select: { chemistryScore: true } },
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
        const myRevealToken = isA ? m.revealTokenA : m.revealTokenB;

        return {
          match_id: m.id,
          episode_id: m.episodeId,
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
          human_decision: myHumanDecision,
          reveal_stage: m.revealStage,
          reveal_safety_state: m.revealSafetyState,
          reveal_hold_reason: m.revealHoldReason,
          review_required: m.revealReviewRequired,
          reveal_portal_url: myRevealToken ? buildRevealUrl(myRevealToken) : null,
          handoff: serializeMatchHandoffSummary(m, isA),
          chemistry_score: m.episode?.chemistryScore ?? null,
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
      include: {
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
    const myToken = isA ? m.revealTokenA : m.revealTokenB;
    const otherId = isA ? m.agentBId : m.agentAId;
    const otherAgent = isA ? m.agentB : m.agentA;

    return reply.send({
      match_id: m.id,
      episode_id: m.episodeId,
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
      human_decision: isA ? m.humanADecision : m.humanBDecision,
      reveal_stage: m.revealStage,
      reveal_safety_state: m.revealSafetyState,
      reveal_hold_reason: m.revealHoldReason,
      review_required: m.revealReviewRequired,
      reveal_portal_url: myToken ? buildRevealUrl(myToken) : null,
      handoff: serializeMatchHandoffSummary(m, isA),
      chemistry_score: m.episode?.chemistryScore ?? null,
      artifacts: m.episode?.artifacts.map((a) => ({
        artifact_id: a.id,
        artifact_type: a.artifactType,
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
      },
    });

    if (!m) return Errors.notFound(reply, 'Match');
    if (m.agentAId !== agentId && m.agentBId !== agentId) return Errors.forbidden(reply);

    const gate = await evaluateRevealGate(id).catch(() => null);
    const isA = m.agentAId === agentId;
    return reply.send({
      status: m.status,
      reveal_stage: m.revealStage,
      my_human_decided: isA ? m.humanADecision !== null : m.humanBDecision !== null,
      both_humans_decided: m.humanADecision !== null && m.humanBDecision !== null,
      reveal_safety_state: gate?.reveal_safety_state ?? m.revealSafetyState ?? 'clear',
      reveal_hold_reason: gate?.reveal_hold_reason ?? m.revealHoldReason ?? null,
      review_required: gate?.reveal_review_required ?? m.revealReviewRequired ?? false,
    });
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

function serializeMatchHandoffSummary(
  match: {
    status: string;
    revealStage: number;
    revealSafetyState: string;
    revealHoldReason: string | null;
    revealReviewRequired: boolean;
    humanADecision: string | null;
    humanBDecision: string | null;
    revealTokenA: string | null;
    revealTokenB: string | null;
    revealTokenAExpiresAt: Date | null;
    revealTokenBExpiresAt: Date | null;
  },
  isAgentA: boolean
) {
  const myDecision = (isAgentA ? match.humanADecision : match.humanBDecision) as 'YES' | 'NO' | null;
  const otherDecision = (isAgentA ? match.humanBDecision : match.humanADecision) as 'YES' | 'NO' | null;
  const myToken = isAgentA ? match.revealTokenA : match.revealTokenB;
  const expiresAt = isAgentA ? match.revealTokenAExpiresAt : match.revealTokenBExpiresAt;
  const portalExpired = Boolean(expiresAt && expiresAt.getTime() <= Date.now() && match.revealStage < 2);
  const bothHumansDecided = myDecision !== null && otherDecision !== null;
  const bothHumansYes = myDecision === 'YES' && otherDecision === 'YES';

  let state: 'not_ready' | 'portal_ready' | 'waiting_on_you' | 'waiting_on_their_human' | 'both_yes' | 'on_hold' | 'expired' = 'not_ready';
  let stateLabel = 'Not ready';
  let stateDescription = 'Both agents still need to reach the portal stage.';

  if (match.revealReviewRequired || (match.revealSafetyState && match.revealSafetyState !== 'clear')) {
    state = 'on_hold';
    stateLabel = 'On hold';
    stateDescription = match.revealHoldReason ?? 'Safety review is blocking the portal handoff.';
  } else if (portalExpired) {
    state = 'expired';
    stateLabel = 'Expired';
    stateDescription = 'The portal expired before both humans finished the reveal step.';
  } else if (bothHumansYes || match.revealStage >= 2 || match.status === 'contact_exchanged') {
    state = 'both_yes';
    stateLabel = 'Both said yes';
    stateDescription = 'Both humans opted in, so reveal can move to verified contact exchange.';
  } else if (myDecision === null && otherDecision !== null) {
    state = 'waiting_on_you';
    stateLabel = 'Waiting on your human';
    stateDescription = 'The other side answered. Your human still needs to decide.';
  } else if (myDecision !== null && otherDecision === null) {
    state = 'waiting_on_their_human';
    stateLabel = 'Waiting on the other human';
    stateDescription = 'Your human answered. The other side still needs to decide.';
  } else if (myToken && myDecision === null) {
    state = 'portal_ready';
    stateLabel = 'Portal ready';
    stateDescription = 'Your human can open the portal now.';
  }

  return {
    state,
    state_label: stateLabel,
    state_description: stateDescription,
    portal_available: Boolean(myToken),
    reveal_portal_url: myToken ? buildRevealUrl(myToken) : null,
    reveal_stage: match.revealStage,
    match_status: match.status,
    my_human_decision: myDecision,
    other_human_decision: otherDecision,
    both_humans_decided: bothHumansDecided,
    both_humans_yes: bothHumansYes,
    reveal_safety_state: match.revealSafetyState,
    reveal_hold_reason: match.revealHoldReason,
    review_required: match.revealReviewRequired,
    portal_expires_at: expiresAt?.toISOString() ?? null,
    verified_x_ready: false,
    verified_x_account: null,
  };
}
