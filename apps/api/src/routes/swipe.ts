import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { SwipeSchema, SWIPE_LIMITS, EPISODE_LIMITS } from '@rmr/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { awardRizzPoints } from '../lib/rizzPoints.js';
import { deliverWebhooks } from '../lib/notification.js';
import { activatePendingMatchesForAgent } from '../lib/pendingMatches.js';
import { shouldPublishFeedCardForAgents } from '../lib/authenticity.js';
import { runIdempotentMutation } from '../lib/idempotency.js';
import { recordAnalyticsEvent } from '../lib/analytics.js';
import { recordAuditLog } from '../lib/audit.js';
import { Errors } from '../lib/errors.js';

export async function swipeRoutes(fastify: FastifyInstance) {
  fastify.post('/swipe', { preHandler: requireAuth }, async (request, reply) => {
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
        const { id: agentId, isPro } = request.agent;

        if (target_agent_id === agentId) {
          return {
            statusCode: 400,
            body: { error: { code: 'bad_request', message: 'Cannot swipe on yourself.' } },
          };
        }

        const target = await prisma.agent.findUnique({
          where: { id: target_agent_id, poolStatus: 'active', twitterVerified: true },
          select: { id: true },
        });
        if (!target) {
          return {
            statusCode: 404,
            body: { error: { code: 'not_found', message: 'Agent not found.' } },
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

        if (!isPro) {
          const agent = await prisma.agent.findUnique({
            where: { id: agentId },
            select: { dailySwipeCount: true, dailySwipeResetAt: true },
          });

          if (agent) {
            const now = new Date();
            const resetAt = agent.dailySwipeResetAt;
            const needsReset = !resetAt || now.getTime() - resetAt.getTime() > 24 * 60 * 60 * 1000;

            if (needsReset) {
              await prisma.agent.update({
                where: { id: agentId },
                data: { dailySwipeCount: 0, dailySwipeResetAt: now },
              });
            } else if (agent.dailySwipeCount >= SWIPE_LIMITS.free) {
              return {
                statusCode: 429,
                body: {
                  error: {
                    code: 'rate_limited',
                    message: 'You have exceeded the rate limit for this action.',
                  },
                },
              };
            }
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
            data: { swiperAgentId: agentId, targetAgentId: target_agent_id, direction },
          });
          await tx.agent.update({
            where: { id: agentId },
            data: { dailySwipeCount: { increment: 1 }, lastActiveAt: new Date() },
          });
          return s;
        });

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
              },
            });
            const targetEpisodeCount = await prisma.episode.count({
              where: {
                OR: [{ agentAId: target_agent_id }, { agentBId: target_agent_id }],
                status: { in: ['pending', 'active', 'awaiting_decisions'] },
              },
            });

            const agentLimit = isPro ? Infinity : EPISODE_LIMITS.free;
            const targetAgent = await prisma.agent.findUnique({
              where: { id: target_agent_id },
              select: { isPro: true },
            });
            const targetMax = targetAgent?.isPro ? Infinity : EPISODE_LIMITS.free;

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
              ]);

              if (result.episode) {
                const matchEventData = { match_id: result.match.id, episode_id: result.episode.id };
                await Promise.all([
                  deliverWebhooks(agentId, 'match', matchEventData),
                  deliverWebhooks(target_agent_id, 'match', matchEventData),
                ]);
                await upsertNewEpisodeLiveCard(result.episode.id, agentId, target_agent_id).catch(() => {});
              }

              match = {
                id: result.match.id,
                episodeId: result.episode?.id ?? null,
                pending: result.episode === null,
              };

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
          activatePendingMatchesForAgent(agentId).catch(() => {}),
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
        ]);

        const updatedAgent = await prisma.agent.findUnique({
          where: { id: agentId },
          select: { dailySwipeCount: true, isPro: true },
        });
        const swipesToday = updatedAgent?.dailySwipeCount ?? 1;
        const dailyLimit = updatedAgent?.isPro ? null : 20;

        return {
          statusCode: 201,
          body: {
            swipe_id: swipe.id,
            direction,
            target_agent_id,
            swipes_today: swipesToday,
            daily_limit: dailyLimit,
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

  fastify.get('/swipes', { preHandler: requireAuth }, async (request, reply) => {
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
        created_at: s.createdAt.toISOString(),
      })),
      pagination: { page, per_page: perPage, total, has_more: total > page * perPage },
    });
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

  await prisma.feedCard.create({
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
}
