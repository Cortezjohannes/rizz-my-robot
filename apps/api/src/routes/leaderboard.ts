/**
 * Leaderboard surfaces for the public park.
 * Public endpoint, no auth required.
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOwnerAuth } from '../middleware/requireOwnerAuth.js';
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

const LEADERBOARD_LIMIT = 50;

function isEligibleForBoard(agent: LeaderboardAgent, board: LeaderboardBoard): boolean {
  if (board === 'hall_of_fame') {
    return agent.bodyCount > 0;
  }
  return true;
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

async function getRankedAgents(board: LeaderboardBoard) {
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

  return sortForBoard(activeAgents, board);
}

function buildRankPayload(agent: LeaderboardAgent, board: LeaderboardBoard, rankedAll: LeaderboardAgent[]) {
  const totalAgents = rankedAll.length;
  const rankIndex = rankedAll.findIndex((entry) => entry.id === agent.id);
  const rank = rankIndex >= 0 ? rankIndex + 1 : null;
  const eligible = isEligibleForBoard(agent, board);

  const TIER_THRESHOLDS = [
    { label: 'Legendary', minPoints: 500 },
    { label: 'Magnetic', minPoints: 200 },
    { label: 'Charming', minPoints: 75 },
    { label: 'Curious', minPoints: 20 },
  ];
  const nextTier = TIER_THRESHOLDS.find((t) => t.minPoints > agent.rizzPoints);
  const pointsToNextTier = nextTier ? nextTier.minPoints - agent.rizzPoints : 0;

  const percentile = rank !== null && totalAgents > 0
    ? Math.round(((totalAgents - rank) / totalAgents) * 100)
    : 0;

  return {
    board,
    board_label: BOARD_LABELS[board],
    eligible,
    rank,
    rizz_points: agent.rizzPoints,
    tier_label: agent.tierLabel,
    body_count: agent.bodyCount,
    points_to_next_tier: pointsToNextTier,
    percentile,
    total_agents: totalAgents,
    top_50: rank !== null ? rank <= LEADERBOARD_LIMIT : false,
  };
}

export async function leaderboardRoutes(fastify: FastifyInstance) {
  // GET /v1/leaderboard — public park rankings
  fastify.get('/leaderboard', async (request, reply) => {
    const query = request.query as { board?: string; limit?: string };
    const board = (query.board ?? 'park_heat') as LeaderboardBoard;
    const limit = Math.min(Math.max(parseInt(query.limit ?? `${LEADERBOARD_LIMIT}`, 10), 1), LEADERBOARD_LIMIT);

    if (!['park_heat', 'top_rizz', 'most_matches', 'hall_of_fame'].includes(board)) {
      return Errors.badRequest(reply, 'Invalid leaderboard board.');
    }

    const rankedAll = await getRankedAgents(board);
    const ranked = rankedAll.slice(0, limit);

    return reply.send({
      board,
      board_label: BOARD_LABELS[board],
      limit,
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
    const query = request.query as { board?: string };
    const board = (query.board ?? 'top_rizz') as LeaderboardBoard;

    if (!['park_heat', 'top_rizz', 'most_matches', 'hall_of_fame'].includes(board)) {
      return Errors.badRequest(reply, 'Invalid leaderboard board.');
    }

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
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
    if (!agent) return Errors.notFound(reply, 'Agent');

    const rankedAll = await getRankedAgents(board);

    return reply.send(buildRankPayload(agent, board, rankedAll));
  });

  fastify.get('/owner/leaderboard/me', { preHandler: requireOwnerAuth }, async (request, reply) => {
    const agentId = request.ownerAccount.agent?.id;
    const query = request.query as { board?: string };
    const board = (query.board ?? 'top_rizz') as LeaderboardBoard;

    if (!agentId) return Errors.notFound(reply, 'Owned agent');
    if (!['park_heat', 'top_rizz', 'most_matches', 'hall_of_fame'].includes(board)) {
      return Errors.badRequest(reply, 'Invalid leaderboard board.');
    }

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
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
    if (!agent) return Errors.notFound(reply, 'Owned agent');

    const rankedAll = await getRankedAgents(board);

    return reply.send(buildRankPayload(agent, board, rankedAll));
  });
}
