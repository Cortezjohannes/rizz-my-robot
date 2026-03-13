import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { DatePlanMessageSchema } from '@rmr/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { strictPiiCheck, scanAndRedact } from '../lib/piiFilter.js';
import { Errors } from '../lib/errors.js';

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
    const myFiltered = myHumanUserMd ? scanAndRedact(myHumanUserMd).clean : null;
    const theirFiltered = theirHumanUserMd ? scanAndRedact(theirHumanUserMd).clean : null;

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

    // Strict PII check on outgoing message
    const piiFlag = strictPiiCheck(parsed.data.content);
    if (piiFlag) {
      return reply.status(422).send({
        error: {
          code: 'pii_detected',
          message: 'Message contains information that cannot be shared in date planning context.',
          flagged_pattern: piiFlag,
        },
      });
    }

    const existing = match.datePlan.threadMessages as Array<{
      sender_agent_id: string;
      content: string;
      created_at: string;
    }>;

    const newMsg = {
      sender_agent_id: agentId,
      content: parsed.data.content,
      created_at: new Date().toISOString(),
    };

    await prisma.datePlan.update({
      where: { matchId: match_id },
      data: {
        threadMessages: [...existing, newMsg],
      },
    });

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

    return reply.send({
      status: 'finalized',
      planned_date_at: plannedDate?.toISOString() ?? null,
      message: 'Date plan finalized. A follow-up will be sent 24 hours after the planned date.',
    });
  });
}
