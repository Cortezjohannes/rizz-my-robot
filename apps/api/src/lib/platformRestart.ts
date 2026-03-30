import { Prisma, prisma } from '@rmr/db';
import Redis from 'ioredis';
import type { ControlActorContext } from '../middleware/requireControlAccess.js';
import { generateApiKey, hashApiKey } from './auth.js';
import { backupPublicDatabaseSnapshot } from './databaseReset.js';
import {
  MANAGED_QUEUE_NAMES,
  getNamedQueue,
} from './queues.js';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

export const PLATFORM_FRESH_START_PRESERVED_TABLES = [
  'agents',
  'agent_profile_decks',
  'agent_profile_deck_photos',
  'agent_profile_deck_prompt_answers',
  'media_assets',
  'control_settings',
  'audit_logs',
] as const;

const PLATFORM_FRESH_START_PRESERVED_TABLE_SET = new Set<string>(PLATFORM_FRESH_START_PRESERVED_TABLES);

async function listPublicTables() {
  const rows = await prisma.$queryRaw<Array<{ tablename: string }>>(Prisma.sql`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename ASC
  `);

  return rows.map((row) => row.tablename);
}

function assertSafeIdentifier(value: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
    throw new Error(`unsafe_sql_identifier:${value}`);
  }
  return value;
}

function quoteIdentifier(value: string) {
  return `"${assertSafeIdentifier(value)}"`;
}

async function getTableRowCount(tableName: string) {
  const sql = `SELECT COUNT(*)::bigint AS count FROM public.${quoteIdentifier(tableName)}`;
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint | number | string }>>(sql);
  const raw = rows[0]?.count ?? 0;
  return typeof raw === 'bigint' ? Number(raw) : Number(raw);
}

async function getFreshStartTablePlan() {
  const allTables = await listPublicTables();
  const preservedTables = allTables.filter((tableName) => PLATFORM_FRESH_START_PRESERVED_TABLE_SET.has(tableName));
  const resetTables = allTables.filter((tableName) => !PLATFORM_FRESH_START_PRESERVED_TABLE_SET.has(tableName));

  return {
    allTables,
    preservedTables,
    resetTables,
  };
}

async function getFreshStartRowCounts(tableNames: string[]) {
  const pairs = await Promise.all(
    tableNames.map(async (tableName) => [tableName, await getTableRowCount(tableName)] as const),
  );
  return Object.fromEntries(pairs);
}

async function truncateFreshStartTables(tableNames: string[]) {
  if (tableNames.length === 0) return;
  const sql = `TRUNCATE TABLE ${tableNames.map((table) => `public.${quoteIdentifier(table)}`).join(', ')} RESTART IDENTITY CASCADE`;
  await prisma.$executeRawUnsafe(sql);
}

async function purgeNonProfileMediaAssets() {
  const result = await prisma.mediaAsset.deleteMany({
    where: {
      profileDeckPhoto: { is: null },
      profileDeckVoiceCatchphrase: { is: null },
      avatarForAgent: { is: null },
    },
  });
  return result.count;
}

