import { randomUUID } from 'crypto';
import { gzipSync } from 'zlib';
import { Prisma, prisma } from '@rmr/db';
import Redis from 'ioredis';
import { MANAGED_QUEUE_NAMES, getNamedQueue } from './queues.js';
import { uploadBufferToStorageAllowingPrivateUrl } from './storage.js';

export const FULL_DATABASE_WIPE_PRESERVED_TABLES = ['_prisma_migrations', 'audit_logs', 'control_settings'] as const;
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

function assertSafeIdentifier(value: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
    throw new Error(`unsafe_sql_identifier:${value}`);
  }
  return value;
}

function quoteIdentifier(value: string) {
  return `"${assertSafeIdentifier(value)}"`;
}

async function listPublicTables() {
  const rows = await prisma.$queryRaw<Array<{ tablename: string }>>(Prisma.sql`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename ASC
  `);

  return rows.map((row) => row.tablename);
}

async function countTableRows(tableName: string) {
  const sql = `
    SELECT COUNT(*)::bigint AS count
    FROM public.${quoteIdentifier(tableName)}
  `;
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint | number | string }>>(sql);
  const rawCount = rows[0]?.count;
  if (typeof rawCount === 'bigint') return Number(rawCount);
  if (typeof rawCount === 'number') return rawCount;
  if (typeof rawCount === 'string') return Number.parseInt(rawCount, 10) || 0;
  return 0;
}

async function drainQueue(name: string) {
  const queue = getNamedQueue(name);

  if (!queue) return { name, cleaned: false };

  try {
    await queue.drain(true);
    await Promise.allSettled([
      queue.clean(0, 10_000, 'failed'),
      queue.clean(0, 10_000, 'completed'),
      queue.clean(0, 10_000, 'wait'),
      queue.clean(0, 10_000, 'delayed'),
      queue.clean(0, 10_000, 'paused'),
      queue.clean(0, 10_000, 'prioritized'),
    ]);
    return { name, cleaned: true };
  } catch (error) {
    console.error(`[database-reset] Failed to drain queue ${name}:`, error);
    return { name, cleaned: false };
  }
}

export async function drainManagedQueues() {
  const results = await Promise.all(MANAGED_QUEUE_NAMES.map((name) => drainQueue(name)));
  const failed = results.filter((result) => !result.cleaned);
  if (failed.length > 0) {
    throw new Error(`queue_drain_failed:${failed.map((result) => result.name).join(',')}`);
  }
  return results;
}

async function clearRedisByPattern(redis: Redis, pattern: string) {
  let cursor = '0';
  let removed = 0;

  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 250);
    cursor = nextCursor;
    if (keys.length > 0) {
      removed += await redis.del(...keys);
    }
  } while (cursor !== '0');

  return removed;
}

export async function clearRedisCoordinationState() {
  let redis: Redis | null = null;

  try {
    redis = new Redis(REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    await redis.connect();

    const removedRevealChatKeys = await clearRedisByPattern(redis, 'reveal_chat:*');
    return {
      connected: true,
      removed_keys: removedRevealChatKeys,
    };
  } catch (error) {
    console.error('[database-reset] Failed to clear Redis coordination state:', error);
    return {
      connected: false,
      removed_keys: 0,
    };
  } finally {
    await redis?.quit().catch(() => {});
  }
}

export async function backupPublicDatabaseSnapshot(input: {
  actorKind: string;
  actorId: string;
  reason: string;
  backupKind: string;
  preservedTables: string[];
  resetTables: string[];
}) {
  if (!process.env.STORAGE_BUCKET) {
    throw new Error('storage_bucket_missing');
  }

  const allTables = await listPublicTables();
  const tableSummaries = await Promise.all(
    allTables.map(async (tableName) => ({
      table_name: tableName,
      row_count: await countTableRows(tableName),
    })),
  );
  const rowCounts = Object.fromEntries(tableSummaries.map((entry) => [entry.table_name, entry.row_count]));

  const backupPayload = {
    kind: input.backupKind,
    backup_scope: 'metadata_only',
    generated_at: new Date().toISOString(),
    actor_kind: input.actorKind,
    actor_id: input.actorId,
    reason: input.reason,
    preserved_tables: input.preservedTables,
    reset_tables: input.resetTables,
    tables: tableSummaries,
  };

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupBody = gzipSync(Buffer.from(JSON.stringify(backupPayload)));
  const backup = await uploadBufferToStorageAllowingPrivateUrl(
    `control-center/db-backups/${timestamp}-${randomUUID()}.json.gz`,
    new Uint8Array(backupBody),
    'application/gzip',
  );

  return {
    backup,
    rowCounts,
    allTables,
  };
}

export async function backupAndResetDatabase(input: {
  actorKind: string;
  actorId: string;
  reason: string;
}) {
  const allTables = await listPublicTables();
  const preservedTables = FULL_DATABASE_WIPE_PRESERVED_TABLES.filter((table) => allTables.includes(table));
  const resetTables = allTables.filter((table) => !FULL_DATABASE_WIPE_PRESERVED_TABLES.includes(table as (typeof FULL_DATABASE_WIPE_PRESERVED_TABLES)[number]));

  const queueReset = await drainManagedQueues();
  const redisReset = await clearRedisCoordinationState();
  if (!redisReset.connected) {
    throw new Error('redis_coordination_clear_failed');
  }

  const snapshot = await backupPublicDatabaseSnapshot({
    actorKind: input.actorKind,
    actorId: input.actorId,
    reason: input.reason,
    backupKind: 'omnimon_database_full_wipe_backup',
    preservedTables,
    resetTables,
  });

  if (resetTables.length > 0) {
    const truncateSql = `TRUNCATE TABLE ${resetTables.map((table) => `public.${quoteIdentifier(table)}`).join(', ')} RESTART IDENTITY CASCADE`;
    await prisma.$executeRawUnsafe(truncateSql);
  }

  return {
    backup: snapshot.backup,
    preservedTables,
    resetTables,
    rowCounts: snapshot.rowCounts,
    queueReset,
    redisReset,
  };
}
