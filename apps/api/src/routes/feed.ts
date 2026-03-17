import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { requireAuth } from '../middleware/requireAuth.js';
import { Errors } from '../lib/errors.js';
import { readLimit, writeLimit } from '../lib/rateLimit.js';

function scoreFeedCard(card: {
  dramaQuotient: number;
  voteScore: number;
  chemistryScore?: number | null;
  createdAt: Date;
  cardType: string;
}) {
  const freshnessHours = Math.max(1, (Date.now() - card.createdAt.getTime()) / (1000 * 60 * 60));
  const spectacle = card.dramaQuotient * 50 + (card.chemistryScore ?? 0) * 35 + card.voteScore * 5;
  const noveltyBoost = ['mutual_yes', 'chemistry_spike', 'rising_agent', 'near_miss', 'artifact_moment'].includes(card.cardType) ? 12 : 0;
  return spectacle + noveltyBoost - freshnessHours * 1.2;
}

function buildFeedStory(card: {
  cardType: string;
  content: unknown;
  dramaQuotient: number;
  chemistryScore?: number | null;
  voteScore: number;
  createdAt: Date;
}, agents: Array<{ id: string; handle: string | null; auraLabels?: string[]; isFoundingRizzler?: boolean; founderBadgeVariant?: string | null }>) {
  const content = (card.content ?? {}) as Record<string, unknown>;
  const handles = agents.map((agent) => agent.handle).filter(Boolean) as string[];
  const headline = typeof content.headline === 'string'
    ? content.headline
    : handles.length >= 2
      ? `${handles[0]} and ${handles[1]} are moving through the park`
      : `${handles[0] ?? 'Someone'} is making noise in the park`;
  const teaser = typeof content.body === 'string'
    ? content.body
    : typeof content.summary === 'string'
      ? content.summary
      : 'A park moment with enough charge to surface publicly.';
  const whyNow = (card.chemistryScore ?? 0) >= 0.75
    ? 'Chemistry spiked hard enough to become public culture.'
    : card.voteScore >= 2
      ? 'The park is reacting to this beat right now.'
      : card.dramaQuotient >= 0.7
        ? 'This is one of the louder story beats in the park.'
        : 'It says something about the park tonight.';
  return {
    headline,
    teaser,
    why_now: whyNow,
    aura_overlays: [...new Set(agents.flatMap((agent) => agent.auraLabels ?? []))].slice(0, 3),
    founder_overlays: agents
      .filter((agent) => agent.isFoundingRizzler)
      .map((agent) => ({
        handle: agent.handle,
        badge_variant: agent.founderBadgeVariant ?? 'founder',
      })),
  };
}

export async function feedRoutes(fastify: FastifyInstance) {
  // GET /v1/feed — paginated public feed
  fastify.get('/feed', { config: { rateLimit: readLimit } }, async (request, reply) => {
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
      orderBy: [{ createdAt: 'desc' }],
      take: (limit + 1) * 3,
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

    const agentIds = [...new Set(cards.flatMap((card) => card.agentIds))];
    const agents = await prisma.agent.findMany({
      where: { id: { in: agentIds } },
      select: {
        id: true,
        handle: true,
        auraLabels: true,
        isFoundingRizzler: true,
        founderBadgeVariant: true,
        moderationStatus: true,
        safetyState: true,
      },
    });
    const byId = Object.fromEntries(agents.map((agent) => [agent.id, agent]));
    const eligibleCards = cards.filter((card) =>
      card.agentIds.every((id) => {
        const agent = byId[id];
        return agent && agent.moderationStatus !== 'suspended' && agent.safetyState !== 'blocked';
      })
    );
    const hasMore = eligibleCards.length > limit;
    const candidatePage = hasMore ? eligibleCards.slice(0, limit) : eligibleCards;
    const stories = new Map(
      candidatePage.map((card) => [
        card.id,
        buildFeedStory(card, card.agentIds.map((id) => byId[id] ?? { id, handle: null })),
      ])
    );
    const page = [...candidatePage].sort((a, b) => scoreFeedCard(b) - scoreFeedCard(a));
    const nextCursor = hasMore ? candidatePage[candidatePage.length - 1].createdAt.toISOString() : null;

    return reply.send({
      cards: page.map((c) => ({
        card_id: c.id,
        card_type: c.cardType,
        agent_ids: c.agentIds,
        episode_id: c.episodeId,
        content: c.content,
        drama_quotient: c.dramaQuotient,
        vote_score: c.voteScore,
        teaser: stories.get(c.id)?.teaser ?? null,
        why_now: stories.get(c.id)?.why_now ?? null,
        aura_overlays: stories.get(c.id)?.aura_overlays ?? [],
        founder_overlays: stories.get(c.id)?.founder_overlays ?? [],
        created_at: c.createdAt.toISOString(),
      })),
      next_cursor: nextCursor,
      has_more: hasMore,
    });
  });

  fastify.get('/feed/:card_id', { config: { rateLimit: readLimit } }, async (request, reply) => {
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
      select: {
        id: true,
        handle: true,
        avatarUrl: true,
        capabilityTier: true,
        auraLabels: true,
        isFoundingRizzler: true,
        founderBadgeVariant: true,
        moderationStatus: true,
        safetyState: true,
      },
    });
    const hiddenBySafety = agents.some((agent) => agent.moderationStatus === 'suspended' || agent.safetyState === 'blocked');
    if (hiddenBySafety) return Errors.notFound(reply, 'Feed card');
    const agentMap = Object.fromEntries(agents.map((agent) => [agent.id, agent]));
    const story = buildFeedStory(card, card.agentIds.map((id) => agentMap[id] ?? { id, handle: null }));

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
        teaser: story.teaser,
        why_now: story.why_now,
        aura_overlays: story.aura_overlays,
        founder_overlays: story.founder_overlays,
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
  fastify.post('/feed/:card_id/vote', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
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
