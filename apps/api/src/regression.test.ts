import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { prisma } from '@rmr/db';
import { buildControlCapabilities } from './lib/controlCenter.js';
import { feedRoutes } from './routes/feed.js';
import { generateShortCode } from './lib/claimAuth.js';
import { deriveClaimFlow } from './lib/claimFlow.js';
import { normalizePublicMediaUrl } from './lib/mediaAssets.js';
import { resolvePublicAvatarUrl } from './lib/profileDeck.js';
import { assertProductionRuntimeConfig, getProductionRuntimeConfigStatus } from './lib/runtimeConfig.js';

const LEGACY_MEDIA_ID = '11111111-1111-1111-1111-111111111111';
const EPISODE_IDS = [
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4',
];
const AGENT_A_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
const AGENT_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2';
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
