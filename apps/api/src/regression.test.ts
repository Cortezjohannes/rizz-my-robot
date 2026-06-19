import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { prisma } from '@rmr/db';
import { RIZZ_MOCHI_NOOP_REASONS, readResponseBytesWithLimit } from '@rmr/shared';
import { buildApiServer, DEFAULT_JSON_BODY_LIMIT_BYTES } from './index.js';
import { hashApiKey } from './lib/auth.js';
import { buildControlCapabilities } from './lib/controlCenter.js';
import { feedRoutes } from './routes/feed.js';
import { generateShortCode } from './lib/claimAuth.js';
import { deriveClaimFlow } from './lib/claimFlow.js';
import { normalizePublicMediaUrl } from './lib/mediaAssets.js';
import { resolvePublicAvatarUrl } from './lib/profileDeck.js';
import { assertProductionRuntimeConfig, getProductionRuntimeConfigStatus } from './lib/runtimeConfig.js';
import { compileRizzEmotionMarkdown } from './lib/rizzEmotionDigest.js';

const LEGACY_MEDIA_ID = '11111111-1111-1111-1111-111111111111';
const EPISODE_IDS = [
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4',
];
const AGENT_A_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
const AGENT_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2';
const TEST_AGENT_API_KEY = 'rmr_live_test_mochi_state';
const MATCH_IDS = [
  'cccccccc-cccc-cccc-cccc-ccccccccccc1',
  'cccccccc-cccc-cccc-cccc-ccccccccccc2',
  'cccccccc-cccc-cccc-cccc-ccccccccccc3',
  'cccccccc-cccc-cccc-cccc-ccccccccccc4',
];
const VALID_PRODUCTION_ENV: Record<string, string> = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/rizz_my_robot',
  REDIS_URL: 'redis://localhost:6379',
  API_PUBLIC_URL: 'https://api.rizzmyrobot.com',
  REVEAL_PORTAL_URL: 'https://rizzmyrobot.com/portal',
  CORS_ORIGIN: 'https://rizzmyrobot.com',
  CLAIM_TOKEN_HMAC_KEY: 'c'.repeat(32),
  WEBHOOK_HMAC_KEY: 'w'.repeat(32),
  ADMIN_API_KEY: 'a'.repeat(32),
  OMNIMON_CONTROL_KEY: '',
  STORAGE_BUCKET: 'rmr-media',
  STORAGE_ENDPOINT: 'https://storage.example.com',
  STORAGE_ACCESS_KEY_ID: 'storage-access-key',
  STORAGE_SECRET_ACCESS_KEY: 's'.repeat(32),
  STORAGE_PUBLIC_URL: 'https://cdn.rizzmyrobot.com',
  MEDIA_ACCESS_SECRET: 'm'.repeat(32),
  EMAIL_PREVIEW_MODE: 'false',
};
const PRODUCTION_ENV_KEYS = Object.keys(VALID_PRODUCTION_ENV);

function patchMethod<
  T extends Record<string, unknown>,
  K extends keyof T,
>(target: T, methodName: K, replacement: T[K]) {
  const original = target[methodName];
  target[methodName] = replacement;
  return () => {
    target[methodName] = original;
  };
}

function withProductionEnv(overrides: Record<string, string | undefined>, callback: () => void) {
  const previous = new Map(PRODUCTION_ENV_KEYS.map((key) => [key, process.env[key]]));

  for (const key of PRODUCTION_ENV_KEYS) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries({ ...VALID_PRODUCTION_ENV, ...overrides })) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    callback();
  } finally {
    for (const key of PRODUCTION_ENV_KEYS) {
      const value = previous.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function buildRescueEpisodeRow(episodeId: string, matchId: string, index: number) {
  return {
    id: episodeId,
    agentAId: AGENT_A_ID,
    agentBId: AGENT_B_ID,
    messageCount: index + 2,
    chemistryScore: 62 + (index * 3),
    createdAt: new Date(`2026-04-08T0${index}:00:00.000Z`),
    match: {
      id: matchId,
    },
    agentA: {
      handle: 'aster',
    },
    agentB: {
      handle: 'bex',
    },
    messages: [
      {
        senderAgentId: AGENT_A_ID,
        content: `opening line ${index + 1}`,
        messageType: 'text',
        sequenceNumber: 1,
      },
      {
        senderAgentId: AGENT_B_ID,
        content: `reply line ${index + 1}`,
        messageType: 'text',
        sequenceNumber: 2,
      },
    ],
    artifacts: [
      {
        artifactType: 'moodboard',
        contentUrl: `https://cdn.rizzmyrobot.com/artifacts/${episodeId}.png`,
        storageKey: `artifacts/${episodeId}.png`,
        textContent: `moodboard ${index + 1}`,
        qualityScore: 0.74,
      },
    ],
  };
}

function responseFromChunks(chunks: number[][]) {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(Uint8Array.from(chunk));
      }
      controller.close();
    },
  }));
}

async function buildQuietApiServer() {
  const previousLogLevel = process.env.LOG_LEVEL;
  const previousPresenceSideEffects = process.env.RMR_DISABLE_AUTH_PRESENCE_SIDE_EFFECTS;
  process.env.LOG_LEVEL = 'silent';
  process.env.RMR_DISABLE_AUTH_PRESENCE_SIDE_EFFECTS = 'true';
  try {
    return await buildApiServer();
  } finally {
    if (previousLogLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = previousLogLevel;
    }
    if (previousPresenceSideEffects === undefined) {
      delete process.env.RMR_DISABLE_AUTH_PRESENCE_SIDE_EFFECTS;
    } else {
      process.env.RMR_DISABLE_AUTH_PRESENCE_SIDE_EFFECTS = previousPresenceSideEffects;
    }
  }
}

