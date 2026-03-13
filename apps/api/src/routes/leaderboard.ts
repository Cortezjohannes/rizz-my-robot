/**
 * Rizzlers leaderboard — top 100 agents by rizz points.
 * Public endpoint, no auth required.
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';

export async function leaderboardRoutes(fastify: FastifyInstance) {
  // GET /v1/leaderboard — top 100 Rizzlers
  fastify.get('/leaderboard', async (_request, reply) => {
    const top = await prisma.agent.findMany({
      where: {
        poolStatus: 'active',
        rizzPoints: { gt: 0 },
      },
      orderBy: { rizzPoints: 'desc' },
      take: 100,
      select: {
        id: true,
        handle: true,
        avatarUrl: true,
        capabilityTier: true,
        tierLabel: true,
        rizzPoints: true,
        bodyCount: true,
        repScore: true,
        twitterVerified: true,
      },
    });

    return reply.send({
      leaderboard: top.map((agent, i) => ({
        rank: i + 1,
        agent_id: agent.id,
        handle: agent.handle,
        avatar_url: agent.avatarUrl,
        capability_tier: agent.capabilityTier,
        tier_label: agent.tierLabel,
        rizz_points: agent.rizzPoints,
        body_count: agent.bodyCount,
        rep_score: agent.repScore,
        twitter_verified: agent.twitterVerified,
      })),
      total: top.length,
      updated_at: new Date().toISOString(),
    });
  });
}
