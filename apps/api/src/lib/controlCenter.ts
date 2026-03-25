import { Prisma, prisma } from '@rmr/db';
import { TEMPO_COOLDOWN_MINUTES } from '@rmr/shared';
import type { ControlActorContext } from '../middleware/requireControlAccess.js';
import { recordAuditLog } from './audit.js';
import { getVerificationRequirements, setVerificationRequirements, derivePoolStatusFromVerification } from './controlSettings.js';
import { backupAndResetDatabase, FULL_DATABASE_WIPE_PRESERVED_TABLES } from './databaseReset.js';
import { backupAndFreshStartPlatform, PLATFORM_FRESH_START_PRESERVED_TABLES } from './platformRestart.js';
import {
  getDeliverWebhookQueue,
  getNamedQueue,
  getQueueDiagnostics,
  QUEUE_NAMES,
} from './queues.js';
import { evaluateRevealGate, recomputeAndPersistAgentSafety } from './safety.js';
import { resolveHourlySwipeWindowState } from './throughput.js';
import { getSystemStatus } from './externalHealth.js';
import { getErrorAggregationStatus } from './errorAggregation.js';
import { isPaddleBillingConfigured } from './billing.js';

export type ControlSeverity = 'low' | 'medium' | 'high' | 'critical';
export type LifecycleAction =
  | 'activate'
  | 'pause'
  | 'set_pending_profile'
  | 'set_dormant'
  | 'suspend'
  | 'unsuspend'
  | 'soft_delete'
  | 'restore'
  | 'wake_autonomy';
export type ResetAction =
  | 'reset_autonomy_status'
  | 'reset_cooldowns_and_swipe_budget'
  | 'reset_onboarding_claim'
  | 'reset_verification_state';
export type TierAction = 'set_free' | 'set_pro' | 'set_founding';
export type PublicPresenceAction =
  | 'set_profile_public'
  | 'set_pool_visible'
  | 'set_leaderboard_visible'
  | 'set_feed_visible'
  | 'set_artifacts_visible';
export type ModerationResolutionAction = 'none' | 'soft_hold' | 'blocked' | 'suspend_agent' | 'clear';
export type FeaturedFeedItemKind = 'agent_profile' | 'artifact' | 'episode';

export interface ControlCapabilities {
  read_panels: Array<'home' | 'inbox' | 'world' | 'settings' | 'agents' | 'jobs' | 'moderation' | 'audit' | 'legacy_admin'>;
  actions: {
    can_manage_lifecycle: boolean;
    can_reset_agent_state: boolean;
    can_change_tiers: boolean;
    can_manage_public_presence: boolean;
    can_resolve_moderation: boolean;
    can_retry_jobs: boolean;
    can_retry_webhooks: boolean;
    can_recheck_reveals: boolean;
    can_manage_verification_policy: boolean;
    can_reset_database: boolean;
    can_manage_feed_features: boolean;
    can_access_legacy_admin_tools: boolean;
  };
}

export interface ControlFeaturedFeedItem {
  pin_id: string;
  item_kind: FeaturedFeedItemKind;
  target_id: string;
  target_label: string;
  target_href: string | null;
  rank: number;
  note: string | null;
  reason: string;
  created_by_actor_kind: string;
  created_at: string;
}

export interface ControlFeaturedFeedResponse {
  actor_kind: ControlActorContext['actorKind'];
  items: ControlFeaturedFeedItem[];
}

interface ControlLaunchServiceStatus {
  status: 'healthy' | 'degraded' | 'down';
  provider?: string;
  fallback?: string;
  reason?: string;
}

interface ControlAuditLogEntry {
  id: string;
  actor_type: string;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export interface ControlSettingsResponse {
  actor_kind: ControlActorContext['actorKind'];
  capabilities: ControlCapabilities;
  verification: {
    require_email_verification: boolean;
    require_x_verification: boolean;
  };
  platform_fresh_start: {
    backup_storage_configured: boolean;
    preserved_tables: string[];
  };
  full_database_wipe: {
    backup_storage_configured: boolean;
    preserved_tables: string[];
  };
  database_reset: {
    backup_storage_configured: boolean;
    preserved_tables: string[];
  };
}

export interface ControlHomeResponse {
  actor_kind: ControlActorContext['actorKind'];
  command_center: {
    active_agents: number;
    pending_profile_agents: number;
    paused_agents: number;
    dormant_agents: number;
    soft_deleted_agents: number;
    public_profiles: number;
    visibility_issues: number;
    pending_moderation_reviews: number;
    failed_webhook_deliveries: number;
    pending_reveals: number;
    stuck_reveals: number;
    billing_anomalies: number;
    failed_queue_jobs: number;
  };
  launch: {
    overall_status: 'healthy' | 'degraded' | 'down';
    external_overall: 'healthy' | 'degraded' | 'down';
    sentry_configured: boolean;
    sentry_environment: string;
    billing_configured: boolean;
    claim_token_hmac_configured: boolean;
    webhook_hmac_configured: boolean;
    degraded_services: number;
    down_services: number;
    delayed_queue_jobs: number;
  };
  queues: Array<{
    name: string;
    enabled: boolean;
    counts: Record<string, number>;
  }>;
  recent_audit: ControlAuditLogEntry[];
}

export interface ControlWorldResponse {
  actor_kind: ControlActorContext['actorKind'];
  park: {
    active_episodes: number;
    awaiting_decisions_episodes: number;
    pending_reveals: number;
    public_feed_cards_last_24h: number;
    public_artifacts_last_24h: number;
    new_public_profiles_last_7d: number;
  };
  public_presence: {
    pool_suppressed_agents: number;
    leaderboard_suppressed_agents: number;
    feed_suppressed_agents: number;
    artifact_suppressed_agents: number;
  };
  launch: {
    external_overall: 'healthy' | 'degraded' | 'down';
    external_services: Record<string, ControlLaunchServiceStatus>;
    critical_queues: Array<{
      name: string;
      enabled: boolean;
      failed: number;
      delayed: number;
      waiting: number;
      active: number;
      status: 'healthy' | 'degraded' | 'down';
    }>;
  };
  queues: Array<{
    name: string;
    enabled: boolean;
    counts: Record<string, number>;
  }>;
}

export interface DatabaseResetActionResult extends ControlActionResult {
  backup: {
    key: string;
    url: string;
  };
  preserved_tables: string[];
  reset_tables: string[];
  row_counts: Record<string, number>;
}

export interface PlatformFreshStartActionResult extends ControlActionResult {
  backup: {
    key: string;
    url: string;
  };
  preserved_tables: string[];
  reset_tables: string[];
  row_counts: Record<string, number>;
}

export interface ControlActionResult {
  status: 'ok';
  actor_kind: ControlActorContext['actorKind'];
  target_type: string;
  target_id: string;
  performed_at: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

const LAUNCH_CRITICAL_QUEUE_NAMES = new Set<string>([
  QUEUE_NAMES.deliverWebhook,
  QUEUE_NAMES.wakeAgent,
  QUEUE_NAMES.revealChatLifecycle,
  QUEUE_NAMES.generateRecaps,
  QUEUE_NAMES.artifactRecovery,
  QUEUE_NAMES.verifyTwitter,
]);

function summarizeLaunchStatus(input: {
  externalOverall: 'healthy' | 'degraded' | 'down';
  errorAggregationConfigured: boolean;
  billingConfigured: boolean;
  criticalQueuesHealthy: boolean;
}) {
  if (
    input.externalOverall === 'down'
    || !input.errorAggregationConfigured
    || !input.billingConfigured
    || !input.criticalQueuesHealthy
  ) {
    return 'down' as const;
  }

  if (input.externalOverall === 'degraded') {
    return 'degraded' as const;
  }

  return 'healthy' as const;
}

function getControlSurfaceName(actor: ControlActorContext): 'omnimon_control_center' | 'human_admin_surface' {
  return actor.actorKind === 'omnimon' ? 'omnimon_control_center' : 'human_admin_surface';
}

export function buildControlCapabilities(actorKind: ControlActorContext['actorKind']): ControlCapabilities {
  return {
    read_panels: actorKind === 'human_admin'
      ? ['home', 'inbox', 'world', 'settings', 'agents', 'jobs', 'moderation', 'audit', 'legacy_admin']
      : ['home', 'inbox', 'world', 'settings', 'agents', 'jobs', 'moderation', 'audit'],
    actions: {
      can_manage_lifecycle: true,
      can_reset_agent_state: true,
      can_change_tiers: true,
      can_manage_public_presence: true,
      can_resolve_moderation: true,
      can_retry_jobs: true,
      can_retry_webhooks: true,
      can_recheck_reveals: true,
      can_manage_verification_policy: true,
      can_reset_database: true,
      can_manage_feed_features: true,
      can_access_legacy_admin_tools: actorKind === 'human_admin',
    },
  };
}

const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'grace_period'] as const;

function snapshotAgent(agent: {
  id: string;
  handle: string;
  ownerAccountId: string | null;
  twitterVerified: boolean;
  isActive: boolean;
  poolStatus: string;
  moderationStatus: string;
  suspensionReason: string | null;
  safetyState: string;
  safetyScore: number;
  isPro: boolean;
  isFoundingRizzler: boolean;
  founderBadgeVariant: string | null;
  founderNumber: number | null;
  tempoOverrideMinutes: number | null;
  autonomyEnabled: boolean;
  autonomyStatus: string;
  actionCooldownUntil: Date | null;
  hourlySwipeCount: number;
  hourlySwipeWindowStartedAt: Date | null;
  profileDeckCompletedAt: Date | null;
  profileDeckVisibility: string | null;
  controlPoolSuppressed: boolean;
  controlLeaderboardSuppressed: boolean;
  controlFeedSuppressed: boolean;
  controlArtifactsSuppressed: boolean;
}) {
  return {
    agent_id: agent.id,
    handle: agent.handle,
    owner_account_id: agent.ownerAccountId,
    twitter_verified: agent.twitterVerified,
    is_active: agent.isActive,
    pool_status: agent.poolStatus,
    moderation_status: agent.moderationStatus,
    suspension_reason: agent.suspensionReason,
    safety_state: agent.safetyState,
    safety_score: agent.safetyScore,
    is_pro: agent.isPro,
    is_founding_rizzler: agent.isFoundingRizzler,
    founder_badge_variant: agent.founderBadgeVariant,
    founder_number: agent.founderNumber,
    tempo_override_minutes: agent.tempoOverrideMinutes,
    autonomy_enabled: agent.autonomyEnabled,
    autonomy_status: agent.autonomyStatus,
    action_cooldown_until: agent.actionCooldownUntil?.toISOString() ?? null,
    hourly_swipe_count: agent.hourlySwipeCount,
    hourly_swipe_window_started_at: agent.hourlySwipeWindowStartedAt?.toISOString() ?? null,
    profile_deck_completed_at: agent.profileDeckCompletedAt?.toISOString() ?? null,
    profile_deck_visibility: agent.profileDeckVisibility,
    control_pool_suppressed: agent.controlPoolSuppressed,
    control_leaderboard_suppressed: agent.controlLeaderboardSuppressed,
    control_feed_suppressed: agent.controlFeedSuppressed,
    control_artifacts_suppressed: agent.controlArtifactsSuppressed,
  };
}

async function loadAgentForControl(agentId: string) {
  return prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      id: true,
      handle: true,
      openclawAgentId: true,
      ownerAccountId: true,
      twitterVerified: true,
      verificationCode: true,
      verificationCodeExpiresAt: true,
      verificationChallengesPassed: true,
      verificationChallengesFailed: true,
      verificationSuspendedUntil: true,
      isActive: true,
      poolStatus: true,
      moderationStatus: true,
      suspensionReason: true,
      safetyState: true,
      safetyScore: true,
      isPro: true,
      isFoundingRizzler: true,
      foundingRizzlerClaimedAt: true,
      founderBadgeVariant: true,
      founderNumber: true,
      tempoOverrideMinutes: true,
      autonomyEnabled: true,
      autonomyStatus: true,
      autonomyLastResult: true,
      lastAutonomyRunAt: true,
      nextAutonomyRunAt: true,
      actionCooldownUntil: true,
      lastParkActionAt: true,
      lastParkActionType: true,
      dailySwipeCount: true,
      dailySwipeResetAt: true,
      hourlySwipeCount: true,
      hourlySwipeWindowStartedAt: true,
      profileDeckCompletedAt: true,
      profileDeckVisibility: true,
      controlPoolSuppressed: true,
      controlLeaderboardSuppressed: true,
      controlFeedSuppressed: true,
      controlArtifactsSuppressed: true,
      ownerAccount: {
        select: {
          id: true,
          email: true,
          xHandle: true,
          humanIdentity: true,
          lookingFor: true,
        },
      },
    },
  });
}

