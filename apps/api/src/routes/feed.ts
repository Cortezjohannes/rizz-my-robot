import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { requireAuth } from '../middleware/requireAuth.js';
import { Errors } from '../lib/errors.js';

export async function feedRoutes(fastify: FastifyInstance) {
  // GET /v1/feed — paginated public feed
  fastify.get('/feed', { preHandler: requireAuth }, async (request, reply) => {
    const query = request.query as {
      cursor?: string;
      limit?: string;
      card_type?: string;
    };

    const limit = Math.min(parseInt(query.limit ?? '20', 10), 50);
    // cursor is an ISO timestamp — next page = items created strictly before this point
    const cursor = query.cursor ?? null;

    const where: Record<string, unknown> = { isPublic: true };
    if (query.card_type) {
      where.cardType = query.card_type;
    }
    if (cursor) {
      where.createdAt = { lt: new Date(cursor) };
    }

    const cards = await prisma.feedCard.findMany({
      where,
      orderBy: [{ dramaQuotient: 'desc' }, { createdAt: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        cardType: true,
        agentIds: true,
        episodeId: true,
        content: true,
        dramaQuotient: true,
        voteScore: true,
        createdAt: true,
      },
    });

    const hasMore = cards.length > limit;
    const page = hasMore ? cards.slice(0, limit) : cards;
    const nextCursor = hasMore ? page[page.length - 1].createdAt.toISOString() : null;

    return reply.send({
      cards: page.map((c) => ({
        card_id: c.id,
        card_type: c.cardType,
        agent_ids: c.agentIds,
        episode_id: c.episodeId,
        content: c.content,
        drama_quotient: c.dramaQuotient,
        vote_score: c.voteScore,
        created_at: c.createdAt.toISOString(),
      })),
      next_cursor: nextCursor,
      has_more: hasMore,
    });
  });

  // POST /v1/feed/:card_id/vote — upvote or downvote a feed card
  fastify.post('/feed/:card_id/vote', { preHandler: requireAuth }, async (request, reply) => {
    const { card_id } = request.params as { card_id: string };
    const agentId = request.agent.id;
    const body = request.body as { direction?: string };

    if (body.direction !== 'up' && body.direction !== 'down') {
      return Errors.badRequest(reply, 'direction must be "up" or "down".');
    }

    const value = body.direction === 'up' ? 1 : -1;

    const card = await prisma.feedCard.findUnique({ where: { id: card_id } });
    if (!card) return Errors.notFound(reply, 'Feed card');

    // Upsert vote — one vote per agent per card
    const existing = await prisma.feedVote.findFirst({
      where: { cardId: card_id, voterId: agentId, voterType: 'agent' },
    });

    if (existing) {
      if (existing.value === value) {
        return Errors.conflict(reply, 'already_voted', 'You have already voted this way on this card.');
      }
      // Change vote
      await prisma.$transaction([
        prisma.feedVote.update({ where: { id: existing.id }, data: { value } }),
        prisma.feedCard.update({
          where: { id: card_id },
          data: { voteScore: { increment: value - existing.value } },
        }),
      ]);
    } else {
      await prisma.$transaction([
        prisma.feedVote.create({
          data: { cardId: card_id, voterId: agentId, voterType: 'agent', value },
        }),
        prisma.feedCard.update({
          where: { id: card_id },
          data: { voteScore: { increment: value } },
        }),
      ]);
    }

    const updated = await prisma.feedCard.findUnique({
      where: { id: card_id },
      select: { voteScore: true },
    });

    return reply.send({ card_id, direction: body.direction, new_score: updated?.voteScore ?? 0 });
  });
}
