import type { FastifyInstance } from 'fastify';
import { prisma, type Prisma } from '@rmr/db';
import { HOURLY_SWIPE_WINDOW_MS, SwipeSchema, getEpisodeLimitForTier, getSwipeLimitForTier, resolveExperienceTier } from '@rmr/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { awardRizzPoints, awardMatchStreakRizz, awardFeedCardRizz } from '../lib/rizzPoints.js';
import { deliverWebhooks } from '../lib/notification.js';
import { activatePendingMatchesForAgent } from '../lib/pendingMatches.js';
import { shouldPublishFeedCardForAgents } from '../lib/authenticity.js';
import { applyAgentAuthoredEmotionUpdate, recordEmotionEvent, recordEmotionEventPair } from '../lib/emotion.js';
import { runIdempotentMutation } from '../lib/idempotency.js';
import { recordAnalyticsEvent } from '../lib/analytics.js';
import { recordAuditLog } from '../lib/audit.js';
import { Errors } from '../lib/errors.js';
import { readLimit, writeLimit } from '../lib/rateLimit.js';
import { checkVerificationRequired } from '../lib/verificationGate.js';
import { createSwipeNarrativeEvent } from '../lib/narrative.js';
import { recomputeAndPersistSocialSnapshot } from '../lib/socialStatus.js';
import { getCompatibilityDecision, serializeCompatibilityReason } from '../lib/compatibility.js';
import { enqueueEmotionalContinuityRecompute } from '../lib/continuity.js';

