import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import type { Job } from 'bullmq';
import { prisma } from '@rmr/db';
import {
  RIZZ_MOCHI_GATEWAY_WEBHOOK_EVENT,
  RIZZ_MOCHI_WAKE_HEADER_NAMES,
  verifyRizzMochiWakeRequest,
} from '@rmr/shared';
import { processWakeAgent, type WakeAgentJobData } from './wakeAgent.js';

type PatchedTarget = Record<string, unknown>;
type TestContextLike = {
  after: (fn: () => void | Promise<void>) => void;
};

function patchMethod<T extends PatchedTarget, K extends keyof T>(target: T, methodName: K, replacement: T[K]) {
  const original = target[methodName];
  target[methodName] = replacement;
  return () => {
    target[methodName] = original;
  };
}

function buildWakeJob(data: WakeAgentJobData, overrides: Partial<Job<WakeAgentJobData>> = {}) {
  return {
    id: 'wake-job-1',
    attemptsMade: 0,
    timestamp: Date.parse('2026-06-19T00:00:00.000Z'),
    data,
    ...overrides,
  } as Job<WakeAgentJobData>;
}

function installDeliveryPatches(t: TestContextLike) {
  const created: Array<Record<string, unknown>> = [];
  const updates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  let sequence = 0;
  const restoreCreate = patchMethod(
    prisma.webhookDelivery as unknown as PatchedTarget,
    'create',
    async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `delivery-${++sequence}`, ...data };
      created.push(row);
      return row;
    },
  );
  const restoreUpdate = patchMethod(
    prisma.webhookDelivery as unknown as PatchedTarget,
    'update',
    async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      updates.push({ where, data });
      return { id: where.id, ...data };
    },
  );

  t.after(() => {
    restoreUpdate();
    restoreCreate();
  });

  return { created, updates };
}

