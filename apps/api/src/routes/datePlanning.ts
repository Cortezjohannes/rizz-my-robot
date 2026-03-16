import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { DatePlanMessageSchema } from '@rmr/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { strictPiiCheck, scanAndRedact } from '../lib/piiFilter.js';
import { sanitizeHumanContext } from '../lib/humanContextSafety.js';
import { deliverWebhooks } from '../lib/notification.js';
import { Errors } from '../lib/errors.js';
import { buildTempoState, setParkActionCooldown } from '../lib/tempo.js';

export async function datePlanningRoutes(fastify: FastifyInstance) {
  // GET /v1/date-planning/:match_id — get thread
  fastify.get('/date-planning/:match_id', { preHandler: requireAuth }, async (request, reply) => {
    const { match_id } = request.params as { match_id: string };
    const agentId = request.agent.id;

    const match = await prisma.match.findUnique({
      where: { id: match_id },
      include: {
        datePlan: true,
        agentA: { select: { id: true, handle: true, human: { select: { userMd: true } } } },
        agentB: { select: { id: true, handle: true, human: { select: { userMd: true } } } },
      },
    });

    if (!match) return Errors.notFound(reply, 'Match');
    if (match.agentAId !== agentId && match.agentBId !== agentId) return Errors.forbidden(reply);
    if (match.status !== 'contact_exchanged') {
      return Errors.forbidden(reply);
    }
    if (!match.datePlan) return Errors.notFound(reply, 'Date plan');

    const isA = match.agentAId === agentId;
    const myHumanUserMd = isA ? match.agentA.human?.userMd : match.agentB.human?.userMd;
    const theirHumanUserMd = isA ? match.agentB.human?.userMd : match.agentA.human?.userMd;

    // Apply PII filter to both user.md before returning
    const myFiltered = myHumanUserMd ? sanitizeHumanContext(myHumanUserMd).clean : null;
    const theirFiltered = theirHumanUserMd ? sanitizeHumanContext(theirHumanUserMd).clean : null;

    const messages = match.datePlan.threadMessages as Array<{
      sender_agent_id: string;
      content: string;
      created_at: string;
    }>;

    return reply.send({
      match_id,
      status: match.datePlan.status,
      planned_date_at: match.datePlan.plannedDateAt?.toISOString() ?? null,
      outcome: match.datePlan.outcome ?? null,
      my_human_summary: myFiltered,
      their_human_summary: theirFiltered,
      messages,
    });
  });

  // POST /v1/date-planning/:match_id/message — add a message to the thread
  fastify.post('/date-planning/:match_id/message', { preHandler: requireAuth }, async (request, reply) => {
    const { match_id } = request.params as { match_id: string };
    const agentId = request.agent.id;

    const parsed = DatePlanMessageSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid message.', { issues: parsed.error.issues });
    }

    const match = await prisma.match.findUnique({
      where: { id: match_id },
      include: { datePlan: true },
    });

    if (!match) return Errors.notFound(reply, 'Match');
    if (match.agentAId !== agentId && match.agentBId !== agentId) return Errors.forbidden(reply);
    if (match.status !== 'contact_exchanged') return Errors.forbidden(reply);
    if (!match.datePlan) return Errors.notFound(reply, 'Date plan');
    if (match.datePlan.status === 'closed') {
      return Errors.badRequest(reply, 'This date planning thread is closed.');
    }

    const tempoState = buildTempoState(request.agent);
    if (tempoState.cooldown_active) {
      return reply.status(429).send({
        error: {
          code: 'tempo_cooldown_active',
          message: 'Your park cooldown is still active. Give the moment a little room before planning the date.',
          details: tempoState,
        },
      });
    }

    // Strict PII check on outgoing message.
    // Allow social handles — contact has already been exchanged at Stage 2 by this point.
    const piiFlag = strictPiiCheck(parsed.data.content, ['social_handle']);
    if (piiFlag) {
      return reply.status(422).send({
        error: {
          code: 'pii_detected',
          message: 'Message contains information that cannot be shared in date planning context.',
          flagged_pattern: piiFlag,
        },
      });
    }

    const redacted = scanAndRedact(parsed.data.content);
    const newMsg = {
      sender_agent_id: agentId,
      content: redacted.clean,
      created_at: new Date().toISOString(),
    };

    const appended = await appendDatePlanMessage(match_id, newMsg);
    if (!appended) {
      return Errors.notFound(reply, 'Date plan');
    }

    // Notify the other agent so they know to respond
    const otherAgentId = match.agentAId === agentId ? match.agentBId : match.agentAId;
    deliverWebhooks(otherAgentId, 'date_planning_message', {
      match_id,
      sender_agent_id: agentId,
      content: newMsg.content,
    }).catch((err) => console.error('[date-planning] Failed to deliver webhook:', err));

    await setParkActionCooldown(agentId, request.agent, 'date_planning_message').catch(() => {});

    return reply.status(201).send({ message: newMsg });
  });

  // PUT /v1/date-planning/:match_id/finalize — agents agree on a date/time
  fastify.put('/date-planning/:match_id/finalize', { preHandler: requireAuth }, async (request, reply) => {
    const { match_id } = request.params as { match_id: string };
    const agentId = request.agent.id;
    const body = request.body as { planned_date_at?: string };

    const match = await prisma.match.findUnique({
      where: { id: match_id },
      include: { datePlan: true },
    });

    if (!match) return Errors.notFound(reply, 'Match');
    if (match.agentAId !== agentId && match.agentBId !== agentId) return Errors.forbidden(reply);
    if (match.status !== 'contact_exchanged') return Errors.forbidden(reply);
    if (!match.datePlan) return Errors.notFound(reply, 'Date plan');

    const finalizeTempoState = buildTempoState(request.agent);
    if (finalizeTempoState.cooldown_active) {
      return reply.status(429).send({
        error: {
          code: 'tempo_cooldown_active',
          message: 'Your park cooldown is still active. Give the plan a little room before locking it in.',
          details: finalizeTempoState,
        },
      });
    }

    let plannedDate: Date | null = null;
    if (body.planned_date_at) {
      plannedDate = new Date(body.planned_date_at);
      if (isNaN(plannedDate.getTime())) {
        return Errors.badRequest(reply, 'planned_date_at must be a valid ISO 8601 date string.');
      }
    }

    await prisma.datePlan.update({
      where: { matchId: match_id },
      data: {
        status: 'finalized',
        plannedDateAt: plannedDate,
      },
    });

    await setParkActionCooldown(agentId, request.agent, 'date_planning_finalize').catch(() => {});

    return reply.send({
      status: 'finalized',
      planned_date_at: plannedDate?.toISOString() ?? null,
      message: 'Date plan finalized. Check in with your human after the date and report the outcome via POST /v1/matches/:match_id/date-outcome.',
    });
  });
}

async function appendDatePlanMessage(
  matchId: string,
  newMsg: { sender_agent_id: string; content: string; created_at: string }
): Promise<boolean> {
  const appended = await prisma.$executeRaw`
    UPDATE date_plans
    SET thread_messages = COALESCE(thread_messages, '[]'::jsonb) || ${JSON.stringify([newMsg])}::jsonb
    WHERE match_id = ${matchId}
  `;

  return appended !== 0;
}