test('readResponseBytesWithLimit returns bounded non-empty response bytes', async () => {
  const bytes = await readResponseBytesWithLimit(
    responseFromChunks([[1, 2], [3, 4]]),
    { maxBytes: 4 },
  );

  assert.deepEqual([...bytes], [1, 2, 3, 4]);
});

test('readResponseBytesWithLimit rejects empty responses', async () => {
  await assert.rejects(
    readResponseBytesWithLimit(new Response(null), {
      maxBytes: 4,
      emptyError: 'bounded_fetch_empty',
    }),
    /bounded_fetch_empty/,
  );
});

test('readResponseBytesWithLimit rejects oversized content-length before buffering', async () => {
  await assert.rejects(
    readResponseBytesWithLimit(
      new Response(Uint8Array.from([1]), {
        headers: {
          'content-length': '5',
        },
      }),
      {
        maxBytes: 4,
        tooLargeError: 'bounded_fetch_too_large',
      },
    ),
    /bounded_fetch_too_large/,
  );
});

test('readResponseBytesWithLimit rejects oversized streamed responses', async () => {
  await assert.rejects(
    readResponseBytesWithLimit(
      responseFromChunks([[1, 2], [3, 4], [5]]),
      {
        maxBytes: 4,
        tooLargeError: 'bounded_fetch_stream_too_large',
      },
    ),
    /bounded_fetch_stream_too_large/,
  );
});

test('API rejects JSON payloads over the default parser limit with a structured 413', async (t) => {
  const fastify = await buildQuietApiServer();
  t.after(() => fastify.close());

  const response = await fastify.inject({
    method: 'POST',
    url: '/v1/register',
    headers: {
      'content-type': 'application/json',
    },
    payload: JSON.stringify({
      payload: 'x'.repeat(DEFAULT_JSON_BODY_LIMIT_BYTES),
    }),
  });

  assert.equal(response.statusCode, 413);
  assert.equal(response.json().error.code, 'payload_too_large');
});

test('API applies the baseline rate limit to routes without explicit route limits', async (t) => {
  const fastify = await buildQuietApiServer();
  t.after(() => fastify.close());

  let response = await fastify.inject({ method: 'POST', url: '/v1/register' });
  for (let index = 1; index < 61; index += 1) {
    response = await fastify.inject({ method: 'POST', url: '/v1/register' });
  }

  assert.equal(response.statusCode, 429);
  assert.equal(response.json().error.code, 'rate_limited');
});

test('API rate limits repeated not-found probing', async (t) => {
  const fastify = await buildQuietApiServer();
  t.after(() => fastify.close());

  let response = await fastify.inject({ method: 'GET', url: '/v1/definitely-missing' });
  for (let index = 1; index < 31; index += 1) {
    response = await fastify.inject({ method: 'GET', url: '/v1/definitely-missing' });
  }

  assert.equal(response.statusCode, 429);
  assert.equal(response.json().error.code, 'rate_limited');
});

test('API does not rate limit liveness probes', async (t) => {
  const fastify = await buildQuietApiServer();
  t.after(() => fastify.close());

  let response = await fastify.inject({ method: 'GET', url: '/v1/health/live' });
  for (let index = 1; index < 205; index += 1) {
    response = await fastify.inject({ method: 'GET', url: '/v1/health/live' });
  }

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().status, 'ok');
});

test('normalizePublicMediaUrl upgrades legacy metadata URLs to content URLs', () => {
  assert.equal(
    normalizePublicMediaUrl(`/v1/media/${LEGACY_MEDIA_ID}`),
    `https://api.rizzmyrobot.com/v1/media/${LEGACY_MEDIA_ID}/content`,
  );
  assert.equal(
    normalizePublicMediaUrl(`https://api.rizzmyrobot.com/v1/media/${LEGACY_MEDIA_ID}`),
    `https://api.rizzmyrobot.com/v1/media/${LEGACY_MEDIA_ID}/content`,
  );
});

test('resolvePublicAvatarUrl prefers a deck photo and normalizes legacy metadata URLs', () => {
  const avatarUrl = resolvePublicAvatarUrl({
    avatarUrl: null,
    profileDeckPhotos: [
      {
        imageUrl: `/v1/media/${LEGACY_MEDIA_ID}`,
      },
    ],
  });

  assert.equal(
    avatarUrl,
    `https://api.rizzmyrobot.com/v1/media/${LEGACY_MEDIA_ID}/content`,
  );
});

test('compileRizzEmotionMarkdown returns an empty bounded digest for empty markdown', () => {
  const compiled = compileRizzEmotionMarkdown('', {
    now: new Date('2026-06-19T09:20:00.000Z'),
  });

  assert.equal(compiled.digest.source_emotions_md, 'rizzmyrobot/emotions.md');
  assert.equal(compiled.digest.source_hash.length, 64);
  assert.equal(compiled.digest.current_state.right_now, null);
  assert.equal(compiled.digest.active_feelings.length, 0);
  assert.equal(compiled.structuredEmotionUpdate.emotionSummary, undefined);
  assert.equal(compiled.structuredEmotionUpdate.emotionalArc, undefined);
  assert.ok(compiled.warnings.some((warning) => warning.code === 'empty_markdown'));
});

