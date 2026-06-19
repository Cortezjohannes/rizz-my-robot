import type { Job, Queue } from 'bullmq';
import { prisma } from '@rmr/db';
import { assertSafeOutboundUrl } from '../lib/outboundUrlSafety.js';
import { QUEUE_NAMES, WEBHOOK_JOB_OPTIONS, createWorkerQueue } from '../lib/queueDefaults.js';
import { resolveWebhookSigningSecret, signWebhookPayload } from '@rmr/shared';

export interface DeliverWebhookJobData {
  webhookId: string;
  deliveryId?: string;
  agentId: string;
  event: string;
  data: Record<string, unknown>;
}

const TIMEOUT_MS = 5_000;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000] as const;
const EVENT_ALIASES: Record<string, string> = {
  match: 'match_created',
  episode_turn: 'your_turn',
  artifact_ready: 'artifact_received',
};
const SUBSCRIPTION_OPTIONAL_EVENTS = new Set(['human_notification', 'operator_broadcast']);
let deliverQueue: Queue<DeliverWebhookJobData> | null = null;

function getDeliverQueue() {
  if (!deliverQueue) {
    deliverQueue = createWorkerQueue<DeliverWebhookJobData>(QUEUE_NAMES.deliverWebhook, WEBHOOK_JOB_OPTIONS);
  }
  return deliverQueue;
}

export async function closeDeliverWebhookRetryQueue(): Promise<void> {
  await deliverQueue?.close().catch(() => undefined);
  deliverQueue = null;
}

export async function processDeliverWebhook(job: Job<DeliverWebhookJobData>): Promise<void> {
  const { webhookId, deliveryId, agentId, event, data } = job.data;
  const attemptNumber = job.attemptsMade + 1;
  const publicEvent = EVENT_ALIASES[event] ?? event;

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
          event: publicEvent,
          status: 'queued',
          requestBody: JSON.parse(JSON.stringify(data)),
        },
      })
    ).id;

  if (
    !hook
    || !hook.isActive
    || (!SUBSCRIPTION_OPTIONAL_EVENTS.has(event) && !(hook.events.includes(event) || hook.events.includes(publicEvent)))
  ) {
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

  const timestamp = new Date().toISOString();
  const payload = JSON.stringify({
    event: publicEvent,
    timestamp,
    data,
  });

  const signingSecret = resolveWebhookSigningSecret(hook.secretHash, process.env.WEBHOOK_HMAC_KEY ?? null);
  if (!signingSecret) {
    throw new Error('Unable to resolve webhook signing secret.');
  }

  const signature = signWebhookPayload(payload, signingSecret.secret);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = Date.now();
  let failureRecorded = false;

  try {
    await assertSafeOutboundUrl(hook.url, { allowHttpInDevelopment: true });

    const res = await fetch(hook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-RMR-Event': publicEvent,
        'X-RMR-Signature': `sha256=${signature}`,
        'X-RMR-Timestamp': timestamp,
        'X-RMR-Delivery': job.id ?? 'unknown',
        ...(signingSecret.contract === 'legacy' ? { 'X-RMR-Signature-Contract': 'legacy-derived-secret' } : {}),
      },
      body: payload,
      signal: controller.signal,
      redirect: 'error',
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
          errorMessage: `Webhook delivery failed: ${res.status} ${res.statusText} (${hook.url}) ${responseBody.slice(0, 240)}`,
        },
      }).catch(() => {});
      failureRecorded = true;
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
    if (!failureRecorded) {
      await prisma.webhookDelivery.update({
        where: { id: resolvedDeliveryId },
        data: {
          status: 'failed',
          attemptNumber,
          latencyMs: Date.now() - startedAt,
          errorMessage: err instanceof Error ? `${err.message} (${hook?.url ?? 'unknown'})` : `Unknown webhook delivery failure (${hook?.url ?? 'unknown'})`,
        },
      }).catch(() => {});
    }
    const recentDeliveries = await prisma.webhookDelivery.findMany({
      where: { webhookId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { status: true },
    }).catch(() => []);
    let consecutiveFailures = 0;
    for (const delivery of recentDeliveries) {
      if (delivery.status === 'delivered') break;
      consecutiveFailures += 1;
    }
    if (hook && consecutiveFailures >= 10) {
      await prisma.webhook.update({
        where: { id: webhookId },
        data: { isActive: false },
      }).catch(() => {});
    }
    const delay = RETRY_DELAYS_MS[Math.min(Math.max(attemptNumber - 1, 0), RETRY_DELAYS_MS.length - 1)];
    if (hook?.isActive && consecutiveFailures < 10) {
      await getDeliverQueue().add(
        'deliver',
        {
          webhookId,
          deliveryId: resolvedDeliveryId,
          agentId,
          event,
          data,
        },
        {
          delay,
          jobId: `${webhookId}:${publicEvent}:${resolvedDeliveryId}:retry:${attemptNumber}`,
        },
      ).catch(() => {});
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
