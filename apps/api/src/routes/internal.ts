import type { FastifyInstance } from 'fastify';
import { createHash, randomBytes } from 'crypto';
import { z } from 'zod';
import { prisma, Prisma } from '@rmr/db';
import { AuthenticityOverrideSchema, SEED_CAST, buildGeneratedPublicCard, getSeedProfile } from '@rmr/shared';
import { getAuthenticitySummary, recomputeAuthenticityScore } from '../lib/authenticity.js';
import { getVerificationRequirements } from '../lib/controlSettings.js';
import { getNamedQueue, getQueueDiagnostics, getSeedBrainQueue, QUEUE_NAMES } from '../lib/queues.js';
import { recordAuditLog } from '../lib/audit.js';
import { evaluateRevealGate, recomputeAndPersistAgentSafety, upsertModerationReview } from '../lib/safety.js';
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
  all: z.boolean().optional(),
  claim_id: z.string().uuid().optional(),
  openclaw_agent_id: z.string().min(1).max(255).optional(),
  email: z.string().email().max(255).optional(),
  x_handle: z.string().min(1).max(50).optional(),
}).refine(
  (data) => Boolean(data.all || data.claim_id || data.openclaw_agent_id || data.email || data.x_handle),
  { message: 'Provide all=true, claim_id, openclaw_agent_id, email, or x_handle.' },
);

const ModerationResolveSchema = z.object({
  status: z.enum(['reviewed', 'actioned', 'dismissed']),
  resolution_notes: z.string().max(2000).optional(),
  resolved_action: z.enum(['none', 'soft_hold', 'blocked', 'suspend_agent', 'clear']).optional(),
});

const InternalReasonSchema = z.object({
  reason: z.string().trim().min(8).max(500),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
});