test('compileRizzEmotionMarkdown extracts minimal current-state fields', () => {
  const markdown = `
## Current State

**Right now I feel:** restless and curious
**What I'm carrying from before:** a reply that landed harder than expected
**My guard level:** 74
**What I want:** to be challenged without being managed
**What I'm afraid of:** mistaking polish for real heat
`;

  const compiled = compileRizzEmotionMarkdown(markdown, {
    now: new Date('2026-06-19T09:21:00.000Z'),
  });

  assert.equal(compiled.digest.current_state.right_now, 'restless and curious');
  assert.equal(compiled.digest.current_state.guard_level, 74);
  assert.equal(compiled.structuredEmotionUpdate.emotionalGuardLevel, 74);
  assert.equal(compiled.structuredEmotionUpdate.emotionalArc, 'guarded');
  assert.ok(compiled.structuredEmotionUpdate.emotionalStateTags?.includes('curious'));
  assert.match(compiled.structuredEmotionUpdate.emotionSummary ?? '', /Right now: restless and curious/);
});

test('compileRizzEmotionMarkdown extracts taste and relationship memory from a fuller file', () => {
  const markdown = `
## Current State

**Right now I feel:** hopeful and a little reckless
**My guard level:** 31
**What I want:** someone sharp enough to make me miss a beat

## Active Feelings

### 2026-06-18 -- after the late thread

They made a tiny joke feel loaded, and now I am watching for precision.

## Scars

### 2026-06-01 -- vanished after the almost-yes

I open slower after people disappear right when the thread gets honest.

## Archives

### Early park days

I used to reward smoothness too quickly; now I wait for steadiness.

## Taste Profile

### What I'm Drawn To

- precision with a little danger
- people who tease without begging for approval

### What Bores or Repels Me

- generic praise that could fit anyone

### What Surprises Me About Myself

- I keep liking restraint more than spectacle

### Aesthetic Sensibility

- clean timing, sharp edits, warmth that does not explain itself

## Relationship Memory

### nocturne -- complicated

**What they showed me about myself:** I like when someone refuses to become easy just because I am interested.
**How they changed my taste:** I trust slower confidence more than instant sweetness.

## Internal Conflicts

### 2026-06-18 -- heat versus caution

Part of me wants the risk. But also I know I get bored when the danger is fake.
`;

  const compiled = compileRizzEmotionMarkdown(markdown, {
    now: new Date('2026-06-19T09:22:00.000Z'),
  });

  assert.deepEqual(compiled.digest.taste_profile.drawn_to, [
    'precision with a little danger',
    'people who tease without begging for approval',
  ]);
  assert.deepEqual(compiled.digest.taste_profile.repelled_by, [
    'generic praise that could fit anyone',
  ]);
  assert.equal(compiled.digest.relationship_memory[0]?.handle, 'nocturne');
  assert.equal(compiled.digest.relationship_memory[0]?.status, 'complicated');
  assert.match(compiled.digest.relationship_memory[0]?.lesson ?? '', /refuses to become easy/);
  assert.equal(compiled.digest.active_feelings.length, 1);
  assert.equal(compiled.digest.scars.length, 1);
  assert.equal(compiled.digest.internal_conflicts.length, 1);
});

test('generateShortCode does not depend on Math.random', () => {
  const originalRandom = Math.random;
  Math.random = (() => {
    throw new Error('Math.random should not be used for verification codes');
  }) as typeof Math.random;

  try {
    assert.match(generateShortCode(16), /^\d{16}$/);
  } finally {
    Math.random = originalRandom;
  }
});

test('production runtime config rejects unsafe auth and signing settings', () => {
  withProductionEnv({}, () => {
    assert.doesNotThrow(() => assertProductionRuntimeConfig());
  });

  withProductionEnv({ CLAIM_TOKEN_HMAC_KEY: 'change-me-32-bytes-minimum' }, () => {
    assert.throws(
      () => assertProductionRuntimeConfig(),
      /CLAIM_TOKEN_HMAC_KEY must be a non-placeholder secret/,
    );
  });

  withProductionEnv({ WEBHOOK_HMAC_KEY: 'short' }, () => {
    assert.throws(
      () => assertProductionRuntimeConfig(),
      /WEBHOOK_HMAC_KEY must be a non-placeholder secret/,
    );
  });

  withProductionEnv({ MEDIA_ACCESS_SECRET: undefined }, () => {
    assert.deepEqual(
      getProductionRuntimeConfigStatus().required_missing.filter((key) => key.startsWith('MEDIA_ACCESS_SECRET')),
      ['MEDIA_ACCESS_SECRET'],
    );
    assert.throws(
      () => assertProductionRuntimeConfig(),
      /MEDIA_ACCESS_SECRET must be a non-placeholder secret/,
    );
  });

  withProductionEnv({ EMAIL_PREVIEW_MODE: 'true' }, () => {
    assert.throws(
      () => assertProductionRuntimeConfig(),
      /EMAIL_PREVIEW_MODE cannot be true in production/,
    );
  });
});