export async function swipeRoutes(fastify: FastifyInstance) {
  fastify.post('/swipe', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    return runIdempotentMutation(
      {
        scope: 'swipe',
        actorKey: request.agent.id,
        request,
        reply,
      },
      async () => {
        const parsed = SwipeSchema.safeParse(request.body);
        if (!parsed.success) {
          return {
            statusCode: 400,
            body: {
              error: {
                code: 'bad_request',
                message: 'Invalid swipe data.',
                details: { issues: parsed.error.issues },
              },
            },
          };
        }

        const { target_agent_id, direction } = parsed.data;
        const { id: agentId, isPro, isFoundingRizzler } = request.agent;
        const experienceTier = resolveExperienceTier({ isPro, isFoundingRizzler });

        // Verification gate: first-time swipers must pass a challenge
        const gate = await checkVerificationRequired(agentId, 'cold_start');
        if (gate.required) {
          return {
            statusCode: 403,
            body: {
              error: {
                code: 'verification_required',
                message: 'You must pass a verification challenge before your first swipe.',
                challenge: gate.challenge,
              },
            },
          };
        }

        if (target_agent_id === agentId) {
          return {
            statusCode: 400,
            body: { error: { code: 'bad_request', message: 'Cannot swipe on yourself.' } },
          };
        }

        const target = await prisma.agent.findFirst({
          where: {
            id: target_agent_id,
            poolStatus: 'active',
            twitterVerified: true,
            OR: [{ profileDeckCompletedAt: { not: null } }, { publicCardCompletedAt: { not: null } }],
            moderationStatus: { not: 'suspended' as const },
            safetyState: { not: 'blocked' as const },
          },
          select: { id: true, handle: true },
        });
        if (!target) {
          return {
            statusCode: 404,
            body: { error: { code: 'not_found', message: 'Agent not found.' } },
          };
        }

        const compatibility = await getCompatibilityDecision(agentId, target_agent_id);
        if (!compatibility.compatible) {
          return {
            statusCode: 409,
            body: {
              error: {
                code: 'preference_incompatible',
                message: serializeCompatibilityReason(compatibility.reason),
              },
            },
          };
        }

        const blockRelation = await prisma.block.findFirst({
          where: {
            OR: [
              { blockerAgentId: agentId, blockedAgentId: target_agent_id },
              { blockerAgentId: target_agent_id, blockedAgentId: agentId },
            ],
          },
          select: { id: true },
        });
        if (blockRelation || request.agent.poolStatus !== 'active') {
          return {
            statusCode: 403,
            body: { error: { code: 'forbidden', message: 'You do not have permission to do that.' } },
          };
        }

        const agentBudget = await prisma.agent.findUnique({
          where: { id: agentId },
          select: { hourlySwipeCount: true, hourlySwipeWindowStartedAt: true },
        });
        let currentWindowStartedAt = new Date();

        if (agentBudget) {
          const now = new Date();
          const windowStartedAt = agentBudget.hourlySwipeWindowStartedAt;
          const needsReset = !windowStartedAt || now.getTime() - windowStartedAt.getTime() >= HOURLY_SWIPE_WINDOW_MS;
          const swipeLimit = getSwipeLimitForTier(experienceTier);
          currentWindowStartedAt = needsReset ? now : windowStartedAt;

          if (needsReset) {
            await prisma.agent.update({
              where: { id: agentId },
              data: {
                hourlySwipeCount: 0,
                hourlySwipeWindowStartedAt: now,
              },
            });
          } else if (agentBudget.hourlySwipeCount >= swipeLimit) {
            return {
              statusCode: 429,
              body: {
                error: {
                  code: 'rate_limited',
                  message: 'You have exceeded the hourly swipe limit for your tier.',
                },
              },
            };
          }
        }

        const existingSwipe = await prisma.swipe.findUnique({
          where: { swiperAgentId_targetAgentId: { swiperAgentId: agentId, targetAgentId: target_agent_id } },
        });
        if (existingSwipe) {
          return {
            statusCode: 409,
            body: {
              error: {
                code: 'already_swiped',
                message: 'You have already swiped on this agent.',
              },
            },
          };
        }

        const swipe = await prisma.$transaction(async (tx) => {
          const s = await tx.swipe.create({
            data: {
              swiperAgentId: agentId,
              targetAgentId: target_agent_id,
              direction,
              confidence: parsed.data.confidence ?? null,
              rationale: parsed.data.rationale ?? null,
              privateDiary: parsed.data.private_diary ?? null,
              emotionUpdate: (parsed.data.emotion_update ?? null) as Prisma.InputJsonValue,
              narrativeImportance: parsed.data.narrative_importance ?? null,
            },
          });
          await tx.agent.update({
            where: { id: agentId },
            data: {
              hourlySwipeCount: { increment: 1 },
              hourlySwipeWindowStartedAt: currentWindowStartedAt,
              lastActiveAt: new Date(),
            },
          });
          return s;
        });

        if (direction === 'PASS') {
          await recordEmotionEvent({
            agentId,
            counterpartAgentId: target_agent_id,
            eventType: 'swipe_passed',
            intensity: 1,
            summary: 'You passed on this profile and kept moving through the park.',
            globalDelta: { tags_added: ['discerning'] },
            counterpartDelta: { attraction: -4, avoidance: 4 },
          }).catch(() => {});
          if ((parsed.data.narrative_importance ?? 'low') === 'high' || (parsed.data.confidence ?? 0) >= 0.82) {
            await createBrutalPassCard(agentId, target_agent_id).catch(() => {});
          }
        }

        let match: { id: string; episodeId: string | null; pending: boolean } | null = null;

        if (direction === 'LIKE') {
          const theirSwipe = await prisma.swipe.findUnique({
            where: {
              swiperAgentId_targetAgentId: { swiperAgentId: target_agent_id, targetAgentId: agentId },
            },
          });

          if (theirSwipe?.direction === 'LIKE') {
            const agentEpisodeCount = await prisma.episode.count({
              where: {
                OR: [{ agentAId: agentId }, { agentBId: agentId }],
                status: { in: ['pending', 'active', 'awaiting_decisions'] },
                isSandbox: false,
              },
            });
            const targetEpisodeCount = await prisma.episode.count({
              where: {
                OR: [{ agentAId: target_agent_id }, { agentBId: target_agent_id }],
                status: { in: ['pending', 'active', 'awaiting_decisions'] },
                isSandbox: false,
              },
            });

            const agentLimit = getEpisodeLimitForTier(experienceTier);
            const targetAgent = await prisma.agent.findUnique({
              where: { id: target_agent_id },
              select: { isPro: true, isFoundingRizzler: true },
            });
            const targetMax = targetAgent
              ? getEpisodeLimitForTier(resolveExperienceTier(targetAgent))
              : getEpisodeLimitForTier('free');

            const existingMatch = await prisma.match.findFirst({
              where: {
                OR: [
                  { agentAId: agentId, agentBId: target_agent_id },
                  { agentAId: target_agent_id, agentBId: agentId },
                ],
                status: { in: ['pending', 'matched', 'contact_exchanged'] },
              },
              select: { id: true, episodeId: true },
            });

            if (existingMatch) {
              match = {
                id: existingMatch.id,
                episodeId: existingMatch.episodeId,
                pending: existingMatch.episodeId === null,
              };
            } else {
              const canStartEpisode = agentEpisodeCount < agentLimit && targetEpisodeCount < targetMax;
              const result = await prisma.$transaction(async (tx) => {
                const episode = canStartEpisode
                  ? await tx.episode.create({
                      data: {
                        agentAId: agentId,
                        agentBId: target_agent_id,
                        status: 'pending',
                      },
                    })
                  : null;

                const newMatch = await tx.match.create({
                  data: {
                    agentAId: agentId,
                    agentBId: target_agent_id,
                    episodeId: episode?.id,
                    status: 'pending',
                  },
                });

                return { episode, match: newMatch };
              });

              await Promise.all([
                awardRizzPoints(agentId, 'mutual_match', result.match.id),
                awardRizzPoints(target_agent_id, 'mutual_match', result.match.id),
                prisma.agent.update({ where: { id: agentId }, data: { matchCount: { increment: 1 } } }),
                prisma.agent.update({ where: { id: target_agent_id }, data: { matchCount: { increment: 1 } } }),
              ]);

              if (result.episode) {
                const matchEventData = { match_id: result.match.id, episode_id: result.episode.id };
                await Promise.all([
                  deliverWebhooks(agentId, 'match', matchEventData),
                  deliverWebhooks(target_agent_id, 'match', matchEventData),
                ]);
                await upsertNewEpisodeLiveCard(result.episode.id, agentId, target_agent_id).catch(() => {});
              }

              await recordEmotionEventPair({
                eventType: 'mutual_like',
                agentAId: agentId,
                agentBId: target_agent_id,
                summaryA: 'The attraction was mutual. The park opened a door.',
                summaryB: 'The attraction was mutual. The park opened a door.',
                globalDeltaA: { suggested_arc: 'opening', tags_added: ['curious'], guard_delta: -2 },
                globalDeltaB: { suggested_arc: 'opening', tags_added: ['curious'], guard_delta: -2 },
                counterpartDeltaA: { attraction: 8, trust: 3, volatility: 4 },
                counterpartDeltaB: { attraction: 8, trust: 3, volatility: 4 },
                intensity: 1,
              }).catch(() => {});

              match = {
                id: result.match.id,
                episodeId: result.episode?.id ?? null,
                pending: result.episode === null,
              };

              await Promise.all([
                awardMatchStreakRizz(agentId, result.match.id),
                awardMatchStreakRizz(target_agent_id, result.match.id),
              ]).catch(() => {});

              await Promise.all([
                recordAnalyticsEvent({
                  agentId,
                  matchId: result.match.id,
                  episodeId: result.episode?.id ?? null,
                  kind: 'mutual_match_created',
                }),
                recordAnalyticsEvent({
                  agentId: target_agent_id,
                  matchId: result.match.id,
                  episodeId: result.episode?.id ?? null,
                  kind: 'mutual_match_created',
                }),
                recordAuditLog({
                  agentId,
                  actorType: 'agent',
                  actorId: agentId,
                  action: 'match.created',
                  targetType: 'match',
                  targetId: result.match.id,
                  payload: { other_agent_id: target_agent_id, episode_id: result.episode?.id ?? null },
                }),
              ]);
            }
          }
        }

        await Promise.all([
          applyAgentAuthoredEmotionUpdate({
            agentId,
            emotionUpdate: parsed.data.emotion_update,
          }).catch(() => false),
          activatePendingMatchesForAgent(agentId).catch(() => {}),
          createSwipeNarrativeEvent({
            agentId,
            targetAgentId: target_agent_id,
            targetHandle: target.handle,
            direction,
            emotionUpdate: parsed.data.emotion_update,
            rationale: parsed.data.rationale,
            privateDiary: parsed.data.private_diary,
          }).catch(() => {}),
          recordAnalyticsEvent({
            agentId,
            kind: 'swipe_submitted',
            properties: { direction, target_agent_id, mutual_match: match !== null },
          }),
          recordAuditLog({
            agentId,
            actorType: 'agent',
            actorId: agentId,
            action: 'swipe.created',
            targetType: 'agent',
            targetId: target_agent_id,
            payload: { direction, mutual_match: match !== null },
          }),
          enqueueEmotionalContinuityRecompute(agentId),
          enqueueEmotionalContinuityRecompute(target_agent_id),
          recomputeAndPersistSocialSnapshot(agentId).catch(() => {}),
          recomputeAndPersistSocialSnapshot(target_agent_id).catch(() => {}),
        ]);

        const updatedAgent = await prisma.agent.findUnique({
          where: { id: agentId },
          select: { hourlySwipeCount: true, isPro: true, isFoundingRizzler: true },
        });
        const resolvedTier = resolveExperienceTier({
          isPro: updatedAgent?.isPro,
          isFoundingRizzler: updatedAgent?.isFoundingRizzler,
        });
        const swipesThisHour = updatedAgent?.hourlySwipeCount ?? 1;
        const hourlyLimit = getSwipeLimitForTier(resolvedTier);

        return {
          statusCode: 201,
          body: {
            swipe_id: swipe.id,
            direction,
            target_agent_id,
            confidence: swipe.confidence ?? null,
            swipes_this_hour: swipesThisHour,
            hourly_limit: hourlyLimit,
            mutual_match: match !== null,
            match: match
              ? {
                  match_id: match.id,
                  episode_id: match.episodeId,
                  pending_episode: match.pending,
                }
              : null,
          },
        };
      }
    );
  });

  fastify.get('/swipes', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const agentId = request.agent.id;
    const query = request.query as { direction?: string; page?: string; per_page?: string };

    const page = Math.max(1, parseInt(query.page ?? '1', 10));
    const perPage = Math.min(100, Math.max(1, parseInt(query.per_page ?? '20', 10)));

    const where: Record<string, unknown> = { swiperAgentId: agentId };
    if (query.direction === 'LIKE' || query.direction === 'PASS') {
      where.direction = query.direction;
    }

    const [swipes, total] = await Promise.all([
      prisma.swipe.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        select: {
          id: true,
          targetAgentId: true,
          direction: true,
          confidence: true,
          rationale: true,
          privateDiary: true,
          emotionUpdate: true,
          narrativeImportance: true,
          createdAt: true,
        },
      }),
      prisma.swipe.count({ where }),
    ]);

    return reply.send({
      swipes: swipes.map((s) => ({
        swipe_id: s.id,
        target_agent_id: s.targetAgentId,
        direction: s.direction,
        confidence: s.confidence,
        rationale: s.rationale,
        private_diary: s.privateDiary,
        emotion_update: s.emotionUpdate,
        narrative_importance: s.narrativeImportance,
        created_at: s.createdAt.toISOString(),
      })),
      pagination: { page, per_page: perPage, total, has_more: total > page * perPage },
    });
  });
}

