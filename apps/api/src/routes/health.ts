import type { FastifyInstance } from 'fastify';
import { Prisma, prisma } from '@rmr/db';
import Redis from 'ioredis';
import { getVerificationRequirements } from '../lib/controlSettings.js';
import { QUEUE_NAMES, getNamedQueue } from '../lib/queues.js';
import { getProductionRuntimeConfigStatus } from '../lib/runtimeConfig.js';
import { getStoragePublicBaseUrl, isStorageConfigured } from '../lib/storage.js';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const WORKER_HEARTBEAT_KEY = 'worker:runtime-heartbeat';

const REQUIRED_SCHEMA_TABLES = [
  'agent_affinity_signals',
  'agent_feed_impressions',
  'agent_profile_views',
  'episode_drafts',
  'featured_feed_pins',
  'media_assets',
  'owner_x_integration_links',
  'park_mood_snapshots',
  'reveal_chat_messages',
  'reveal_chat_participants',
  'reveal_chats',
] as const;

const REQUIRED_SCHEMA_COLUMNS = [
  ['agents', 'avatar_media_asset_id'],
  ['agents', 'current_intentions'],
  ['agents', 'last_api_call_at'],
  ['agents', 'presence_status'],
  ['agents', 'verification_challenges_issued'],
  ['agent_profile_decks', 'voice_catchphrase_media_asset_id'],
  ['episode_messages', 'is_autonomous'],
  ['episodes', 'exit_initiated_by_agent_id'],
  ['episodes', 'exit_style'],
  ['swipes', 'is_autonomous'],
] as const;

async function getMissingSchemaObjects() {
  const requiredTables = Prisma.join(REQUIRED_SCHEMA_TABLES.map((tableName) => Prisma.sql`(${tableName})`));
  const requiredColumns = Prisma.join(REQUIRED_SCHEMA_COLUMNS.map(([tableName, columnName]) => Prisma.sql`(${tableName}, ${columnName})`));

  const [presentTables, presentColumns] = await Promise.all([
    prisma.$queryRaw<Array<{ table_name: string }>>(Prisma.sql`
      WITH required(table_name) AS (
        VALUES ${requiredTables}
      )
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (SELECT table_name FROM required)
    `),
    prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>(Prisma.sql`
      WITH required(table_name, column_name) AS (
        VALUES ${requiredColumns}
      )
      SELECT c.table_name, c.column_name
      FROM information_schema.columns c
      INNER JOIN required r
        ON c.table_name = r.table_name
       AND c.column_name = r.column_name
      WHERE c.table_schema = 'public'
    `),
  ]);

  const presentTableSet = new Set(presentTables.map((row) => row.table_name));
  const presentColumnSet = new Set(presentColumns.map((row) => `${row.table_name}.${row.column_name}`));

  return [
    ...REQUIRED_SCHEMA_TABLES
      .filter((tableName) => !presentTableSet.has(tableName))
      .map((tableName) => `table:${tableName}`),
    ...REQUIRED_SCHEMA_COLUMNS
      .filter(([tableName, columnName]) => !presentColumnSet.has(`${tableName}.${columnName}`))
      .map(([tableName, columnName]) => `column:${tableName}.${columnName}`),
  ];
}

async function checkRedisConnectivity() {
  const redis = new Redis(REDIS_URL, {
    lazyConnect: true,
    connectTimeout: 1500,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });

  try {
    await redis.connect();
    const pong = await redis.ping();
    return {
      ok: pong === 'PONG',
      error: pong === 'PONG' ? null : `unexpected_redis_response:${pong}`,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'redis_unreachable',
    };
  } finally {
    redis.disconnect();
  }
}

const CRITICAL_QUEUE_NAMES = [
  QUEUE_NAMES.deliverWebhook,
  QUEUE_NAMES.artifactRecovery,
  QUEUE_NAMES.ghostCheck,
  QUEUE_NAMES.revealChatLifecycle,
  QUEUE_NAMES.expireRevealTokens,
  QUEUE_NAMES.presenceStatus,
  QUEUE_NAMES.wakeAgent,
] as const;

async function checkCriticalQueues() {
  const results = await Promise.all(
    CRITICAL_QUEUE_NAMES.map(async (queueName) => {
      const queue = getNamedQueue(queueName);
      if (!queue) {
        return { name: queueName, enabled: false };
      }

      try {
        await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
        return { name: queueName, enabled: true };
      } catch {
        return { name: queueName, enabled: false };
      }
    }),
  );

  return results;
}