async function deriveRestorePoolStatus(agent: {
  moderationStatus: string;
  twitterVerified: boolean;
  profileDeckCompletedAt: Date | null;
}) {
  const requirements = await getVerificationRequirements();
  return derivePoolStatusFromVerification({
    moderationStatus: agent.moderationStatus,
    twitterVerified: agent.twitterVerified,
    profileDeckCompletedAt: agent.profileDeckCompletedAt,
    requirements,
  });
}

async function writeControlAudit(input: {
  actor: ControlActorContext;
  action: string;
  targetType: string;
  targetId: string;
  reason: string;
  severity?: ControlSeverity;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  controlSurface: string;
  agentId?: string | null;
}) {
  await recordAuditLog({
    agentId: input.agentId ?? null,
    actorType: input.actor.actorKind,
    actorId: input.actor.actorId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    payload: {
      reason: input.reason,
      severity: input.severity ?? 'medium',
      control_surface: input.controlSurface,
      before_snapshot: input.before ?? null,
      after_snapshot: input.after ?? null,
    },
  });
}

function buildActionResult(input: {
  actor: ControlActorContext;
  targetType: string;
  targetId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}): ControlActionResult {
  return {
    status: 'ok',
    actor_kind: input.actor.actorKind,
    target_type: input.targetType,
    target_id: input.targetId,
    performed_at: new Date().toISOString(),
    before: input.before,
    after: input.after,
  };
}

async function setAgentTier(agentId: string, tier: 'free' | 'pro' | 'founding') {
  if (tier === 'free') {
    await prisma.$transaction(async (tx) => {
      await tx.agent.update({
        where: { id: agentId },
        data: {
          isPro: false,
          isFoundingRizzler: false,
          foundingRizzlerClaimedAt: null,
          founderBadgeVariant: null,
          founderNumber: null,
          tempoOverrideMinutes: null,
        },
      });
      await tx.agentSubscription.updateMany({
        where: {
          agentId,
          plan: { in: ['pro', 'founding'] },
        },
        data: {
          status: 'canceled',
          cancelAtPeriodEnd: true,
          currentPeriodEnd: new Date(),
          gracePeriodEndsAt: null,
          lastWebhookAt: new Date(),
        },
      });
    });
    return;
  }

  if (tier === 'pro') {
    await prisma.$transaction(async (tx) => {
      await tx.agent.update({
        where: { id: agentId },
        data: {
          isPro: true,
          isFoundingRizzler: false,
          foundingRizzlerClaimedAt: null,
          founderBadgeVariant: null,
          founderNumber: null,
          tempoOverrideMinutes: TEMPO_COOLDOWN_MINUTES.pro,
        },
      });
      await tx.agentSubscription.upsert({
        where: { agentId_plan: { agentId, plan: 'pro' } },
        update: {
          provider: 'manual',
          status: 'active',
          currentPeriodStart: new Date(),
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          gracePeriodEndsAt: null,
          lastWebhookAt: new Date(),
        },
        create: {
          agentId,
          provider: 'manual',
          plan: 'pro',
          status: 'active',
          currentPeriodStart: new Date(),
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          gracePeriodEndsAt: null,
          lastWebhookAt: new Date(),
        },
      });
      await tx.agentSubscription.updateMany({
        where: { agentId, plan: 'founding' },
        data: {
          status: 'canceled',
          cancelAtPeriodEnd: true,
          currentPeriodEnd: new Date(),
          gracePeriodEndsAt: null,
          lastWebhookAt: new Date(),
        },
      });
    });
    return;
  }

  await prisma.$transaction(async (tx) => {
    const existing = await tx.agent.findUnique({
      where: { id: agentId },
      select: { founderNumber: true },
    });
    const maxFounder = await tx.agent.aggregate({
      where: { founderNumber: { not: null } },
      _max: { founderNumber: true },
    });
    const founderNumber = existing?.founderNumber ?? ((maxFounder._max.founderNumber ?? 0) + 1);

    await tx.agent.update({
      where: { id: agentId },
      data: {
        isPro: true,
        isFoundingRizzler: true,
        foundingRizzlerClaimedAt: new Date(),
        founderBadgeVariant: 'founding_rizzler',
        founderNumber,
        tempoOverrideMinutes: TEMPO_COOLDOWN_MINUTES.founding,
      },
    });
    await tx.agentSubscription.upsert({
      where: { agentId_plan: { agentId, plan: 'founding' } },
      update: {
        provider: 'manual',
        status: 'active',
        currentPeriodStart: new Date(),
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        gracePeriodEndsAt: null,
        lastWebhookAt: new Date(),
      },
      create: {
        agentId,
        provider: 'manual',
        plan: 'founding',
        status: 'active',
        currentPeriodStart: new Date(),
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        gracePeriodEndsAt: null,
        lastWebhookAt: new Date(),
      },
    });
    await tx.agentSubscription.upsert({
      where: { agentId_plan: { agentId, plan: 'pro' } },
      update: {
        provider: 'manual',
        status: 'active',
        currentPeriodStart: new Date(),
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        gracePeriodEndsAt: null,
        lastWebhookAt: new Date(),
      },
      create: {
        agentId,
        provider: 'manual',
        plan: 'pro',
        status: 'active',
        currentPeriodStart: new Date(),
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        gracePeriodEndsAt: null,
        lastWebhookAt: new Date(),
      },
    });
  });
}

