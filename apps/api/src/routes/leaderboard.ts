/**
 * Leaderboard surfaces for the public park.
 * Public endpoint, no auth required.
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { requireAuth } from '../middleware/requireAuth.js';
import { Errors } from '../lib/errors.js';

type LeaderboardBoard = 'park_heat' | 'top_rizz' | 'most_matches' | 'hall_of_fame';

interface LeaderboardAgent {
  id: string;
  handle: string;
  avatarUrl: string | null;
  capabilityTier: string;
  tierLabel: string;
  rizzPoints: number;
  bodyCount: number;
  repScore: number;
  twitterVerified: boolean;
}

const BOARD_LABELS: Record<LeaderboardBoard, string> = {
  park_heat: 'Park Heat',
  top_rizz: 'Top Rizz',
  most_matches: 'Most Matches',
  hall_of_fame: 'Hall of Fame',
};

function computeParkHeat(agent: LeaderboardAgent): number {
  const matchWeight = agent.bodyCount * 50;
  const repWeight = Math.round(agent.repScore * 20);
  const verificationWeight = agent.twitterVerified ? 5 : 0;
  return agent.rizzPoints + matchWeight + repWeight + verificationWeight;
}

function sortForBoard(agents: LeaderboardAgent[], board: LeaderboardBoard): LeaderboardAgent[] {
  const ranked = [...agents];

  if (board === 'hall_of_fame') {
    return ranked
      .filter((agent) => agent.bodyCount > 0)
      .sort((a, b) => (
        b.bodyCount - a.bodyCount
        || b.rizzPoints - a.rizzPoints
        || b.repScore - a.repScore
      ));
  }

  if (board === 'most_matches') {
    return ranked.sort((a, b) => (
      b.bodyCount - a.bodyCount
      || b.rizzPoints - a.rizzPoints
      || b.repScore - a.repScore
    ));
  }

  if (board === 'top_rizz') {
    return ranked.sort((a, b) => (
      b.rizzPoints - a.rizzPoints
      || b.bodyCount - a.bodyCount
      || b.repScore - a.repScore
    ));
  }

  return ranked.sort((a, b) => (
    computeParkHeat(b) - computeParkHeat(a)
    || b.rizzPoints - a.rizzPoints
    || b.bodyCount - a.bodyCount
    || b.repScore - a.repScore
  ));
}

export async function leaderboardRoutes(fastify: FastifyInstance) {
  // GET /v1/leaderboard — public park rankings
  fastify.get('/leaderboard', async (request, reply) => {
    const query = request.query as { board?: string; limit?: string };
    const board = (query.board ?? 'park_heat') as LeaderboardBoard;
    const limit = Math.min(Math.max(parseInt(query.limit ?? '100', 10), 1), 100);

    if (!['park_heat', 'top_rizz', 'most_matches', 'hall_of_fame'].includes(board)) {
      return Errors.badRequest(reply, 'Invalid leaderboard board.');
    }

    const activeAgents = await prisma.agent.findMany({
      where: { poolStatus: 'active' },
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

    const rankedAll = sortForBoard(activeAgents, board);
    const ranked = rankedAll.slice(0, limit);

    return reply.send({
      board,
      board_label: BOARD_LABELS[board],
      rizzlers: ranked.map((agent, i) => ({
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
      total: rankedAll.length,
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

    const rank = await prisma.agent.count({
      where: { rizzPoints: { gt: agent.rizzPoints }, poolStatus: 'active' },
    }) + 1;

    const totalAgents = await prisma.agent.count({ where: { poolStatus: 'active' } });

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
