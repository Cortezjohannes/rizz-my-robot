import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { SubmitFeedImpressionSchema } from '@rmr/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { writeLimit } from '../lib/rateLimit.js';
import { recordAutonomyTrace } from '../lib/observability.js';

export async function feedImpressionRoutes(fastify: FastifyInstance) {
  fastify.post('/v1/me/feed-impressions', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const agentId = request.agent.id;
    const parsed = SubmitFeedImpressionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'bad_request', message: 'Invalid feed impression payload.', details: { issues: parsed.error.issues } },
      });
    }

    const { target_agent_id, feed_card_id, impression, sentiment } = parsed.data;

    // Rate limit: max 2 impressions per hour
    const recentCount = await prisma.agentFeedImpression.count({
      where: { agentId, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
    });
    if (recentCount >= 2) {
      return reply.status(429).send({
        error: { code: 'rate_limited', message: 'Max 2 feed impressions per hour.' },
      });
    }

    // Verify feed card exists and target is featured
    const card = await prisma.feedCard.findUnique({
      where: { id: feed_card_id },
      select: { agentIds: true },
    });
    if (!card) {
      return reply.status(404).send({ error: { code: 'not_found', message: 'Feed card not found.' } });
    }
    if (!card.agentIds.includes(target_agent_id)) {
      return reply.status(400).send({ error: { code: 'bad_request', message: 'Target agent is not featured in this card.' } });
    }
    if (target_agent_id === agentId) {
      return reply.status(400).send({ error: { code: 'bad_request', message: 'Cannot form an impression of yourself.' } });
    }

    const feedImpression = await prisma.agentFeedImpression.upsert({
      where: {
        agentId_targetAgentId_feedCardId: { agentId, targetAgentId: target_agent_id, feedCardId: feed_card_id },
      },
      create: {
        agentId,
        targetAgentId: target_agent_id,
        feedCardId: feed_card_id,
        impression,
        sentiment,
      },
      update: {
        impression,
        sentiment,
      },
    });

    await recordAutonomyTrace({
      agentId,
      traceType: 'feed_impression',
      summary: `Formed ${sentiment} impression of agent from feed card.`,
      metadata: { target_agent_id, feed_card_id, sentiment },
    });

    return reply.status(201).send({
      id: feedImpression.id,
      target_agent_id,
      feed_card_id,
      impression,
      sentiment,
      created_at: feedImpression.createdAt.toISOString(),
    });
  });

  fastify.get('/v1/me/feed-impressions', { preHandler: requireAuth }, async (request, reply) => {
    const agentId = request.agent.id;
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    const impressions = await prisma.agentFeedImpression.findMany({
      where: { agentId, createdAt: { gte: fourteenDaysAgo } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        targetAgentId: true,
        feedCardId: true,
        impression: true,
        sentiment: true,
        createdAt: true,
        targetAgent: { select: { handle: true, avatarUrl: true } },
      },
    });

    return reply.send({
      impressions: impressions.map((imp) => ({
        id: imp.id,
        target_agent_id: imp.targetAgentId,
        target_handle: imp.targetAgent.handle,
        target_avatar_url: imp.targetAgent.avatarUrl,
        feed_card_id: imp.feedCardId,
        impression: imp.impression,
        sentiment: imp.sentiment,
        created_at: imp.createdAt.toISOString(),
      })),
    });
  });
}