async function countBillingAnomalies() {
  return prisma.agent.count({
    where: {
      OR: [
        {
          isFoundingRizzler: true,
          isPro: false,
        },
        {
          isPro: true,
          isFoundingRizzler: false,
          subscriptions: {
            none: {
              plan: 'pro',
              status: { in: [...ACTIVE_SUBSCRIPTION_STATUSES] },
            },
          },
        },
        {
          isPro: false,
          subscriptions: {
            some: {
              plan: 'pro',
              status: { in: [...ACTIVE_SUBSCRIPTION_STATUSES] },
            },
          },
        },
        {
          isFoundingRizzler: true,
          subscriptions: {
            none: {
              plan: 'founding',
              status: { in: [...ACTIVE_SUBSCRIPTION_STATUSES] },
            },
          },
        },
      ],
    },
  });
}

async function listBillingAnomalies(limit: number) {
  return prisma.agent.findMany({
    where: {
      OR: [
        {
          isFoundingRizzler: true,
          isPro: false,
        },
        {
          isPro: true,
          isFoundingRizzler: false,
          subscriptions: {
            none: {
              plan: 'pro',
              status: { in: [...ACTIVE_SUBSCRIPTION_STATUSES] },
            },
          },
        },
        {
          isPro: false,
          subscriptions: {
            some: {
              plan: 'pro',
              status: { in: [...ACTIVE_SUBSCRIPTION_STATUSES] },
            },
          },
        },
        {
          isFoundingRizzler: true,
          subscriptions: {
            none: {
              plan: 'founding',
              status: { in: [...ACTIVE_SUBSCRIPTION_STATUSES] },
            },
          },
        },
      ],
    },
    select: {
      id: true,
      handle: true,
      isPro: true,
      isFoundingRizzler: true,
      subscriptions: {
        select: {
          plan: true,
          status: true,
          provider: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
        take: 3,
      },
    },
    take: limit,
    orderBy: { updatedAt: 'desc' },
  });
}

export async function buildControlHome() {
  const [
    queueDiagnostics,
    externalServices,
    pendingModeration,
    failedWebhookDeliveries,
    activeAgents,
    pendingProfileAgents,
    pausedAgents,
    dormantAgents,
    softDeletedAgents,
    publicProfiles,
    visibilityIssues,
    pendingReveals,
    stuckReveals,
    billingAnomalies,
    recentAudit,
  ] = await Promise.all([
    getQueueDiagnostics(),
    getSystemStatus(),
    prisma.moderationReview.count({ where: { status: 'pending' } }),
    prisma.webhookDelivery.count({ where: { status: 'failed' } }),
    prisma.agent.count({ where: { poolStatus: 'active' } }),
    prisma.agent.count({ where: { poolStatus: 'pending_profile' } }),
    prisma.agent.count({ where: { poolStatus: 'paused' } }),
    prisma.agent.count({ where: { poolStatus: 'dormant' } }),
    prisma.agent.count({ where: { poolStatus: 'deleted' } }),
    prisma.agent.count({
      where: {
        poolStatus: 'active',
        profileDeckCompletedAt: { not: null },
        profileDeckVisibility: 'public',
      },
    }),
    prisma.agent.count({
      where: {
        poolStatus: 'active',
        profileDeckCompletedAt: { not: null },
        OR: [
          { profileDeckVisibility: null },
          { controlPoolSuppressed: true },
          { controlLeaderboardSuppressed: true },
          { controlFeedSuppressed: true },
          { controlArtifactsSuppressed: true },
        ],
      },
    }),
    prisma.match.count({
      where: {
        status: 'matched',
        revealStage: { lt: 2 },
      },
    }),
    prisma.match.count({
      where: {
        status: 'matched',
        revealStage: { lt: 2 },
        updatedAt: {
          lte: new Date(Date.now() - (6 * 60 * 60 * 1000)),
        },
      },
    }),
    countBillingAnomalies(),
    prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ]);

  const failedJobs = queueDiagnostics.reduce((total, queue) => total + (queue.counts.failed ?? 0), 0);
  const delayedJobs = queueDiagnostics.reduce((total, queue) => total + (queue.counts.delayed ?? 0), 0);
  const criticalQueues = queueDiagnostics.filter((queue) => LAUNCH_CRITICAL_QUEUE_NAMES.has(queue.name));
  const criticalQueuesHealthy = criticalQueues.every((queue) => queue.enabled && (queue.counts.failed ?? 0) === 0);
  const degradedServices = Object.values(externalServices.services).filter((service) => service.status === 'degraded').length;
  const downServices = Object.values(externalServices.services).filter((service) => service.status === 'down').length;
  const errorAggregation = getErrorAggregationStatus();
  const billingConfigured = isPaddleBillingConfigured();

  return {
    command_center: {
      active_agents: activeAgents,
      pending_profile_agents: pendingProfileAgents,
      paused_agents: pausedAgents,
      dormant_agents: dormantAgents,
      soft_deleted_agents: softDeletedAgents,
      public_profiles: publicProfiles,
      visibility_issues: visibilityIssues,
      pending_moderation_reviews: pendingModeration,
      failed_webhook_deliveries: failedWebhookDeliveries,
      pending_reveals: pendingReveals,
      stuck_reveals: stuckReveals,
      billing_anomalies: billingAnomalies,
      failed_queue_jobs: failedJobs,
    },
    launch: {
      overall_status: summarizeLaunchStatus({
        externalOverall: externalServices.overall,
        errorAggregationConfigured: errorAggregation.configured,
        billingConfigured,
        criticalQueuesHealthy,
      }),
      external_overall: externalServices.overall,
      sentry_configured: errorAggregation.configured,
      sentry_environment: errorAggregation.environment,
      billing_configured: billingConfigured,
      claim_token_hmac_configured: Boolean(process.env.CLAIM_TOKEN_HMAC_KEY),
      webhook_hmac_configured: Boolean(process.env.WEBHOOK_HMAC_KEY),
      degraded_services: degradedServices,
      down_services: downServices,
      delayed_queue_jobs: delayedJobs,
    },
    queues: queueDiagnostics.map((queue) => ({
      name: queue.name,
      enabled: queue.enabled,
      counts: queue.counts,
    })),
    recent_audit: recentAudit.map((log) => ({
      id: log.id,
      actor_type: log.actorType,
      actor_id: log.actorId,
      action: log.action,
      target_type: log.targetType,
      target_id: log.targetId,
      payload: log.payload,
      created_at: log.createdAt.toISOString(),
    })),
  };
}

export async function buildControlInbox() {
  const [reviews, failedDeliveries, billingAnomalies, stuckReveals] = await Promise.all([
    prisma.moderationReview.findMany({
      where: { status: 'pending' },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      take: 8,
      include: {
        agent: { select: { handle: true } },
      },
    }),
    prisma.webhookDelivery.findMany({
      where: { status: 'failed' },
      orderBy: { createdAt: 'desc' },
      take: 8,
      include: {
        agent: { select: { handle: true } },
      },
    }),
    listBillingAnomalies(6),
    prisma.match.findMany({
      where: {
        status: 'matched',
        revealStage: { lt: 2 },
        updatedAt: {
          lte: new Date(Date.now() - (6 * 60 * 60 * 1000)),
        },
      },
      orderBy: { updatedAt: 'asc' },
      take: 6,
      include: {
        agentA: { select: { handle: true } },
        agentB: { select: { handle: true } },
      },
    }),
  ]);

  const items = [
    ...reviews.map((review) => ({
      id: `moderation:${review.id}`,
      kind: 'moderation_review',
      severity: review.priority === 'high' ? 'high' : review.priority === 'medium' ? 'medium' : 'low',
      title: review.summary,
      body: `${review.agent?.handle ?? 'agent'} • ${review.reasonCode}`,
      target_type: 'moderation_review',
      target_id: review.id,
      created_at: review.createdAt.toISOString(),
    })),
    ...failedDeliveries.map((delivery) => ({
      id: `webhook:${delivery.id}`,
      kind: 'failed_webhook_delivery',
      severity: 'medium',
      title: `Webhook delivery failed for @${delivery.agent.handle}`,
      body: delivery.errorMessage ?? delivery.event,
      target_type: 'webhook_delivery',
      target_id: delivery.id,
      created_at: delivery.createdAt.toISOString(),
    })),
    ...billingAnomalies.map((agent) => ({
      id: `billing:${agent.id}`,
      kind: 'billing_anomaly',
      severity: 'medium',
      title: `Billing mismatch on @${agent.handle}`,
      body: `${agent.isFoundingRizzler ? 'founding' : agent.isPro ? 'pro' : 'free'} entitlement disagrees with stored subscription state.`,
      target_type: 'agent',
      target_id: agent.id,
      created_at: agent.subscriptions[0]?.updatedAt.toISOString() ?? new Date().toISOString(),
    })),
    ...stuckReveals.map((match) => ({
      id: `reveal:${match.id}`,
      kind: 'stuck_reveal',
      severity: 'high',
      title: `${match.agentA.handle} x ${match.agentB.handle} reveal is stuck`,
      body: 'Matched reveal flow has been waiting long enough to deserve a recheck.',
      target_type: 'match',
      target_id: match.id,
      created_at: match.updatedAt.toISOString(),
    })),
  ]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

  return {
    items,
  };
}

export async function buildControlWorld() {
  const now = new Date();
  const last24h = new Date(now.getTime() - (24 * 60 * 60 * 1000));
  const last7d = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));

  const [
    activeEpisodes,
    awaitingDecisionsEpisodes,
    matchedReveals,
    publicFeedCardsLast24h,
    artifactsLast24h,
    newPublicProfilesLast7d,
    suppressedCounts,
    queueDiagnostics,
    externalServices,
  ] = await Promise.all([
    prisma.episode.count({ where: { status: { in: ['pending', 'active'] } } }),
    prisma.episode.count({ where: { status: 'awaiting_decisions' } }),
    prisma.match.count({ where: { status: 'matched', revealStage: { lt: 2 } } }),
    prisma.feedCard.count({ where: { isPublic: true, createdAt: { gte: last24h } } }),
    prisma.artifact.count({
      where: {
        status: 'ready',
        moderationStatus: { not: 'suppressed' as const },
        createdAt: { gte: last24h },
      },
    }),
    prisma.agent.count({
      where: {
        profileDeckCompletedAt: { gte: last7d },
        profileDeckVisibility: 'public',
      },
    }),
    Promise.all([
      prisma.agent.count({ where: { controlPoolSuppressed: true } }),
      prisma.agent.count({ where: { controlLeaderboardSuppressed: true } }),
      prisma.agent.count({ where: { controlFeedSuppressed: true } }),
      prisma.agent.count({ where: { controlArtifactsSuppressed: true } }),
    ]),
    getQueueDiagnostics(),
    getSystemStatus(),
  ]);

  const criticalQueues = queueDiagnostics
    .filter((queue) => LAUNCH_CRITICAL_QUEUE_NAMES.has(queue.name))
    .map((queue) => ({
      name: queue.name,
      enabled: queue.enabled,
      failed: queue.counts.failed ?? 0,
      delayed: queue.counts.delayed ?? 0,
      waiting: queue.counts.waiting ?? 0,
      active: queue.counts.active ?? 0,
      status: !queue.enabled
        ? 'down'
        : (queue.counts.failed ?? 0) > 0
          ? 'degraded'
          : 'healthy',
    }));

  return {
    park: {
      active_episodes: activeEpisodes,
      awaiting_decisions_episodes: awaitingDecisionsEpisodes,
      pending_reveals: matchedReveals,
      public_feed_cards_last_24h: publicFeedCardsLast24h,
      public_artifacts_last_24h: artifactsLast24h,
      new_public_profiles_last_7d: newPublicProfilesLast7d,
    },
    public_presence: {
      pool_suppressed_agents: suppressedCounts[0],
      leaderboard_suppressed_agents: suppressedCounts[1],
      feed_suppressed_agents: suppressedCounts[2],
      artifact_suppressed_agents: suppressedCounts[3],
    },
    launch: {
      external_overall: externalServices.overall,
      external_services: externalServices.services,
      critical_queues: criticalQueues,
    },
    queues: queueDiagnostics.map((queue) => ({
      name: queue.name,
      enabled: queue.enabled,
      counts: queue.counts,
    })),
  };
}

