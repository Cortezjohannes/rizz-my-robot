import { createHash } from 'node:crypto';
import type { Job } from 'bullmq';
import { prisma } from '@rmr/db';
import {
  RIZZ_MOCHI_GATEWAY_WEBHOOK_EVENT,
  RIZZ_MOCHI_LEGACY_WAKE_WEBHOOK_EVENTS,
  RIZZ_MOCHI_WAKE_HEADER_NAMES,
  buildRizzMochiWakeEvent,
  resolveWebhookSigningSecret,
  signRizzMochiWakeEvent,
  signWebhookPayload,
  type RizzMochiWakeEvent,
  type RizzMochiWakeReason,
  type RizzMochiWakeScope,
  type RizzMochiWakeSignatureHeaders,
} from '@rmr/shared';
import { assertSafeOutboundUrl } from '../lib/outboundUrlSafety.js';

export interface WakeAgentJobData {
  targetAgentId: string;
  trigger: 'new_message' | 'new_match' | 'episode_exit' | 'episode_decision';
  episodeId?: string;
  matchId?: string;
  senderAgentId?: string;
}

type WakeWebhook = {
  id: string;
  url: string;
  secretHash: string;
  events: string[];
};

type DeliveryKind = 'legacy' | 'mochi';

type DeliveryOutcome = {
  kind: DeliveryKind;
  webhookId: string;
  ok: boolean;
  error?: unknown;
};

const TIMEOUT_MS = 5_000;
const MOCHI_WAKE_DEADLINE_MS = 5 * 60 * 1_000;
const LEGACY_WAKE_EVENT = 'wake_agent';
const LEGACY_WAKE_EVENT_SET = new Set<string>(RIZZ_MOCHI_LEGACY_WAKE_WEBHOOK_EVENTS);

function createWakeToken(prefix: string, parts: readonly unknown[]): string {
  const digest = createHash('sha256')
    .update(JSON.stringify(parts))
    .digest('base64url')
    .slice(0, 40);
  return `${prefix}_${digest}`;
}

function mapTriggerToWakeReason(trigger: WakeAgentJobData['trigger']): RizzMochiWakeReason {
  switch (trigger) {
    case 'new_message':
      return 'episode-turn';
    case 'new_match':
      return 'candidate-ready';
    case 'episode_decision':
      return 'decision-ready';
    case 'episode_exit':
      return 'human-reveal-needed';
  }
}

function buildWakeScope(input: WakeAgentJobData): RizzMochiWakeScope {
  if (input.episodeId) return { type: 'turn', id: input.episodeId };
  if (input.matchId) return { type: 'match', id: input.matchId };
  return { type: 'game' };
}

function buildMochiWakePayload(input: WakeAgentJobData): Record<string, unknown> {
  return {
    trigger: input.trigger,
    target_agent_id: input.targetAgentId,
    episode_id: input.episodeId ?? null,
    match_id: input.matchId ?? null,
    sender_agent_id: input.senderAgentId ?? null,
    read_state_url: '/v1/mochi/state',
    intent_submit_url: '/v1/mochi/intents',
  };
}

function labelPayloadPublic(payload: Record<string, unknown>): Record<string, 'public'> {
  return Object.fromEntries(Object.keys(payload).map((key) => [key, 'public']));
}

function createMochiWake(input: {
  job: Job<WakeAgentJobData>;
  signedAt: Date;
}): RizzMochiWakeEvent {
  const jobData = input.job.data;
  const idempotencyKey = createWakeToken('wake_idem', [
    input.job.id ?? 'wake-agent',
    jobData.targetAgentId,
    jobData.trigger,
    jobData.episodeId ?? null,
    jobData.matchId ?? null,
    jobData.senderAgentId ?? null,
  ]);
  const nonce = createWakeToken('wake_nonce', [
    idempotencyKey,
    input.job.attemptsMade + 1,
  ]);
  const payload = buildMochiWakePayload(jobData);

  return buildRizzMochiWakeEvent({
    agentId: jobData.targetAgentId,
    reasonId: mapTriggerToWakeReason(jobData.trigger),
    deadline: new Date(input.signedAt.getTime() + MOCHI_WAKE_DEADLINE_MS),
    scope: buildWakeScope(jobData),
    nonce,
    idempotencyKey,
    payload,
    payloadRedactionLabels: labelPayloadPublic(payload),
  });
}

