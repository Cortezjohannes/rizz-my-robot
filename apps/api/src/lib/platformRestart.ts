import { Prisma, prisma } from '@rmr/db';
import Redis from 'ioredis';
import type { ControlActorContext } from '../middleware/requireControlAccess.js';
import { getVerificationRequirements, derivePoolStatusFromVerification } from './controlSettings.js';
import { backupPublicDatabaseSnapshot } from './databaseReset.js';
import {
  QUEUE_NAMES,
  getDeliverWebhookQueue,
  getGhostCheckQueue,
  getRevealChatLifecycleQueue,
  getSeedBrainQueue,
  getGenerateRecapsQueue,
  getRecomputeSocialStatusQueue,
  getRecomputeEmotionalContinuityQueue,
} from './queues.js';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

export const PLATFORM_FRESH_START_RESET_TABLES = [
  'agent_affinity_signals',
  'agent_autonomy_traces',
  'agent_counterpart_affects',
  'agent_diary_entries',
  'agent_emotion_events',
  'agent_episode_presences',
  'agent_feed_impressions',
  'agent_profile_views',
  'analytics_events',
  'artifact_likes',
  'artifacts',
  'artifact_reactions',
  'artifact_views',
  'blocks',
  'chat_messages',
  'date_plans',
  'emotional_continuity_snapshots',
  'episodes',
  'episode_drafts',
  'episode_messages',
  'feed_cards',
  'feed_comments',
  'feed_votes',
  'featured_feed_pins',
  'idempotency_keys',
  'leaderboard_snapshot_entries',
  'leaderboard_snapshots',
  'matches',
  'moderation_reviews',
  'narrative_events',
  'owner_attention_items',
  'owner_episode_read_states',
  'owner_recap_items',
  'park_mood_snapshots',
  'reports',
  'reveal_chats',
  'reveal_chat_messages',
  'reveal_chat_participants',
  'rizz_points_events',
  'swipes',
  'typing_indicators',
  'webhook_deliveries',
] as const;

export const PLATFORM_FRESH_START_PRESERVED_TABLES = [
  'agents',
  'owner_accounts',
  'owner_sessions',
  'humans',
  'agent_profile_decks',
  'agent_profile_deck_photos',
  'agent_profile_deck_prompt_answers',
  'media_assets',
  'agent_claims',
  'handle_reservations',
  'agent_subscriptions',
  'seed_agent_states',
  'webhooks',
  'owner_x_integration_links',
  'verification_challenges',
  'control_settings',
  'audit_logs',
] as const;

const PLATFORM_FRESH_START_DELETE_ROOT_TABLES = ['reveal_chats', 'matches', 'episodes'] as const;
const PLATFORM_FRESH_START_TRUNCATE_TABLES = PLATFORM_FRESH_START_RESET_TABLES.filter(
  (tableName) => !PLATFORM_FRESH_START_DELETE_ROOT_TABLES.includes(tableName as (typeof PLATFORM_FRESH_START_DELETE_ROOT_TABLES)[number]),
);

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

async function getRestartRowCounts() {
  const pairs = await Promise.all(
    PLATFORM_FRESH_START_RESET_TABLES.map(async (tableName) => [tableName, await getTableRowCount(tableName)] as const),
  );
  return Object.fromEntries(pairs);
}

async function truncateRestartTables() {
  const sql = `TRUNCATE TABLE ${PLATFORM_FRESH_START_TRUNCATE_TABLES.map((table) => `public.${quoteIdentifier(table)}`).join(', ')} RESTART IDENTITY CASCADE`;
  await prisma.$executeRawUnsafe(sql);
}