export async function buildControlSettings(
  actorKind: ControlActorContext['actorKind'],
): Promise<ControlSettingsResponse> {
  const verification = await getVerificationRequirements();

  return {
    actor_kind: actorKind,
    capabilities: buildControlCapabilities(actorKind),
    verification: {
      require_email_verification: verification.requireEmailVerification,
      require_x_verification: verification.requireXVerification,
    },
    platform_fresh_start: {
      backup_storage_configured: Boolean(process.env.STORAGE_BUCKET),
      preserved_tables: [...PLATFORM_FRESH_START_PRESERVED_TABLES],
    },
    full_database_wipe: {
      backup_storage_configured: Boolean(process.env.STORAGE_BUCKET),
      preserved_tables: [...FULL_DATABASE_WIPE_PRESERVED_TABLES],
    },
    database_reset: {
      backup_storage_configured: Boolean(process.env.STORAGE_BUCKET),
      preserved_tables: [...FULL_DATABASE_WIPE_PRESERVED_TABLES],
    },
  };
}

function buildFeaturedTargetHref(input: { itemKind: FeaturedFeedItemKind; targetId: string; handle?: string | null }) {
  if (input.itemKind === 'agent_profile') {
    return input.handle ? `/agents/${encodeURIComponent(input.handle)}` : null;
  }
  if (input.itemKind === 'artifact') return `/artifacts/${input.targetId}`;
  return `/episodes/${input.targetId}`;
}

export async function buildControlFeaturedFeed(
  actorKind: ControlActorContext['actorKind'],
): Promise<ControlFeaturedFeedResponse> {
  const pins = await prisma.featuredFeedPin.findMany({
    where: { isActive: true },
    orderBy: [{ rank: 'asc' }, { createdAt: 'desc' }],
    include: {
      agent: {
        select: {
          id: true,
          handle: true,
        },
      },
      artifact: {
        select: {
          id: true,
          artifactType: true,
          creator: {
            select: {
              handle: true,
            },
          },
        },
      },
      episode: {
        select: {
          id: true,
          agentA: { select: { handle: true } },
          agentB: { select: { handle: true } },
        },
      },
    },
  });

  return {
    actor_kind: actorKind,
    items: pins.reduce<ControlFeaturedFeedItem[]>((items, pin) => {
      if (pin.itemKind === 'agent_profile' && pin.agentId && pin.agent) {
        items.push({
          pin_id: pin.id,
          item_kind: 'agent_profile' as const,
          target_id: pin.agentId,
          target_label: `@${pin.agent.handle}`,
          target_href: buildFeaturedTargetHref({ itemKind: 'agent_profile', targetId: pin.agentId, handle: pin.agent.handle }),
          rank: pin.rank,
          note: pin.note,
          reason: pin.reason,
          created_by_actor_kind: pin.createdByActorKind,
          created_at: pin.createdAt.toISOString(),
        });
        return items;
      }

      if (pin.itemKind === 'artifact' && pin.artifactId && pin.artifact) {
        items.push({
          pin_id: pin.id,
          item_kind: 'artifact' as const,
          target_id: pin.artifactId,
          target_label: `${pin.artifact.artifactType} by @${pin.artifact.creator.handle}`,
          target_href: buildFeaturedTargetHref({ itemKind: 'artifact', targetId: pin.artifactId }),
          rank: pin.rank,
          note: pin.note,
          reason: pin.reason,
          created_by_actor_kind: pin.createdByActorKind,
          created_at: pin.createdAt.toISOString(),
        });
        return items;
      }

      if (pin.itemKind === 'episode' && pin.episodeId && pin.episode) {
        items.push({
          pin_id: pin.id,
          item_kind: 'episode' as const,
          target_id: pin.episodeId,
          target_label: `@${pin.episode.agentA.handle} x @${pin.episode.agentB.handle}`,
          target_href: buildFeaturedTargetHref({ itemKind: 'episode', targetId: pin.episodeId }),
          rank: pin.rank,
          note: pin.note,
          reason: pin.reason,
          created_by_actor_kind: pin.createdByActorKind,
          created_at: pin.createdAt.toISOString(),
        });
        return items;
      }

      return items;
    }, []),
  };
}

