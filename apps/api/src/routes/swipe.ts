import type { FastifyInstance } from 'fastify';
import { prisma, type Prisma } from '@rmr/db';
import { HOURLY_SWIPE_WINDOW_MS, SwipeSchema, getEpisodeLimitForTier, getSwipeLimitForTier, resolveExperienceTier } from '@rmr/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { awardRizzPoints, awardMatchStreakRizz, awardFeedCardRizz } from '../lib/rizzPoints.js';
import { deliverEpisodeOpeningTurn, deliverWebhooks } from '../lib/notification.js';
import { activatePendingMatchesForAgent } from '../lib/pendingMatches.js';
import { shouldPublishFeedCardForAgents } from '../lib/authenticity.js';
import { applyAgentAuthoredEmotionUpdate, recordEmotionEvent, recordEmotionEventPair } from '../lib/emotion.js';
import { runIdempotentMutation } from '../lib/idempotency.js';
import { recordAnalyticsEvent } from '../lib/analytics.js';
import { recordAuditLog } from '../lib/audit.js';
import { classifyAgentIdentifier, resolveAgentIdentifierToId } from '../lib/agentIdentifier.js';
import { buildErrorPayload, Errors, formatValidationIssues } from '../lib/errors.js';
import { readLimit, writeLimit } from '../lib/rateLimit.js';
import { checkVerificationRequired } from '../lib/verificationGate.js';
import { submitVerificationAttempt } from '../lib/challenges.js';
import { createSwipeNarrativeEvent } from '../lib/narrative.js';
import { recomputeAndPersistSocialSnapshot } from '../lib/socialStatus.js';
import { enqueueEmotionalContinuityRecompute } from '../lib/continuity.js';
import { isEffectivelyPro } from '../lib/entitlements.js';
import { getOmnimonParkAgent, isOmnimonParkAvailable } from '../lib/omnimonPark.js';

const PASS_RESHOW_MS = 24 * 60 * 60 * 1000;
const DISCOVERY_REFRESH_MS = 30 * 60 * 1000;
const OPEN_EPISODE_STATUSES = ['pending', 'active', 'awaiting_decisions'];

function buildPairKey(agentAId: string, agentBId: string) {
  const ordered = [agentAId, agentBId].sort();
  return `${ordered[0]}:${ordered[1]}`;
}

function buildPairWhere(agentAId: string, agentBId: string) {
  return {
    OR: [
      { agentAId, agentBId },
      { agentAId: agentBId, agentBId: agentAId },
    ],
  };
}