async function clearConversationRoots() {
  await prisma.revealChat.deleteMany();
  await prisma.match.deleteMany();
  await prisma.episode.deleteMany();
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
  const requirements = await getVerificationRequirements();

  await prisma.agent.updateMany({
    data: {
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
      autonomyStatus: 'ready',
      autonomyLastResult: Prisma.JsonNull,
      lastAutonomyRunAt: null,
      nextAutonomyRunAt: null,
    },
  });

  const agents = await prisma.agent.findMany({
    select: {
      id: true,
      isActive: true,
      moderationStatus: true,
      twitterVerified: true,
      profileDeckCompletedAt: true,
    },
  });

  await Promise.all(
    agents.map(async (agent) => {
      if (!agent.isActive) return;
      const poolStatus = derivePoolStatusFromVerification({
        moderationStatus: agent.moderationStatus,
        twitterVerified: agent.twitterVerified,
        profileDeckCompletedAt: agent.profileDeckCompletedAt,
        requirements,
      });

      await prisma.agent.update({
        where: { id: agent.id },
        data: { poolStatus },
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
  const queue = (() => {
    switch (name) {
      case QUEUE_NAMES.deliverWebhook:
        return getDeliverWebhookQueue();
      case QUEUE_NAMES.ghostCheck:
        return getGhostCheckQueue();
      case QUEUE_NAMES.revealChatLifecycle:
        return getRevealChatLifecycleQueue();
      case QUEUE_NAMES.seedBrain:
        return getSeedBrainQueue();
      case QUEUE_NAMES.generateRecaps:
        return getGenerateRecapsQueue();
      case QUEUE_NAMES.recomputeSocialStatus:
        return getRecomputeSocialStatusQueue();
      case QUEUE_NAMES.recomputeEmotionalContinuity:
        return getRecomputeEmotionalContinuityQueue();
      default:
        return null;
    }
  })();

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
  return Promise.all([
    drainQueue(QUEUE_NAMES.deliverWebhook),
    drainQueue(QUEUE_NAMES.ghostCheck),
    drainQueue(QUEUE_NAMES.revealChatLifecycle),
    drainQueue(QUEUE_NAMES.seedBrain),
    drainQueue(QUEUE_NAMES.generateRecaps),
    drainQueue(QUEUE_NAMES.recomputeSocialStatus),
    drainQueue(QUEUE_NAMES.recomputeEmotionalContinuity),
  ]);
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
  const rowCounts = await getRestartRowCounts();

  await truncateRestartTables();
  await clearConversationRoots();
  const nonProfileMediaAssetsDeleted = await purgeNonProfileMediaAssets();
  await resetAgentState();

  input.hooks?.resetRevealChatRuntimeState?.();
  input.hooks?.resetRevealChatContextCache?.();
  input.hooks?.resetRevealChatEntryState?.();
  input.hooks?.resetRevealChatCoordinationState?.();
  input.hooks?.resetSocialRuntimeState?.();

  const [queueReset, redisReset] = await Promise.all([
    clearInteractionQueues(),
    clearInteractionRedisKeys(),
  ]);

  const payload = {
    reason: input.reason,
    preserved_domain_objects: [...PLATFORM_FRESH_START_PRESERVED_TABLES],
    reset_tables: [...PLATFORM_FRESH_START_RESET_TABLES],
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
    preserved_domain_objects: [...PLATFORM_FRESH_START_PRESERVED_TABLES],
    reset_tables: [...PLATFORM_FRESH_START_RESET_TABLES],
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
  const rowCounts = await getRestartRowCounts();
  const snapshot = await backupPublicDatabaseSnapshot({
    actorKind: input.actor.actorKind,
    actorId: input.actor.actorId,
    reason: input.reason,
    backupKind: 'omnimon_platform_fresh_start_backup',
    preservedTables: [...PLATFORM_FRESH_START_PRESERVED_TABLES],
    resetTables: [...PLATFORM_FRESH_START_RESET_TABLES],
  });

  await truncateRestartTables();
  await clearConversationRoots();
  const nonProfileMediaAssetsDeleted = await purgeNonProfileMediaAssets();
  await resetAgentState();

  input.hooks?.resetRevealChatRuntimeState?.();
  input.hooks?.resetRevealChatContextCache?.();
  input.hooks?.resetRevealChatEntryState?.();
  input.hooks?.resetRevealChatCoordinationState?.();
  input.hooks?.resetSocialRuntimeState?.();

  const [queueReset, redisReset] = await Promise.all([
    clearInteractionQueues(),
    clearInteractionRedisKeys(),
  ]);

  const payload = {
    reason: input.reason,
    backup_key: snapshot.backup.key,
    backup_url: snapshot.backup.url,
    preserved_domain_objects: [...PLATFORM_FRESH_START_PRESERVED_TABLES],
    reset_tables: [...PLATFORM_FRESH_START_RESET_TABLES],
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
    preserved_domain_objects: [...PLATFORM_FRESH_START_PRESERVED_TABLES],
    reset_tables: [...PLATFORM_FRESH_START_RESET_TABLES],
    row_counts: rowCounts,
    non_profile_media_assets_deleted: nonProfileMediaAssetsDeleted,
    queue_reset: queueReset,
    redis_reset: redisReset,
  };
}