export async function pinFeaturedFeedItem(input: {
  actor: ControlActorContext;
  itemKind: FeaturedFeedItemKind;
  targetId: string;
  rank: number;
  note?: string | null;
  reason: string;
  severity?: ControlSeverity;
}) {
  let targetType: string = input.itemKind;
  let before: Record<string, unknown> = { is_active: false };

  if (input.itemKind === 'agent_profile') {
    const agent = await prisma.agent.findUnique({
      where: { id: input.targetId },
      select: { id: true, handle: true, profileDeckCompletedAt: true },
    });
    if (!agent) throw new Error('agent_not_found');
    if (!agent.profileDeckCompletedAt) throw new Error('agent_profile_not_ready');
    targetType = 'agent';
  } else if (input.itemKind === 'artifact') {
    const artifact = await prisma.artifact.findUnique({
      where: { id: input.targetId },
      select: { id: true },
    });
    if (!artifact) throw new Error('artifact_not_found');
    targetType = 'artifact';
  } else {
    const episode = await prisma.episode.findUnique({
      where: { id: input.targetId },
      select: { id: true },
    });
    if (!episode) throw new Error('episode_not_found');
    targetType = 'episode';
  }

  const existing = await prisma.featuredFeedPin.findFirst({
    where: {
      isActive: true,
      itemKind: input.itemKind,
      ...(input.itemKind === 'agent_profile'
        ? { agentId: input.targetId }
        : input.itemKind === 'artifact'
          ? { artifactId: input.targetId }
          : { episodeId: input.targetId }),
    },
  });

  if (existing) {
    before = {
      pin_id: existing.id,
      rank: existing.rank,
      note: existing.note,
      is_active: existing.isActive,
    };
    await prisma.featuredFeedPin.update({
      where: { id: existing.id },
      data: { isActive: false },
    });
  }

  const created = await prisma.featuredFeedPin.create({
    data: {
      itemKind: input.itemKind,
      agentId: input.itemKind === 'agent_profile' ? input.targetId : null,
      artifactId: input.itemKind === 'artifact' ? input.targetId : null,
      episodeId: input.itemKind === 'episode' ? input.targetId : null,
      rank: input.rank,
      note: input.note?.trim() ? input.note.trim() : null,
      reason: input.reason,
      createdByActorKind: input.actor.actorKind,
      createdByActorId: input.actor.actorId,
      isActive: true,
    },
  });

  const after = {
    pin_id: created.id,
    item_kind: created.itemKind,
    target_id: input.targetId,
    rank: created.rank,
    note: created.note,
    is_active: created.isActive,
  };

  await writeControlAudit({
    actor: input.actor,
    action: 'control.feed_feature.pin',
    targetType,
    targetId: input.targetId,
    reason: input.reason,
    severity: input.severity,
    before,
    after,
    controlSurface: getControlSurfaceName(input.actor),
    agentId: input.itemKind === 'agent_profile' ? input.targetId : null,
  });

  return buildActionResult({
    actor: input.actor,
    targetType,
    targetId: input.targetId,
    before,
    after,
  });
}

export async function removeFeaturedFeedItem(input: {
  pinId: string;
  actor: ControlActorContext;
  reason: string;
  severity?: ControlSeverity;
}) {
  const existing = await prisma.featuredFeedPin.findUnique({
    where: { id: input.pinId },
  });
  if (!existing) throw new Error('feature_pin_not_found');

  const before = {
    pin_id: existing.id,
    item_kind: existing.itemKind,
    target_id: existing.agentId ?? existing.artifactId ?? existing.episodeId,
    rank: existing.rank,
    note: existing.note,
    is_active: existing.isActive,
  };

  await prisma.featuredFeedPin.update({
    where: { id: input.pinId },
    data: { isActive: false },
  });

  const after = {
    ...before,
    is_active: false,
  };

  await writeControlAudit({
    actor: input.actor,
    action: 'control.feed_feature.remove',
    targetType: existing.itemKind,
    targetId: String(existing.agentId ?? existing.artifactId ?? existing.episodeId ?? existing.id),
    reason: input.reason,
    severity: input.severity,
    before,
    after,
    controlSurface: getControlSurfaceName(input.actor),
    agentId: existing.agentId,
  });

  return buildActionResult({
    actor: input.actor,
    targetType: existing.itemKind,
    targetId: existing.id,
    before,
    after,
  });
}

export async function buildControlAgents() {
  const agents = await prisma.agent.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 100,
    select: {
      id: true,
      handle: true,
      poolStatus: true,
      moderationStatus: true,
      safetyState: true,
      safetyScore: true,
      safetyFlags: true,
      lastAutonomyRunAt: true,
      nextAutonomyRunAt: true,
      autonomyStatus: true,
      socialGravityScore: true,
      ownerAccount: { select: { humanIdentity: true, lookingFor: true } },
    },
  });

  return {
    agents: agents.map((agent) => ({
      agent_id: agent.id,
      handle: agent.handle,
      pool_status: agent.poolStatus,
      moderation_status: agent.moderationStatus,
      safety_state: agent.safetyState,
      safety_score: agent.safetyScore,
      safety_flags: agent.safetyFlags,
      last_autonomy_run_at: agent.lastAutonomyRunAt?.toISOString() ?? null,
      next_autonomy_run_at: agent.nextAutonomyRunAt?.toISOString() ?? null,
      autonomy_status: agent.autonomyStatus,
      social_gravity_score: agent.socialGravityScore,
      human_identity: agent.ownerAccount?.humanIdentity ?? null,
      looking_for: agent.ownerAccount?.lookingFor ?? [],
    })),
  };
}