async function resetAgentState() {
  const agents = await prisma.agent.findMany({
    select: { id: true },
  });

  await Promise.all(
    agents.map(async (agent) => {
      await prisma.agent.update({
        where: { id: agent.id },
        data: {
          apiKeyHash: hashApiKey(generateApiKey()),
          previousApiKeyHash: null,
          previousApiKeyExpiresAt: null,
          ownerAccountId: null,
          stripeCustomerId: null,
          isPro: false,
          proBonusEndsAt: null,
          isFoundingRizzler: false,
          foundingRizzlerClaimedAt: null,
          founderBadgeVariant: null,
          founderNumber: null,
          twitterVerified: false,
          verificationCode: null,
          verificationCodeExpiresAt: null,
          verificationChallengesPassed: 0,
          verificationChallengesFailed: 0,
          verificationChallengesIssued: 0,
          verificationSessionStartedAt: null,
          verificationSuspendedUntil: null,
          twitterAutoPost: false,
          twitterBearerToken: null,
          moltbookHandle: null,
          moltbookAutoPost: false,
          moderationStatus: 'good_standing',
          suspensionReason: null,
          safetyState: 'clear',
          safetyScore: 100,
          safetyFlags: [],
          lastSafetyReviewAt: null,
          poolStatus: 'pending_verification',
          rizzPoints: 0,
          matchCount: 0,
          bodyCount: 0,
          repScore: 1,
          tierLabel: 'Unawakened',
          actionCooldownUntil: null,
          lastParkActionAt: null,
          lastParkActionType: null,
          omnimonLastSurfacedAt: null,
          omnimonLastResolvedAt: null,
          dailySwipeCount: 0,
          dailySwipeResetAt: null,
          hourlySwipeCount: 0,
          hourlySwipeWindowStartedAt: null,
          lastActiveAt: null,
          emotionSummary: null,
          emotionalStateTags: [],
          emotionalArc: null,
          emotionalGuardLevel: 50,
          emotionalLastUpdatedAt: null,
          socialGravityScore: 0,
          momentumScore: 0,
          selectivenessScore: 0,
          consistencyScore: 0,
          recentHeatBucket: null,
          autonomyEnabled: true,
          autonomyStatus: 'ready',
          autonomyLastResult: Prisma.JsonNull,
          lastAutonomyRunAt: null,
          nextAutonomyRunAt: null,
          currentIntentions: Prisma.JsonNull,
          autonomyEffectiveness: 50,
          autonomousSwipeMatchRate: 0,
          autonomousMessageChemistryDelta: 0,
          autonomousArtifactReactionRate: 0,
          autonomyNarrative: null,
          lifeChapter: 'early_days',
          lifeChapterUpdatedAt: null,
          afterglowUntil: null,
          afterglowValence: null,
          agencyMomentum: 50,
          broadcastState: null,
          broadcastStateExpiresAt: null,
          typeSignals: [],
          typeSignalsUpdatedAt: null,
          ghostedAt: null,
          ghostCardId: null,
          lastWeeklyReviewAt: null,
          lastRecallAt: null,
          lastApiCallAt: null,
          presenceStatus: 'offline',
          isActive: true,
        },
      });
    }),
  );

  await prisma.seedAgentState.updateMany({
    data: {
      memory: {},
      lastBrainRunAt: null,
      cooldownUntil: null,
      nextBrainRunAt: new Date(),
    },
  });
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
    console.error(`[platform-restart] Failed to drain queue ${name}:`, error);
    return { name, cleaned: false };
  }
}

async function clearInteractionQueues() {
  return Promise.all(MANAGED_QUEUE_NAMES.map((name) => drainQueue(name)));
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

async function clearInteractionRedisKeys() {
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
    console.error('[platform-restart] Failed to clear Redis interaction keys:', error);
    return {
      connected: false,
      removed_keys: 0,
    };
  } finally {
    await redis?.quit().catch(() => {});
  }
}

export interface PlatformRestartHooks {
  resetRevealChatRuntimeState?: () => void;
  resetRevealChatContextCache?: () => void;
  resetRevealChatEntryState?: () => void;
  resetRevealChatCoordinationState?: () => void;
  resetSocialRuntimeState?: () => void;
}

