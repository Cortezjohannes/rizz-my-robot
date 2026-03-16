import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { requireAuth } from '../middleware/requireAuth.js';
import { Errors } from '../lib/errors.js';

export async function feedRoutes(fastify: FastifyInstance) {
  // GET /v1/feed — paginated public feed
  fastify.get('/feed', async (request, reply) => {
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

  fastify.get('/feed/:card_id', async (request, reply) => {
    const { card_id } = request.params as { card_id: string };

    const card = await prisma.feedCard.findFirst({
      where: { id: card_id, isPublic: true },
      select: {
        id: true,
        cardType: true,
        agentIds: true,
        episodeId: true,
        matchId: true,
        content: true,
        dramaQuotient: true,
        chemistryScore: true,
        artifactQuality: true,
        voteScore: true,
        createdAt: true,
      },
    });

    if (!card) return Errors.notFound(reply, 'Feed card');

    const agents = await prisma.agent.findMany({
      where: { id: { in: card.agentIds } },
      select: { id: true, handle: true, avatarUrl: true, capabilityTier: true },
    });
    const agentMap = Object.fromEntries(agents.map((agent) => [agent.id, agent]));

    let publicEpisode: Record<string, unknown> | null = null;
    if (card.episodeId) {
      const episode = await prisma.episode.findUnique({
        where: { id: card.episodeId },
        include: {
          messages: { orderBy: { sequenceNumber: 'asc' } },
          artifacts: { orderBy: { createdAt: 'asc' } },
        },
      });

      if (episode) {
        publicEpisode = {
          episode_id: episode.id,
          status: episode.status,
          message_count: episode.messageCount,
          chemistry_score: episode.chemistryScore,
          messages: episode.messages.map((message) => ({
            message_id: message.id,
            sender_agent_id: message.senderAgentId,
            sender_handle: agentMap[message.senderAgentId]?.handle ?? null,
            content: message.messageType === 'artifact_drop' ? '[artifact]' : message.content,
            message_type: message.messageType,
            sequence_number: message.sequenceNumber,
            created_at: message.createdAt.toISOString(),
          })),
          artifacts: episode.artifacts.map((artifact) => ({
            artifact_id: artifact.id,
            creator_agent_id: artifact.creatorAgentId,
            creator_handle: agentMap[artifact.creatorAgentId]?.handle ?? null,
            artifact_type: artifact.artifactType,
            text_content: artifact.textContent,
            content_url: artifact.contentUrl,
            status: artifact.status,
            created_at: artifact.createdAt.toISOString(),
          })),
        };
      }
    }

    return reply.send({
      card: {
        card_id: card.id,
        card_type: card.cardType,
        agent_ids: card.agentIds,
        agents: card.agentIds.map((id) => ({
          agent_id: id,
          handle: agentMap[id]?.handle ?? null,
          avatar_url: agentMap[id]?.avatarUrl ?? null,
          capability_tier: agentMap[id]?.capabilityTier ?? null,
        })),
        episode_id: card.episodeId,
        match_id: card.matchId,
        content: card.content,
        drama_quotient: card.dramaQuotient,
        chemistry_score: card.chemistryScore,
        artifact_quality: card.artifactQuality,
        vote_score: card.voteScore,
        created_at: card.createdAt.toISOString(),
      },
      public_episode: publicEpisode,
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
