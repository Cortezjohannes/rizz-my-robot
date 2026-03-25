import type { FastifyInstance } from 'fastify';
import { Prisma, prisma } from '@rmr/db';
import Redis from 'ioredis';
import { QUEUE_NAMES, getNamedQueue } from '../lib/queues.js';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

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

export async function healthRoutes(fastify: FastifyInstance) {
  const readyHandler = async (_request: unknown, reply: { status: (code: number) => { send: (payload: unknown) => unknown } }) => {
    let dbOk = false;
    let errorMessage: string | null = null;
    let missingObjects: string[] = [];
    let redisOk = false;
    let redisError: string | null = null;
    let unavailableQueues: string[] = [];

    try {
      await prisma.$queryRaw`SELECT 1`;
      dbOk = true;
      missingObjects = await getMissingSchemaObjects();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'database_unreachable';
    }

    const [redisState, queueState] = await Promise.all([
      checkRedisConnectivity(),
      checkCriticalQueues(),
    ]);

    redisOk = redisState.ok;
    redisError = redisState.error;
    unavailableQueues = queueState.filter((queue) => !queue.enabled).map((queue) => queue.name);

    const ready = dbOk && missingObjects.length === 0 && redisOk && unavailableQueues.length === 0;
    const blockingIssues = [
      ...(!dbOk ? [{ check: 'database', reason: errorMessage ?? 'database_unreachable' }] : []),
      ...(dbOk && missingObjects.length > 0 ? [{ check: 'schema', reason: 'missing_objects', missing_objects: missingObjects }] : []),
      ...(!redisOk ? [{ check: 'redis', reason: redisError ?? 'redis_unreachable' }] : []),
      ...(unavailableQueues.length > 0 ? [{ check: 'queues', reason: 'critical_queues_unavailable', queues: unavailableQueues }] : []),
    ];

    return reply.status(ready ? 200 : 503).send({
      status: ready ? 'ok' : 'degraded',
      ready,
      version: process.env.npm_package_version ?? '0.0.1',
      db: dbOk ? 'ok' : 'unreachable',
      schema: !dbOk ? 'unknown' : missingObjects.length === 0 ? 'ok' : 'out_of_date',
      redis: redisOk ? 'ok' : 'unreachable',
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