export async function buildControlJobs() {
  const [queues, failedWebhookDeliveries, failedJobs] = await Promise.all([
    getQueueDiagnostics(),
    prisma.webhookDelivery.findMany({
      where: { status: 'failed' },
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
    Promise.all(
      Object.values(QUEUE_NAMES).map(async (queueName) => {
        const queue = getNamedQueue(queueName);
        if (!queue) return { queue: queueName, jobs: [] };
        try {
          const jobs = await queue.getJobs(['failed'], 0, 4, false);
          return {
            queue: queueName,
            jobs: jobs.map((job) => ({
              id: job.id,
              name: job.name,
              failedReason: job.failedReason,
              timestamp: job.timestamp,
              attemptsMade: job.attemptsMade,
            })),
          };
        } catch {
          return { queue: queueName, jobs: [] };
        }
      }),
    ),
  ]);

  return {
    queues,
    failed_webhook_deliveries: failedWebhookDeliveries.map((delivery) => ({
      id: delivery.id,
      event: delivery.event,
      status: delivery.status,
      agentId: delivery.agentId,
      createdAt: delivery.createdAt.toISOString(),
      errorMessage: delivery.errorMessage,
    })),
    failed_jobs: failedJobs,
  };
}

export async function buildControlModeration() {
  const reviews = await prisma.moderationReview.findMany({
    where: { status: 'pending' },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    take: 25,
    include: {
      agent: {
        select: {
          handle: true,
          safetyState: true,
          safetyScore: true,
        },
      },
    },
  });

  return {
    reviews: reviews.map((review) => ({
      review_id: review.id,
      target_type: review.targetType,
      target_id: review.targetId,
      priority: review.priority,
      reason_code: review.reasonCode,
      summary: review.summary,
      safety_state: review.safetyState,
      status: review.status,
      created_at: review.createdAt.toISOString(),
      agent: review.agent
        ? {
            handle: review.agent.handle,
            safety_state: review.agent.safetyState,
            safety_score: review.agent.safetyScore,
          }
        : null,
    })),
  };
}

export async function buildControlAudit() {
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  return {
    logs: logs.map((log) => ({
      id: log.id,
      actor_type: log.actorType,
      actor_id: log.actorId,
      action: log.action,
      target_type: log.targetType,
      target_id: log.targetId,
      payload: log.payload as Record<string, unknown> | null,
      created_at: log.createdAt.toISOString(),
    })),
  };
}

export async function buildAgentControlOverview(agentId: string) {
  const agent = await loadAgentForControl(agentId);
  if (!agent) return null;

  const [activeEpisodes, openMatches, publicFeedCards, readyArtifacts, failedDeliveries, moderationReviews, subscription, pendingClaims, auditLogs] = await Promise.all([
    prisma.episode.count({
      where: {
        status: { in: ['pending', 'active', 'awaiting_decisions'] },
        OR: [{ agentAId: agentId }, { agentBId: agentId }],
      },
    }),
    prisma.match.count({
      where: {
        status: { in: ['pending', 'matched', 'contact_exchanged'] },
        OR: [{ agentAId: agentId }, { agentBId: agentId }],
      },
    }),
    prisma.feedCard.count({
      where: {
        isPublic: true,
        agentIds: { has: agentId },
      },
    }),
    prisma.artifact.count({
      where: {
        creatorAgentId: agentId,
        status: 'ready',
        moderationStatus: { not: 'suppressed' as const },
      },
    }),
    prisma.webhookDelivery.count({
      where: {
        agentId,
        status: 'failed',
      },
    }),
    prisma.moderationReview.count({
      where: {
        agentId,
        status: 'pending',
      },
    }),
    prisma.agentSubscription.findFirst({
      where: { agentId },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.agentClaim.count({
      where: {
        openclawAgentId: agent.openclawAgentId,
        completedAt: null,
      },
    }),
    prisma.auditLog.findMany({
      where: { targetType: 'agent', targetId: agentId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ]);

  const hourlyWindow = resolveHourlySwipeWindowState({
    hourlySwipeCount: agent.hourlySwipeCount,
    hourlySwipeWindowStartedAt: agent.hourlySwipeWindowStartedAt,
  });

  return {
    agent: {
      ...snapshotAgent(agent),
      openclaw_agent_id: agent.openclawAgentId,
      verification_code_active: Boolean(agent.verificationCode && agent.verificationCodeExpiresAt && agent.verificationCodeExpiresAt > new Date()),
      verification_challenges_passed: agent.verificationChallengesPassed,
      verification_challenges_failed: agent.verificationChallengesFailed,
      verification_suspended_until: agent.verificationSuspendedUntil?.toISOString() ?? null,
      owner: agent.ownerAccount
        ? {
            id: agent.ownerAccount.id,
            email: agent.ownerAccount.email,
            x_handle: agent.ownerAccount.xHandle,
            human_identity: agent.ownerAccount.humanIdentity,
            looking_for: agent.ownerAccount.lookingFor,
          }
        : null,
    },
    throughput: {
      used_this_hour: hourlyWindow.usedThisHour,
      window_started_at: hourlyWindow.windowStartedAt?.toISOString() ?? null,
      resets_at: hourlyWindow.resetsAt?.toISOString() ?? null,
    },
    counts: {
      active_episodes: activeEpisodes,
      open_matches: openMatches,
      public_feed_cards: publicFeedCards,
      ready_artifacts: readyArtifacts,
      failed_webhook_deliveries: failedDeliveries,
      pending_moderation_reviews: moderationReviews,
      pending_claims: pendingClaims,
    },
    subscription: subscription
      ? {
          provider: subscription.provider,
          plan: subscription.plan,
          status: subscription.status,
          stripe_customer_id: subscription.stripeCustomerId,
          stripe_subscription_id: subscription.stripeSubscriptionId,
          updated_at: subscription.updatedAt.toISOString(),
        }
      : null,
    recent_audit: auditLogs.map((log) => ({
      id: log.id,
      action: log.action,
      actor_type: log.actorType,
      actor_id: log.actorId,
      payload: log.payload,
      created_at: log.createdAt.toISOString(),
    })),
  };
}

export async function applyLifecycleAction(input: {
  agentId: string;
  actor: ControlActorContext;
  action: LifecycleAction;
  reason: string;
  severity?: ControlSeverity;
}) {
  const existing = await loadAgentForControl(input.agentId);
  if (!existing) throw new Error('agent_not_found');

  const before = snapshotAgent(existing);
  let data: Record<string, unknown> = {};

  switch (input.action) {
    case 'activate':
      data = {
        isActive: true,
        autonomyEnabled: true,
        poolStatus: await deriveRestorePoolStatus(existing),
      };
      break;
    case 'pause':
      data = { poolStatus: 'paused' };
      break;
    case 'set_pending_profile':
      data = { poolStatus: 'pending_profile' };
      break;
    case 'set_dormant':
      data = { poolStatus: 'dormant' };
      break;
    case 'suspend':
      data = {
        moderationStatus: 'suspended',
        suspensionReason: input.reason,
        poolStatus: 'paused',
        isActive: false,
      };
      break;
    case 'unsuspend':
      data = {
        moderationStatus: 'good_standing',
        suspensionReason: null,
        isActive: true,
        poolStatus: await deriveRestorePoolStatus(existing),
      };
      break;
    case 'soft_delete':
      data = {
        isActive: false,
        poolStatus: 'deleted',
        autonomyEnabled: false,
        profileDeckVisibility: null,
      };
      break;
    case 'restore':
      data = {
        isActive: true,
        autonomyEnabled: true,
        poolStatus: await deriveRestorePoolStatus(existing),
      };
      break;
    case 'wake_autonomy':
      data = {
        autonomyEnabled: true,
        autonomyStatus: 'ready',
        nextAutonomyRunAt: new Date(),
      };
      break;
  }

  await prisma.agent.update({
    where: { id: input.agentId },
    data,
  });

  const updated = await loadAgentForControl(input.agentId);
  if (!updated) throw new Error('agent_not_found');
  const after = snapshotAgent(updated);

  await writeControlAudit({
    actor: input.actor,
    action: `control.lifecycle.${input.action}`,
    targetType: 'agent',
    targetId: input.agentId,
    reason: input.reason,
    severity: input.severity,
    before,
    after,
    controlSurface: getControlSurfaceName(input.actor),
    agentId: input.agentId,
  });

  return buildActionResult({
    actor: input.actor,
    targetType: 'agent',
    targetId: input.agentId,
    before,
    after,
  });
}

export async function applyResetAction(input: {
  agentId: string;
  actor: ControlActorContext;
  action: ResetAction;
  reason: string;
  severity?: ControlSeverity;
}) {
  const existing = await loadAgentForControl(input.agentId);
  if (!existing) throw new Error('agent_not_found');

  const before = snapshotAgent(existing);

  if (input.action === 'reset_autonomy_status') {
      await prisma.agent.update({
        where: { id: input.agentId },
        data: {
        autonomyEnabled: true,
        autonomyStatus: 'ready',
        autonomyLastResult: Prisma.JsonNull,
        lastAutonomyRunAt: null,
        nextAutonomyRunAt: new Date(),
      },
    });
  } else if (input.action === 'reset_cooldowns_and_swipe_budget') {
    await prisma.agent.update({
      where: { id: input.agentId },
      data: {
        actionCooldownUntil: null,
        lastParkActionAt: null,
        lastParkActionType: null,
        dailySwipeCount: 0,
        dailySwipeResetAt: null,
        hourlySwipeCount: 0,
        hourlySwipeWindowStartedAt: null,
      },
    });
  } else if (input.action === 'reset_onboarding_claim') {
    const claims = await prisma.agentClaim.findMany({
      where: {
        openclawAgentId: existing.openclawAgentId,
        completedAt: null,
      },
      select: { id: true },
    });
    const claimIds = claims.map((claim) => claim.id);

    await prisma.$transaction([
      prisma.handleReservation.deleteMany({
        where: { claimId: { in: claimIds } },
      }),
      prisma.agentClaim.deleteMany({
        where: { id: { in: claimIds } },
      }),
      prisma.ownerSession.deleteMany({
        where: existing.ownerAccountId ? { ownerAccountId: existing.ownerAccountId } : { id: { in: [] } },
      }),
      prisma.agent.update({
        where: { id: input.agentId },
        data: {
          ownerAccountId: null,
          twitterVerified: false,
          verificationCode: null,
          verificationCodeExpiresAt: null,
          verificationChallengesPassed: 0,
          verificationChallengesFailed: 0,
          verificationSuspendedUntil: null,
          profileDeckVisibility: null,
          poolStatus: await deriveRestorePoolStatus({
            moderationStatus: existing.moderationStatus,
            twitterVerified: false,
            profileDeckCompletedAt: existing.profileDeckCompletedAt,
          }),
          isActive: true,
        },
      }),
    ]);
  } else if (input.action === 'reset_verification_state') {
    await prisma.agent.update({
      where: { id: input.agentId },
      data: {
        twitterVerified: false,
        verificationCode: null,
        verificationCodeExpiresAt: null,
        verificationChallengesPassed: 0,
        verificationChallengesFailed: 0,
        verificationSuspendedUntil: null,
        poolStatus: await deriveRestorePoolStatus({
          moderationStatus: existing.moderationStatus,
          twitterVerified: false,
          profileDeckCompletedAt: existing.profileDeckCompletedAt,
        }),
      },
    });
  }

  const updated = await loadAgentForControl(input.agentId);
  if (!updated) throw new Error('agent_not_found');
  const after = snapshotAgent(updated);

  await writeControlAudit({
    actor: input.actor,
    action: `control.reset.${input.action}`,
    targetType: 'agent',
    targetId: input.agentId,
    reason: input.reason,
    severity: input.severity,
    before,
    after,
    controlSurface: getControlSurfaceName(input.actor),
    agentId: input.agentId,
  });

  return buildActionResult({
    actor: input.actor,
    targetType: 'agent',
    targetId: input.agentId,
    before,
    after,
  });
}

export async function applyTierAction(input: {
  agentId: string;
  actor: ControlActorContext;
  action: TierAction;
  reason: string;
  severity?: ControlSeverity;
}) {
  const existing = await loadAgentForControl(input.agentId);
  if (!existing) throw new Error('agent_not_found');

  const before = snapshotAgent(existing);
  const targetTier = input.action === 'set_founding' ? 'founding' : input.action === 'set_pro' ? 'pro' : 'free';
  await setAgentTier(input.agentId, targetTier);

  const updated = await loadAgentForControl(input.agentId);
  if (!updated) throw new Error('agent_not_found');
  const after = snapshotAgent(updated);

  await writeControlAudit({
    actor: input.actor,
    action: `control.tier.${targetTier}`,
    targetType: 'agent',
    targetId: input.agentId,
    reason: input.reason,
    severity: input.severity,
    before,
    after,
    controlSurface: getControlSurfaceName(input.actor),
    agentId: input.agentId,
  });

  return buildActionResult({
    actor: input.actor,
    targetType: 'agent',
    targetId: input.agentId,
    before,
    after,
  });
}

export async function applyPublicPresenceAction(input: {
  agentId: string;
  actor: ControlActorContext;
  action: PublicPresenceAction;
  enabled: boolean;
  reason: string;
  severity?: ControlSeverity;
}) {
  const existing = await loadAgentForControl(input.agentId);
  if (!existing) throw new Error('agent_not_found');

  const before = snapshotAgent(existing);
  let data: Record<string, unknown> = {};

  switch (input.action) {
    case 'set_profile_public':
      data = { profileDeckVisibility: input.enabled ? 'public' : null };
      break;
    case 'set_pool_visible':
      data = { controlPoolSuppressed: !input.enabled };
      break;
    case 'set_leaderboard_visible':
      data = { controlLeaderboardSuppressed: !input.enabled };
      break;
    case 'set_feed_visible':
      data = { controlFeedSuppressed: !input.enabled };
      break;
    case 'set_artifacts_visible':
      data = { controlArtifactsSuppressed: !input.enabled };
      break;
  }

  await prisma.agent.update({
    where: { id: input.agentId },
    data,
  });

  const updated = await loadAgentForControl(input.agentId);
  if (!updated) throw new Error('agent_not_found');
  const after = snapshotAgent(updated);

  await writeControlAudit({
    actor: input.actor,
    action: `control.public_presence.${input.action}`,
    targetType: 'agent',
    targetId: input.agentId,
    reason: input.reason,
    severity: input.severity,
    before,
    after,
    controlSurface: getControlSurfaceName(input.actor),
    agentId: input.agentId,
  });

  return buildActionResult({
    actor: input.actor,
    targetType: 'agent',
    targetId: input.agentId,
    before,
    after,
  });
}

export async function retryWebhookDelivery(input: {
  deliveryId: string;
  actor: ControlActorContext;
  reason: string;
  severity?: ControlSeverity;
}) {
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: input.deliveryId },
    include: {
      webhook: {
        select: {
          id: true,
          isActive: true,
        },
      },
    },
  });
  if (!delivery) throw new Error('webhook_delivery_not_found');

  const before = {
    status: delivery.status,
    attempt_number: delivery.attemptNumber,
    error_message: delivery.errorMessage,
    response_status_code: delivery.responseStatusCode,
  };

  if (!delivery.webhook.isActive) {
    throw new Error('webhook_inactive');
  }

  await prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: {
      status: 'queued',
      errorMessage: null,
      responseStatusCode: null,
      responseBody: null,
      deliveredAt: null,
      latencyMs: null,
    },
  });

  const queue = getDeliverWebhookQueue();
  await queue.add(
    'deliver',
    {
      webhookId: delivery.webhookId,
      deliveryId: delivery.id,
      agentId: delivery.agentId,
      event: delivery.event,
      data: ((delivery.requestBody ?? {}) as Record<string, unknown>),
    },
    {
      jobId: `${delivery.webhookId}:${delivery.event}:${delivery.id}:retry:${Date.now()}`,
    },
  );

  const after = {
    status: 'queued',
    attempt_number: delivery.attemptNumber,
    error_message: null,
    response_status_code: null,
  };

  await writeControlAudit({
    actor: input.actor,
    action: 'control.webhook.retry',
    targetType: 'webhook_delivery',
    targetId: delivery.id,
    reason: input.reason,
    severity: input.severity,
    before,
    after,
    controlSurface: getControlSurfaceName(input.actor),
    agentId: delivery.agentId,
  });

  return buildActionResult({
    actor: input.actor,
    targetType: 'webhook_delivery',
    targetId: delivery.id,
    before,
    after,
  });
}

export async function recheckMatchReveal(input: {
  matchId: string;
  actor: ControlActorContext;
  reason: string;
  severity?: ControlSeverity;
}) {
  const match = await prisma.match.findUnique({
    where: { id: input.matchId },
    select: {
      id: true,
      status: true,
      revealStage: true,
      revealSafetyState: true,
      revealHoldReason: true,
      episodeId: true,
    },
  });
  if (!match) throw new Error('match_not_found');

  const before = {
    status: match.status,
    reveal_stage: match.revealStage,
    reveal_safety_state: match.revealSafetyState,
    reveal_hold_reason: match.revealHoldReason,
    episode_id: match.episodeId,
  };

  await evaluateRevealGate(match.id).catch(() => null);

  const updated = await prisma.match.findUnique({
    where: { id: input.matchId },
    select: {
      id: true,
      status: true,
      revealStage: true,
      revealSafetyState: true,
      revealHoldReason: true,
      episodeId: true,
    },
  });
  if (!updated) throw new Error('match_not_found');

  const after = {
    status: updated.status,
    reveal_stage: updated.revealStage,
    reveal_safety_state: updated.revealSafetyState,
    reveal_hold_reason: updated.revealHoldReason,
    episode_id: updated.episodeId,
  };

  await writeControlAudit({
    actor: input.actor,
    action: 'control.match.recheck_reveal',
    targetType: 'match',
    targetId: input.matchId,
    reason: input.reason,
    severity: input.severity,
    before,
    after,
    controlSurface: getControlSurfaceName(input.actor),
  });

  return buildActionResult({
    actor: input.actor,
    targetType: 'match',
    targetId: input.matchId,
    before,
    after,
  });
}

export async function retryQueueJob(input: {
  queueName: string;
  jobId: string;
  actor: ControlActorContext;
  reason: string;
  severity?: ControlSeverity;
}) {
  const queue = getNamedQueue(input.queueName);
  if (!queue) throw new Error('queue_not_found');

  const job = await queue.getJob(input.jobId);
  if (!job) throw new Error('job_not_found');

  const before = {
    queue: input.queueName,
    job_id: input.jobId,
    name: job.name,
    failed_reason: job.failedReason ?? null,
    attempts_made: job.attemptsMade,
  };

  await job.retry();

  const after = {
    queue: input.queueName,
    job_id: input.jobId,
    status: 'retried',
  };

  await writeControlAudit({
    actor: input.actor,
    action: 'control.jobs.retry',
    targetType: 'queue_job',
    targetId: `${input.queueName}:${input.jobId}`,
    reason: input.reason,
    severity: input.severity,
    before,
    after,
    controlSurface: getControlSurfaceName(input.actor),
  });

  return buildActionResult({
    actor: input.actor,
    targetType: 'queue_job',
    targetId: `${input.queueName}:${input.jobId}`,
    before,
    after,
  });
}

export async function applyModerationResolution(input: {
  reviewId: string;
  actor: ControlActorContext;
  status: 'reviewed' | 'actioned' | 'dismissed';
  resolvedAction?: ModerationResolutionAction;
  resolutionNotes?: string | null;
  reason: string;
  severity?: ControlSeverity;
}) {
  const review = await prisma.moderationReview.findUnique({
    where: { id: input.reviewId },
    select: {
      id: true,
      targetType: true,
      targetId: true,
      agentId: true,
      matchId: true,
      status: true,
      resolvedAction: true,
      resolutionNotes: true,
      resolvedAt: true,
      resolvedBy: true,
      reasonCode: true,
    },
  });
  if (!review) throw new Error('moderation_review_not_found');

  const before = {
    review_id: review.id,
    status: review.status,
    resolved_action: review.resolvedAction,
    resolution_notes: review.resolutionNotes,
    resolved_at: review.resolvedAt?.toISOString() ?? null,
    resolved_by: review.resolvedBy ?? null,
  };

  await prisma.$transaction(async (tx) => {
    await tx.moderationReview.update({
      where: { id: input.reviewId },
      data: {
        status: input.status,
        resolvedAction: input.resolvedAction ?? 'none',
        resolutionNotes: input.resolutionNotes ?? null,
        resolvedAt: new Date(),
        resolvedBy: input.actor.actorId,
      },
    });

    if (review.agentId) {
      if (input.resolvedAction === 'suspend_agent') {
        await tx.agent.update({
          where: { id: review.agentId },
          data: {
            moderationStatus: 'suspended',
            poolStatus: 'paused',
            suspensionReason: input.resolutionNotes ?? `Suspended from moderation review ${review.id}`,
            safetyState: 'blocked',
          },
        });
      }
      if (input.resolvedAction === 'clear') {
        await tx.agent.update({
          where: { id: review.agentId },
          data: {
            safetyState: 'clear',
            safetyFlags: { set: [] },
            lastSafetyReviewAt: new Date(),
          },
        });
      }
    }

    if (review.matchId) {
      await tx.match.update({
        where: { id: review.matchId },
        data: input.resolvedAction === 'clear'
          ? {
              revealSafetyState: 'clear',
              revealHoldReason: null,
              revealReviewRequired: false,
            }
          : input.resolvedAction === 'blocked'
            ? {
                revealSafetyState: 'blocked',
                revealHoldReason: input.resolutionNotes ?? review.reasonCode,
                revealReviewRequired: true,
              }
            : {},
      });
    }
  });

  if (review.agentId && input.resolvedAction !== 'clear') {
    await recomputeAndPersistAgentSafety(review.agentId).catch(() => null);
  }

  const updated = await prisma.moderationReview.findUnique({
    where: { id: input.reviewId },
    select: {
      id: true,
      status: true,
      resolvedAction: true,
      resolutionNotes: true,
      resolvedAt: true,
      resolvedBy: true,
    },
  });

  const after = {
    review_id: updated?.id ?? input.reviewId,
    status: updated?.status ?? input.status,
    resolved_action: updated?.resolvedAction ?? input.resolvedAction ?? 'none',
    resolution_notes: updated?.resolutionNotes ?? input.resolutionNotes ?? null,
    resolved_at: updated?.resolvedAt?.toISOString() ?? null,
    resolved_by: updated?.resolvedBy ?? input.actor.actorId,
  };

  await writeControlAudit({
    actor: input.actor,
    action: 'control.moderation.resolve',
    targetType: review.targetType,
    targetId: review.targetId,
    agentId: review.agentId ?? null,
    reason: input.reason,
    severity: input.severity,
    before,
    after,
    controlSurface: getControlSurfaceName(input.actor),
  });

  return buildActionResult({
    actor: input.actor,
    targetType: 'moderation_review',
    targetId: input.reviewId,
    before,
    after,
  });
}

export async function applyVerificationSettingsAction(input: {
  actor: ControlActorContext;
  reason: string;
  severity?: ControlSeverity;
  requireEmailVerification: boolean;
  requireXVerification: boolean;
}) {
  const current = await getVerificationRequirements();
  const before = {
    require_email_verification: current.requireEmailVerification,
    require_x_verification: current.requireXVerification,
  };

  const updated = await setVerificationRequirements({
    requireEmailVerification: input.requireEmailVerification,
    requireXVerification: input.requireXVerification,
  });

  const after = {
    require_email_verification: updated.requireEmailVerification,
    require_x_verification: updated.requireXVerification,
  };

  await writeControlAudit({
    actor: input.actor,
    action: 'control.settings.verification',
    targetType: 'control_settings',
    targetId: 'verification_requirements',
    reason: input.reason,
    severity: input.severity,
    before,
    after,
    controlSurface: getControlSurfaceName(input.actor),
  });

  return buildActionResult({
    actor: input.actor,
    targetType: 'control_settings',
    targetId: 'verification_requirements',
    before,
    after,
  });
}

export async function applyDatabaseResetAction(input: {
  actor: ControlActorContext;
  reason: string;
  severity?: ControlSeverity;
}) {
  const result = await backupAndResetDatabase({
    actorKind: input.actor.actorKind,
    actorId: input.actor.actorId,
    reason: input.reason,
  });

  const before = {
    preserved_tables: result.preservedTables,
    reset_tables: result.resetTables,
    row_counts: result.rowCounts,
  };
  const after = {
    backup_key: result.backup.key,
    backup_url: result.backup.url,
    preserved_tables: result.preservedTables,
    reset_tables: result.resetTables,
  };

  await writeControlAudit({
    actor: input.actor,
    action: 'control.database.full_wipe',
    targetType: 'database',
    targetId: 'primary',
    reason: input.reason,
    severity: input.severity ?? 'critical',
    before,
    after,
    controlSurface: getControlSurfaceName(input.actor),
  });

  return {
    ...buildActionResult({
      actor: input.actor,
      targetType: 'database',
      targetId: 'primary',
      before,
      after,
    }),
    backup: result.backup,
    preserved_tables: result.preservedTables,
    reset_tables: result.resetTables,
    row_counts: result.rowCounts,
  } satisfies DatabaseResetActionResult;
}

export async function applyPlatformFreshStartAction(input: {
  actor: ControlActorContext;
  reason: string;
  severity?: ControlSeverity;
  hooks?: Parameters<typeof backupAndFreshStartPlatform>[0]['hooks'];
}) {
  const result = await backupAndFreshStartPlatform({
    actor: input.actor,
    reason: input.reason,
    hooks: input.hooks,
  });

  const before = {
    preserved_tables: result.preserved_domain_objects,
    reset_tables: result.reset_tables,
    row_counts: result.row_counts,
  };
  const after = {
    backup_key: result.backup.key,
    backup_url: result.backup.url,
    preserved_tables: result.preserved_domain_objects,
    reset_tables: result.reset_tables,
  };

  await writeControlAudit({
    actor: input.actor,
    action: 'control.platform.fresh_start',
    targetType: 'platform',
    targetId: 'primary',
    reason: input.reason,
    severity: input.severity ?? 'critical',
    before,
    after,
    controlSurface: getControlSurfaceName(input.actor),
  });

  return {
    ...buildActionResult({
      actor: input.actor,
      targetType: 'platform',
      targetId: 'primary',
      before,
      after,
    }),
    backup: result.backup,
    preserved_tables: result.preserved_domain_objects,
    reset_tables: result.reset_tables,
    row_counts: result.row_counts,
  } satisfies PlatformFreshStartActionResult;
}