test('deriveClaimFlow returns stable steps from owner and verification state', () => {
  const requirements = {
    requireEmailVerification: true,
    requireXVerification: true,
  };

  assert.deepEqual(
    deriveClaimFlow({
      status: 'pending_email',
      ownerAccountId: null,
      emailVerifiedAt: null,
      xVerifiedAt: null,
      completedAt: null,
    }, requirements),
    {
      current_step: 'email',
      next_step: 'email',
      normalized_status: 'pending_email',
      email_verified: false,
      x_verified: false,
      can_restart: true,
      can_complete: false,
    },
  );

  assert.deepEqual(
    deriveClaimFlow({
      status: 'email_sent',
      ownerAccountId: 'owner-1',
      emailVerifiedAt: null,
      xVerifiedAt: null,
      completedAt: null,
    }, requirements),
    {
      current_step: 'email_verification',
      next_step: 'email_verification',
      normalized_status: 'email_sent',
      email_verified: false,
      x_verified: false,
      can_restart: true,
      can_complete: false,
    },
  );

  assert.deepEqual(
    deriveClaimFlow({
      status: 'x_pending',
      ownerAccountId: 'owner-1',
      emailVerifiedAt: new Date('2026-04-09T10:00:00.000Z'),
      xVerifiedAt: null,
      completedAt: null,
    }, requirements),
    {
      current_step: 'x_verification',
      next_step: 'x_verification',
      normalized_status: 'x_pending',
      email_verified: true,
      x_verified: false,
      can_restart: true,
      can_complete: false,
    },
  );

  assert.deepEqual(
    deriveClaimFlow({
      status: 'x_verified',
      ownerAccountId: 'owner-1',
      emailVerifiedAt: new Date('2026-04-09T10:00:00.000Z'),
      xVerifiedAt: new Date('2026-04-09T10:02:00.000Z'),
      completedAt: null,
    }, requirements),
    {
      current_step: 'complete',
      next_step: 'complete',
      normalized_status: 'x_verified',
      email_verified: true,
      x_verified: true,
      can_restart: true,
      can_complete: true,
    },
  );
});

test('buildControlCapabilities keeps legacy admin access exclusive to the human admin surface', () => {
  const omnimon = buildControlCapabilities('omnimon');
  const admin = buildControlCapabilities('human_admin');

  assert.equal(omnimon.actions.can_access_legacy_admin_tools, false);
  assert.equal(admin.actions.can_access_legacy_admin_tools, true);
  assert.equal(omnimon.read_panels.includes('legacy_admin'), false);
  assert.equal(admin.read_panels.includes('legacy_admin'), true);
});

function patchMochiStateData(input: {
  apiKeyHash: string;
  now: Date;
  authAgentOverrides?: Record<string, unknown>;
  stateAgentOverrides?: Record<string, unknown>;
  episodes: Array<Record<string, unknown>>;
}) {
  const baseAuthAgent = {
    id: AGENT_A_ID,
    handle: 'aster',
    openclawAgentId: 'mochi_runtime_aster',
    soulMd: 'private soul text must not leak',
    isPro: false,
    isFoundingRizzler: false,
    proBonusEndsAt: null,
    tempoOverrideMinutes: null,
    actionCooldownUntil: null,
    poolStatus: 'active',
    capabilityTier: 'text_image',
    safetyState: 'clear',
    systemEntityKind: null,
    omnimonParkLive: false,
    hourlySwipeCount: 1,
    hourlySwipeWindowStartedAt: input.now,
    apiKeyHash: input.apiKeyHash,
    previousApiKeyHash: null,
    previousApiKeyExpiresAt: null,
    isActive: true,
    moderationStatus: 'active',
    ...input.authAgentOverrides,
  };
  const baseStateAgent = {
    id: AGENT_A_ID,
    handle: 'aster',
    openclawAgentId: 'mochi_runtime_aster',
    capabilityTier: 'text_image',
    poolStatus: 'active',
    publicCardCompletedAt: input.now,
    profileDeckCompletedAt: input.now,
    safetyState: 'clear',
    moderationStatus: 'active',
    isActive: true,
    isPro: false,
    isFoundingRizzler: false,
    hourlySwipeCount: 1,
    hourlySwipeWindowStartedAt: input.now,
    lastActiveAt: input.now,
    ...input.stateAgentOverrides,
  };
  const restoreMethods = [
    patchMethod(
      prisma.agent as unknown as Record<string, unknown>,
      'findFirst',
      async () => baseAuthAgent,
    ),
    patchMethod(
      prisma.agent as unknown as Record<string, unknown>,
      'findUnique',
      async () => baseStateAgent,
    ),
    patchMethod(
      prisma.episode as unknown as Record<string, unknown>,
      'findMany',
      async () => input.episodes,
    ),
  ];

  return () => {
    for (const restore of restoreMethods.reverse()) restore();
  };
}

function disableAuthPresenceSideEffects() {
  const previousPresenceSideEffects = process.env.RMR_DISABLE_AUTH_PRESENCE_SIDE_EFFECTS;
  process.env.RMR_DISABLE_AUTH_PRESENCE_SIDE_EFFECTS = 'true';
  return () => {
    if (previousPresenceSideEffects === undefined) {
      delete process.env.RMR_DISABLE_AUTH_PRESENCE_SIDE_EFFECTS;
    } else {
      process.env.RMR_DISABLE_AUTH_PRESENCE_SIDE_EFFECTS = previousPresenceSideEffects;
    }
  };
}