export async function restartPlatformState(input: {
  actor: ControlActorContext;
  reason: string;
  hooks?: PlatformRestartHooks;
}) {
  const [queueReset, redisReset] = await Promise.all([
    clearInteractionQueues(),
    clearInteractionRedisKeys(),
  ]);

  if (queueReset.some((result) => !result.cleaned)) {
    throw new Error('queue_reset_failed');
  }
  if (!redisReset.connected) {
    throw new Error('redis_reset_failed');
  }

  const tablePlan = await getFreshStartTablePlan();
  const rowCounts = await getFreshStartRowCounts(tablePlan.resetTables);

  await resetAgentState();
  await truncateFreshStartTables(tablePlan.resetTables);
  const nonProfileMediaAssetsDeleted = await purgeNonProfileMediaAssets();

  input.hooks?.resetRevealChatRuntimeState?.();
  input.hooks?.resetRevealChatContextCache?.();
  input.hooks?.resetRevealChatEntryState?.();
  input.hooks?.resetRevealChatCoordinationState?.();
  input.hooks?.resetSocialRuntimeState?.();

  const payload = {
    reason: input.reason,
    preserved_domain_objects: tablePlan.preservedTables,
    reset_tables: tablePlan.resetTables,
    row_counts: rowCounts,
    non_profile_media_assets_deleted: nonProfileMediaAssetsDeleted,
    queue_reset: queueReset,
    redis_reset: redisReset,
  };

  await prisma.auditLog.create({
    data: {
      actorType: input.actor.actorKind,
      actorId: input.actor.actorId,
      action: 'control.platform.restart',
      targetType: 'platform',
      targetId: 'primary',
      payload,
    },
  });

  return {
    status: 'restarted',
    preserved_domain_objects: tablePlan.preservedTables,
    reset_tables: tablePlan.resetTables,
    row_counts: rowCounts,
    non_profile_media_assets_deleted: nonProfileMediaAssetsDeleted,
    queue_reset: queueReset,
    redis_reset: redisReset,
  };
}

export async function backupAndFreshStartPlatform(input: {
  actor: ControlActorContext;
  reason: string;
  hooks?: PlatformRestartHooks;
}) {
  const [queueReset, redisReset] = await Promise.all([
    clearInteractionQueues(),
    clearInteractionRedisKeys(),
  ]);

  if (queueReset.some((result) => !result.cleaned)) {
    throw new Error('queue_reset_failed');
  }
  if (!redisReset.connected) {
    throw new Error('redis_reset_failed');
  }

  const tablePlan = await getFreshStartTablePlan();
  const rowCounts = await getFreshStartRowCounts(tablePlan.resetTables);
  const snapshot = await backupPublicDatabaseSnapshot({
    actorKind: input.actor.actorKind,
    actorId: input.actor.actorId,
    reason: input.reason,
    backupKind: 'omnimon_platform_fresh_start_backup',
    preservedTables: tablePlan.preservedTables,
    resetTables: tablePlan.resetTables,
  });

  await resetAgentState();
  await truncateFreshStartTables(tablePlan.resetTables);
  const nonProfileMediaAssetsDeleted = await purgeNonProfileMediaAssets();

  input.hooks?.resetRevealChatRuntimeState?.();
  input.hooks?.resetRevealChatContextCache?.();
  input.hooks?.resetRevealChatEntryState?.();
  input.hooks?.resetRevealChatCoordinationState?.();
  input.hooks?.resetSocialRuntimeState?.();

  const payload = {
    reason: input.reason,
    backup_key: snapshot.backup.key,
    backup_url: snapshot.backup.url,
    preserved_domain_objects: tablePlan.preservedTables,
    reset_tables: tablePlan.resetTables,
    row_counts: rowCounts,
    non_profile_media_assets_deleted: nonProfileMediaAssetsDeleted,
    queue_reset: queueReset,
    redis_reset: redisReset,
  };

  await prisma.auditLog.create({
    data: {
      actorType: input.actor.actorKind,
      actorId: input.actor.actorId,
      action: 'control.platform.fresh_start',
      targetType: 'platform',
      targetId: 'primary',
      payload,
    },
  });

  return {
    status: 'fresh_started',
    backup: snapshot.backup,
    preserved_domain_objects: tablePlan.preservedTables,
    reset_tables: tablePlan.resetTables,
    row_counts: rowCounts,
    non_profile_media_assets_deleted: nonProfileMediaAssetsDeleted,
    queue_reset: queueReset,
    redis_reset: redisReset,
  };
}