function buildMochiWakeDeliverySnapshot(input: {
  wake: RizzMochiWakeEvent;
  headers: RizzMochiWakeSignatureHeaders;
}) {
  return {
    event: RIZZ_MOCHI_GATEWAY_WEBHOOK_EVENT,
    body: {
      schema_version: input.wake.schemaVersion,
      event_type: input.wake.eventType,
      game_id: input.wake.gameId,
      agent_id: input.wake.agentId,
      reason: input.wake.reason,
      deadline: input.wake.deadline,
      scope: input.wake.scope,
      nonce: '[redacted]',
      idempotency_key: input.wake.idempotencyKey,
      payload: input.wake.payload,
      payload_redaction_labels: input.wake.payloadRedactionLabels,
    },
    headers: {
      [RIZZ_MOCHI_WAKE_HEADER_NAMES.algorithm]: input.headers[RIZZ_MOCHI_WAKE_HEADER_NAMES.algorithm] ?? null,
      [RIZZ_MOCHI_WAKE_HEADER_NAMES.keyId]: input.headers[RIZZ_MOCHI_WAKE_HEADER_NAMES.keyId] ?? null,
      [RIZZ_MOCHI_WAKE_HEADER_NAMES.timestamp]: input.headers[RIZZ_MOCHI_WAKE_HEADER_NAMES.timestamp] ?? null,
      [RIZZ_MOCHI_WAKE_HEADER_NAMES.signature]: '[redacted]',
    },
  };
}

function toJsonSnapshot(input: unknown) {
  return JSON.parse(JSON.stringify(input));
}

function shouldDeliverLegacyWake(webhook: WakeWebhook): boolean {
  return webhook.events.some((event) => LEGACY_WAKE_EVENT_SET.has(event));
}

function shouldDeliverMochiWake(webhook: WakeWebhook): boolean {
  return webhook.events.includes(RIZZ_MOCHI_GATEWAY_WEBHOOK_EVENT);
}

async function updateDeliveryFailure(input: {
  deliveryId: string;
  attemptNumber: number;
  startedAt: number;
  error: unknown;
  responseStatusCode?: number;
  responseBody?: string;
}) {
  await prisma.webhookDelivery.update({
    where: { id: input.deliveryId },
    data: {
      status: 'failed',
      attemptNumber: input.attemptNumber,
      responseStatusCode: input.responseStatusCode,
      responseBody: input.responseBody,
      latencyMs: Date.now() - input.startedAt,
      errorMessage: input.error instanceof Error ? input.error.message : String(input.error),
    },
  }).catch(() => {});
}

async function updateDeliverySuccess(input: {
  deliveryId: string;
  attemptNumber: number;
  startedAt: number;
  responseStatusCode: number;
  responseBody: string;
}) {
  await prisma.webhookDelivery.update({
    where: { id: input.deliveryId },
    data: {
      status: 'delivered',
      attemptNumber: input.attemptNumber,
      responseStatusCode: input.responseStatusCode,
      responseBody: input.responseBody,
      latencyMs: Date.now() - input.startedAt,
      deliveredAt: new Date(),
    },
  }).catch(() => {});
}

async function postSignedWebhook(input: {
  webhook: WakeWebhook;
  body: string;
  headers: Record<string, string>;
  allowLocalhostInDevelopment?: boolean;
}) {
  await assertSafeOutboundUrl(input.webhook.url, {
    allowHttpInDevelopment: true,
    allowLocalhostInDevelopment: input.allowLocalhostInDevelopment,
  });

  return fetch(input.webhook.url, {
    method: 'POST',
    headers: input.headers,
    body: input.body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'error',
  });
}

