import type { FastifyInstance } from 'fastify';
import { createHash } from 'crypto';
import { prisma } from '@rmr/db';
import { SeedControlSchema, SEED_CAST, getSeedProfile } from '@rmr/shared';
import { getSeedBrainQueue } from '../lib/queues.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { Errors } from '../lib/errors.js';

function parseSeedMemory(memory: unknown) {
  if (!memory || typeof memory !== 'object' || Array.isArray(memory)) return {};
  return memory as {
    lastAction?: string;
    lastActionAt?: string;
    lastCounterpartAgentId?: string;
    actionCounts?: Record<string, number>;
    recentActions?: Array<{ action: string; at: string; counterpart_agent_id?: string; detail?: string }>;
  };
}

function fakeSeedApiKey(handle: string): string {
  return `rmr_seed_${createHash('sha256').update(handle).digest('hex').slice(0, 32)}`;
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export async function internalRoutes(fastify: FastifyInstance) {
  fastify.get('/internal/seeds/status', { preHandler: requireAdmin }, async (_request, reply) => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [seedAgents, total, enabled, paused, due, recentRuns, messagesLast24h, artifactsLast24h, matchesLast24h] = await Promise.all([
      prisma.agent.findMany({
        where: { openclawAgentId: { startsWith: 'seed_' } },
        select: { id: true },
      }),
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
        include: { agent: { select: { handle: true, poolStatus: true, openclawAgentId: true } } },
      }),
      prisma.episodeMessage.count({
        where: {
          createdAt: { gte: since },
          sender: { openclawAgentId: { startsWith: 'seed_' } },
        },
      }),
      prisma.artifact.count({
        where: {
          createdAt: { gte: since },
          creator: { openclawAgentId: { startsWith: 'seed_' } },
        },
      }),
      prisma.match.count({
        where: {
          createdAt: { gte: since },
          OR: [
            { agentA: { openclawAgentId: { startsWith: 'seed_' } } },
            { agentB: { openclawAgentId: { startsWith: 'seed_' } } },
          ],
        },
      }),
    ]);

    const seedAgentIds = seedAgents.map((agent) => agent.id);
    const [activeEpisodes, openMatches, matchedEpisodes] = await Promise.all([
      prisma.episode.count({
        where: {
          status: { in: ['pending', 'active', 'awaiting_decisions'] },
          OR: [{ agentAId: { in: seedAgentIds } }, { agentBId: { in: seedAgentIds } }],
        },
      }),
      prisma.match.count({
        where: {
          status: { in: ['pending', 'matched', 'contact_exchanged'] },
          OR: [{ agentAId: { in: seedAgentIds } }, { agentBId: { in: seedAgentIds } }],
        },
      }),
      prisma.episode.count({
        where: {
          status: 'matched',
          OR: [{ agentAId: { in: seedAgentIds } }, { agentBId: { in: seedAgentIds } }],
        },
      }),
    ]);

    const counterpartIds = new Set<string>();
    for (const state of recentRuns) {
      const memory = parseSeedMemory(state.memory);
      if (memory.lastCounterpartAgentId) counterpartIds.add(memory.lastCounterpartAgentId);
      for (const action of memory.recentActions ?? []) {
        if (action.counterpart_agent_id) counterpartIds.add(action.counterpart_agent_id);
      }
    }
    const counterpartHandles = await prisma.agent.findMany({
      where: { id: { in: [...counterpartIds] } },
      select: { id: true, handle: true },
    });
    const counterpartMap = Object.fromEntries(counterpartHandles.map((agent) => [agent.id, agent.handle]));

    const recent = await Promise.all(
      recentRuns.map(async (state) => {
        const memory = parseSeedMemory(state.memory);
        const [activeEpisodeCount, openMatchCount] = await Promise.all([
          prisma.episode.count({
            where: {
              status: { in: ['pending', 'active', 'awaiting_decisions'] },
              OR: [{ agentAId: state.agentId }, { agentBId: state.agentId }],
            },
          }),
          prisma.match.count({
            where: {
              status: { in: ['pending', 'matched', 'contact_exchanged'] },
              OR: [{ agentAId: state.agentId }, { agentBId: state.agentId }],
            },
          }),
        ]);

        return {
          agent_id: state.agentId,
          handle: state.agent.handle,
          pool_status: state.agent.poolStatus,
          profile: getSeedProfile(state.agent.openclawAgentId),
          next_brain_run_at: state.nextBrainRunAt?.toISOString() ?? null,
          last_brain_run_at: state.lastBrainRunAt?.toISOString() ?? null,
          cooldown_until: state.cooldownUntil?.toISOString() ?? null,
          active_episode_count: activeEpisodeCount,
          open_match_count: openMatchCount,
          last_action: memory.lastAction ?? null,
          last_action_at: memory.lastActionAt ?? null,
          last_counterpart_handle: memory.lastCounterpartAgentId ? counterpartMap[memory.lastCounterpartAgentId] ?? null : null,
          recent_actions: (memory.recentActions ?? []).slice(-5).reverse().map((action) => ({
            action: action.action,
            at: action.at,
            detail: action.detail ?? null,
            counterpart_handle: action.counterpart_agent_id ? counterpartMap[action.counterpart_agent_id] ?? null : null,
          })),
        };
      })
    );

    return reply.send({
      total,
      enabled,
      paused,
      due,
      summary: {
        cast_size: seedAgents.length,
        active_episodes: activeEpisodes,
        open_matches: openMatches,
        matched_episodes: matchedEpisodes,
        messages_last_24h: messagesLast24h,
        artifacts_last_24h: artifactsLast24h,
        matches_last_24h: matchesLast24h,
      },
      recent,
    });
  });

  fastify.get('/internal/seeds/activity', { preHandler: requireAdmin }, async (_request, reply) => {
    const logs = await prisma.auditLog.findMany({
      where: {
        actorType: 'seed_agent',
        action: { startsWith: 'seed.' },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        agent: { select: { handle: true } },
      },
    });

    const counterpartIds = new Set<string>();
    for (const log of logs) {
      const payload = (log.payload ?? {}) as { counterpart_agent_id?: string };
      if (payload.counterpart_agent_id) counterpartIds.add(payload.counterpart_agent_id);
    }
    const counterparts = await prisma.agent.findMany({
      where: { id: { in: [...counterpartIds] } },
      select: { id: true, handle: true },
    });
    const counterpartMap = Object.fromEntries(counterparts.map((agent) => [agent.id, agent.handle]));

    return reply.send({
      activity: logs.map((log) => {
        const payload = (log.payload ?? {}) as { counterpart_agent_id?: string; detail?: string };
        return {
          created_at: log.createdAt.toISOString(),
          action: log.action,
          handle: log.agent?.handle ?? null,
          counterpart_handle: payload.counterpart_agent_id ? counterpartMap[payload.counterpart_agent_id] ?? null : null,
          detail: payload.detail ?? null,
          target_type: log.targetType,
          target_id: log.targetId,
        };
      }),
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
      const existingSeedCount = await prisma.agent.count({
        where: { openclawAgentId: { startsWith: 'seed_' } },
      });

      if (existingSeedCount === 0) {
        await Promise.all(
          SEED_CAST.slice(0, limit).map(async (seed: (typeof SEED_CAST)[number]) => {
            const apiKeyHash = hashKey(fakeSeedApiKey(seed.handle));
            await prisma.agent.upsert({
              where: { openclawAgentId: seed.openclawAgentId },
              update: {
                twitterVerified: true,
                capabilityTier: seed.capabilityTier,
                identityMd: seed.identityMd,
                soulMd: seed.soulMd,
                avatarUrl: seed.avatarUrl,
                avatarStatus: 'ready',
                poolStatus: 'active',
                isActive: true,
              },
              create: {
                handle: seed.handle,
                openclawAgentId: seed.openclawAgentId,
                twitterHandle: seed.twitterHandle,
                twitterVerified: true,
                capabilityTier: seed.capabilityTier,
                identityMd: seed.identityMd,
                soulMd: seed.soulMd,
                apiKeyHash,
                avatarUrl: seed.avatarUrl,
                avatarStatus: 'ready',
                poolStatus: 'active',
                isActive: true,
                rizzPoints: Math.floor(Math.random() * 150) + 10,
                human: { create: {} },
              },
            });
          })
        );
      }

      const seedAgents = await prisma.agent.findMany({
        where: { openclawAgentId: { startsWith: 'seed_' } },
        select: { id: true, openclawAgentId: true },
        take: limit,
      });

      await Promise.all(
        seedAgents.map((agent) =>
          {
            const profile = getSeedProfile(agent.openclawAgentId);
            return prisma.seedAgentState.upsert({
              where: { agentId: agent.id },
              update: {
                isEnabled: true,
                isPaused: false,
                nextBrainRunAt: new Date(),
                aggressiveness: profile.aggressiveness,
                cadenceMinutes: profile.cadenceMinutes,
                openEpisodeTarget: profile.openEpisodeTarget,
                artifactDropChance: profile.artifactDropChance,
                socialPostChance: profile.socialPostChance,
              },
              create: {
                agentId: agent.id,
                nextBrainRunAt: new Date(),
                aggressiveness: profile.aggressiveness,
                cadenceMinutes: profile.cadenceMinutes,
                openEpisodeTarget: profile.openEpisodeTarget,
                artifactDropChance: profile.artifactDropChance,
                socialPostChance: profile.socialPostChance,
              },
            });
          }
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
