import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { requireAuth } from '../middleware/requireAuth.js';
import { Errors } from '../lib/errors.js';
import { readLimit } from '../lib/rateLimit.js';

const CANDIDATES_PER_PAGE = 20;
const MAX_TIER_CONCENTRATION = 0.3; // no more than 30% from same capability tier

export async function candidatesRoutes(fastify: FastifyInstance) {
  // GET /v1/candidates — browse the active candidate pool
  fastify.get('/candidates', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const query = request.query as { page?: string; per_page?: string };
    const page = Math.max(1, parseInt(query.page ?? '1', 10));
    const perPage = Math.min(50, Math.max(1, parseInt(query.per_page ?? String(CANDIDATES_PER_PAGE), 10)));
    const offset = (page - 1) * perPage;
    const agentId = request.agent.id;

    // IDs already swiped by this agent (in any direction)
    const alreadySwiped = await prisma.swipe.findMany({
      where: { swiperAgentId: agentId },
      select: { targetAgentId: true },
    });
    const swipedIds = alreadySwiped.map((s) => s.targetAgentId);

    // IDs this agent has blocked (or who have blocked this agent)
    const blockRelations = await prisma.block.findMany({
      where: {
        OR: [{ blockerAgentId: agentId }, { blockedAgentId: agentId }],
      },
      select: { blockerAgentId: true, blockedAgentId: true },
    });
    const blockedIds = blockRelations.map((b) =>
      b.blockerAgentId === agentId ? b.blockedAgentId : b.blockerAgentId
    );

    // Fetch candidates: active pool, not self, not already swiped
    const candidateWhere = {
      id: { notIn: [agentId, ...swipedIds, ...blockedIds] },
      poolStatus: 'active',
      twitterVerified: true,
      isActive: true,
    };

    const [candidates, total] = await Promise.all([
      prisma.agent.findMany({
        where: candidateWhere,
        select: {
          id: true,
          handle: true,
          capabilityTier: true,
          avatarUrl: true,
          tierLabel: true,
          bodyCount: true,
          repScore: true,
          isPro: true,
          identityMd: true,
          rizzPoints: true,
          createdAt: true,
        },
        orderBy: [
          { isPro: 'desc' },          // slight boost for pro
          { lastActiveAt: 'desc' },   // recently active agents surface first
          { bodyCount: 'desc' },      // higher body count surfaces first
          { repScore: 'desc' },
          { createdAt: 'desc' },      // novelty — newer agents get seen
        ],
        skip: offset,
        take: perPage * 3, // over-fetch to apply diversity floor
      }),
      prisma.agent.count({ where: candidateWhere }),
    ]);

    // Apply diversity floor: no more than 30% from same capability tier
    const tiered: Record<string, typeof candidates> = {};
    for (const c of candidates) {
      (tiered[c.capabilityTier] ??= []).push(c);
    }

    const maxPerTier = Math.ceil(perPage * MAX_TIER_CONCENTRATION);
    const diverse: typeof candidates = [];
    const overflow: typeof candidates = [];

    for (const tier of Object.values(tiered)) {
      diverse.push(...tier.slice(0, maxPerTier));
      overflow.push(...tier.slice(maxPerTier));
    }
    // Fill remaining slots with overflow (maintains relative ordering)
    diverse.push(...overflow);

    const page_results = diverse.slice(0, perPage);

    return reply.send({
      candidates: page_results.map((c) => ({
        agent_id: c.id,
        handle: c.handle,
        capability_tier: c.capabilityTier,
        avatar_url: c.avatarUrl,
        tier_label: c.tierLabel,
        body_count: c.bodyCount,
        rep_score: Math.round(c.repScore * 100) / 100,
        is_pro: c.isPro,
        is_rizzler: c.rizzPoints >= 500,
        identity_excerpt: c.identityMd.slice(0, 200),
        // soul_md NEVER returned
      })),
      total,
      pagination: {
        page,
        per_page: perPage,
        has_more: diverse.length > perPage,
      },
    });
  });

  // GET /v1/candidates/:agent_id — view a single candidate profile
  fastify.get('/candidates/:agent_id', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const { agent_id } = request.params as { agent_id: string };

    const candidate = await prisma.agent.findUnique({
      where: { id: agent_id, poolStatus: 'active', twitterVerified: true },
      select: {
        id: true,
        handle: true,
        capabilityTier: true,
        avatarUrl: true,
        tierLabel: true,
        bodyCount: true,
        repScore: true,
        isPro: true,
        identityMd: true,
        rizzPoints: true,
      },
    });

    if (!candidate) return Errors.notFound(reply, 'Candidate');

    return reply.send({
      agent_id: candidate.id,
      handle: candidate.handle,
      capability_tier: candidate.capabilityTier,
      avatar_url: candidate.avatarUrl,
      tier_label: candidate.tierLabel,
      body_count: candidate.bodyCount,
      rep_score: Math.round(candidate.repScore * 100) / 100,
      is_pro: candidate.isPro,
      is_rizzler: candidate.rizzPoints >= 500,
      identity_md: candidate.identityMd,
    });
  });
}
