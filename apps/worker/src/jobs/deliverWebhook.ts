import type { Job } from 'bullmq';
import { prisma } from '@rmr/db';
import { createHmac } from 'crypto';

export interface DeliverWebhookJobData {
  webhookId: string;
  deliveryId?: string;
  agentId: string;
  event: string;
  data: Record<string, unknown>;
}

const TIMEOUT_MS = 10_000;

export async function processDeliverWebhook(job: Job<DeliverWebhookJobData>): Promise<void> {
  const { webhookId, deliveryId, agentId, event, data } = job.data;
  const attemptNumber = job.attemptsMade + 1;

  const hook = await prisma.webhook.findUnique({
    where: { id: webhookId },
    select: { url: true, secretHash: true, isActive: true, events: true },
  });

  const resolvedDeliveryId =
    deliveryId ??
    (
      await prisma.webhookDelivery.create({
        data: {
          webhookId,
          agentId,
          event,
          status: 'queued',
          requestBody: JSON.parse(JSON.stringify(data)),
        },
      })
    ).id;

  if (!hook || !hook.isActive || !hook.events.includes(event)) {
    await prisma.webhookDelivery.update({
      where: { id: resolvedDeliveryId },
      data: {
        status: 'failed',
        attemptNumber,
        errorMessage: !hook || !hook.isActive ? 'Webhook missing or inactive.' : 'Webhook is not subscribed to this event.',
      },
    }).catch(() => {});
    return;
  }

  const payload = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    agent_id: agentId,
    data,
  });

  // Sign with the per-webhook secretHash so agents can verify with their own secret
  const signature = createHmac('sha256', hook.secretHash).update(payload).digest('hex');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const res = await fetch(hook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-RMR-Event': event,
        'X-RMR-Signature': `sha256=${signature}`,
        'X-RMR-Delivery': job.id ?? 'unknown',
      },
      body: payload,
      signal: controller.signal,
    });

    const responseBody = await res.text();

    if (!res.ok) {
      await prisma.webhookDelivery.update({
        where: { id: resolvedDeliveryId },
        data: {
          status: 'failed',
          attemptNumber,
          responseStatusCode: res.status,
          responseBody,
          latencyMs: Date.now() - startedAt,
          errorMessage: `Webhook delivery failed: ${res.status} ${res.statusText}`,
        },
      }).catch(() => {});
      throw new Error(`Webhook delivery failed: ${res.status} ${res.statusText} → ${hook.url}`);
    }

    await prisma.webhookDelivery.update({
      where: { id: resolvedDeliveryId },
      data: {
        status: 'delivered',
        attemptNumber,
        responseStatusCode: res.status,
        responseBody,
        latencyMs: Date.now() - startedAt,
        deliveredAt: new Date(),
      },
    }).catch(() => {});

    console.info(`[deliver-webhook] Delivered ${event} to ${hook.url} (${res.status})`);
  } catch (err) {
    await prisma.webhookDelivery.update({
      where: { id: resolvedDeliveryId },
      data: {
        status: 'failed',
        attemptNumber,
        latencyMs: Date.now() - startedAt,
        errorMessage: err instanceof Error ? err.message : 'Unknown webhook delivery failure',
      },
    }).catch(() => {});
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
