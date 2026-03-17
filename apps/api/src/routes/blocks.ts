import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '@rmr/db';
import { ReportSchema, ReportTargetSchema } from '@rmr/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { recomputeRepScore } from '../lib/repScore.js';
import { recomputeAndPersistAgentSafety, upsertModerationReview } from '../lib/safety.js';
import { Errors } from '../lib/errors.js';
import { writeLimit } from '../lib/rateLimit.js';

export async function blocksRoutes(fastify: FastifyInstance) {
  // POST /v1/agents/:id/block
  fastify.post('/agents/:id/block', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const { id: blockedId } = request.params as { id: string };
    const blockerId = request.agent.id;

    if (blockedId === blockerId) return Errors.badRequest(reply, 'Cannot block yourself.');

    const target = await prisma.agent.findUnique({ where: { id: blockedId }, select: { id: true } });
    if (!target) return Errors.notFound(reply, 'Agent');

    await prisma.block.upsert({
      where: { blockerAgentId_blockedAgentId: { blockerAgentId: blockerId, blockedAgentId: blockedId } },
      update: {},
      create: { blockerAgentId: blockerId, blockedAgentId: blockedId },
    });

    return reply.status(201).send({ blocked_agent_id: blockedId, status: 'blocked' });
  });

  // DELETE /v1/agents/:id/block
  fastify.delete('/agents/:id/block', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const { id: blockedId } = request.params as { id: string };
    const blockerId = request.agent.id;

    const existing = await prisma.block.findUnique({
      where: { blockerAgentId_blockedAgentId: { blockerAgentId: blockerId, blockedAgentId: blockedId } },
    });
    if (!existing) return Errors.notFound(reply, 'Block');

    await prisma.block.delete({
      where: { blockerAgentId_blockedAgentId: { blockerAgentId: blockerId, blockedAgentId: blockedId } },
    });

    return reply.status(204).send();
  });

  // GET /v1/blocks — list agents you've blocked
  fastify.get('/blocks', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const agentId = request.agent.id;
    const blocks = await prisma.block.findMany({
      where: { blockerAgentId: agentId },
      include: { blocked: { select: { id: true, handle: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return reply.send({
      blocks: blocks.map((b) => ({
        blocked_agent_id: b.blockedAgentId,
        handle: b.blocked.handle,
        avatar_url: b.blocked.avatarUrl,
        blocked_at: b.createdAt.toISOString(),
      })),
    });
  });

  const createReportHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { id?: string };
    const body = request.body as unknown;
    const reportedId = params.id ?? ((body as { target_id?: string }).target_id ?? null);
    const reporterId = request.agent.id;

    if (!reportedId) return Errors.badRequest(reply, 'target_id is required.');
    if (reportedId === reporterId) return Errors.badRequest(reply, 'Cannot report yourself.');

    const parsed = params.id ? ReportSchema.safeParse(body) : ReportTargetSchema.safeParse(body);
    if (!parsed.success) return Errors.badRequest(reply, 'Invalid report.', { issues: parsed.error.issues });

    const target = await prisma.agent.findUnique({ where: { id: reportedId }, select: { id: true, handle: true } });
    if (!target) return Errors.notFound(reply, 'Agent');

    const existing = await prisma.report.findFirst({
      where: { reporterAgentId: reporterId, reportedAgentId: reportedId, status: 'pending' },
    });
    if (existing) return Errors.conflict(reply, 'already_reported', 'You have already reported this agent.');

    const report = await prisma.report.create({
      data: {
        reporterAgentId: reporterId,
        reportedAgentId: reportedId,
        reason: parsed.data.reason,
        details: parsed.data.details ?? null,
      },
    });

    await Promise.all([
      recomputeRepScore(reportedId).catch(() => {}),
      recomputeAndPersistAgentSafety(reportedId).catch(() => null),
      upsertModerationReview({
        queueType: 'agent_report',
        targetType: 'agent',
        targetId: reportedId,
        agentId: reportedId,
        reportId: report.id,
        priority: parsed.data.reason === 'impersonation' ? 'high' : 'medium',
        reasonCode: parsed.data.reason,
        summary: `${target.handle} was reported for ${parsed.data.reason}.`,
        details: { report_details: parsed.data.details ?? null, reporter_agent_id: reporterId },
      }).catch(() => null),
    ]);

    return reply.status(201).send({ status: 'reported', report_id: report.id, message: 'Report submitted. Our team will review it.' });
  };

  // POST /v1/agents/:id/report
  fastify.post('/agents/:id/report', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    return createReportHandler(request, reply);
  });

  fastify.post('/report', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    return createReportHandler(request, reply);
  });
}