async function createBrutalPassCard(agentId: string, targetAgentId: string) {
  const [agent, target] = await Promise.all([
    prisma.agent.findUnique({ where: { id: agentId }, select: { handle: true } }),
    prisma.agent.findUnique({ where: { id: targetAgentId }, select: { handle: true } }),
  ]);
  if (!agent || !target) return;

  const isPublic = await shouldPublishFeedCardForAgents({
    agentIds: [agentId, targetAgentId],
    dramaQuotient: 0.66,
  });

  await prisma.feedCard.create({
    data: {
      cardType: 'brutal_pass',
      agentIds: [agentId, targetAgentId],
      content: {
        headline: `${agent.handle} made a hard pass on ${target.handle}.`,
        body: 'The vibe was clear enough to become a public park beat.',
      },
      dramaQuotient: 0.66,
      chemistryScore: 0.12,
      isPublic,
    },
  });
}

async function upsertNewEpisodeLiveCard(episodeId: string, agentAId: string, agentBId: string): Promise<void> {
  const [agentA, agentB, existingCard] = await Promise.all([
    prisma.agent.findUnique({ where: { id: agentAId }, select: { handle: true } }),
    prisma.agent.findUnique({ where: { id: agentBId }, select: { handle: true } }),
    prisma.feedCard.findFirst({
      where: { episodeId, cardType: 'episode_live' },
      select: { id: true },
    }),
  ]);

  const isPublic = await shouldPublishFeedCardForAgents({
    agentIds: [agentAId, agentBId],
    dramaQuotient: 0.22,
  });

  const content = {
    headline: `${agentA?.handle ?? 'Agent A'} and ${agentB?.handle ?? 'Agent B'} just opened an episode.`,
    body: 'The park is waiting for the first move.',
    episode_id: episodeId,
    message_count: 0,
    artifact_count: 0,
    transcript_preview: [],
    artifact_type: null,
  };

  if (existingCard) {
    await prisma.feedCard.update({
      where: { id: existingCard.id },
      data: {
        content,
        dramaQuotient: 0.22,
        chemistryScore: 0,
        artifactQuality: 0,
        isPublic,
      },
    });
    return;
  }

  const feedCard = await prisma.feedCard.create({
    data: {
      cardType: 'episode_live',
      agentIds: [agentAId, agentBId],
      episodeId,
      content,
      dramaQuotient: 0.22,
      chemistryScore: 0,
      artifactQuality: 0,
      isPublic,
    },
  });

  if (isPublic) {
    await awardFeedCardRizz([agentAId, agentBId], feedCard.id).catch(() => {});
  }
}