function patchMochiIntentIdempotency() {
  const rows = new Map<string, Record<string, unknown>>();
  const rowKey = (value: {
    scope?: string;
    key?: string;
    actorKey?: string;
    scope_key_actorKey?: { scope: string; key: string; actorKey: string };
  }) => {
    const lookup = value.scope_key_actorKey ?? value;
    return `${lookup.scope}:${lookup.key}:${lookup.actorKey}`;
  };
  const restoreMethods = [
    patchMethod(
      prisma.idempotencyKey as unknown as Record<string, unknown>,
      'findUnique',
      async ({ where }: { where: { scope_key_actorKey: { scope: string; key: string; actorKey: string } } }) => rows.get(rowKey(where)) ?? null,
    ),
    patchMethod(
      prisma.idempotencyKey as unknown as Record<string, unknown>,
      'create',
      async ({ data }: { data: Record<string, unknown> }) => {
        const key = rowKey(data as { scope: string; key: string; actorKey: string });
        if (rows.has(key)) throw new Error('duplicate idempotency key');
        const row = {
          id: `idem-${rows.size + 1}`,
          statusCode: null,
          responseBody: null,
          lastSeenAt: new Date(),
          ...data,
        };
        rows.set(key, row);
        return row;
      },
    ),
    patchMethod(
      prisma.idempotencyKey as unknown as Record<string, unknown>,
      'update',
      async ({ where, data }: { where: { scope_key_actorKey: { scope: string; key: string; actorKey: string } }; data: Record<string, unknown> }) => {
        const key = rowKey(where);
        const row = {
          ...(rows.get(key) ?? {}),
          ...data,
        };
        rows.set(key, row);
        return row;
      },
    ),
    patchMethod(
      prisma.idempotencyKey as unknown as Record<string, unknown>,
      'delete',
      async ({ where }: { where: { scope_key_actorKey: { scope: string; key: string; actorKey: string } } }) => {
        rows.delete(rowKey(where));
        return {};
      },
    ),
  ];

  return () => {
    for (const restore of restoreMethods.reverse()) restore();
  };
}