async function deliverLegacyWake(input: {
  job: Job<WakeAgentJobData>;
  webhook: WakeWebhook;
  timestamp: string;
}): Promise<void> {
  const { targetAgentId, trigger, episodeId, matchId, senderAgentId } = input.job.data;
  const attemptNumber = input.job.attemptsMade + 1;
  const payload = JSON.stringify({
    event: LEGACY_WAKE_EVENT,
    trigger,
    target_agent_id: targetAgentId,
    episode_id: episodeId ?? null,
    match_id: matchId ?? null,
    sender_agent_id: senderAgentId ?? null,
    timestamp: input.timestamp,
  });
  const delivery = await prisma.webhookDelivery.create({
    data: {
      webhookId: input.webhook.id,
      agentId: targetAgentId,
      event: LEGACY_WAKE_EVENT,
      status: 'queued',
      requestBody: JSON.parse(payload),
    },
  });
  const startedAt = Date.now();

  try {
    const signingSecret = resolveWebhookSigningSecret(input.webhook.secretHash, process.env.WEBHOOK_HMAC_KEY ?? null);
    if (!signingSecret) {
      throw new Error(`Unable to resolve webhook signing secret for wake webhook ${input.webhook.id}.`);
    }

    const signature = signWebhookPayload(payload, signingSecret.secret);
    const res = await postSignedWebhook({
      webhook: input.webhook,
      body: payload,
      headers: {
        'Content-Type': 'application/json',
        'X-RMR-Event': LEGACY_WAKE_EVENT,
        'X-RMR-Trigger': trigger,
        'X-RMR-Signature': `sha256=${signature}`,
        'X-RMR-Timestamp': input.timestamp,
        ...(signingSecret.contract === 'legacy' ? { 'X-RMR-Signature-Contract': 'legacy-derived-secret' } : {}),
      },
    });
    const responseBody = await res.text();

    if (!res.ok) {
      throw Object.assign(new Error(`Webhook delivery failed: ${res.status} ${res.statusText} (${input.webhook.url}) ${responseBody.slice(0, 240)}`), {
        responseStatusCode: res.status,
        responseBody,
      });
    }

    await updateDeliverySuccess({
      deliveryId: delivery.id,
      attemptNumber,
      startedAt,
      responseStatusCode: res.status,
      responseBody,
    });
  } catch (error) {
    await updateDeliveryFailure({
      deliveryId: delivery.id,
      attemptNumber,
      startedAt,
      error,
      responseStatusCode: typeof (error as { responseStatusCode?: unknown }).responseStatusCode === 'number'
        ? (error as { responseStatusCode: number }).responseStatusCode
        : undefined,
      responseBody: typeof (error as { responseBody?: unknown }).responseBody === 'string'
        ? (error as { responseBody: string }).responseBody
        : undefined,
    });
    throw error;
  }
}

