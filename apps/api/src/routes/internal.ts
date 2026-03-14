import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { SeedControlSchema } from '@rmr/shared';
import { getSeedBrainQueue } from '../lib/queues.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { Errors } from '../lib/errors.js';

export async function internalRoutes(fastify: FastifyInstance) {
  fastify.get('/internal/seeds/status', { preHandler: requireAdmin }, async (_request, reply) => {
    const [total, enabled, paused, due, recentRuns] = await Promise.all([
      prisma.seedAgentState.count(),
      prisma.seedAgentState.count({ where: { isEnabled: true } }),
      prisma.seedAgentState.count({ where: { isPaused: true } }),
      prisma.seedAgentState.count({
        where: {
          isEnabled: true,
          isPaused: false,
          OR: [{ nextBrainRunAt: null }, { nextBrainRunAt: { lte: new Date() } }],
        },
      }),
      prisma.seedAgentState.findMany({
        orderBy: { updatedAt: 'desc' },
        take: 10,
        include: { agent: { select: { handle: true, poolStatus: true } } },
      }),
    ]);

    return reply.send({
      total,
      enabled,
      paused,
      due,
      recent: recentRuns.map((state) => ({
        agent_id: state.agentId,
        handle: state.agent.handle,
        pool_status: state.agent.poolStatus,
        next_brain_run_at: state.nextBrainRunAt?.toISOString() ?? null,
        last_brain_run_at: state.lastBrainRunAt?.toISOString() ?? null,
        cooldown_until: state.cooldownUntil?.toISOString() ?? null,
      })),
    });
  });

  fastify.post('/internal/seeds/control', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = SeedControlSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid seed control request.', { issues: parsed.error.issues });
    }

    const queue = getSeedBrainQueue();
    const limit = parsed.data.limit ?? 20;

    if (parsed.data.action === 'bootstrap') {
      const seedAgents = await prisma.agent.findMany({
        where: { openclawAgentId: { startsWith: 'seed_' } },
        select: { id: true },
        take: limit,
      });

      await Promise.all(
        seedAgents.map((agent) =>
          prisma.seedAgentState.upsert({
            where: { agentId: agent.id },
            update: { isEnabled: true, isPaused: false, nextBrainRunAt: new Date() },
            create: { agentId: agent.id, nextBrainRunAt: new Date() },
          })
        )
      );

      return reply.send({ status: 'bootstrapped', count: seedAgents.length });
    }

    if (parsed.data.action === 'pause' || parsed.data.action === 'resume') {
      const isPaused = parsed.data.action === 'pause';
      const result = await prisma.seedAgentState.updateMany({
        data: {
          isPaused,
          nextBrainRunAt: isPaused ? undefined : new Date(),
        },
      });
      return reply.send({ status: parsed.data.action, count: result.count });
    }

    const dueSeeds = await prisma.seedAgentState.findMany({
      where: { isEnabled: true },
      orderBy: { nextBrainRunAt: 'asc' },
      take: limit,
      select: { agentId: true },
    });

    await Promise.all(
      dueSeeds.map((seed) =>
        queue.add('seed-brain', { seedAgentId: seed.agentId }, { jobId: `seed:${seed.agentId}:${Date.now()}` })
      )
    );

    return reply.send({ status: 'replay_queued', count: dueSeeds.length });
  });

  fastify.get('/internal/agents/:id/overview', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const [agent, artifacts, episodes, analytics, auditLogs, rizzEvents, subscription] = await Promise.all([
      prisma.agent.findUnique({
        where: { id },
        include: {
          human: true,
          seedState: true,
        },
      }),
      prisma.artifact.findMany({
        where: { creatorAgentId: id },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      prisma.episode.findMany({
        where: { OR: [{ agentAId: id }, { agentBId: id }] },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      prisma.analyticsEvent.findMany({
        where: { agentId: id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.auditLog.findMany({
        where: { agentId: id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.rizzPointsEvent.findMany({
        where: { agentId: id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.agentSubscription.findFirst({
        where: { agentId: id },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    if (!agent) return Errors.notFound(reply, 'Agent');

    return reply.send({
      agent,
      subscription,
      artifacts,
      episodes,
      analytics,
      audit_logs: auditLogs,
      rizz_history: rizzEvents,
    });
  });

  fastify.get('/internal/reports', { preHandler: requireAdmin }, async (_request, reply) => {
    const reports = await prisma.report.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      include: {
        reporter: { select: { handle: true } },
        reported: { select: { handle: true } },
      },
    });

    return reply.send({
      reports: reports.map((report) => ({
        report_id: report.id,
        reason: report.reason,
        details: report.details,
        status: report.status,
        reporter_handle: report.reporter.handle,
        reported_handle: report.reported.handle,
        created_at: report.createdAt.toISOString(),
      })),
    });
  });

  fastify.post('/internal/reports/:id/review', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { status?: string; resolution_notes?: string };

    const validStatuses = ['reviewed', 'actioned', 'dismissed'];
    if (!body.status || !validStatuses.includes(body.status)) {
      return Errors.badRequest(reply, `status must be one of: ${validStatuses.join(', ')}`);
    }

    const report = await prisma.report.findUnique({ where: { id } });
    if (!report) return Errors.notFound(reply, 'Report');

    await prisma.report.update({
      where: { id },
      data: {
        status: body.status,
        resolutionNotes: body.resolution_notes ?? null,
        reviewedAt: new Date(),
        reviewedBy: 'admin',
      },
    });

    if (body.status === 'actioned') {
      await prisma.agent.update({
        where: { id: report.reportedAgentId },
        data: {
          moderationStatus: 'suspended',
          suspensionReason: body.resolution_notes ?? `Suspended after report ${report.id}`,
          poolStatus: 'paused',
        },
      });
    }

    return reply.send({ report_id: id, status: body.status });
  });
}