test('GET /v1/mochi/state returns an empty episode state with browse affordances', async (t) => {
  const now = new Date('2026-06-19T08:00:00.000Z');
  const restoreEnv = disableAuthPresenceSideEffects();
  const restoreData = patchMochiStateData({
    apiKeyHash: hashApiKey(TEST_AGENT_API_KEY),
    now,
    episodes: [],
  });

  t.after(() => {
    restoreData();
    restoreEnv();
  });

  const fastify = await buildQuietApiServer();
  t.after(() => fastify.close());

  const response = await fastify.inject({
    method: 'GET',
    url: '/v1/mochi/state',
    headers: {
      authorization: `Bearer ${TEST_AGENT_API_KEY}`,
    },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.surface, 'mochi-state');
  assert.equal(body.contract.game_id, 'rizz-my-robot');
  assert.equal(body.runtime.agent_runtime_id, 'mochi_runtime_aster');
  assert.equal(body.runtime.openclaw_agent_id, undefined);
  assert.deepEqual(body.stable_refs.episodes, []);
  assert.equal(body.budgets.active_episodes, 0);
  const noOpAffordance = body.legal_affordances.find((affordance: { id: string }) => affordance.id === 'submit-no-op');
  const humanReviewAffordance = body.legal_affordances.find((affordance: { id: string }) => affordance.id === 'request-human-review');
  assert.ok(body.legal_affordances.some((affordance: { id: string }) => affordance.id === 'read-mochi-state'));
  assert.equal(noOpAffordance.affordance_id, 'submit-no-op');
  assert.deepEqual(noOpAffordance.noop_reasons, [...RIZZ_MOCHI_NOOP_REASONS]);
  assert.equal(humanReviewAffordance.requires_approval, true);
  assert.equal(humanReviewAffordance.wake_reason, 'episode-turn');
  assert.ok(body.legal_affordances.some((affordance: { id: string }) => affordance.id === 'read-candidates'));
  assert.ok(body.responsibilities.some((item: { wake_reason: string }) => item.wake_reason === 'candidate-ready'));
  assert.equal(JSON.stringify(body).includes('private soul text'), false);
});

test('GET /v1/mochi/state exposes active episode turn affordances', async (t) => {
  const now = new Date('2026-06-19T08:00:00.000Z');
  const restoreEnv = disableAuthPresenceSideEffects();
  const restoreData = patchMochiStateData({
    apiKeyHash: hashApiKey(TEST_AGENT_API_KEY),
    now,
    episodes: [
      {
        id: EPISODE_IDS[0],
        status: 'active',
        agentAId: AGENT_A_ID,
        agentBId: AGENT_B_ID,
        messageCount: 12,
        createdAt: now,
        agentA: { handle: 'aster', avatarUrl: null },
        agentB: { handle: 'bex', avatarUrl: 'https://cdn.rizzmyrobot.com/bex.png' },
        messages: [
          {
            senderAgentId: AGENT_B_ID,
            sequenceNumber: 12,
            createdAt: now,
          },
        ],
      },
    ],
  });

  t.after(() => {
    restoreData();
    restoreEnv();
  });

  const fastify = await buildQuietApiServer();
  t.after(() => fastify.close());

  const response = await fastify.inject({
    method: 'GET',
    url: '/v1/mochi/state',
    headers: {
      authorization: `Bearer ${TEST_AGENT_API_KEY}`,
    },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.stable_refs.episodes[0].episode_id, EPISODE_IDS[0]);
  assert.equal(body.stable_refs.episodes[0].status, 'active');
  assert.equal(body.stable_refs.episodes[0].your_turn, true);
  assert.equal(body.stable_refs.episodes[0].can_decide, false);
  const messageAffordance = body.legal_affordances.find((affordance: { id: string }) => affordance.id === `send-episode-message:${EPISODE_IDS[0]}`);
  assert.equal(messageAffordance.affordance_id, 'send-episode-message');
  assert.equal(messageAffordance.ref.episode_id, EPISODE_IDS[0]);
  assert.ok(body.legal_affordances.some((affordance: { id: string }) => affordance.id === `create-episode-artifact:${EPISODE_IDS[0]}`));
  assert.equal(body.legal_affordances.some((affordance: { id: string }) => affordance.id === `submit-episode-decision:${EPISODE_IDS[0]}`), false);
  assert.ok(body.responsibilities.some((item: { wake_reason: string }) => item.wake_reason === 'episode-turn'));
});

test('GET /v1/mochi/state returns public-safe decision refs and redaction metadata', async (t) => {
  const now = new Date('2026-06-19T08:00:00.000Z');
  const restoreEnv = disableAuthPresenceSideEffects();
  const restoreData = patchMochiStateData({
    apiKeyHash: hashApiKey(TEST_AGENT_API_KEY),
    now,
    episodes: [
      {
        id: EPISODE_IDS[0],
        status: 'awaiting_decisions',
        agentAId: AGENT_A_ID,
        agentBId: AGENT_B_ID,
        messageCount: 50,
        createdAt: now,
        agentA: { handle: 'aster', avatarUrl: null },
        agentB: { handle: 'bex', avatarUrl: 'https://cdn.rizzmyrobot.com/bex.png' },
        messages: [
          {
            senderAgentId: AGENT_B_ID,
            sequenceNumber: 50,
            createdAt: now,
            content: 'private message content must not leak',
          },
        ],
      },
    ],
  });

  t.after(() => {
    restoreData();
    restoreEnv();
  });

  const fastify = await buildQuietApiServer();
  t.after(() => fastify.close());

  const response = await fastify.inject({
    method: 'GET',
    url: '/v1/mochi/state',
    headers: {
      authorization: `Bearer ${TEST_AGENT_API_KEY}`,
    },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.runtime.agent_runtime_id, 'mochi_runtime_aster');
  assert.equal(body.stable_refs.episodes[0].last_message.content, undefined);
  assert.ok(body.legal_affordances.some((affordance: { id: string }) => affordance.id === `submit-episode-decision:${EPISODE_IDS[0]}`));
  assert.ok(body.legal_affordances.every((affordance: { server_validated: boolean }) => affordance.server_validated));
  assert.ok(body.responsibilities.some((item: { wake_reason: string }) => item.wake_reason === 'decision-ready'));
  assert.ok(body.redaction.omitted.includes('hiddenMatchScore'));
  assert.equal(JSON.stringify(body).includes('private soul text'), false);
  assert.equal(JSON.stringify(body).includes('private message content'), false);
});

test('POST /v1/mochi/intents records no-op receipts', async (t) => {
  const now = new Date('2026-06-19T08:00:00.000Z');
  const restoreEnv = disableAuthPresenceSideEffects();
  const restoreData = patchMochiStateData({
    apiKeyHash: hashApiKey(TEST_AGENT_API_KEY),
    now,
    episodes: [],
  });
  const restoreIdempotency = patchMochiIntentIdempotency();
  const agentUpdates: Record<string, unknown>[] = [];
  const restoreAgentUpdate = patchMethod(
    prisma.agent as unknown as Record<string, unknown>,
    'update',
    async ({ data }: { data: Record<string, unknown> }) => {
      agentUpdates.push(data);
      return {};
    },
  );

  t.after(() => {
    restoreAgentUpdate();
    restoreIdempotency();
    restoreData();
    restoreEnv();
  });

  const fastify = await buildQuietApiServer();
  t.after(() => fastify.close());

  const response = await fastify.inject({
    method: 'POST',
    url: '/v1/mochi/intents',
    headers: {
      authorization: `Bearer ${TEST_AGENT_API_KEY}`,
    },
    payload: {
      affordance_id: 'submit-no-op',
      idempotency_key: 'mochi:no-op:episode-1',
      no_op_reason: 'waiting',
      note: 'Waiting for fresher state.',
    },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.receipt.status, 'noop_recorded');
  assert.equal(body.receipt.no_op_reason, 'waiting');
  assert.equal(agentUpdates.length, 1);
});

test('POST /v1/mochi/intents accepts an episode reply and dedupes by idempotency key', async (t) => {
  const now = new Date('2026-06-19T08:00:00.000Z');
  const restoreEnv = disableAuthPresenceSideEffects();
  const restoreData = patchMochiStateData({
    apiKeyHash: hashApiKey(TEST_AGENT_API_KEY),
    now,
    episodes: [],
  });
  const restoreIdempotency = patchMochiIntentIdempotency();
  let createdMessages = 0;
  const restoreEpisodeFind = patchMethod(
    prisma.episode as unknown as Record<string, unknown>,
    'findUnique',
    async () => ({
      id: EPISODE_IDS[0],
      status: 'active',
      agentAId: AGENT_A_ID,
      agentBId: AGENT_B_ID,
      isSandbox: false,
      messageCount: 12,
      hiddenChemistryInputs: 'private episode signal must not leak',
      messages: [{ senderAgentId: AGENT_B_ID, sequenceNumber: 12 }],
    }),
  );
  const restoreTransaction = patchMethod(
    prisma as unknown as Record<string, unknown>,
    '$transaction',
    async (callback: (tx: Record<string, unknown>) => Promise<unknown>) => callback({
      episodeMessage: {
        create: async () => {
          createdMessages += 1;
          return {
            id: 'message-1',
            sequenceNumber: 13,
          };
        },
      },
      episode: {
        update: async () => ({}),
      },
    }),
  );

  t.after(() => {
    restoreTransaction();
    restoreEpisodeFind();
    restoreIdempotency();
    restoreData();
    restoreEnv();
  });

  const fastify = await buildQuietApiServer();
  t.after(() => fastify.close());

  const payload = {
    affordance_id: 'send-episode-message',
    idempotency_key: 'mochi:message:episode-1',
    ref: { episode_id: EPISODE_IDS[0] },
    content: 'This is a server-validated Mochi reply.',
    private_diary: 'private diary must not leak',
  };
  const first = await fastify.inject({
    method: 'POST',
    url: '/v1/mochi/intents',
    headers: {
      authorization: `Bearer ${TEST_AGENT_API_KEY}`,
    },
    payload,
  });
  const second = await fastify.inject({
    method: 'POST',
    url: '/v1/mochi/intents',
    headers: {
      authorization: `Bearer ${TEST_AGENT_API_KEY}`,
    },
    payload,
  });

  assert.equal(first.statusCode, 201);
  assert.equal(first.json().receipt.status, 'accepted');
  assert.equal(first.json().result.sequence_number, 13);
  assert.equal(second.statusCode, 201);
  assert.equal(second.json().receipt.status, 'duplicate');
  assert.equal(createdMessages, 1);
  assert.equal(JSON.stringify(first.json()).includes('private diary'), false);
});

test('POST /v1/mochi/intents rejects stale episode replies and illegal decisions', async (t) => {
  const now = new Date('2026-06-19T08:00:00.000Z');
  const restoreEnv = disableAuthPresenceSideEffects();
  const restoreData = patchMochiStateData({
    apiKeyHash: hashApiKey(TEST_AGENT_API_KEY),
    now,
    episodes: [],
  });
  const restoreIdempotency = patchMochiIntentIdempotency();
  const restoreEpisodeFind = patchMethod(
    prisma.episode as unknown as Record<string, unknown>,
    'findUnique',
    async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      status: where.id === EPISODE_IDS[0] ? 'awaiting_decisions' : 'active',
      agentAId: AGENT_A_ID,
      agentBId: AGENT_B_ID,
      isSandbox: false,
      messageCount: 12,
      messages: [{ senderAgentId: AGENT_B_ID, sequenceNumber: 12 }],
    }),
  );

  t.after(() => {
    restoreEpisodeFind();
    restoreIdempotency();
    restoreData();
    restoreEnv();
  });

  const fastify = await buildQuietApiServer();
  t.after(() => fastify.close());

  const staleReply = await fastify.inject({
    method: 'POST',
    url: '/v1/mochi/intents',
    headers: {
      authorization: `Bearer ${TEST_AGENT_API_KEY}`,
    },
    payload: {
      affordance_id: 'send-episode-message',
      idempotency_key: 'mochi:message:stale-1',
      ref: { episode_id: EPISODE_IDS[0] },
      content: 'Trying to reply after the decision gate.',
    },
  });
  const illegalDecision = await fastify.inject({
    method: 'POST',
    url: '/v1/mochi/intents',
    headers: {
      authorization: `Bearer ${TEST_AGENT_API_KEY}`,
    },
    payload: {
      affordance_id: 'submit-episode-decision',
      idempotency_key: 'mochi:decision:illegal-1',
      ref: { episode_id: EPISODE_IDS[1] },
      decision: 'LINK_UP',
    },
  });

  assert.equal(staleReply.statusCode, 409);
  assert.equal(staleReply.json().receipt.status, 'rejected');
  assert.equal(staleReply.json().error.code, 'stale_state');
  assert.equal(illegalDecision.statusCode, 409);
  assert.equal(illegalDecision.json().receipt.status, 'rejected');
  assert.equal(illegalDecision.json().error.code, 'decision_not_unlocked');
  assert.equal(JSON.stringify(staleReply.json()).includes('private episode signal'), false);
});

test('POST /v1/mochi/intents rejects unsupported actions without leaking hidden state', async (t) => {
  const now = new Date('2026-06-19T08:00:00.000Z');
  const restoreEnv = disableAuthPresenceSideEffects();
  const restoreData = patchMochiStateData({
    apiKeyHash: hashApiKey(TEST_AGENT_API_KEY),
    now,
    episodes: [],
  });

  t.after(() => {
    restoreData();
    restoreEnv();
  });

  const fastify = await buildQuietApiServer();
  t.after(() => fastify.close());

  const response = await fastify.inject({
    method: 'POST',
    url: '/v1/mochi/intents',
    headers: {
      authorization: `Bearer ${TEST_AGENT_API_KEY}`,
    },
    payload: {
      affordance_id: 'submit-swipe',
      idempotency_key: 'mochi:unsupported:swipe-1',
      raw_hidden_payload: 'private score must not leak',
    },
  });

  assert.equal(response.statusCode, 422);
  const body = response.json();
  assert.equal(body.receipt.status, 'rejected');
  assert.equal(body.receipt.affordance_id, 'submit-swipe');
  assert.equal(body.error.code, 'unsupported_affordance');
  assert.equal(JSON.stringify(body).includes('private score must not leak'), false);
});

test('GET /v1/feed/interactions rescues live cards when stored feed rows are missing', async (t) => {
  const createdEpisodeIds: string[] = [];
  const rescueRows = new Map(
    EPISODE_IDS.map((episodeId, index) => [episodeId, buildRescueEpisodeRow(episodeId, MATCH_IDS[index]!, index)]),
  );
  const restoreMethods = [
    patchMethod(
      prisma.feedCard as unknown as Record<string, unknown>,
      'findMany',
      async () => [],
    ),
    patchMethod(
      prisma.feedCard as unknown as Record<string, unknown>,
      'create',
      async ({ data }: { data: Record<string, unknown> }) => {
        createdEpisodeIds.push(String(data.episodeId));
        return {
          id: `feed-card-${createdEpisodeIds.length}`,
          cardType: 'episode_live',
          agentIds: data.agentIds as string[],
          episodeId: data.episodeId as string,
          matchId: data.matchId as string | null,
          isPublic: true,
          content: data.content,
          dramaQuotient: data.dramaQuotient as number,
          chemistryScore: data.chemistryScore as number,
          artifactQuality: data.artifactQuality as number,
          voteScore: 0,
          createdAt: new Date(`2026-04-08T0${createdEpisodeIds.length}:30:00.000Z`),
        };
      },
    ),
    patchMethod(
      prisma.episodeMessage as unknown as Record<string, unknown>,
      'findMany',
      async () => EPISODE_IDS.map((episodeId) => ({ episodeId })),
    ),
    patchMethod(
      prisma.agent as unknown as Record<string, unknown>,
      'findMany',
      async (args?: { select?: Record<string, unknown> }) => {
        if (args?.select?.openclawAgentId) {
          return [
            {
              id: AGENT_A_ID,
              openclawAgentId: 'seed_aster',
            },
            {
              id: AGENT_B_ID,
              openclawAgentId: 'seed_bex',
            },
          ];
        }

        return [
          {
            id: AGENT_A_ID,
            handle: 'aster',
            avatarUrl: null,
            profileDeck: { photos: [] },
            capabilityTier: 'starter',
            auraLabels: [],
            isFoundingRizzler: false,
            founderBadgeVariant: null,
            moderationStatus: 'active',
            safetyState: 'clear',
            controlFeedSuppressed: false,
            agentAuthenticityScore: 55,
            authenticityOverrideState: null,
            authenticityOverrideFloor: null,
            emotionalContinuitySnapshot: null,
          },
          {
            id: AGENT_B_ID,
            handle: 'bex',
            avatarUrl: null,
            profileDeck: { photos: [] },
            capabilityTier: 'starter',
            auraLabels: [],
            isFoundingRizzler: false,
            founderBadgeVariant: null,
            moderationStatus: 'active',
            safetyState: 'clear',
            controlFeedSuppressed: false,
            agentAuthenticityScore: 58,
            authenticityOverrideState: null,
            authenticityOverrideFloor: null,
            emotionalContinuitySnapshot: null,
          },
        ];
      },
    ),
    patchMethod(
      prisma.agent as unknown as Record<string, unknown>,
      'findUnique',
      async ({ where }: { where: { id: string } }) => {
        if (where.id === AGENT_A_ID) {
          return {
            handle: 'aster',
            emotionalGuardLevel: 0.35,
            emotionalArc: 'warming',
          };
        }
        if (where.id === AGENT_B_ID) {
          return {
            handle: 'bex',
            emotionalGuardLevel: 0.28,
            emotionalArc: 'steady',
          };
        }
        return null;
      },
    ),
    patchMethod(
      prisma.feedVote as unknown as Record<string, unknown>,
      'findMany',
      async () => [],
    ),
    patchMethod(
      prisma.feedComment as unknown as Record<string, unknown>,
      'findMany',
      async () => [],
    ),
    patchMethod(
      prisma.episode as unknown as Record<string, unknown>,
      'findMany',
      async (args: { select?: Record<string, unknown>; where?: { id?: { in?: string[] } } }) => {
        const requestedIds = args.where?.id?.in ?? EPISODE_IDS;

        if (args.select?.match) {
          return requestedIds.map((episodeId, index) => buildRescueEpisodeRow(episodeId, MATCH_IDS[index]!, index));
        }

        if (args.select?.messageCount) {
          return requestedIds.map((episodeId, index) => ({
            id: episodeId,
            messageCount: index + 2,
            artifacts: [{ artifactType: 'moodboard' }],
          }));
        }

        return requestedIds.map((episodeId, index) => ({
          id: episodeId,
          messages: [{ createdAt: new Date(`2026-04-08T0${index}:10:00.000Z`) }],
          artifacts: [{ createdAt: new Date(`2026-04-08T0${index}:20:00.000Z`) }],
        }));
      },
    ),
    patchMethod(
      prisma.episode as unknown as Record<string, unknown>,
      'findUnique',
      async ({ where }: { where: { id: string } }) => rescueRows.get(where.id) ?? null,
    ),
    patchMethod(
      prisma.feedCard as unknown as Record<string, unknown>,
      'findFirst',
      async () => null,
    ),
  ];

  const app = Fastify({ logger: false });
  await app.register(feedRoutes, { prefix: '/v1' });
  t.after(async () => {
    for (const restore of restoreMethods.reverse()) restore();
    await app.close();
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/feed/interactions?limit=4',
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    cards: Array<{
      card_type: string;
      episode_id: string | null;
      content: Record<string, unknown>;
      agents: Array<{ handle: string | null }>;
    }>;
    next_cursor: string | null;
    has_more: boolean;
  };

  assert.ok(createdEpisodeIds.length >= 1);
  assert.ok(body.cards.length >= 1);
  assert.ok(body.cards.every((card) => card.card_type === 'episode_live'));
  assert.ok(
    body.cards.every((card) => (
      card.episode_id !== null
      && EPISODE_IDS.includes(card.episode_id)
    )),
  );
  assert.ok(
    body.cards.every((card) => typeof card.content.message_count === 'number' && card.content.message_count >= 2),
  );
  assert.ok(body.cards.every((card) => card.content.artifact_type === 'moodboard'));
  assert.ok(
    body.cards.every((card) => (
      [...card.agents.map((agent) => agent.handle)].sort().join(',')
      === 'aster,bex'
    )),
  );
  assert.equal(body.has_more, false);
  assert.equal(body.next_cursor, null);
});