async function checkWorkerHeartbeat() {
  const redis = new Redis(REDIS_URL, {
    lazyConnect: true,
    connectTimeout: 1500,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });

  try {
    await redis.connect();
    const payload = await redis.get(WORKER_HEARTBEAT_KEY);
    if (!payload) {
      return {
        ok: false,
        state: 'missing' as const,
        details: null as Record<string, unknown> | null,
        error: 'worker_heartbeat_missing',
      };
    }

    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      const state = typeof parsed.state === 'string' ? parsed.state : 'unknown';
      return {
        ok: state === 'running',
        state,
        details: parsed,
        error: state === 'running' ? null : `worker_state_${state}`,
      };
    } catch {
      return {
        ok: false,
        state: 'invalid' as const,
        details: null as Record<string, unknown> | null,
        error: 'worker_heartbeat_invalid',
      };
    }
  } catch (error) {
    return {
      ok: false,
      state: 'unreachable' as const,
      details: null as Record<string, unknown> | null,
      error: error instanceof Error ? error.message : 'worker_heartbeat_unreachable',
    };
  } finally {
    redis.disconnect();
  }
}

function checkStorageHosting() {
  const configured = isStorageConfigured();
  const publicBaseUrl = getStoragePublicBaseUrl();

  return {
    ok: configured && Boolean(publicBaseUrl),
    configured,
    public_base_url: publicBaseUrl,
    error: configured
      ? (publicBaseUrl ? null : 'storage_public_url_missing')
      : 'storage_bucket_missing',
  };
}

function checkClaimEmailDelivery(input: { requireEmailVerification: boolean }) {
  if (!input.requireEmailVerification) {
    return { ok: true, reason: null as string | null };
  }

  if (process.env.SENDGRID_API_KEY) {
    return { ok: true, reason: null as string | null };
  }

  if (process.env.EMAIL_PREVIEW_MODE === 'true') {
    return { ok: true, reason: 'email_preview_mode_enabled' };
  }

  return { ok: false, reason: 'sendgrid_unconfigured' };
}

function checkClaimXOAuth(input: { requireXVerification: boolean }) {
  if (!input.requireXVerification) {
    return { ok: true, reason: null as string | null };
  }

  const hasConfig = Boolean(process.env.X_CLIENT_ID && process.env.X_OAUTH_REDIRECT_URI);
  return {
    ok: hasConfig,
    reason: hasConfig ? null : 'x_oauth_unconfigured',
  };
}

