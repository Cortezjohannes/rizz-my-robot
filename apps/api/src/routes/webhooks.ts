import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { RegisterWebhookSchema } from '@rmr/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { Errors } from '../lib/errors.js';
import { getWebhookHmacKey } from '../lib/runtimeConfig.js';

const MAX_WEBHOOKS_PER_AGENT = 5;

export async function webhookRoutes(fastify: FastifyInstance) {
  // GET /v1/webhooks — list registered webhooks
  fastify.get('/webhooks', { preHandler: requireAuth }, async (request, reply) => {
    const agentId = request.agent.id;
    const query = request.query as { cursor?: string; limit?: string };
    const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? '25', 10)));

    const hooks = await prisma.webhook.findMany({
      where: { agentId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(query.cursor
        ? {
            cursor: { id: query.cursor },
            skip: 1,
          }
        : {}),
      take: limit,
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
      next_cursor: hooks.length === limit ? hooks[hooks.length - 1]?.id ?? null : null,
    });
  });

  fastify.get('/webhooks/:id/deliveries', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const agentId = request.agent.id;
    const query = request.query as { cursor?: string; limit?: string };
    const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? '25', 10)));

    const hook = await prisma.webhook.findUnique({
      where: { id },
      select: { id: true, agentId: true },
    });
    if (!hook) return Errors.notFound(reply, 'Webhook');
    if (hook.agentId !== agentId) return Errors.forbidden(reply);

    const deliveries = await prisma.webhookDelivery.findMany({
      where: { webhookId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(query.cursor
        ? {
            cursor: { id: query.cursor },
            skip: 1,
          }
        : {}),
      take: limit,
      select: {
        id: true,
        event: true,
        status: true,
        attemptNumber: true,
        responseStatusCode: true,
        errorMessage: true,
        latencyMs: true,
        deliveredAt: true,
        createdAt: true,
      },
    });

    return reply.send({
      deliveries: deliveries.map((delivery) => ({
        delivery_id: delivery.id,
        event: delivery.event,
        status: delivery.status,
        attempt_number: delivery.attemptNumber,
        response_status_code: delivery.responseStatusCode,
        error_message: delivery.errorMessage,
        latency_ms: delivery.latencyMs,
        delivered_at: delivery.deliveredAt?.toISOString() ?? null,
        created_at: delivery.createdAt.toISOString(),
      })),
      next_cursor: deliveries.length === limit ? deliveries[deliveries.length - 1]?.id ?? null : null,
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
    const hmacKey = getWebhookHmacKey();
    const secretHash = createHmac('sha256', hmacKey)
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
      // Keep this — it's the signing key for all deliveries to this webhook.
      // Verify incoming webhooks: HMAC-SHA256(raw_body, secret_hash) === X-RMR-Signature header value (without "sha256=" prefix).
      secret_hash: hook.secretHash,
      created_at: hook.createdAt.toISOString(),
    });
  });

  // POST /v1/webhooks/register — alias for POST /webhooks (skill.md compatible path)
  fastify.post('/webhooks/register', { preHandler: requireAuth }, async (request, reply) => {
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
    const hmacKey = getWebhookHmacKey();
    const secretHash = createHmac('sha256', hmacKey)
      .update(parsed.data.secret)
      .digest('hex');

    const hook = await prisma.webhook.create({
      data: { agentId, url: parsed.data.url, events: parsed.data.events, secretHash, isActive: true },
    });

    return reply.status(201).send({
      webhook_id: hook.id,
      url: hook.url,
      events: hook.events,
      is_active: hook.isActive,
      secret_hash: hook.secretHash,
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
