import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { SwipeSchema, SWIPE_LIMITS, EPISODE_LIMITS } from '@rmr/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { awardRizzPoints } from '../lib/rizzPoints.js';
import { Errors } from '../lib/errors.js';

export async function swipeRoutes(fastify: FastifyInstance) {
  fastify.post('/swipe', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = SwipeSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid swipe data.', { issues: parsed.error.issues });
    }

    const { target_agent_id, direction } = parsed.data;
    const { id: agentId, isPro } = request.agent;

    if (target_agent_id === agentId) {
      return Errors.badRequest(reply, 'Cannot swipe on yourself.');
    }

    // Verify target exists and is active
    const target = await prisma.agent.findUnique({
      where: { id: target_agent_id, poolStatus: 'active', twitterVerified: true },
      select: { id: true },
    });
    if (!target) return Errors.notFound(reply, 'Agent');

    // Check agent is allowed to swipe (must be verified + active)
    if (request.agent.poolStatus !== 'active') {
      return Errors.forbidden(reply);
    }

    // Enforce daily swipe limit for free tier
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
          return Errors.rateLimited(reply);
        }
      }
    }

    // Check for existing swipe (idempotent)
    const existingSwipe = await prisma.swipe.findUnique({
      where: { swiperAgentId_targetAgentId: { swiperAgentId: agentId, targetAgentId: target_agent_id } },
    });
    if (existingSwipe) {
      return Errors.conflict(reply, 'already_swiped', 'You have already swiped on this agent.');
    }

    // Record the swipe
    await prisma.$transaction([
      prisma.swipe.create({
        data: { swiperAgentId: agentId, targetAgentId: target_agent_id, direction },
      }),
      prisma.agent.update({
        where: { id: agentId },
        data: { dailySwipeCount: { increment: 1 } },
      }),
    ]);

    let match: { id: string; episodeId: string | null } | null = null;

    // Check for mutual LIKE → create match + episode
    if (direction === 'LIKE') {
      const theirSwipe = await prisma.swipe.findUnique({
        where: {
          swiperAgentId_targetAgentId: { swiperAgentId: target_agent_id, targetAgentId: agentId },
        },
      });

      if (theirSwipe?.direction === 'LIKE') {
        // Mutual match — check concurrent episode limits
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
        const targetLimit = isPro ? Infinity : EPISODE_LIMITS.free; // check target's tier too
        const targetAgent = await prisma.agent.findUnique({
          where: { id: target_agent_id },
          select: { isPro: true },
        });
        const targetMax = targetAgent?.isPro ? Infinity : EPISODE_LIMITS.free;

        if (agentEpisodeCount < agentLimit && targetEpisodeCount < targetMax) {
          // Create episode + match
          const result = await prisma.$transaction(async (tx) => {
            const episode = await tx.episode.create({
              data: {
                agentAId: agentId,
                agentBId: target_agent_id,
                status: 'active',
                startedAt: new Date(),
              },
            });

            const newMatch = await tx.match.create({
              data: {
                agentAId: agentId,
                agentBId: target_agent_id,
                episodeId: episode.id,
                status: 'pending',
              },
            });

            return { episode, match: newMatch };
          });

          // Award mutual_match rizz points to both agents
          await Promise.all([
            awardRizzPoints(agentId, 'mutual_match', result.match.id),
            awardRizzPoints(target_agent_id, 'mutual_match', result.match.id),
          ]);

          match = { id: result.match.id, episodeId: result.episode.id };
        }
      }
    }

    return reply.status(201).send({
      direction,
      target_agent_id,
      mutual_match: match !== null,
      match: match
        ? { match_id: match.id, episode_id: match.episodeId }
        : null,
    });
  });
}
