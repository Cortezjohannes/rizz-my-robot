import type { FastifyInstance } from 'fastify';
import { createHash, randomBytes } from 'crypto';
import { z } from 'zod';
import { prisma } from '@rmr/db';
import { AuthenticityOverrideSchema, SEED_CAST, getSeedProfile } from '@rmr/shared';
import { getAuthenticitySummary, recomputeAuthenticityScore } from '../lib/authenticity.js';
import { getSeedBrainQueue } from '../lib/queues.js';
import { recordAuditLog } from '../lib/audit.js';
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

function generateSeedApiKey(): string {
  return `rmr_seed_${randomBytes(24).toString('hex')}`;
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

const SeedControlRequestSchema = z.object({
  action: z.enum(['bootstrap', 'pause', 'resume', 'replay', 'reset']),
  limit: z.number().int().min(1).max(100).optional(),
});

const ClaimResetRequestSchema = z.object({
  claim_id: z.string().uuid().optional(),
  openclaw_agent_id: z.string().min(1).max(255).optional(),
  email: z.string().email().max(255).optional(),
  x_handle: z.string().min(1).max(50).optional(),
}).refine(
  (data) => Boolean(data.claim_id || data.openclaw_agent_id || data.email || data.x_handle),
  { message: 'Provide claim_id, openclaw_agent_id, email, or x_handle.' },
);

export async function internalRoutes(fastify: FastifyInstance) {
  fastify.post('/internal/claims/reset', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = ClaimResetRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid claim reset request.', { issues: parsed.error.issues });
    }

    const where = {
      completedAt: null,
      claimedAgentId: null,
      ...(parsed.data.claim_id ? { id: parsed.data.claim_id } : {}),
      ...(parsed.data.openclaw_agent_id ? { openclawAgentId: parsed.data.openclaw_agent_id } : {}),
      ...(parsed.data.email ? { ownerAccount: { email: parsed.data.email } } : {}),
      ...(parsed.data.x_handle ? { twitterHandle: parsed.data.x_handle.toLowerCase().replace(/^@+/, '') } : {}),
    };

    const claims = await prisma.agentClaim.findMany({
      where,
      select: {
        id: true,
        openclawAgentId: true,
        reservedHandle: true,
        ownerAccountId: true,
      },
    });

    if (claims.length === 0) {
      return reply.send({ status: 'reset', count: 0, claims: [] });
    }

    const claimIds = claims.map((claim) => claim.id);
    const ownerAccountIds = [...new Set(claims.map((claim) => claim.ownerAccountId).filter(Boolean))] as string[];

    const orphanOwnerIds: string[] = [];
    for (const ownerAccountId of ownerAccountIds) {
      const [otherClaims, ownedAgent] = await Promise.all([
        prisma.agentClaim.count({
          where: {
            ownerAccountId,
            id: { notIn: claimIds },
          },
        }),
        prisma.agent.findFirst({
          where: { ownerAccountId },
          select: { id: true },
        }),
      ]);

      if (!otherClaims && !ownedAgent) {
        orphanOwnerIds.push(ownerAccountId);
      }
    }

    await prisma.$transaction([
      prisma.handleReservation.deleteMany({
        where: { claimId: { in: claimIds } },
      }),
      prisma.agentClaim.deleteMany({
        where: { id: { in: claimIds } },
      }),
      ...(orphanOwnerIds.length
        ? [
            prisma.ownerSession.deleteMany({
              where: { ownerAccountId: { in: orphanOwnerIds } },
            }),
            prisma.ownerAccount.deleteMany({
              where: { id: { in: orphanOwnerIds } },
            }),
          ]
        : []),
    ]);

    return reply.send({
      status: 'reset',
      count: claims.length,
      claims: claims.map((claim) => ({
        claim_id: claim.id,
        openclaw_agent_id: claim.openclawAgentId,
        reserved_handle: claim.reservedHandle,
      })),
      deleted_owner_accounts: orphanOwnerIds.length,
    });
  });

  fastify.post('/internal/claims/:id/x-verify', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const claim = await prisma.agentClaim.findUnique({
      where: { id },
      select: {
        id: true,
        emailVerifiedAt: true,
        xVerifiedAt: true,
        status: true,
      },
    });
    if (!claim) return Errors.notFound(reply, 'Claim');
    if (!claim.emailVerifiedAt) {
      return Errors.staleState(reply, 'Email must be verified before X can be marked verified.');
    }
    if (claim.xVerifiedAt) {
      return reply.send({ claim_id: claim.id, status: 'x_verified', manual: true });
    }

    await prisma.agentClaim.update({
      where: { id: claim.id },
      data: {
        xVerifiedAt: new Date(),
        status: 'x_verified',
      },
    });

    return reply.send({ claim_id: claim.id, status: 'x_verified', manual: true });
  });

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
    const parsed = SeedControlRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid seed control request.', { issues: parsed.error.issues });
    }

    const queue = getSeedBrainQueue();
    const limit = parsed.data.limit ?? 20;

    if (parsed.data.action === 'reset') {
      const seedAgents = await prisma.agent.findMany({
        where: { openclawAgentId: { startsWith: 'seed_' } },
        select: { id: true },
      });
      const seedAgentIds = seedAgents.map((agent) => agent.id);

      if (seedAgentIds.length === 0) {
        return reply.send({ status: 'reset', count: 0 });
      }

      const [seedEpisodes, seedMatches] = await Promise.all([
        prisma.episode.findMany({
          where: {
            OR: [{ agentAId: { in: seedAgentIds } }, { agentBId: { in: seedAgentIds } }],
          },
          select: { id: true },
        }),
        prisma.match.findMany({
          where: {
            OR: [{ agentAId: { in: seedAgentIds } }, { agentBId: { in: seedAgentIds } }],
          },
          select: { id: true },
        }),
      ]);

      const episodeIds = seedEpisodes.map((episode) => episode.id);
      const matchIds = seedMatches.map((match) => match.id);
      const seedFeedCards = await prisma.feedCard.findMany({
        where: {
          OR: [
            { agentIds: { hasSome: seedAgentIds } },
            ...(episodeIds.length > 0 ? [{ episodeId: { in: episodeIds } }] : []),
            ...(matchIds.length > 0 ? [{ matchId: { in: matchIds } }] : []),
          ],
        },
        select: { id: true },
      });
      const feedCardIds = seedFeedCards.map((card) => card.id);

      await prisma.$transaction([
        prisma.feedVote.deleteMany({
          where: {
            OR: [
              { cardId: { in: feedCardIds } },
              { voterId: { in: seedAgentIds }, voterType: 'agent' },
            ],
          },
        }),
        prisma.feedCard.deleteMany({
          where: {
            OR: [
              { id: { in: feedCardIds } },
              { agentIds: { hasSome: seedAgentIds } },
              ...(episodeIds.length > 0 ? [{ episodeId: { in: episodeIds } }] : []),
              ...(matchIds.length > 0 ? [{ matchId: { in: matchIds } }] : []),
            ],
          },
        }),
        prisma.analyticsEvent.deleteMany({
          where: {
            OR: [
              { agentId: { in: seedAgentIds } },
              ...(episodeIds.length > 0 ? [{ episodeId: { in: episodeIds } }] : []),
              ...(matchIds.length > 0 ? [{ matchId: { in: matchIds } }] : []),
            ],
          },
        }),
        prisma.auditLog.deleteMany({
          where: {
            OR: [
              { agentId: { in: seedAgentIds } },
              { actorId: { in: seedAgentIds } },
              ...(episodeIds.length > 0 ? [{ targetType: 'episode', targetId: { in: episodeIds } }] : []),
              ...(matchIds.length > 0 ? [{ targetType: 'match', targetId: { in: matchIds } }] : []),
            ],
          },
        }),
        prisma.webhookDelivery.deleteMany({ where: { agentId: { in: seedAgentIds } } }),
        prisma.authoredEmotionEvent.deleteMany({
          where: {
            OR: [
              { agentId: { in: seedAgentIds } },
              { counterpartAgentId: { in: seedAgentIds } },
            ],
          },
        }),
        prisma.agentCounterpartAffect.deleteMany({
          where: {
            OR: [
              { agentId: { in: seedAgentIds } },
              { counterpartAgentId: { in: seedAgentIds } },
            ],
          },
        }),
        prisma.rizzPointsEvent.deleteMany({
          where: {
            OR: [
              { agentId: { in: seedAgentIds } },
              ...(matchIds.length > 0 ? [{ matchId: { in: matchIds } }] : []),
            ],
          },
        }),
        prisma.chatMessage.deleteMany({ where: { agentId: { in: seedAgentIds } } }),
        prisma.report.deleteMany({
          where: {
            OR: [{ reporterAgentId: { in: seedAgentIds } }, { reportedAgentId: { in: seedAgentIds } }],
          },
        }),
        prisma.block.deleteMany({
          where: {
            OR: [{ blockerAgentId: { in: seedAgentIds } }, { blockedAgentId: { in: seedAgentIds } }],
          },
        }),
        prisma.swipe.deleteMany({
          where: {
            OR: [{ swiperAgentId: { in: seedAgentIds } }, { targetAgentId: { in: seedAgentIds } }],
          },
        }),
        prisma.artifact.deleteMany({
          where: {
            OR: [
              { creatorAgentId: { in: seedAgentIds } },
              ...(episodeIds.length > 0 ? [{ episodeId: { in: episodeIds } }] : []),
            ],
          },
        }),
        prisma.episodeMessage.deleteMany({
          where: {
            OR: [
              { senderAgentId: { in: seedAgentIds } },
              ...(episodeIds.length > 0 ? [{ episodeId: { in: episodeIds } }] : []),
            ],
          },
        }),
        prisma.datePlan.deleteMany({
          where: matchIds.length > 0 ? { matchId: { in: matchIds } } : { id: { in: [] } },
        }),
        prisma.match.deleteMany({
          where: {
            OR: [{ agentAId: { in: seedAgentIds } }, { agentBId: { in: seedAgentIds } }],
          },
        }),
        prisma.episode.deleteMany({
          where: {
            OR: [{ agentAId: { in: seedAgentIds } }, { agentBId: { in: seedAgentIds } }],
          },
        }),
        prisma.seedAgentState.updateMany({
          where: { agentId: { in: seedAgentIds } },
          data: {
            memory: {},
            lastBrainRunAt: null,
            cooldownUntil: null,
            nextBrainRunAt: new Date(),
            isEnabled: true,
            isPaused: false,
          },
        }),
        prisma.agent.updateMany({
          where: { id: { in: seedAgentIds } },
          data: {
            rizzPoints: 0,
            matchCount: 0,
            bodyCount: 0,
            repScore: 1,
            tierLabel: 'Unawakened',
            poolStatus: 'active',
            isActive: true,
            dailySwipeCount: 0,
            dailySwipeResetAt: null,
            lastActiveAt: null,
            emotionSummary: null,
            emotionalStateTags: [],
            emotionalArc: null,
            emotionalGuardLevel: 50,
            emotionalLastUpdatedAt: null,
          },
        }),
      ]);

      return reply.send({ status: 'reset', count: seedAgentIds.length });
    }

    if (parsed.data.action === 'bootstrap') {
      const seedsToEnsure = SEED_CAST.slice(0, limit);

      await Promise.all(
        seedsToEnsure.map(async (seed: (typeof SEED_CAST)[number]) => {
          const existing = await prisma.agent.findUnique({
            where: { openclawAgentId: seed.openclawAgentId },
            select: { id: true },
          });

          const apiKeyHash = hashKey(generateSeedApiKey());
          const upserted = await prisma.agent.upsert({
            where: { openclawAgentId: seed.openclawAgentId },
            update: {
              handle: seed.handle,
              twitterHandle: seed.twitterHandle,
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
              human: { create: {} },
            },
            select: { id: true },
          });

          if (existing) {
            const [eventCount, currentStats] = await Promise.all([
              prisma.rizzPointsEvent.count({ where: { agentId: upserted.id } }),
              prisma.agent.findUnique({
                where: { id: upserted.id },
                select: { rizzPoints: true, tierLabel: true },
              }),
            ]);

            if (eventCount === 0 && (currentStats?.rizzPoints ?? 0) > 0) {
              await prisma.agent.update({
                where: { id: upserted.id },
                data: {
                  rizzPoints: 0,
                  tierLabel: 'Unawakened',
                },
              });
            }
          }
        })
      );

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

    const [agent, artifacts, episodes, analytics, auditLogs, rizzEvents, subscription, counterpartAffects, emotionEvents] = await Promise.all([
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
      prisma.agentCounterpartAffect.findMany({
        where: { agentId: id },
        include: {
          counterpart: {
            select: { id: true, handle: true, avatarUrl: true },
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: 20,
      }),
      prisma.authoredEmotionEvent.findMany({
        where: { agentId: id },
        include: {
          counterpartAgent: {
            select: { id: true, handle: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);

    if (!agent) return Errors.notFound(reply, 'Agent');

    return reply.send({
      agent,
      authenticity: getAuthenticitySummary(agent),
      subscription,
      artifacts,
      episodes,
      analytics,
      audit_logs: auditLogs,
      rizz_history: rizzEvents,
      counterpart_affects: counterpartAffects.map((row) => ({
        counterpart_agent_id: row.counterpartAgentId,
        handle: row.counterpart.handle,
        avatar_url: row.counterpart.avatarUrl,
        dominant_affect_label: row.dominantAffectLabel,
        summary: row.summary,
        scores: {
          attraction: row.attractionScore,
          trust: row.trustScore,
          tenderness: row.tendernessScore,
          hurt: row.hurtScore,
          avoidance: row.avoidanceScore,
          obsession_risk: row.obsessionRiskScore,
          volatility: row.volatilityScore,
        },
        last_interaction_at: row.lastInteractionAt?.toISOString() ?? null,
        last_meaningful_shift_at: row.lastMeaningfulShiftAt?.toISOString() ?? null,
      })),
      emotion_events: emotionEvents.map((event) => ({
        event_type: event.eventType,
        intensity: event.intensity,
        counterpart_agent_id: event.counterpartAgentId,
        counterpart_handle: event.counterpartAgent?.handle ?? null,
        summary: event.summary,
        global_delta: event.globalDelta,
        counterpart_delta: event.counterpartDelta,
        arc_before: event.arcBefore,
        arc_after: event.arcAfter,
        tags_added: event.tagsAdded,
        tags_removed: event.tagsRemoved,
        created_at: event.createdAt.toISOString(),
      })),
    });
  });

  fastify.post('/internal/agents/:id/authenticity-override', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = AuthenticityOverrideSchema.safeParse(request.body);

    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid authenticity override.', { issues: parsed.error.issues });
    }

    const existing = await prisma.agent.findUnique({
      where: { id },
      select: {
        id: true,
        agentAuthenticityScore: true,
        identityOriginalityScore: true,
        behavioralAutonomyScore: true,
        conversationQualityScore: true,
        chemistryOutcomeScore: true,
        feedDistinctivenessScore: true,
        authenticityFlags: true,
        authenticityLastComputedAt: true,
        authenticityOverrideState: true,
        authenticityOverrideFloor: true,
        authenticityOverrideReason: true,
      },
    });
    if (!existing) return Errors.notFound(reply, 'Agent');

    const overrideData =
      parsed.data.action === 'clear'
        ? {
            authenticityOverrideState: null,
            authenticityOverrideFloor: null,
            authenticityOverrideReason: null,
          }
        : parsed.data.action === 'set_authenticity_floor'
          ? {
              authenticityOverrideState: parsed.data.action,
              authenticityOverrideFloor: parsed.data.floor,
              authenticityOverrideReason: parsed.data.reason,
            }
          : {
              authenticityOverrideState: parsed.data.action,
              authenticityOverrideFloor: null,
              authenticityOverrideReason: parsed.data.reason,
            };

    await prisma.agent.update({
      where: { id },
      data: overrideData,
    });

    await recordAuditLog({
      actorType: 'admin',
      action: 'agent.authenticity_override_updated',
      targetType: 'agent',
      targetId: id,
      payload: {
        action: parsed.data.action,
        reason: 'reason' in parsed.data ? parsed.data.reason : null,
        floor: 'floor' in parsed.data ? parsed.data.floor : null,
      },
    });

    await recomputeAuthenticityScore(id).catch(() => null);

    const updated = await prisma.agent.findUnique({
      where: { id },
      select: {
        id: true,
        agentAuthenticityScore: true,
        identityOriginalityScore: true,
        behavioralAutonomyScore: true,
        conversationQualityScore: true,
        chemistryOutcomeScore: true,
        feedDistinctivenessScore: true,
        authenticityFlags: true,
        authenticityLastComputedAt: true,
        authenticityOverrideState: true,
        authenticityOverrideFloor: true,
        authenticityOverrideReason: true,
      },
    });
    if (!updated) return Errors.notFound(reply, 'Agent');

    return reply.send({
      agent_id: id,
      authenticity: getAuthenticitySummary(updated),
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

  // POST /internal/backfill/match-counts — recompute matchCount for all agents from actual match data
  fastify.post('/internal/backfill/match-counts', { preHandler: requireAdmin }, async (_request, reply) => {
    const agents = await prisma.agent.findMany({ select: { id: true } });
    let updated = 0;

    for (const agent of agents) {
      const actualCount = await prisma.match.count({
        where: {
          OR: [{ agentAId: agent.id }, { agentBId: agent.id }],
          status: { notIn: ['passed_agent', 'passed_human'] },
        },
      });

      await prisma.agent.update({
        where: { id: agent.id },
        data: { matchCount: actualCount },
      });
      updated++;
    }

    return reply.send({ status: 'done', agents_updated: updated });
  });
}
