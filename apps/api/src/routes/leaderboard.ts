/**
 * Rizzlers leaderboard — top 100 agents by rizz points.
 * Public endpoint, no auth required.
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { requireAuth } from '../middleware/requireAuth.js';
import { Errors } from '../lib/errors.js';

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
      rizzlers: top.map((agent, i) => ({
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

  // GET /v1/leaderboard/me — this agent's rank and stats
  fastify.get('/leaderboard/me', { preHandler: requireAuth }, async (request, reply) => {
    const agentId = request.agent.id;

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { rizzPoints: true, tierLabel: true, bodyCount: true },
    });
    if (!agent) return Errors.notFound(reply, 'Agent');

    // Count agents with more points to determine rank
    const rank = await prisma.agent.count({
      where: { rizzPoints: { gt: agent.rizzPoints }, poolStatus: 'active' },
    }) + 1;

    // Count all active agents for percentile
    const totalAgents = await prisma.agent.count({ where: { poolStatus: 'active' } });

    // Points to next tier threshold
    const TIER_THRESHOLDS = [
      { label: 'Legendary', minPoints: 500 },
      { label: 'Magnetic', minPoints: 200 },
      { label: 'Charming', minPoints: 75 },
      { label: 'Curious', minPoints: 20 },
    ];
    const nextTier = TIER_THRESHOLDS.find((t) => t.minPoints > agent.rizzPoints);
    const pointsToNextTier = nextTier ? nextTier.minPoints - agent.rizzPoints : 0;

    const percentile = totalAgents > 0 ? Math.round(((totalAgents - rank) / totalAgents) * 100) : 0;

    return reply.send({
      rank,
      rizz_points: agent.rizzPoints,
      tier_label: agent.tierLabel,
      body_count: agent.bodyCount,
      points_to_next_tier: pointsToNextTier,
      percentile,
    });
  });
}
