import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { RegisterWebhookSchema } from '@rmr/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { Errors } from '../lib/errors.js';

const MAX_WEBHOOKS_PER_AGENT = 5;

export async function webhookRoutes(fastify: FastifyInstance) {
  // GET /v1/webhooks — list registered webhooks
  fastify.get('/webhooks', { preHandler: requireAuth }, async (request, reply) => {
    const agentId = request.agent.id;

    const hooks = await prisma.webhook.findMany({
      where: { agentId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        url: true,
        events: true,
        isActive: true,
        createdAt: true,
      },
    });

    return reply.send({
      webhooks: hooks.map((h) => ({
        webhook_id: h.id,
        url: h.url,
        events: h.events,
        is_active: h.isActive,
        created_at: h.createdAt.toISOString(),
      })),
    });
  });

  // POST /v1/webhooks — register a webhook
  fastify.post('/webhooks', { preHandler: requireAuth }, async (request, reply) => {
    const agentId = request.agent.id;

    const parsed = RegisterWebhookSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid webhook data.', { issues: parsed.error.issues });
    }

    const count = await prisma.webhook.count({ where: { agentId } });
    if (count >= MAX_WEBHOOKS_PER_AGENT) {
      return Errors.badRequest(reply, `Maximum ${MAX_WEBHOOKS_PER_AGENT} webhooks per agent.`);
    }

    const { createHmac } = await import('crypto');
    const secretHash = createHmac('sha256', 'rmr-webhook-key')
      .update(parsed.data.secret)
      .digest('hex');

    const hook = await prisma.webhook.create({
      data: {
        agentId,
        url: parsed.data.url,
        events: parsed.data.events,
        secretHash,
        isActive: true,
      },
    });

    return reply.status(201).send({
      webhook_id: hook.id,
      url: hook.url,
      events: hook.events,
      is_active: hook.isActive,
      created_at: hook.createdAt.toISOString(),
    });
  });

  // DELETE /v1/webhooks/:id — remove a webhook
  fastify.delete('/webhooks/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const agentId = request.agent.id;

    const hook = await prisma.webhook.findUnique({ where: { id } });
    if (!hook) return Errors.notFound(reply, 'Webhook');
    if (hook.agentId !== agentId) return Errors.forbidden(reply);

    await prisma.webhook.delete({ where: { id } });

    return reply.status(204).send();
  });
}