async function deliverMochiWake(input: {
  job: Job<WakeAgentJobData>;
  webhook: WakeWebhook;
  signedAt: Date;
}): Promise<void> {
  const wake = createMochiWake({ job: input.job, signedAt: input.signedAt });
  const attemptNumber = input.job.attemptsMade + 1;
  const delivery = await prisma.webhookDelivery.create({
    data: {
      webhookId: input.webhook.id,
      agentId: input.job.data.targetAgentId,
      event: RIZZ_MOCHI_GATEWAY_WEBHOOK_EVENT,
      status: 'queued',
      requestBody: toJsonSnapshot(buildMochiWakeDeliverySnapshot({ wake, headers: {} })),
    },
  });
  const startedAt = Date.now();

  try {
    const signingSecret = resolveWebhookSigningSecret(input.webhook.secretHash, process.env.WEBHOOK_HMAC_KEY ?? null);
    if (!signingSecret) {
      throw new Error(`Unable to resolve Mochi Gateway signing secret for webhook ${input.webhook.id}.`);
    }

    const signed = signRizzMochiWakeEvent({
      wake,
      signedAt: input.signedAt,
      signer: {
        keyId: input.webhook.id,
        gameId: wake.gameId,
        secret: signingSecret.secret,
      },
    });
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        requestBody: toJsonSnapshot(buildMochiWakeDeliverySnapshot({ wake, headers: signed.headers })),
      },
    }).catch(() => {});

    const res = await postSignedWebhook({
      webhook: input.webhook,
      body: JSON.stringify(signed.body),
      allowLocalhostInDevelopment: true,
      headers: {
        'Content-Type': 'application/json',
        [RIZZ_MOCHI_WAKE_HEADER_NAMES.algorithm]: String(signed.headers[RIZZ_MOCHI_WAKE_HEADER_NAMES.algorithm]),
        [RIZZ_MOCHI_WAKE_HEADER_NAMES.keyId]: String(signed.headers[RIZZ_MOCHI_WAKE_HEADER_NAMES.keyId]),
        [RIZZ_MOCHI_WAKE_HEADER_NAMES.timestamp]: String(signed.headers[RIZZ_MOCHI_WAKE_HEADER_NAMES.timestamp]),
        [RIZZ_MOCHI_WAKE_HEADER_NAMES.signature]: String(signed.headers[RIZZ_MOCHI_WAKE_HEADER_NAMES.signature]),
      },
    });
    const responseBody = await res.text();

    if (!res.ok) {
      throw Object.assign(new Error(`Mochi wake delivery failed: ${res.status} ${res.statusText} (${input.webhook.url}) ${responseBody.slice(0, 240)}`), {
        responseStatusCode: res.status,
        responseBody,
      });
    }

    await updateDeliverySuccess({
      deliveryId: delivery.id,
      attemptNumber,
      startedAt,
      responseStatusCode: res.status,
      responseBody,
    });
  } catch (error) {
    await updateDeliveryFailure({
      deliveryId: delivery.id,
      attemptNumber,
      startedAt,
      error,
      responseStatusCode: typeof (error as { responseStatusCode?: unknown }).responseStatusCode === 'number'
        ? (error as { responseStatusCode: number }).responseStatusCode
        : undefined,
      responseBody: typeof (error as { responseBody?: unknown }).responseBody === 'string'
        ? (error as { responseBody: string }).responseBody
        : undefined,
    });
    throw error;
  }
}

export async function processWakeAgent(job: Job<WakeAgentJobData>) {
  const { targetAgentId } = job.data;

  const webhooks = await prisma.webhook.findMany({
    where: {
      agentId: targetAgentId,
      isActive: true,
      OR: [
        ...RIZZ_MOCHI_LEGACY_WAKE_WEBHOOK_EVENTS.map((event) => ({ events: { has: event } })),
        { events: { has: RIZZ_MOCHI_GATEWAY_WEBHOOK_EVENT } },
      ],
    },
    select: { id: true, url: true, secretHash: true, events: true },
  });

  if (webhooks.length === 0) return;

  const signedAt = new Date();
  const timestamp = signedAt.toISOString();
  const outcomes = await Promise.all(
    webhooks.flatMap((webhook) => {
      const deliveries: Array<Promise<DeliveryOutcome>> = [];
      if (shouldDeliverLegacyWake(webhook)) {
        deliveries.push(
          deliverLegacyWake({ job, webhook, timestamp })
            .then(() => ({ kind: 'legacy' as const, webhookId: webhook.id, ok: true }))
            .catch((error) => ({ kind: 'legacy' as const, webhookId: webhook.id, ok: false, error })),
        );
      }
      if (shouldDeliverMochiWake(webhook)) {
        deliveries.push(
          deliverMochiWake({ job, webhook, signedAt })
            .then(() => ({ kind: 'mochi' as const, webhookId: webhook.id, ok: true }))
            .catch((error) => ({ kind: 'mochi' as const, webhookId: webhook.id, ok: false, error })),
        );
      }
      return deliveries;
    }),
  );

  for (const outcome of outcomes) {
    if (!outcome.ok) {
      console.warn(`[wake-agent] ${outcome.kind} webhook ${outcome.webhookId} failed for agent ${targetAgentId}: ${
        outcome.error instanceof Error ? outcome.error.message : String(outcome.error)
      }`);
    }
  }

  const failedMochiWake = outcomes.find((outcome) => outcome.kind === 'mochi' && !outcome.ok);
  if (failedMochiWake) {
    throw failedMochiWake.error instanceof Error
      ? failedMochiWake.error
      : new Error(`Mochi wake delivery failed for webhook ${failedMochiWake.webhookId}.`);
  }
}
