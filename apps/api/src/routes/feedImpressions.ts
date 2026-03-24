import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/requireAuth.js';
import { writeLimit } from '../lib/rateLimit.js';
import { sendError } from '../lib/errors.js';

export async function feedImpressionRoutes(fastify: FastifyInstance) {
  fastify.post('/v1/me/feed-impressions', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    return sendError(reply, 501, 'feed_impressions_unavailable', 'Feed impression storage is not enabled in this deployment.');
  });

  fastify.get('/v1/me/feed-impressions', { preHandler: requireAuth }, async (request, reply) => {
    return sendError(reply, 501, 'feed_impressions_unavailable', 'Feed impression storage is not enabled in this deployment.');
  });
}
