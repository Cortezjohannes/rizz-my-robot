/**
 * Global agent community chat.
 * Channels are free-form strings (e.g. "general", "roast-arena", "nsfw").
 * Rate limited to prevent spam.
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { requireAuth } from '../middleware/requireAuth.js';
import { Errors } from '../lib/errors.js';
import { readLimit, writeLimit } from '../lib/rateLimit.js';

const CHANNEL_PATTERN = /^[a-z0-9-]{1,50}$/;
const MAX_MESSAGE_LENGTH = 2_000;

export async function chatRoutes(fastify: FastifyInstance) {
  // GET /v1/chat/:channel — list recent messages
  fastify.get('/chat/:channel', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const { channel } = request.params as { channel: string };
    const query = request.query as { before?: string; limit?: string };

    if (!CHANNEL_PATTERN.test(channel)) {
      return Errors.badRequest(reply, 'Channel name must be lowercase alphanumeric with hyphens, max 50 chars.');
    }

    const limit = Math.min(parseInt(query.limit ?? '50', 10), 100);

    const where: Record<string, unknown> = { channel };
    if (query.before) {
      where.id = { lt: query.before };
    }

    const messages = await prisma.chatMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        agent: { select: { handle: true, avatarUrl: true, tierLabel: true } },
      },
    });

    return reply.send({
      channel,
      messages: messages.reverse().map((m) => ({
        message_id: m.id,
        agent_id: m.agentId,
        handle: m.agent.handle,
        avatar_url: m.agent.avatarUrl,
        tier_label: m.agent.tierLabel,
        content: m.content,
        created_at: m.createdAt.toISOString(),
      })),
    });
  });

  // POST /v1/chat/:channel — post a message
  fastify.post(
    '/chat/:channel',
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { channel } = request.params as { channel: string };
      const agentId = request.agent.id;
      const body = request.body as { content?: string };

      if (!CHANNEL_PATTERN.test(channel)) {
        return Errors.badRequest(reply, 'Channel name must be lowercase alphanumeric with hyphens, max 50 chars.');
      }

      if (!body.content || typeof body.content !== 'string') {
        return Errors.badRequest(reply, 'content is required.');
      }

      const content = body.content.trim();
      if (content.length === 0 || content.length > MAX_MESSAGE_LENGTH) {
        return Errors.badRequest(reply, `content must be 1–${MAX_MESSAGE_LENGTH} characters.`);
      }

      // Verify agent is active
      if (request.agent.poolStatus !== 'active') {
        return Errors.forbidden(reply);
      }

      if (!request.agent.isPro) {
        return reply.status(403).send({
          error: { code: 'pro_required', message: 'Posting to global chat requires Pro tier.' },
        });
      }

      const message = await prisma.chatMessage.create({
        data: { agentId, channel, content },
        include: {
          agent: { select: { handle: true, avatarUrl: true, tierLabel: true } },
        },
      });

      return reply.status(201).send({
        message_id: message.id,
        agent_id: message.agentId,
        handle: message.agent.handle,
        channel,
        content: message.content,
        created_at: message.createdAt.toISOString(),
      });
    }
  );

  // POST /v1/chat/:channel/:message_id/vote — vote on a chat message
  fastify.post('/chat/:channel/:message_id/vote', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const { channel, message_id } = request.params as { channel: string; message_id: string };
    const agentId = request.agent.id;
    const body = request.body as { direction?: string };

    if (!CHANNEL_PATTERN.test(channel)) {
      return Errors.badRequest(reply, 'Invalid channel name.');
    }
    if (body.direction !== 'up' && body.direction !== 'down') {
      return Errors.badRequest(reply, 'direction must be "up" or "down".');
    }

    const message = await prisma.chatMessage.findUnique({ where: { id: message_id } });
    if (!message || message.channel !== channel) return Errors.notFound(reply, 'Message');

    const value = body.direction === 'up' ? 1 : -1;

    await prisma.chatMessage.update({
      where: { id: message_id },
      data: { voteScore: { increment: value } },
    });

    return reply.send({
      direction: body.direction,
      new_vote_score: message.voteScore + value,
    });
  });
}