export async function healthRoutes(fastify: FastifyInstance) {
  const readyHandler = async (_request: unknown, reply: { status: (code: number) => { send: (payload: unknown) => unknown } }) => {
    let dbOk = false;
    let errorMessage: string | null = null;
    let missingObjects: string[] = [];
    let redisOk = false;
    let redisError: string | null = null;
    let unavailableQueues: string[] = [];
    let storageOk = false;
    let storageError: string | null = null;
    let claimEmailOk = false;
    let claimEmailReason: string | null = null;
    let claimXOk = false;
    let claimXReason: string | null = null;
    let workerOk = false;
    let workerState = 'unknown';
    let workerError: string | null = null;
    let workerDetails: Record<string, unknown> | null = null;
    const runtimeConfig = getProductionRuntimeConfigStatus();
    let verificationRequirements = {
      requireEmailVerification: true,
      requireXVerification: true,
    };

    try {
      await prisma.$queryRaw`SELECT 1`;
      dbOk = true;
      [missingObjects, verificationRequirements] = await Promise.all([
        getMissingSchemaObjects(),
        getVerificationRequirements(),
      ]);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'database_unreachable';
    }

    const [redisState, queueState, workerStateCheck] = await Promise.all([
      checkRedisConnectivity(),
      checkCriticalQueues(),
      checkWorkerHeartbeat(),
    ]);

    redisOk = redisState.ok;
    redisError = redisState.error;
    unavailableQueues = queueState.filter((queue) => !queue.enabled).map((queue) => queue.name);
    workerOk = workerStateCheck.ok;
    workerState = workerStateCheck.state;
    workerError = workerStateCheck.error;
    workerDetails = workerStateCheck.details;
    const storageState = checkStorageHosting();
    storageOk = storageState.ok;
    storageError = storageState.error;
    const claimEmailState = checkClaimEmailDelivery({
      requireEmailVerification: verificationRequirements.requireEmailVerification,
    });
    claimEmailOk = claimEmailState.ok;
    claimEmailReason = claimEmailState.reason;
    const claimXState = checkClaimXOAuth({
      requireXVerification: verificationRequirements.requireXVerification,
    });
    claimXOk = claimXState.ok;
    claimXReason = claimXState.reason;

    const ready = dbOk
      && missingObjects.length === 0
      && redisOk
      && unavailableQueues.length === 0
      && workerOk
      && storageOk
      && runtimeConfig.required_missing.length === 0
      && claimEmailOk
      && claimXOk;
    const blockingIssues = [
      ...(!dbOk ? [{ check: 'database', reason: errorMessage ?? 'database_unreachable' }] : []),
      ...(dbOk && missingObjects.length > 0 ? [{ check: 'schema', reason: 'missing_objects', missing_objects: missingObjects }] : []),
      ...(!redisOk ? [{ check: 'redis', reason: redisError ?? 'redis_unreachable' }] : []),
      ...(!storageOk ? [{ check: 'storage', reason: storageError ?? 'storage_unavailable' }] : []),
      ...(runtimeConfig.required_missing.length > 0
        ? [{
            check: 'runtime_config',
            reason: 'required_runtime_config_missing',
            missing: runtimeConfig.required_missing,
          }]
        : []),
      ...(!workerOk ? [{ check: 'worker', reason: workerError ?? 'worker_unavailable', state: workerState }] : []),
      ...(!claimEmailOk ? [{ check: 'claim_email', reason: claimEmailReason ?? 'claim_email_unavailable' }] : []),
      ...(!claimXOk ? [{ check: 'claim_x_oauth', reason: claimXReason ?? 'claim_x_oauth_unavailable' }] : []),
      ...(unavailableQueues.length > 0 ? [{ check: 'queues', reason: 'critical_queues_unavailable', queues: unavailableQueues }] : []),
    ];

    return reply.status(ready ? 200 : 503).send({
      status: ready ? 'ok' : 'degraded',
      ready,
      version: process.env.npm_package_version ?? '0.0.1',
      db: dbOk ? 'ok' : 'unreachable',
      schema: !dbOk ? 'unknown' : missingObjects.length === 0 ? 'ok' : 'out_of_date',
      redis: redisOk ? 'ok' : 'unreachable',
      worker: workerOk ? 'ok' : 'unavailable',
      storage: storageOk ? 'ok' : 'unavailable',
      runtime_config: runtimeConfig.required_missing.length === 0 ? 'ok' : 'unavailable',
      claim_email: claimEmailOk ? 'ok' : 'unavailable',
      claim_x_oauth: claimXOk ? 'ok' : 'unavailable',
      queues: unavailableQueues.length === 0 ? 'ok' : 'degraded',
      checks: {
        database: {
          status: dbOk ? 'healthy' : 'down',
          ...(errorMessage ? { error: errorMessage } : {}),
        },
        schema: {
          status: !dbOk ? 'unknown' : missingObjects.length === 0 ? 'healthy' : 'out_of_date',
          ...(missingObjects.length > 0 ? { missing_objects: missingObjects } : {}),
        },
        redis: {
          status: redisOk ? 'healthy' : 'down',
          ...(redisError ? { error: redisError } : {}),
        },
        worker: {
          status: workerOk ? 'healthy' : 'down',
          state: workerState,
          ...(workerError ? { error: workerError } : {}),
          ...(workerDetails ? { details: workerDetails } : {}),
        },
        storage: {
          status: storageOk ? 'healthy' : 'down',
          ...(storageError ? { error: storageError } : {}),
          configured: storageState.configured,
          public_base_url: storageState.public_base_url,
        },
        runtime_config: {
          status: runtimeConfig.required_missing.length === 0 ? 'healthy' : 'down',
          required_missing: runtimeConfig.required_missing,
          recommended_missing: runtimeConfig.recommended_missing,
        },
        claim_email: {
          status: claimEmailOk ? 'healthy' : 'down',
          requirement_enabled: verificationRequirements.requireEmailVerification,
          ...(claimEmailReason ? { reason: claimEmailReason } : {}),
        },
        claim_x_oauth: {
          status: claimXOk ? 'healthy' : 'down',
          requirement_enabled: verificationRequirements.requireXVerification,
          ...(claimXReason ? { reason: claimXReason } : {}),
        },
        queues: {
          status: unavailableQueues.length === 0 ? 'healthy' : 'degraded',
          total: queueState.length,
          unavailable: unavailableQueues,
        },
      },
      ...(blockingIssues.length > 0 ? { blocking_issues: blockingIssues } : {}),
      queue_health: {
        total: queueState.length,
        unavailable: unavailableQueues,
      },
      missing_objects: missingObjects,
      ...(errorMessage ? { error: errorMessage } : {}),
      ...(redisError ? { redis_error: redisError } : {}),
      ts: new Date().toISOString(),
    });
  };

  const liveHandler = async (_request: unknown, reply: { status: (code: number) => { send: (payload: unknown) => unknown } }) => {
    return reply.status(200).send({ status: 'ok' });
  };

  fastify.get('/health', readyHandler);
  fastify.get('/v1/health', readyHandler);
  fastify.get('/health/ready', readyHandler);
  fastify.get('/v1/health/ready', readyHandler);

  // Liveness probe — no db check, just confirms process is alive
  fastify.get('/health/live', liveHandler);
  fastify.get('/v1/health/live', liveHandler);
}