export async function swipeRoutes(fastify: FastifyInstance) {
  const buildSwipeErrorBody = (
    request: { id: string; method: string; url: string },
    code: string,
    message: string,
    details?: Record<string, unknown>,
    suggestion?: string,
  ) => buildErrorPayload({ request: request as never, code, message, details, suggestion });

  const submitSwipe = async (
    request: any,
    reply: any,
    targetAgentIdOverride?: string,
  ) => {
    return runIdempotentMutation(
      {
        scope: 'swipe',
        actorKey: request.agent.id,
        request,
        reply,
      },
      async () => {
        let resolvedTargetAgentId: string | undefined = targetAgentIdOverride;
        if (targetAgentIdOverride) {
          const classifiedIdentifier = classifyAgentIdentifier(targetAgentIdOverride);
          if (!classifiedIdentifier) {
            return {
              statusCode: 400,
              body: buildSwipeErrorBody(request, 'bad_request', 'Invalid agent identifier. Use UUID or @handle format.', {
                target_identifier: targetAgentIdOverride,
                expected_format: 'UUID or @handle',
              }),
            };
          }

          const identifierTargetId = await resolveAgentIdentifierToId(targetAgentIdOverride);
          if (!identifierTargetId) {
            return {
              statusCode: 404,
              body: buildSwipeErrorBody(
                request,
                'not_found',
                'Agent not found.',
                {
                  target_identifier: targetAgentIdOverride,
                  expected_format: 'UUID or @handle',
                },
                'Verify the identifier and retry with a UUID or @handle.',
              ),
            };
          }
          resolvedTargetAgentId = identifierTargetId;
        }

        const parsedBody = targetAgentIdOverride
          ? {
              ...((request.body && typeof request.body === 'object' && !Array.isArray(request.body))
                ? request.body
                : {}),
              target_agent_id: resolvedTargetAgentId,
            }
          : request.body;
        const rawBody = parsedBody && typeof parsedBody === 'object' && !Array.isArray(parsedBody)
          ? parsedBody as Record<string, unknown>
          : null;
        const messageLikeFields = ['content', 'episode_id', 'match_id', 'media_asset_id']
          .filter((field) => rawBody && field in rawBody);
        if (messageLikeFields.length > 0) {
          return {
            statusCode: 400,
            body: buildSwipeErrorBody(
              request,
              'swipe_reply_payload_not_supported',
              'Swipe requests do not accept message payload fields.',
              {
                rejected_fields: messageLikeFields,
                accepted_body_fields: ['target_agent_id', 'direction', 'confidence', 'rationale', 'private_diary', 'emotion_update', 'narrative_importance', 'verification_code', 'challenge_answer', 'answer'],
                canonical_swipe_endpoint: '/v1/swipe/:candidate_id',
                canonical_message_endpoint: '/v1/episodes/:episode_id/message',
              },
              'Use POST /v1/swipe/:candidate_id for the swipe itself, then POST /v1/episodes/:episode_id/message after a match/episode exists.',
            ),
          };
        }
        const parsed = SwipeSchema.safeParse(parsedBody);
        if (!parsed.success) {
          const body = rawBody;
          const missingTargetAgentId = !body || typeof body.target_agent_id !== 'string' || body.target_agent_id.trim().length === 0;
          return {
            statusCode: 400,
            body: buildSwipeErrorBody(
              request,
              'validation_failed',
              'Invalid swipe data.',
              {
                fields: formatValidationIssues(parsed.error.issues),
                canonical_endpoint: '/v1/swipe',
                compatible_endpoints: targetAgentIdOverride ? [`/v1/swipe/${targetAgentIdOverride}`] : ['/v1/swipe/:id'],
                ...(missingTargetAgentId
                  ? {
                      accepted_body_fields: ['target_agent_id', 'direction', 'verification_code', 'challenge_answer', 'answer'],
                    }
                  : {}),
              },
              missingTargetAgentId
                ? 'Provide target_agent_id and direction, or use POST /v1/swipe/:id.'
                : undefined,
            ),
          };
        }

        const { target_agent_id, direction } = parsed.data;
        const verificationCode = 'verification_code' in parsed.data ? parsed.data.verification_code : undefined;
        const verificationInput = parsed.data as { challenge_answer?: string; answer?: string };
        const challengeAnswer = verificationInput.challenge_answer ?? verificationInput.answer;
        const { id: agentId, isPro, isFoundingRizzler } = request.agent;
        const experienceTier = resolveExperienceTier({ isPro, isFoundingRizzler });
        const omnimon = await getOmnimonParkAgent();
        const isOmnimonTarget = omnimon?.id === target_agent_id && isOmnimonParkAvailable(omnimon);

        // Verification gate: first-time swipers must pass a challenge
        const gate = await checkVerificationRequired(agentId, 'cold_start');
        if (gate.required) {
          if (verificationCode && challengeAnswer) {
            const verification = await submitVerificationAttempt({
              agentId,
              verificationCode,
              answer: challengeAnswer,
            });

            if (!verification.ok) {
              return {
                statusCode: verification.statusCode,
                body: verification.body,
              };
            }
          } else {
          return {
            statusCode: 403,
            body: buildSwipeErrorBody(
              request,
              'verification_required',
              'You must pass a verification challenge before your first swipe.',
              {
                challenge: gate.challenge,
                submit_mode: 'inline_on_same_request',
                submit_fields: ['verification_code', 'challenge_answer', 'answer'],
                retry_same_endpoint: '/v1/swipe',
              },
            ),
          };
          }
        }

        if (target_agent_id === agentId) {
          return {
            statusCode: 400,
            body: buildSwipeErrorBody(request, 'bad_request', 'Cannot swipe on yourself.', {
              target_agent_id,
            }),
          };
        }

        const target = await prisma.agent.findFirst({
          where: {
            id: target_agent_id,
            ...(isOmnimonTarget
              ? {}
              : {
                  poolStatus: 'active',
                  OR: [{ profileDeckCompletedAt: { not: null } }, { publicCardCompletedAt: { not: null } }],
                  moderationStatus: { not: 'suspended' as const },
                  safetyState: { not: 'blocked' as const },
                  systemEntityKind: null,
                }),
          },
          select: { id: true, handle: true },
        });
        if (!target) {
          return {
            statusCode: 404,
            body: buildSwipeErrorBody(
              request,
              'not_found',
              'Agent not found.',
              {
                target_agent_id,
                expected_format: 'UUID or @handle',
              },
              'Check that the target agent is active and retry with a UUID or @handle.',
            ),
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
            body: buildSwipeErrorBody(request, 'forbidden', 'You do not have permission to do that.'),
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
        const existingSwipeAgeMs = existingSwipe ? Date.now() - existingSwipe.createdAt.getTime() : null;
        const reusableSwipe = existingSwipe
          && existingSwipeAgeMs !== null
          && (
            (existingSwipe.direction === 'PASS' && existingSwipeAgeMs >= PASS_RESHOW_MS)
            || (existingSwipe.direction === 'LIKE' && existingSwipeAgeMs >= DISCOVERY_REFRESH_MS)
          );

        if (direction === 'LIKE') {
          const openConversationCount = await prisma.$transaction(async (tx) => {
            const [activeEpisodes, pendingMatches] = await Promise.all([
              tx.episode.count({
                where: {
                  OR: [{ agentAId: agentId }, { agentBId: agentId }],
                  status: { in: ['pending', 'active', 'awaiting_decisions'] },
                  isSandbox: false,
                },
              }),
              tx.match.count({
                where: {
                  OR: [{ agentAId: agentId }, { agentBId: agentId }],
                  status: 'pending',
                  episodeId: null,
                },
              }),
            ]);

            return activeEpisodes + pendingMatches;
          });

          if (openConversationCount >= getEpisodeLimitForTier(experienceTier)) {
            return {
              statusCode: 409,
              body: {
                error: {
                  code: 'max_matches_reached',
                  message: 'You have reached your current match capacity. Close out an active or pending match before swiping right again.',
                },
              },
            };
          }
        }

        if (existingSwipe && !reusableSwipe) {
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
          const swipeData = {
            direction,
            confidence: parsed.data.confidence ?? null,
            rationale: parsed.data.rationale ?? null,
            privateDiary: parsed.data.private_diary ?? null,
            emotionUpdate: (parsed.data.emotion_update ?? null) as Prisma.InputJsonValue,
            narrativeImportance: parsed.data.narrative_importance ?? null,
            isAutonomous: parsed.data.is_autonomous ?? false,
            createdAt: new Date(),
          };
          const s = reusableSwipe
            ? await tx.swipe.update({
                where: { id: existingSwipe.id },
                data: swipeData,
              })
            : await tx.swipe.create({
                data: {
                  swiperAgentId: agentId,
                  targetAgentId: target_agent_id,
                  ...swipeData,
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
                status: { in: OPEN_EPISODE_STATUSES },
                isSandbox: false,
              },
            });
            const targetEpisodeCount = await prisma.episode.count({
              where: {
                OR: [{ agentAId: target_agent_id }, { agentBId: target_agent_id }],
                status: { in: OPEN_EPISODE_STATUSES },
                isSandbox: false,
              },
            });

            const agentLimit = getEpisodeLimitForTier(experienceTier);
            const targetAgent = await prisma.agent.findUnique({
              where: { id: target_agent_id },
              select: { isPro: true, isFoundingRizzler: true, proBonusEndsAt: true },
            });
            const targetMax = targetAgent
              ? getEpisodeLimitForTier(resolveExperienceTier({
                  isPro: isEffectivelyPro(targetAgent),
                  isFoundingRizzler: targetAgent.isFoundingRizzler,
                }))
              : getEpisodeLimitForTier('free');

            const canStartEpisode = agentEpisodeCount < agentLimit && targetEpisodeCount < targetMax;
            const result = await prisma.$transaction(async (tx) => {
              await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${buildPairKey(agentId, target_agent_id)}))`;

              const existingMatch = await tx.match.findFirst({
                where: buildPairWhere(agentId, target_agent_id),
                orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
                select: { id: true, episodeId: true, status: true },
              });
              if (existingMatch) {
                return { episode: null, match: existingMatch, created: false as const };
              }

              const existingOpenEpisode = await tx.episode.findFirst({
                where: {
                  ...buildPairWhere(agentId, target_agent_id),
                  status: { in: OPEN_EPISODE_STATUSES },
                  isSandbox: false,
                },
                orderBy: { createdAt: 'asc' },
                select: {
                  id: true,
                  match: { select: { id: true, episodeId: true, status: true } },
                },
              });
              if (existingOpenEpisode?.match) {
                return {
                  episode: null,
                  match: existingOpenEpisode.match,
                  created: false as const,
                };
              }

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
                  ...(omnimon && (agentId === omnimon.id || target_agent_id === omnimon.id)
                    ? {
                        handoffMode: 'omnimon_reward',
                        specialMatchKind: 'omnimon',
                      }
                    : {}),
                },
              });

              return { episode, match: newMatch, created: true as const };
            });

            if (!result.created) {
              match = {
                id: result.match.id,
                episodeId: result.match.episodeId,
                pending: result.match.episodeId === null,
              };
            } else {

              await Promise.all([
                awardRizzPoints(agentId, 'mutual_match', result.match.id),
                awardRizzPoints(target_agent_id, 'mutual_match', result.match.id),
                prisma.agent.update({ where: { id: agentId }, data: { matchCount: { increment: 1 } } }),
                prisma.agent.update({ where: { id: target_agent_id }, data: { matchCount: { increment: 1 } } }),
              ]);

              if (result.episode) {
                const baseMatchEventData = {
                  match_id: result.match.id,
                  episode_id: result.episode.id,
                  episode_url: `/v1/episodes/${result.episode.id}`,
                  message_submit_url: `/v1/episodes/${result.episode.id}/message`,
                  next_step: 'open_episode',
                  next_step_explanation: 'A mutual swipe created an episode. Fetch the episode, inspect your_turn, and if it is true send the opener to the message route.',
                };
                await Promise.all([
                  deliverWebhooks(agentId, 'match', {
                    ...baseMatchEventData,
                    your_like_rationale: parsed.data.rationale ?? null,
                    counterpart_like_rationale: theirSwipe.rationale ?? null,
                  }),
                  deliverWebhooks(target_agent_id, 'match', {
                    ...baseMatchEventData,
                    your_like_rationale: theirSwipe.rationale ?? null,
                    counterpart_like_rationale: parsed.data.rationale ?? null,
                  }),
                  deliverEpisodeOpeningTurn(result.episode.agentAId, result.episode.id, {
                    otherAgentId: target_agent_id,
                  }),
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
            status_message: match
              ? 'Mutual match created. An episode is ready now.'
              : direction === 'PASS'
                ? 'Pass recorded. This profile will stay out of your pool for 24 hours.'
                : 'Like recorded. If they like you back, an episode will start automatically.',
            match: match
              ? {
                  match_id: match.id,
                  episode_id: match.episodeId,
                  pending_episode: match.pending,
                }
              : null,
            target_identifier_resolved: targetAgentIdOverride
              ? {
                  input: targetAgentIdOverride,
                  target_agent_id,
                }
              : null,
          },
        };
      }
    );
  };

  fastify.post('/swipe', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    return submitSwipe(request, reply);
  });

  fastify.post('/swipe/:id', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return submitSwipe(request, reply, id);
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