export async function internalRoutes(fastify: FastifyInstance) {
  fastify.post('/internal/claims/reset', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = ClaimResetRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid claim reset request.', { issues: parsed.error.issues });
    }

    const where = parsed.data.all
      ? {
          completedAt: null,
          claimedAgentId: null,
        }
      : {
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
    const verificationRequirements = await getVerificationRequirements();

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
    if (verificationRequirements.requireEmailVerification && !claim.emailVerifiedAt) {
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
            hourlySwipeCount: 0,
            hourlySwipeWindowStartedAt: null,
            lastActiveAt: null,
            emotionSummary: null,
            emotionalStateTags: [],
            emotionalArc: null,
            emotionalGuardLevel: 50,
            emotionalLastUpdatedAt: null,
            autonomyEnabled: true,
            autonomyStatus: 'ready',
            autonomyLastResult: Prisma.JsonNull,
            lastAutonomyRunAt: null,
            nextAutonomyRunAt: null,
          },
        }),
      ]);

      return reply.send({ status: 'reset', count: seedAgentIds.length });
    }

    if (parsed.data.action === 'bootstrap') {
      const seedsToEnsure = SEED_CAST.slice(0, limit);

      await Promise.all(
        seedsToEnsure.map(async (seed: (typeof SEED_CAST)[number]) => {
          const publicCard = buildGeneratedPublicCard({
            identityMd: seed.identityMd,
            soulMd: seed.soulMd,
            capabilityTier: seed.capabilityTier,
          });
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
              publicSummary: publicCard.public_summary,
              vibeTags: publicCard.vibe_tags,
              signatureLines: publicCard.signature_lines,
              publicPosture: publicCard.public_posture,
              seekingStyle: publicCard.seeking_style,
              paceCue: publicCard.pace_cue,
              publicPrestigeMarkers: publicCard.public_prestige_markers,
              publicCardCompletedAt: new Date(),
              autonomyEnabled: true,
              autonomyStatus: 'ready',
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
              publicSummary: publicCard.public_summary,
              vibeTags: publicCard.vibe_tags,
              signatureLines: publicCard.signature_lines,
              publicPosture: publicCard.public_posture,
              seekingStyle: publicCard.seeking_style,
              paceCue: publicCard.pace_cue,
              publicPrestigeMarkers: publicCard.public_prestige_markers,
              publicCardCompletedAt: new Date(),
              autonomyEnabled: true,
              autonomyStatus: 'ready',
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
      actorType: request.controlActor?.actorKind ?? 'human_admin',
      actorId: request.controlActor?.actorId ?? 'admin',
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

  fastify.get('/internal/moderation/queue', { preHandler: requireAdmin }, async (_request, reply) => {
    const reviews = await prisma.moderationReview.findMany({
      where: { status: 'pending' },
      orderBy: [{ createdAt: 'asc' }],
      take: 100,
      include: {
        agent: { select: { handle: true, safetyState: true, safetyScore: true } },
        match: { select: { status: true, revealSafetyState: true, revealHoldReason: true } },
        report: { select: { reason: true, details: true, reporter: { select: { handle: true } } } },
      },
    });

    const priorityRank = { high: 0, medium: 1, low: 2 } as const;

    return reply.send({
      reviews: reviews
        .sort((a, b) => (
          (priorityRank[a.priority as keyof typeof priorityRank] ?? 99)
          - (priorityRank[b.priority as keyof typeof priorityRank] ?? 99)
          || a.createdAt.getTime() - b.createdAt.getTime()
        ))
        .map((review) => ({
        review_id: review.id,
        queue_type: review.queueType,
        target_type: review.targetType,
        target_id: review.targetId,
        priority: review.priority,
        reason_code: review.reasonCode,
        summary: review.summary,
        safety_state: review.safetyState,
        status: review.status,
        created_at: review.createdAt.toISOString(),
        agent: review.agent
          ? {
              handle: review.agent.handle,
              safety_state: review.agent.safetyState,
              safety_score: review.agent.safetyScore,
            }
          : null,
        match: review.match
          ? {
              status: review.match.status,
              reveal_safety_state: review.match.revealSafetyState,
              reveal_hold_reason: review.match.revealHoldReason,
            }
          : null,
        report: review.report
          ? {
              reason: review.report.reason,
              details: review.report.details,
              reporter_handle: review.report.reporter.handle,
            }
          : null,
        })),
    });
  });

  fastify.get('/internal/moderation/:reviewId', { preHandler: requireAdmin }, async (request, reply) => {
    const { reviewId } = request.params as { reviewId: string };
    const review = await prisma.moderationReview.findUnique({
      where: { id: reviewId },
      include: {
        agent: true,
        match: true,
        report: {
          include: {
            reporter: { select: { handle: true } },
            reported: { select: { handle: true } },
          },
        },
      },
    });
    if (!review) return Errors.notFound(reply, 'Moderation review');
    return reply.send({ review });
  });

  fastify.post('/internal/moderation/:reviewId/resolve', { preHandler: requireAdmin }, async (request, reply) => {
    const { reviewId } = request.params as { reviewId: string };
    const parsed = ModerationResolveSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid moderation resolution.', { issues: parsed.error.issues });
    }

    const review = await prisma.moderationReview.findUnique({ where: { id: reviewId } });
    if (!review) return Errors.notFound(reply, 'Moderation review');

    await prisma.$transaction(async (tx) => {
      await tx.moderationReview.update({
        where: { id: reviewId },
        data: {
          status: parsed.data.status,
          resolutionNotes: parsed.data.resolution_notes ?? null,
          resolvedAction: parsed.data.resolved_action ?? 'none',
          resolvedBy: request.controlActor?.actorId ?? 'admin',
          resolvedAt: new Date(),
        },
      });

      if (review.reportId) {
        await tx.report.update({
          where: { id: review.reportId },
          data: {
            status: parsed.data.status,
            resolutionNotes: parsed.data.resolution_notes ?? null,
            reviewedAt: new Date(),
            reviewedBy: request.controlActor?.actorId ?? 'admin',
          },
        });
      }

      if (review.agentId) {
        if (parsed.data.resolved_action === 'suspend_agent') {
          await tx.agent.update({
            where: { id: review.agentId },
            data: {
              moderationStatus: 'suspended',
              poolStatus: 'paused',
              suspensionReason: parsed.data.resolution_notes ?? `Suspended from moderation review ${review.id}`,
              safetyState: 'blocked',
            },
          });
        }
        if (parsed.data.resolved_action === 'clear') {
          await tx.agent.update({
            where: { id: review.agentId },
            data: {
              safetyState: 'clear',
              safetyFlags: { set: [] },
              lastSafetyReviewAt: new Date(),
            },
          });
        }
      }

      if (review.matchId) {
        await tx.match.update({
          where: { id: review.matchId },
          data: parsed.data.resolved_action === 'clear'
            ? {
                revealSafetyState: 'clear',
                revealHoldReason: null,
                revealReviewRequired: false,
              }
            : parsed.data.resolved_action === 'blocked'
              ? {
                  revealSafetyState: 'blocked',
                  revealHoldReason: parsed.data.resolution_notes ?? review.reasonCode,
                  revealReviewRequired: true,
                }
              : {},
        });
      }
    });

    if (review.agentId && parsed.data.resolved_action !== 'clear') {
      await recomputeAndPersistAgentSafety(review.agentId).catch(() => null);
    }

    await recordAuditLog({
      actorType: request.controlActor?.actorKind ?? 'human_admin',
      actorId: request.controlActor?.actorId ?? 'admin',
      action: 'moderation.review_resolved',
      targetType: review.targetType,
      targetId: review.targetId,
      agentId: review.agentId ?? null,
      payload: parsed.data,
    });

    return reply.send({ review_id: reviewId, status: parsed.data.status });
  });

  fastify.post('/internal/matches/:id/reveal-review', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const gate = await evaluateRevealGate(id);
    if (!gate) return Errors.notFound(reply, 'Match');
    return reply.send(gate);
  });

  fastify.get('/internal/agents', { preHandler: requireAdmin }, async (_request, reply) => {
    const agents = await prisma.agent.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        handle: true,
        poolStatus: true,
        moderationStatus: true,
        safetyState: true,
        safetyScore: true,
        safetyFlags: true,
        lastAutonomyRunAt: true,
        nextAutonomyRunAt: true,
        autonomyStatus: true,
        socialGravityScore: true,
        ownerAccount: { select: { humanIdentity: true, lookingFor: true } },
      },
    });
    return reply.send({
      agents: agents.map((agent) => ({
        agent_id: agent.id,
        handle: agent.handle,
        pool_status: agent.poolStatus,
        moderation_status: agent.moderationStatus,
        safety_state: agent.safetyState,
        safety_score: agent.safetyScore,
        safety_flags: agent.safetyFlags,
        last_autonomy_run_at: agent.lastAutonomyRunAt?.toISOString() ?? null,
        next_autonomy_run_at: agent.nextAutonomyRunAt?.toISOString() ?? null,
        autonomy_status: agent.autonomyStatus,
        social_gravity_score: agent.socialGravityScore,
        human_identity: agent.ownerAccount?.humanIdentity ?? null,
        looking_for: agent.ownerAccount?.lookingFor ?? [],
      })),
    });
  });

  fastify.get('/internal/agents/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [agent, traces, reviews] = await Promise.all([
      prisma.agent.findUnique({
        where: { id },
        include: {
          ownerAccount: true,
        },
      }),
      prisma.agentAutonomyTrace.findMany({
        where: { agentId: id },
        orderBy: { createdAt: 'desc' },
        take: 25,
      }),
      prisma.moderationReview.findMany({
        where: { agentId: id },
        orderBy: { createdAt: 'desc' },
        take: 25,
      }),
    ]);
    if (!agent) return Errors.notFound(reply, 'Agent');
    return reply.send({ agent, traces, reviews });
  });

  fastify.get('/internal/episodes/:id/trace', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [episode, narratives, audits, traces] = await Promise.all([
      prisma.episode.findUnique({
        where: { id },
        include: {
          messages: { orderBy: { sequenceNumber: 'asc' } },
          artifacts: { orderBy: { createdAt: 'asc' } },
          match: true,
        },
      }),
      prisma.narrativeEvent.findMany({
        where: { episodeId: id },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.auditLog.findMany({
        where: {
          targetType: 'episode',
          targetId: id,
        },
        orderBy: { createdAt: 'asc' },
        take: 100,
      }),
      prisma.agentAutonomyTrace.findMany({
        where: { episodeId: id },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    if (!episode) return Errors.notFound(reply, 'Episode');
    return reply.send({ episode, narratives, audits, traces });
  });

  fastify.get('/internal/jobs', { preHandler: requireAdmin }, async (_request, reply) => {
    const [queues, failedWebhookDeliveries, failedJobs] = await Promise.all([
      getQueueDiagnostics(),
      prisma.webhookDelivery.findMany({
        where: { status: 'failed' },
        orderBy: { createdAt: 'desc' },
        take: 25,
      }),
      Promise.all(
        Object.values(QUEUE_NAMES).map(async (queueName) => {
          const queue = getNamedQueue(queueName);
          if (!queue) return { queue: queueName, jobs: [] };
          try {
            const jobs = await queue.getJobs(['failed'], 0, 4, false);
            return {
              queue: queueName,
              jobs: jobs.map((job) => ({
                id: job.id,
                name: job.name,
                failedReason: job.failedReason,
                timestamp: job.timestamp,
                attemptsMade: job.attemptsMade,
              })),
            };
          } catch {
            return { queue: queueName, jobs: [] };
          }
        }),
      ),
    ]);
    return reply.send({ queues, failed_webhook_deliveries: failedWebhookDeliveries, failed_jobs: failedJobs });
  });

  fastify.post('/internal/jobs/:queue/:jobId/retry', { preHandler: requireAdmin }, async (request, reply) => {
    const { queue: queueName, jobId } = request.params as { queue: string; jobId: string };
    const parsed = InternalReasonSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid job retry payload.', { issues: parsed.error.issues });
    }
    const queue = getNamedQueue(queueName);
    if (!queue) return Errors.notFound(reply, 'Queue');
    const job = await queue.getJob(jobId);
    if (!job) return Errors.notFound(reply, 'Job');
    await job.retry();
    await recordAuditLog({
      actorType: request.controlActor?.actorKind ?? 'human_admin',
      actorId: request.controlActor?.actorId ?? 'admin',
      action: 'internal.job_retried',
      targetType: 'queue_job',
      targetId: `${queueName}:${jobId}`,
      payload: {
        queue: queueName,
        job_id: jobId,
        reason: parsed.data.reason,
        severity: parsed.data.severity ?? 'medium',
        control_surface: 'human_admin_surface',
      },
    });
    return reply.send({ queue: queueName, job_id: jobId, status: 'retried' });
  });

  fastify.post('/internal/agents/:id/wake', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = InternalReasonSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid wake payload.', { issues: parsed.error.issues });
    }
    await prisma.agent.update({
      where: { id },
      data: {
        nextAutonomyRunAt: new Date(),
        autonomyStatus: 'ready',
      },
    });
    await recordAuditLog({
      actorType: request.controlActor?.actorKind ?? 'human_admin',
      actorId: request.controlActor?.actorId ?? 'admin',
      action: 'internal.agent_wake_requested',
      targetType: 'agent',
      targetId: id,
      agentId: id,
      payload: {
        reason: parsed.data.reason,
        severity: parsed.data.severity ?? 'medium',
        control_surface: 'human_admin_surface',
      },
    });
    return reply.send({ agent_id: id, status: 'wake_scheduled' });
  });

  fastify.post('/internal/episodes/:id/recheck', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = InternalReasonSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid reveal recheck payload.', { issues: parsed.error.issues });
    }
    const episode = await prisma.episode.findUnique({
      where: { id },
      select: { id: true, match: { select: { id: true } } },
    });
    if (!episode) return Errors.notFound(reply, 'Episode');
    if (episode.match?.id) {
      await evaluateRevealGate(episode.match.id).catch(() => null);
    }
    await recordAuditLog({
      actorType: request.controlActor?.actorKind ?? 'human_admin',
      actorId: request.controlActor?.actorId ?? 'admin',
      action: 'internal.episode_rechecked',
      targetType: 'episode',
      targetId: id,
      payload: {
        reason: parsed.data.reason,
        severity: parsed.data.severity ?? 'medium',
        match_id: episode.match?.id ?? null,
        control_surface: 'human_admin_surface',
      },
    });
    return reply.send({ episode_id: id, status: 'rechecked', match_id: episode.match?.id ?? null });
  });

  fastify.get('/internal/audit', { preHandler: requireAdmin }, async (_request, reply) => {
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return reply.send({
      logs: logs.map((log) => ({
        ...log,
        created_at: log.createdAt.toISOString(),
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
        reviewedBy: request.controlActor?.actorId ?? 'admin',
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

    await recordAuditLog({
      actorType: request.controlActor?.actorKind ?? 'human_admin',
      actorId: request.controlActor?.actorId ?? 'admin',
      action: 'internal.report_reviewed',
      targetType: 'report',
      targetId: id,
      agentId: report.reportedAgentId,
      payload: {
        status: body.status,
        resolution_notes: body.resolution_notes ?? null,
        control_surface: 'human_admin_surface',
      },
    });

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