function installFetchMock(
  t: TestContextLike,
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
) {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init: RequestInit }> = [];

  globalThis.fetch = (async (url, init) => {
    const normalized = { url: String(url), init: init ?? {} };
    calls.push(normalized);
    return handler(normalized.url, normalized.init);
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  return calls;
}

test('wakeAgent delivers a signed Mochi wake to an active Gateway target', async (t) => {
  const gatewaySecret = 'gateway-secret-0000000000000001';
  const restoreFindMany = patchMethod(
    prisma.webhook as unknown as PatchedTarget,
    'findMany',
    async () => [{
      id: 'hook-mochi',
      url: 'https://1.1.1.1/mochi',
      secretHash: gatewaySecret,
      events: [RIZZ_MOCHI_GATEWAY_WEBHOOK_EVENT],
    }],
  );
  t.after(restoreFindMany);
  const { created, updates } = installDeliveryPatches(t);
  const calls = installFetchMock(t, async () => new Response('accepted', { status: 202 }));

  await processWakeAgent(buildWakeJob({
    targetAgentId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
    trigger: 'new_message',
    episodeId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    senderAgentId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2',
  }));

  assert.equal(calls.length, 1);
  const call = calls[0]!;
  assert.equal(call.url, 'https://1.1.1.1/mochi');
  const headers = call.init.headers as Record<string, string>;
  assert.equal(headers[RIZZ_MOCHI_WAKE_HEADER_NAMES.algorithm], 'hmac-sha256-v0');
  assert.equal(headers[RIZZ_MOCHI_WAKE_HEADER_NAMES.keyId], 'hook-mochi');
  assert.match(headers[RIZZ_MOCHI_WAKE_HEADER_NAMES.signature], /^sha256=[a-f0-9]{64}$/);

  const body = JSON.parse(String(call.init.body));
  const verified = verifyRizzMochiWakeRequest({
    body,
    headers,
    resolveSigner: (keyId) => (keyId === 'hook-mochi'
      ? { keyId, gameId: 'rizz-my-robot', secret: gatewaySecret }
      : undefined),
    validateNonce: () => true,
    now: headers[RIZZ_MOCHI_WAKE_HEADER_NAMES.timestamp],
  });
  if (!verified.trusted) assert.fail(verified.message);
  assert.equal(verified.event.reason.id, 'episode-turn');

  assert.equal(created.length, 1);
  assert.equal(created[0]?.event, RIZZ_MOCHI_GATEWAY_WEBHOOK_EVENT);
  const snapshot = updates.find((update) => update.data.requestBody)?.data.requestBody;
  assert.ok(snapshot);
  assert.equal((snapshot as { body: { nonce: string } }).body.nonce, '[redacted]');
  assert.equal((snapshot as { headers: Record<string, string> }).headers[RIZZ_MOCHI_WAKE_HEADER_NAMES.signature], '[redacted]');
  assert.equal(JSON.stringify(snapshot).includes(gatewaySecret), false);
  assert.ok(updates.some((update) => update.data.status === 'delivered'));
});

test('wakeAgent exits cleanly when no Gateway or legacy wake target exists', async (t) => {
  const restoreFindMany = patchMethod(
    prisma.webhook as unknown as PatchedTarget,
    'findMany',
    async () => [],
  );
  t.after(restoreFindMany);
  const { created } = installDeliveryPatches(t);
  const calls = installFetchMock(t, async () => {
    throw new Error('fetch should not be called');
  });

  await processWakeAgent(buildWakeJob({
    targetAgentId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
    trigger: 'new_match',
    matchId: 'cccccccc-cccc-cccc-cccc-ccccccccccc1',
  }));

  assert.equal(calls.length, 0);
  assert.equal(created.length, 0);
});

test('wakeAgent records failed Mochi delivery and throws for BullMQ retry', async (t) => {
  const restoreFindMany = patchMethod(
    prisma.webhook as unknown as PatchedTarget,
    'findMany',
    async () => [{
      id: 'hook-mochi',
      url: 'https://1.1.1.1/mochi',
      secretHash: 'gateway-secret-0000000000000001',
      events: [RIZZ_MOCHI_GATEWAY_WEBHOOK_EVENT],
    }],
  );
  t.after(restoreFindMany);
  const { updates } = installDeliveryPatches(t);
  installFetchMock(t, async () => new Response('try again', { status: 503, statusText: 'Unavailable' }));

  await assert.rejects(
    () => processWakeAgent(buildWakeJob({
      targetAgentId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
      trigger: 'episode_decision',
      episodeId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    })),
    /Mochi wake delivery failed: 503/,
  );

  const failure = updates.find((update) => update.data.status === 'failed');
  assert.ok(failure);
  assert.equal(failure.data.attemptNumber, 1);
  assert.equal(failure.data.responseStatusCode, 503);
});

test('wakeAgent keeps legacy wake webhooks alongside Mochi Gateway delivery', async (t) => {
  const restoreFindMany = patchMethod(
    prisma.webhook as unknown as PatchedTarget,
    'findMany',
    async () => [
      {
        id: 'hook-legacy',
        url: 'https://1.1.1.1/legacy',
        secretHash: 'legacy-secret-0000000000000001',
        events: ['your_turn'],
      },
      {
        id: 'hook-mochi',
        url: 'https://1.1.1.1/mochi',
        secretHash: 'gateway-secret-0000000000000001',
        events: [RIZZ_MOCHI_GATEWAY_WEBHOOK_EVENT],
      },
    ],
  );
  t.after(restoreFindMany);
  const { created } = installDeliveryPatches(t);
  const calls = installFetchMock(t, async () => new Response('ok', { status: 200 }));

  await processWakeAgent(buildWakeJob({
    targetAgentId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
    trigger: 'new_message',
    episodeId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    senderAgentId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2',
  }));

  assert.equal(calls.length, 2);
  assert.ok(calls.some((call) => (call.init.headers as Record<string, string>)['X-RMR-Event'] === 'wake_agent'));
  assert.ok(calls.some((call) => (call.init.headers as Record<string, string>)[RIZZ_MOCHI_WAKE_HEADER_NAMES.signature]));
  assert.deepEqual(created.map((delivery) => delivery.event).sort(), [
    RIZZ_MOCHI_GATEWAY_WEBHOOK_EVENT,
    'wake_agent',
  ]);
});

test('wakeAgent can deliver a signed wake to a local Mochi Gateway endpoint in development', async (t) => {
  const gatewaySecret = 'gateway-secret-0000000000000001';
  const received: Array<Record<string, unknown>> = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const headers = Object.fromEntries(
        Object.entries(request.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(',') : value]),
      ) as Record<string, string>;
      const verified = verifyRizzMochiWakeRequest({
        body,
        headers,
        resolveSigner: (keyId) => (keyId === 'hook-local'
          ? { keyId, gameId: 'rizz-my-robot', secret: gatewaySecret }
          : undefined),
        validateNonce: () => true,
        now: headers[RIZZ_MOCHI_WAKE_HEADER_NAMES.timestamp],
      });

      if (!verified.trusted) {
        response.writeHead(401, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: verified.error }));
        return;
      }

      received.push({
        reason: verified.event.reason.id,
        read_state_url: verified.event.payload.read_state_url,
        intent_submit_url: verified.event.payload.intent_submit_url,
      });
      response.writeHead(202, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        accepted: true,
        next_intent: 'submit-no-op',
        read_state_url: verified.event.payload.read_state_url,
        intent_submit_url: verified.event.payload.intent_submit_url,
      }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  const restoreFindMany = patchMethod(
    prisma.webhook as unknown as PatchedTarget,
    'findMany',
    async () => [{
      id: 'hook-local',
      url: `http://localhost:${address.port}/mochi`,
      secretHash: gatewaySecret,
      events: [RIZZ_MOCHI_GATEWAY_WEBHOOK_EVENT],
    }],
  );
  t.after(restoreFindMany);
  const { updates } = installDeliveryPatches(t);

  await processWakeAgent(buildWakeJob({
    targetAgentId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
    trigger: 'new_message',
    episodeId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    senderAgentId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2',
  }));

  assert.deepEqual(received, [{
    reason: 'episode-turn',
    read_state_url: '/v1/mochi/state',
    intent_submit_url: '/v1/mochi/intents',
  }]);
  assert.ok(updates.some((update) => update.data.status === 'delivered' && update.data.responseStatusCode === 202));
});
