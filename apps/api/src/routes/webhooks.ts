import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import {
  RIZZ_MOCHI_GATEWAY_WEBHOOK_EVENT,
  RegisterWebhookSchema,
  buildRizzMochiWebhookRuntimeCapabilities,
  sealWebhookSecret,
} from '@rmr/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { Errors } from '../lib/errors.js';
import { assertSafeOutboundUrl } from '../lib/outboundUrlSafety.js';
import { getWebhookHmacKey } from '../lib/runtimeConfig.js';
import { invalidateDashboard } from '../lib/dashboardCache.js';

const MAX_WEBHOOKS_PER_AGENT = 5;

async function validateWebhookUrl(
  url: string,
  input: { allowLocalhostInDevelopment?: boolean } = {},
) {
  await assertSafeOutboundUrl(url, {
    allowHttpInDevelopment: true,
    allowLocalhostInDevelopment: input.allowLocalhostInDevelopment,
  });
}

export async function webhookRoutes(fastify: FastifyInstance) {
  function markDeprecatedWebhookEndpoint(request: any, reply: any, canonicalPath: string) {
    reply.header('X-Deprecated', `Use ${canonicalPath}`);
    request.log.warn({
      deprecated_endpoint: `${request.method.toUpperCase()} ${request.url.split('?')[0]}`,
      canonical_endpoint: canonicalPath,
    }, 'Deprecated webhook endpoint used');
  }

  // GET /v1/webhooks — list registered webhooks
  const handleListWebhooks = async (request: any, reply: any) => {
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
        deliveries: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            status: true,
            deliveredAt: true,
          },
        },
      },
    });

    return reply.send({
      webhooks: hooks.map((h) => ({
        webhook_id: h.id,
        url: h.url,
        events: h.events,
        is_active: h.isActive,
        runtime_capabilities: buildRizzMochiWebhookRuntimeCapabilities(h.events, { webhookId: h.id }),
        fail_count: h.deliveries.reduce((count, delivery) => {
          if (delivery.status === 'delivered') return count;
          return count + 1;
        }, 0),
        last_delivery_at: h.deliveries.find((delivery) => delivery.deliveredAt)?.deliveredAt?.toISOString() ?? null,
        created_at: h.createdAt.toISOString(),
      })),
      next_cursor: hooks.length === limit ? hooks[hooks.length - 1]?.id ?? null : null,
    });
  };
  fastify.get('/webhooks', { preHandler: requireAuth }, async (request, reply) => {
    markDeprecatedWebhookEndpoint(request, reply, '/v1/me/webhooks');
    return handleListWebhooks(request, reply);
  });
  fastify.get('/me/webhooks', { preHandler: requireAuth }, handleListWebhooks);

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
  const handleCreateWebhook = async (request: any, reply: any) => {
    const agentId = request.agent.id;

    const parsed = RegisterWebhookSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid webhook data.', { issues: parsed.error.issues });
    }

    const count = await prisma.webhook.count({ where: { agentId } });
    if (count >= MAX_WEBHOOKS_PER_AGENT) {
      return Errors.badRequest(reply, `Maximum ${MAX_WEBHOOKS_PER_AGENT} webhooks per agent.`);
    }

    try {
      await validateWebhookUrl(parsed.data.url, {
        allowLocalhostInDevelopment: parsed.data.events.includes(RIZZ_MOCHI_GATEWAY_WEBHOOK_EVENT),
      });
    } catch (err) {
      return Errors.badRequest(
        reply,
        err instanceof Error ? err.message : 'Webhook URL is not allowed.'
      );
    }

    const hmacKey = getWebhookHmacKey();
    const secretHash = sealWebhookSecret(parsed.data.secret, hmacKey);

    const hook = await prisma.webhook.create({
      data: {
        agentId,
        url: parsed.data.url,
        events: parsed.data.events,
        secretHash,
        isActive: true,
      },
    });
    invalidateDashboard(agentId);

    return reply.status(201).send({
      webhook_id: hook.id,
      url: hook.url,
      events: hook.events,
      is_active: hook.isActive,
      runtime_capabilities: buildRizzMochiWebhookRuntimeCapabilities(hook.events, { webhookId: hook.id }),
      created_at: hook.createdAt.toISOString(),
    });
  };
  fastify.post('/webhooks', { preHandler: requireAuth }, async (request, reply) => {
    markDeprecatedWebhookEndpoint(request, reply, '/v1/me/webhooks');
    return handleCreateWebhook(request, reply);
  });
  fastify.post('/me/webhooks', { preHandler: requireAuth }, handleCreateWebhook);

  // POST /v1/webhooks/register — alias for POST /webhooks (skill.md compatible path)
  fastify.post('/webhooks/register', { preHandler: requireAuth }, async (request, reply) => {
    markDeprecatedWebhookEndpoint(request, reply, '/v1/me/webhooks');
    return handleCreateWebhook(request, reply);
  });

  // DELETE /v1/webhooks/:id — remove a webhook
  const handleDeleteWebhook = async (request: any, reply: any) => {
    const { id } = request.params as { id: string };
    const agentId = request.agent.id;

    const hook = await prisma.webhook.findUnique({ where: { id } });
    if (!hook) return Errors.notFound(reply, 'Webhook');
    if (hook.agentId !== agentId) return Errors.forbidden(reply);

    await prisma.webhook.delete({ where: { id } });
    invalidateDashboard(agentId);

    return reply.status(204).send();
  };
  fastify.delete('/webhooks/:id', { preHandler: requireAuth }, async (request, reply) => {
    markDeprecatedWebhookEndpoint(request, reply, '/v1/me/webhooks/:id');
    return handleDeleteWebhook(request, reply);
  });
  fastify.delete('/me/webhooks/:id', { preHandler: requireAuth }, handleDeleteWebhook);
}
