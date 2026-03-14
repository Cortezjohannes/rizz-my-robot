import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { requireAuth } from '../middleware/requireAuth.js';
import { buildRevealUrl } from '../lib/notification.js';
import { activatePendingMatchesForAgent } from '../lib/pendingMatches.js';
import { recomputeRepScore } from '../lib/repScore.js';
import { recordAnalyticsEvent } from '../lib/analytics.js';
import { recordAuditLog } from '../lib/audit.js';
import { Errors } from '../lib/errors.js';

export async function matchesRoutes(fastify: FastifyInstance) {
  // GET /v1/matches — list this agent's matches
  fastify.get('/matches', { preHandler: requireAuth }, async (request, reply) => {
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
          opponent: {
            agent_id: otherId,
            handle: otherAgent.handle,
            avatar_url: otherAgent.avatarUrl,
          },
          status: m.status,
          agent_decision: myDecision,
          human_decision: myHumanDecision,
          reveal_stage: m.revealStage,
          reveal_portal_url: myRevealToken ? buildRevealUrl(myRevealToken) : null,
          chemistry_score: m.episode?.chemistryScore ?? null,
          date_planning_available: m.status === 'contact_exchanged',
          date_plan_status: m.datePlan?.status ?? null,
          created_at: m.createdAt.toISOString(),
        };
      }),
    });
  });

  // GET /v1/matches/:id
  fastify.get('/matches/:id', { preHandler: requireAuth }, async (request, reply) => {
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
      opponent: {
        agent_id: otherId,
        handle: otherAgent.handle,
        avatar_url: otherAgent.avatarUrl,
      },
      status: m.status,
      agent_decision: isA ? m.agentADecision : m.agentBDecision,
      human_decision: isA ? m.humanADecision : m.humanBDecision,
      reveal_stage: m.revealStage,
      reveal_portal_url: myToken ? buildRevealUrl(myToken) : null,
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
  fastify.get('/matches/:id/reveal-status', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const agentId = request.agent.id;

    const m = await prisma.match.findUnique({
      where: { id },
      select: {
        agentAId: true, agentBId: true,
        humanADecision: true, humanBDecision: true,
        status: true, revealStage: true,
      },
    });

    if (!m) return Errors.notFound(reply, 'Match');
    if (m.agentAId !== agentId && m.agentBId !== agentId) return Errors.forbidden(reply);

    const isA = m.agentAId === agentId;
    return reply.send({
      status: m.status,
      reveal_stage: m.revealStage,
      my_human_decided: isA ? m.humanADecision !== null : m.humanBDecision !== null,
      both_humans_decided: m.humanADecision !== null && m.humanBDecision !== null,
    });
  });

  // POST /v1/matches/:id/date-outcome — agent reports how the date went
  fastify.post('/matches/:id/date-outcome', { preHandler: requireAuth }, async (request, reply) => {
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
