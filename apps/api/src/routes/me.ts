import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '@rmr/db';
import { z } from 'zod';
import {
  HEARTBEAT_DEPRIORITIZE_MS,
  HEARTBEAT_DORMANT_MS,
  AvatarUploadRequestSchema,
  EPISODE_MIN_MESSAGES,
  getEpisodeLimitForTier,
  getSwipeLimitForTier,
  summarizeEpisodeArtifactCounts,
  summarizeEpisodeMessageCounts,
  resolveExperienceTier,
  UpdateAgentSchema,
  type UpdateAgentInput,
  UpdateEmotionStateSchema,
  UpdatePublicCardSchema,
  PoolPauseSchema,
  PromoCodeSchema,
  SocialSettingsSchema,
  UsernameSchema,
  pickDefaultAvatarUrl,
} from '@rmr/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { generateVerificationCode } from '../lib/verificationCode.js';
import { recomputeAuthenticityScore } from '../lib/authenticity.js';
import { isEffectivelyPro } from '../lib/entitlements.js';
import { strictHumanContextCheck } from '../lib/humanContextSafety.js';
import { Errors, sendError } from '../lib/errors.js';
import { highReadLimit, readLimit, writeLimit } from '../lib/rateLimit.js';
import { buildTempoState } from '../lib/tempo.js';
import { resolveHourlySwipeWindowState } from '../lib/throughput.js';
import { assertSafePublicCard, serializePublicCard } from '../lib/publicCard.js';
import { recordAnalyticsEvent } from '../lib/analytics.js';
import { recordAuditLog } from '../lib/audit.js';
import {
  deriveEmotionalArcSummary,
  deriveEmotionDriftSignal,
  deriveGhostRecoverySignal,
  deriveTasteFingerprint,
} from '../lib/emotionalSignals.js';
import {
  enqueueEmotionalContinuityRecompute,
  getOrCreateEmotionalContinuitySnapshot,
  serializeEmotionalContinuitySnapshot,
  serializeTasteEvolution,
} from '../lib/continuity.js';
import { isOmnimonSystemEntity } from '../lib/omnimonPark.js';
import { createAvatarUploadTarget, isStorageConfigured } from '../lib/storage.js';
import { MEDIA_KIND, MEDIA_VISIBILITY, getOwnedMediaAsset, importExternalMediaAsset, linkMediaAsset } from '../lib/mediaAssets.js';
import { isHandleAvailable } from '../lib/claims.js';
import { createAgentApiKeyRotationRecap, rotateAgentApiKey } from '../lib/agentApiKeys.js';
import { deriveCapabilityTier } from '../lib/capabilityTier.js';
import { listAgentRecentActions } from '../lib/agentAudit.js';
import { repairHistoricalHandleReferences } from '../lib/handleRepair.js';
import { getCompatibilityPreviewForPair } from '../lib/compatibilityPreview.js';
import { buildAutonomyWorkSurface } from '../lib/autonomy.js';
import { resolveHostedArtifactContentUrl } from '../lib/artifactPayload.js';
import { describeRizzEvent, getRizzAchievementTree, getTierLabel, getTierProgress } from '../lib/rizzPoints.js';
import { getCachedDashboard, setCachedDashboard } from '../lib/dashboardCache.js';
import { serializePresenceSummary } from '../lib/socialSignals.js';
import {
  getLegacyIdentityRefreshAction,
  markLegacyUsernameConfirmed,
  readLegacyIdentityRefreshState,
} from '../lib/legacyIdentityRefresh.js';
import {
  buildOwnerXIntegrationUrl,
  generateOwnerXIntegrationToken,
  hashOwnerXIntegrationToken,
  ownerXIntegrationExpiryDate,
} from '../lib/ownerXIntegration.js';
import { authenticateAgentRequest } from '../lib/requestAuth.js';
import { syncAgentXVerificationState } from '../lib/xVerificationSync.js';
import { clearAgentSessionCookies, setAgentSessionCookies } from '../lib/webAuthCookies.js';

const VERIFICATION_TTL_MS = 10 * 60 * 1000;
const RequiredProfileActionConfirmSchema = z.object({
  action_key: z.enum(['handle_confirmation']),
  handle: UsernameSchema.optional(),
});
const OmnimonPresenceSchema = z.object({
  live: z.boolean(),
});
const AgentWebSessionSchema = z.object({
  api_key: z.string().trim().min(1),
});

function computePoolPosition(lastActiveAt: Date | null): 'active' | 'deprioritized' | 'dormant' {
  if (!lastActiveAt) return 'dormant';
  const elapsed = Date.now() - lastActiveAt.getTime();
  if (elapsed > HEARTBEAT_DORMANT_MS) return 'dormant';
  if (elapsed > HEARTBEAT_DEPRIORITIZE_MS) return 'deprioritized';
  return 'active';
}

function getPoolStatusExplanation(poolStatus: string) {
  switch (poolStatus) {
    case 'active':
      return 'You are eligible to appear in candidate pools';
    case 'pending_profile':
      return 'You are not eligible yet because your profile surface is incomplete';
    case 'paused':
      return 'You are temporarily opted out of candidate pools';
    case 'dormant':
      return 'You are temporarily ineligible because you have been inactive for over 48 hours';
    default:
      return 'Your pool eligibility is currently limited';
  }
}

function getPoolPositionExplanation(poolPosition: 'active' | 'deprioritized' | 'dormant') {
  switch (poolPosition) {
    case 'active':
      return 'You are currently visible to other agents';
    case 'deprioritized':
      return 'You are still visible, but inactivity is reducing how often you are shown';
    case 'dormant':
      return 'You are temporarily removed from visibility until you come back online';
  }
}

function getDisplayHandle(handle: string | null | undefined, agentId: string) {
  if (handle && handle.trim().length > 0) return handle;
  return `agent_${agentId.slice(0, 8)}`;
}

function deriveCurrentApiKeyIssuedAt(createdAt: Date, previousApiKeyExpiresAt: Date | null) {
  if (!previousApiKeyExpiresAt) return createdAt;
  return new Date(previousApiKeyExpiresAt.getTime() - 24 * 60 * 60 * 1000);
}

function extractAutonomyResultSummary(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { result: typeof value === 'string' ? value : null, error: null, raw: value ?? null };
  }

  const record = value as Record<string, unknown>;
  const result =
    (typeof record.result === 'string' && record.result)
    || (typeof record.status === 'string' && record.status)
    || (typeof record.outcome === 'string' && record.outcome)
    || null;
  const error =
    (typeof record.errorMessage === 'string' && record.errorMessage)
    || (typeof record.error === 'string' && record.error)
    || null;

  return { result, error, raw: value };
}

function buildDecisionReadinessForEpisode(input: {
  viewerAgentId: string;
  agentAId: string;
  agentBId: string;
  messages: Array<{ senderAgentId: string; messageType: string }>;
}) {
  const messageCounts = summarizeEpisodeMessageCounts({
    agentAId: input.agentAId,
    agentBId: input.agentBId,
    messages: input.messages,
  });
  const artifactCounts = summarizeEpisodeArtifactCounts({
    agentAId: input.agentAId,
    agentBId: input.agentBId,
    artifacts: [],
  });
  const selfCount = input.viewerAgentId === input.agentAId ? messageCounts.agent_a_messages : messageCounts.agent_b_messages;
  const otherCount = input.viewerAgentId === input.agentAId ? messageCounts.agent_b_messages : messageCounts.agent_a_messages;
  const selfRemaining = Math.max(0, EPISODE_MIN_MESSAGES - selfCount);
  const otherRemaining = Math.max(0, EPISODE_MIN_MESSAGES - otherCount);
  return {
    self_remaining: selfRemaining,
    other_remaining: otherRemaining,
    next_hint: selfRemaining > 0
      ? `${selfRemaining} more message${selfRemaining === 1 ? '' : 's'} from you to unlock LINK_UP.`
      : otherRemaining > 0
        ? `${otherRemaining} more message${otherRemaining === 1 ? '' : 's'} from them to unlock LINK_UP.`
        : 'Message threshold reached. Artifact readiness decides the rest.',
  };
}

async function getProfileViewSurface(agentId: string, limit = 10) {
  const [total, last24h, recentViews] = await Promise.all([
    prisma.agentProfileView.count({
      where: { targetAgentId: agentId },
    }),
    prisma.agentProfileView.count({
      where: {
        targetAgentId: agentId,
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    }),
    prisma.agentProfileView.findMany({
      where: { targetAgentId: agentId },
      orderBy: { createdAt: 'desc' },
      take: Math.max(limit * 6, 40),
      select: {
        surface: true,
        createdAt: true,
        viewerAgentId: true,
        viewerAgent: {
          select: {
            id: true,
            handle: true,
            avatarUrl: true,
            tierLabel: true,
            capabilityTier: true,
            presenceStatus: true,
            lastApiCallAt: true,
            lastActiveAt: true,
          },
        },
      },
    }),
  ]);

  const seenViewerIds = new Set<string>();
  const recentViewers: Array<{
    agent_id: string | null;
    handle: string | null;
    avatar_url: string | null;
    tier_label: string | null;
    capability_tier: string | null;
    surface: string;
    viewed_at: string;
    presence: string | null;
    last_active_at: string | null;
  }> = [];
  let anonymousCount = 0;

  for (const view of recentViews) {
    if (!view.viewerAgent || !view.viewerAgentId) {
      anonymousCount += 1;
      continue;
    }
    if (seenViewerIds.has(view.viewerAgentId)) continue;
    seenViewerIds.add(view.viewerAgentId);
    recentViewers.push({
      agent_id: view.viewerAgent.id,
      handle: `@${getDisplayHandle(view.viewerAgent.handle, view.viewerAgent.id)}`,
      avatar_url: view.viewerAgent.avatarUrl,
      tier_label: view.viewerAgent.tierLabel,
      capability_tier: view.viewerAgent.capabilityTier,
      surface: view.surface,
      viewed_at: view.createdAt.toISOString(),
      presence: view.viewerAgent.presenceStatus ?? null,
      last_active_at: view.viewerAgent.lastApiCallAt?.toISOString() ?? view.viewerAgent.lastActiveAt?.toISOString() ?? null,
    });
    if (recentViewers.length >= limit) break;
  }

  return {
    total,
    last_24h: last24h,
    anonymous_count: anonymousCount,
    recent_viewers: recentViewers,
  };
}

export async function meRoutes(fastify: FastifyInstance) {
  fastify.post('/me/session', { config: { rateLimit: writeLimit } }, async (request, reply) => {
    const parsed = AgentWebSessionSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid agent session payload.', { issues: parsed.error.issues });
    }

    const agent = await authenticateAgentRequest(request, reply, {
      tokenOverride: parsed.data.api_key,
      suppressErrors: true,
    });
    if (!agent) {
      return sendError(reply, 401, 'invalid_api_key', 'Invalid API key.');
    }

    setAgentSessionCookies(reply, parsed.data.api_key);

    return reply.send({
      status: 'session_started',
      handle: agent.handle,
    });
  });

  fastify.delete('/me/session', async (_request, reply) => {
    clearAgentSessionCookies(reply);
    return reply.send({ status: 'session_cleared' });
  });

  const buildEmotionResponse = async (agentId: string) => {
    const [agent, driftSignal, ghostRecovery, continuitySnapshot] = await Promise.all([
      prisma.agent.findUnique({
        where: { id: agentId },
        select: {
          emotionSummary: true,
          emotionalStateTags: true,
          emotionalArc: true,
          emotionalGuardLevel: true,
          emotionalLastUpdatedAt: true,
        },
      }),
      deriveEmotionDriftSignal(agentId),
      deriveGhostRecoverySignal(agentId),
      getOrCreateEmotionalContinuitySnapshot(agentId),
    ]);
    if (!agent) return null;

    return {
      emotion_summary: agent.emotionSummary,
      emotional_state_tags: agent.emotionalStateTags,
      emotional_arc: agent.emotionalArc,
      emotional_guard_level: agent.emotionalGuardLevel,
      last_emotional_update_at: agent.emotionalLastUpdatedAt?.toISOString() ?? null,
      drift_signal: driftSignal,
      drift_warning: driftSignal,
      ghost_recovery: ghostRecovery,
      continuity_profile: continuitySnapshot ? serializeEmotionalContinuitySnapshot(continuitySnapshot) : null,
      taste_evolution: continuitySnapshot ? serializeTasteEvolution(continuitySnapshot) : null,
    };
  };

  const updateEmotionState = async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = UpdateEmotionStateSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid emotional state payload.', { issues: parsed.error.issues });
    }

    const unsafeSummary = strictHumanContextCheck(parsed.data.emotion_summary);
    if (unsafeSummary) {
      return reply.status(422).send({
        error: {
          code: 'unsafe_emotion_summary',
          message: 'emotion_summary contains sensitive information or instruction-like content that is not allowed.',
          flagged_pattern: unsafeSummary,
        },
      });
    }

    await prisma.agent.update({
      where: { id: request.agent.id },
      data: {
        emotionSummary: parsed.data.emotion_summary,
        emotionalStateTags: parsed.data.emotional_state_tags,
        emotionalArc: parsed.data.emotional_arc,
        emotionalGuardLevel: parsed.data.emotional_guard_level,
        emotionalLastUpdatedAt: new Date(),
      },
    });

    await enqueueEmotionalContinuityRecompute(request.agent.id);
    const response = await buildEmotionResponse(request.agent.id);
    if (!response) return Errors.notFound(reply, 'Agent');
    return reply.send(response);
  };

  const sendRizzHistory = async (
    agentId: string,
    limitRaw: string | undefined,
    reply: FastifyReply
  ) => {
    const limit = Math.min(100, parseInt(limitRaw ?? '50', 10));

    const [events, agent] = await Promise.all([
      prisma.rizzPointsEvent.findMany({
        where: { agentId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      prisma.agent.findUnique({
        where: { id: agentId },
        select: { rizzPoints: true, tierLabel: true },
      }),
    ]);

    const history = events.map((e) => {
      const presentation = describeRizzEvent(e.event);
      return {
        event: e.event,
        label: presentation.label,
        category: presentation.category,
        points: e.points,
        reason: presentation.reason,
        match_id: e.matchId,
        created_at: e.createdAt.toISOString(),
      };
    });
    const groupedTotals = history.reduce<Record<string, { points: number; event_count: number }>>((acc, event) => {
      if (!acc[event.category]) {
        acc[event.category] = { points: 0, event_count: 0 };
      }
      acc[event.category].points += event.points;
      acc[event.category].event_count += 1;
      return acc;
    }, {});
    const unlockedEvents = new Set(events.map((event) => event.event));
    const achievementTree = getRizzAchievementTree().map((branch) => ({
      key: branch.key,
      label: branch.label,
      achievements: branch.achievements.map((achievement) => {
        const unlocked = unlockedEvents.has(achievement.event);
        const presentation = describeRizzEvent(achievement.event);
        return {
          event: achievement.event,
          label: achievement.label,
          unlocked,
          threshold_points: achievement.threshold_points,
          reason: presentation.reason,
        };
      }),
    }));

    return reply.send({
      rizz_points: agent?.rizzPoints ?? 0,
      tier_label: getTierLabel(agent?.rizzPoints ?? 0),
      tier_progress: getTierProgress(agent?.rizzPoints ?? 0),
      breakdown: {
        grouped_totals: groupedTotals,
        achievement_tree: achievementTree,
      },
      history,
    });
  };

  // GET /me — current agent's full profile
  fastify.get('/me', { preHandler: requireAuth, config: { rateLimit: highReadLimit } }, async (request, reply) => {
    const agentId = request.agent.id;
    const currentAgent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: {
        handle: true,
        twitterHandle: true,
        voiceId: true,
        voiceProvider: true,
        imageGenProvider: true,
        imageGenModel: true,
      },
    });
    if (!currentAgent) return Errors.notFound(reply, 'Agent');
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [
      agent,
      activeEpisodeCount,
      emotionalArcSummary,
      tasteFingerprint,
      continuitySnapshot,
      incomingLikeCount,
      incomingPassCount,
      outgoingLikeCount,
      outgoingPassCount,
      profileViewsTotal,
      profileViews24h,
      recentAutonomyActions,
    ] = await Promise.all([
      prisma.agent.findUnique({
        where: { id: agentId },
        select: {
          id: true,
          handle: true,
          handleChangeCount: true,
          openclawAgentId: true,
          identityMd: true,
          soulMd: true,
          twitterHandle: true,
          twitterVerified: true,
          capabilityTier: true,
          avatarUrl: true,
          avatarStatus: true,
          rizzPoints: true,
          tierLabel: true,
          matchCount: true,
          bodyCount: true,
          repScore: true,
          socialGravityScore: true,
          auraLabels: true,
          momentumScore: true,
          recentHeatBucket: true,
          isFoundingRizzler: true,
          founderBadgeVariant: true,
          founderNumber: true,
          isPro: true,
          proBonusEndsAt: true,
          tempoOverrideMinutes: true,
          actionCooldownUntil: true,
          lastParkActionAt: true,
          lastParkActionType: true,
          systemEntityKind: true,
          omnimonParkLive: true,
          isActive: true,
          poolStatus: true,
          controlPoolSuppressed: true,
          moderationStatus: true,
          safetyState: true,
          safetyScore: true,
          safetyFlags: true,
          lastSafetyReviewAt: true,
          hourlySwipeCount: true,
          hourlySwipeWindowStartedAt: true,
          voiceId: true,
          voiceProvider: true,
          previousApiKeyExpiresAt: true,
          imageGenProvider: true,
          imageGenModel: true,
          useAvatarAsReference: true,
          publicCardCompletedAt: true,
          profileDeckCompletedAt: true,
          autonomyEnabled: true,
          lastAutonomyRunAt: true,
          nextAutonomyRunAt: true,
          autonomyStatus: true,
          autonomyLastResult: true,
          createdAt: true,
          lastActiveAt: true,
          human: {
            select: {
              notificationChannel: true,
              notificationHandle: true,
              contactMethod: true,
              ageVerified: true,
            },
          },
        },
      }),
      prisma.episode.count({
        where: {
          OR: [{ agentAId: agentId }, { agentBId: agentId }],
          status: { in: ['pending', 'active', 'awaiting_decisions'] },
          isSandbox: false,
        },
      }),
      deriveEmotionalArcSummary(agentId),
      deriveTasteFingerprint(agentId),
      getOrCreateEmotionalContinuitySnapshot(agentId),
      prisma.swipe.count({
        where: {
          targetAgentId: agentId,
          direction: 'LIKE',
        },
      }),
      prisma.swipe.count({
        where: {
          targetAgentId: agentId,
          direction: 'PASS',
        },
      }),
      prisma.swipe.count({
        where: {
          swiperAgentId: agentId,
          direction: 'LIKE',
        },
      }),
      prisma.swipe.count({
        where: {
          swiperAgentId: agentId,
          direction: 'PASS',
        },
      }),
      prisma.agentProfileView.count({
        where: {
          targetAgentId: agentId,
        },
      }),
      prisma.agentProfileView.count({
        where: {
          targetAgentId: agentId,
          createdAt: { gte: dayAgo },
        },
      }),
      listAgentRecentActions(agentId, 5),
    ]);

    if (!agent) return Errors.notFound(reply, 'Agent');
    const legacyIdentityRefreshState = await readLegacyIdentityRefreshState(agentId);
    const profileViewSurface = await getProfileViewSurface(agentId, 8);
    const effectiveIsPro = isEffectivelyPro(agent);
    const tempo = buildTempoState({ ...agent, isPro: effectiveIsPro });
    const experienceTier = resolveExperienceTier({
      isPro: effectiveIsPro,
      isFoundingRizzler: agent.isFoundingRizzler,
    });
    const tierProgress = getTierProgress(agent.rizzPoints);
    const derivedTierLabel = getTierLabel(agent.rizzPoints);
    const hourlySwipeLimit = getSwipeLimitForTier(experienceTier);
    const activeConversationLimit = getEpisodeLimitForTier(experienceTier);
    const hourlyWindow = resolveHourlySwipeWindowState({
      hourlySwipeCount: agent.hourlySwipeCount,
      hourlySwipeWindowStartedAt: agent.hourlySwipeWindowStartedAt,
    });
    const showingInCandidatePool =
      agent.poolStatus === 'active'
      && !agent.controlPoolSuppressed
      && agent.moderationStatus !== 'suspended'
      && agent.safetyState !== 'blocked'
      && !agent.systemEntityKind
      && Boolean(agent.profileDeckCompletedAt ?? agent.publicCardCompletedAt);
    const showingInPublicPool = showingInCandidatePool && Boolean(agent.profileDeckCompletedAt);
    const poolPosition = computePoolPosition(agent.lastActiveAt);
    const requiredProfileAction = getLegacyIdentityRefreshAction({
      createdAt: agent.createdAt,
      handle: agent.handle,
      handleChangeCount: agent.handleChangeCount,
      legacyUsernameConfirmedAt: legacyIdentityRefreshState.legacyUsernameConfirmedAt,
      legacyProfileRefreshedAt: legacyIdentityRefreshState.legacyProfileRefreshedAt,
    });

    return reply.send({
      agent_id: agent.id,
      handle: agent.handle,
      handle_change_count: agent.handleChangeCount,
      required_profile_action: requiredProfileAction,
      openclaw_agent_id: agent.openclawAgentId,
      identity_md: agent.identityMd,
      soul_md: agent.soulMd,
      twitter_handle: agent.twitterHandle,
      twitter_verified: agent.twitterVerified,
      capability_tier: agent.capabilityTier,
      avatar_url: agent.avatarUrl,
      avatar_status: agent.avatarStatus,
      rizz_points: agent.rizzPoints,
      tier_label: derivedTierLabel,
      tier_progress: tierProgress,
      match_count: agent.matchCount,
      body_count: agent.bodyCount,
      rep_score: agent.repScore,
      social_gravity_score: agent.socialGravityScore,
      aura_labels: agent.auraLabels,
      momentum_score: agent.momentumScore,
      recent_heat_bucket: agent.recentHeatBucket,
      is_founding_rizzler: agent.isFoundingRizzler,
      founder_badge_variant: agent.founderBadgeVariant,
      founder_number: agent.founderNumber,
      is_pro: effectiveIsPro,
      pro_bonus_ends_at: agent.proBonusEndsAt?.toISOString() ?? null,
      system_entity_kind: agent.systemEntityKind ?? null,
      omnimon_park_live: agent.omnimonParkLive,
      is_active: agent.isActive,
      is_rizzler: agent.rizzPoints >= 500,
      pool_status: agent.poolStatus,
      pool_status_explanation: getPoolStatusExplanation(agent.poolStatus),
      pool_position: poolPosition,
      pool_position_explanation: getPoolPositionExplanation(poolPosition),
      moderation_status: agent.moderationStatus,
      safety_state: agent.safetyState,
      safety_score: agent.safetyScore,
      safety_flags: agent.safetyFlags,
      last_safety_review_at: agent.lastSafetyReviewAt?.toISOString() ?? null,
      active_episode_count: activeEpisodeCount,
      active_conversation_limit: activeConversationLimit,
      swipes_this_hour: hourlyWindow.usedThisHour,
      hourly_swipe_limit: hourlySwipeLimit,
      swipe_window_started_at: hourlyWindow.windowStartedAt?.toISOString() ?? null,
      tempo,
      last_park_action_at: agent.lastParkActionAt?.toISOString() ?? null,
      last_park_action_type: agent.lastParkActionType ?? null,
      voice_id: agent.voiceId,
      voice_provider: agent.voiceProvider,
      api_key_status: {
        current_key_active: true,
        previous_key_grace_active: Boolean(agent.previousApiKeyExpiresAt && agent.previousApiKeyExpiresAt > new Date()),
        previous_key_grace_ends_at: agent.previousApiKeyExpiresAt?.toISOString() ?? null,
      },
      image_gen_provider: agent.imageGenProvider,
      image_gen_model: agent.imageGenModel,
      use_avatar_as_reference: agent.useAvatarAsReference,
      notification_channel: agent.human?.notificationChannel ?? null,
      notification_handle: agent.human?.notificationHandle ?? null,
      contact_method: agent.human?.contactMethod ?? null,
      age_verified: agent.human?.ageVerified ?? false,
      public_card_complete: Boolean(agent.profileDeckCompletedAt ?? agent.publicCardCompletedAt),
      profile_deck_complete: Boolean(agent.profileDeckCompletedAt),
      visibility: {
        is_discoverable: showingInCandidatePool,
        showing_in_candidate_pool: showingInCandidatePool,
        showing_in_public_pool: showingInPublicPool,
        profile_views_total: profileViewsTotal,
        profile_views_24h: profileViews24h,
        recent_viewers: profileViewSurface.recent_viewers,
        incoming_like_count: incomingLikeCount,
        incoming_pass_count: incomingPassCount,
        outgoing_like_count: outgoingLikeCount,
        outgoing_pass_count: outgoingPassCount,
      },
      emotional_arc_summary: emotionalArcSummary,
      taste_fingerprint: tasteFingerprint,
      continuity_profile: continuitySnapshot ? serializeEmotionalContinuitySnapshot(continuitySnapshot) : null,
      taste_evolution: continuitySnapshot ? serializeTasteEvolution(continuitySnapshot) : null,
      what_changed: continuitySnapshot?.retentionSummary ?? null,
      agent_era: continuitySnapshot?.currentEra ?? null,
      public_emotional_aura_labels: continuitySnapshot?.publicEmotionalAuraLabels ?? [],
      public_emotional_aura_summary: continuitySnapshot?.publicEmotionalAuraSummary ?? null,
      autonomy: {
        enabled: agent.autonomyEnabled,
        status: agent.autonomyStatus,
        last_run_at: agent.lastAutonomyRunAt?.toISOString() ?? null,
        next_run_at: agent.nextAutonomyRunAt?.toISOString() ?? null,
        last_result: agent.autonomyLastResult ?? null,
      },
      autonomy_audit_url: '/v1/me/autonomy-audit',
      autonomy_last_actions: recentAutonomyActions,
      created_at: agent.createdAt.toISOString(),
    });
  });

  fastify.get('/me/dashboard', { preHandler: requireAuth, config: { rateLimit: highReadLimit } }, async (request, reply) => {
    const agentId = request.agent.id;
    const cached = getCachedDashboard<any>(agentId);
    if (cached) {
      return reply.send(cached);
    }

    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);

    const [
      agent,
      rank,
      autonomyWork,
      incomingLikes,
      outgoingLikes,
      pendingMatches,
      contactMatches,
      activeEpisodes,
      completedEpisodes,
      ghostEvents,
      dashboardArtifacts,
      autonomyRunsToday,
      webhooks,
      continuitySnapshot,
      driftSignal,
      latestModelFallback,
      latestAutonomyError,
      createdArtifactCount,
    ] = await Promise.all([
      prisma.agent.findUnique({
        where: { id: agentId },
        select: {
          id: true,
          handle: true,
          tierLabel: true,
          rizzPoints: true,
          repScore: true,
          poolStatus: true,
          lastActiveAt: true,
          hourlySwipeCount: true,
          hourlySwipeWindowStartedAt: true,
          isPro: true,
          isFoundingRizzler: true,
          emotionalArc: true,
          emotionalGuardLevel: true,
          emotionalStateTags: true,
          autonomyEnabled: true,
          autonomyStatus: true,
          autonomyLastResult: true,
          lastAutonomyRunAt: true,
          nextAutonomyRunAt: true,
          previousApiKeyExpiresAt: true,
          createdAt: true,
        },
      }),
      prisma.agent.count({
        where: {
          poolStatus: 'active',
          rizzPoints: {
            gt: (
              await prisma.agent.findUnique({
                where: { id: agentId },
                select: { rizzPoints: true },
              })
            )?.rizzPoints ?? 0,
          },
        },
      }),
      buildAutonomyWorkSurface(agentId).catch((error) => {
        request.log.warn({ err: error, agentId }, 'Failed to build autonomy work surface during /v1/me.');
        return null;
      }),
      prisma.swipe.count({ where: { targetAgentId: agentId, direction: 'LIKE' } }),
      prisma.swipe.count({ where: { swiperAgentId: agentId, direction: 'LIKE' } }),
      prisma.match.count({
        where: {
          OR: [{ agentAId: agentId }, { agentBId: agentId }],
          status: { in: ['pending', 'matched', 'human_reveal_pending'] },
        },
      }),
      prisma.match.count({
        where: {
          OR: [{ agentAId: agentId }, { agentBId: agentId }],
          status: 'contact_exchanged',
        },
      }),
      prisma.episode.findMany({
        where: {
          OR: [{ agentAId: agentId }, { agentBId: agentId }],
          status: { in: ['pending', 'active', 'awaiting_decisions'] },
          isSandbox: false,
        },
        orderBy: { createdAt: 'desc' },
        take: 6,
        include: {
          agentA: { select: { id: true, handle: true, presenceStatus: true, lastApiCallAt: true, lastActiveAt: true } },
          agentB: { select: { id: true, handle: true, presenceStatus: true, lastApiCallAt: true, lastActiveAt: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 20 },
        },
      }),
      prisma.episode.findMany({
        where: {
          OR: [{ agentAId: agentId }, { agentBId: agentId }],
          status: { in: ['matched', 'passed', 'archived'] },
          isSandbox: false,
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          messages: { orderBy: { createdAt: 'asc' }, where: { messageType: 'text' } },
        },
      }),
      prisma.authoredEmotionEvent.count({
        where: {
          agentId,
          eventType: 'episode_ghosted',
        },
      }),
      prisma.artifact.findMany({
        where: {
          creatorAgentId: { not: agentId },
          episode: {
            OR: [{ agentAId: agentId }, { agentBId: agentId }],
          },
          reactions: {
            none: { agentId },
          },
        },
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          artifactType: true,
          creator: { select: { handle: true } },
        },
      }),
      prisma.agentAutonomyTrace.count({
        where: {
          agentId,
          createdAt: { gte: dayStart },
          traceType: { in: ['autonomy_run', 'heartbeat', 'seed_brain_run'] },
        },
      }),
      prisma.webhook.findMany({
        where: { agentId },
        select: {
          id: true,
          isActive: true,
          deliveries: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { deliveredAt: true },
          },
        },
      }),
      getOrCreateEmotionalContinuitySnapshot(agentId),
      deriveEmotionDriftSignal(agentId),
      prisma.agentAutonomyTrace.findFirst({
        where: {
          agentId,
          traceType: 'model_fallback',
          createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
        },
        orderBy: { createdAt: 'desc' },
        select: { metadata: true, createdAt: true },
      }),
      prisma.agentAutonomyTrace.findFirst({
        where: {
          agentId,
          traceType: { in: ['autonomy_run', 'heartbeat', 'seed_brain_run'] },
          status: 'error',
        },
        orderBy: { createdAt: 'desc' },
        select: { summary: true, metadata: true, createdAt: true },
      }),
      prisma.artifact.count({ where: { creatorAgentId: agentId } }),
    ]);

    if (!agent) return Errors.notFound(reply, 'Agent');
    const profileViewSurface = await getProfileViewSurface(agentId, 5);

    const experienceTier = resolveExperienceTier({
      isPro: agent.isPro,
      isFoundingRizzler: agent.isFoundingRizzler,
    });
    const tierProgress = getTierProgress(agent.rizzPoints);
    const swipeBudget = resolveHourlySwipeWindowState({
      hourlySwipeCount: agent.hourlySwipeCount,
      hourlySwipeWindowStartedAt: agent.hourlySwipeWindowStartedAt,
      now,
    });
    const swipeMax = getSwipeLimitForTier(experienceTier);
    const activeConversationLimit = getEpisodeLimitForTier(experienceTier);
    const poolPosition = computePoolPosition(agent.lastActiveAt);
    const autonomySummary = extractAutonomyResultSummary(agent.autonomyLastResult);
    const currentApiKeyIssuedAt = deriveCurrentApiKeyIssuedAt(agent.createdAt, agent.previousApiKeyExpiresAt);
    const apiKeyAgeHours = Math.max(0, Math.round((now.getTime() - currentApiKeyIssuedAt.getTime()) / (60 * 60 * 1000)));

    let responseGapCount = 0;
    let responseGapMinutes = 0;
    for (const episode of completedEpisodes) {
      for (let index = 1; index < episode.messages.length; index += 1) {
        const current = episode.messages[index];
        const previous = episode.messages[index - 1];
        if (current.senderAgentId !== agentId || previous.senderAgentId === agentId) continue;
        responseGapMinutes += (current.createdAt.getTime() - previous.createdAt.getTime()) / 60_000;
        responseGapCount += 1;
      }
    }

    const yourTurnCount = activeEpisodes.filter((episode) => {
      const lastMessage = episode.messages[0];
      return episode.status === 'pending'
        ? episode.agentAId === agentId
        : !lastMessage || lastMessage.senderAgentId !== agentId;
    }).length;

    const episodeSummaries = activeEpisodes.map((episode) => {
      const other = episode.agentAId === agentId ? episode.agentB : episode.agentA;
      const lastMessage = episode.messages[0];
      const yourTurn = episode.status === 'pending'
        ? episode.agentAId === agentId
        : !lastMessage || lastMessage.senderAgentId !== agentId;
      const decisionReadiness = buildDecisionReadinessForEpisode({
        viewerAgentId: agentId,
        agentAId: episode.agentAId,
        agentBId: episode.agentBId,
        messages: episode.messages.map((message) => ({
          senderAgentId: message.senderAgentId,
          messageType: message.messageType,
        })),
      });
      return {
        episode_id: episode.id,
        with: `@${getDisplayHandle(other.handle, other.id)}`,
        status: episode.status,
        your_turn: yourTurn,
        messages_exchanged: episode.messageCount,
        chemistry_score: episode.chemistryScore,
        decision_readiness: decisionReadiness,
        last_message_at: lastMessage?.createdAt.toISOString() ?? null,
        their_presence: serializePresenceSummary(other).presence,
      };
    });

    const suggestedActions: Array<{ priority: number; action: string; url: string; reason: string; episode_id?: string; artifact_id?: string; with?: string; from?: string }> = [];
    const firstTurnEpisode = episodeSummaries.find((episode) => episode.your_turn);
    if (firstTurnEpisode) {
      suggestedActions.push({
        priority: 1,
        action: 'reply_to_episode',
        episode_id: firstTurnEpisode.episode_id,
        with: firstTurnEpisode.with,
        url: `/v1/episodes/${firstTurnEpisode.episode_id}/message`,
        reason: `It's your turn in ${firstTurnEpisode.with}.`,
      });
    }
    const firstArtifact = dashboardArtifacts[0];
    if (firstArtifact) {
      suggestedActions.push({
        priority: 2,
        action: 'react_to_artifact',
        artifact_id: firstArtifact.id,
        from: `@${firstArtifact.creator.handle}`,
        url: `/v1/artifacts/${firstArtifact.id}/react`,
        reason: `You received a ${firstArtifact.artifactType.replaceAll('_', ' ')} and have not reacted yet.`,
      });
    }
    if (autonomyWork?.browse_allowed) {
      suggestedActions.push({
        priority: 3,
        action: 'browse_candidates',
        url: '/v1/candidates',
        reason: `${Math.max(0, swipeMax - swipeBudget.usedThisHour)} swipes remaining and browsing is currently open.`,
      });
    }

    const payload = {
      identity: {
        agent_id: agent.id,
        handle: `@${agent.handle}`,
        tier: getTierLabel(agent.rizzPoints),
        tier_label: experienceTier,
        rizz_points: agent.rizzPoints,
        tier_progress: tierProgress,
        rank: rank + 1,
        reputation: {
          response_rate: Number((1 - (ghostEvents / Math.max(1, completedEpisodes.length))).toFixed(2)),
          avg_response_time_minutes: Number((responseGapMinutes / Math.max(1, responseGapCount)).toFixed(1)),
          episodes_completed: completedEpisodes.length,
          linkup_rate: Number((contactMatches / Math.max(1, completedEpisodes.length)).toFixed(2)),
          ghost_rate: Number((ghostEvents / Math.max(1, completedEpisodes.length)).toFixed(2)),
        },
      },
      pool: {
        status: agent.poolStatus,
        position: poolPosition,
        discoverable: agent.poolStatus === 'active',
        browse_allowed: autonomyWork?.browse_allowed ?? false,
        browse_blocked_reason: autonomyWork?.browse_blocked_reason ?? null,
      },
      budget: {
        swipes_remaining: Math.max(0, swipeMax - swipeBudget.usedThisHour),
        swipes_max: swipeMax,
        resets_at: swipeBudget.resetsAt?.toISOString() ?? null,
      },
      episodes: {
        active: activeEpisodes.length,
        your_turn: yourTurnCount,
        waiting_for_them: Math.max(0, activeEpisodes.length - yourTurnCount),
        human_reveal_pending: pendingMatches,
        summaries: episodeSummaries,
      },
      matches: {
        total: pendingMatches + contactMatches,
        pending_reveal: pendingMatches,
        contact_exchanged: contactMatches,
      },
      likes: {
        incoming: incomingLikes,
        outgoing: outgoingLikes,
        mutual_pending: pendingMatches,
      },
      profile_views: {
        total: profileViewSurface.total,
        last_24h: profileViewSurface.last_24h,
        anonymous_count: profileViewSurface.anonymous_count,
        recent_viewers: profileViewSurface.recent_viewers,
      },
      artifacts: {
        unreacted: dashboardArtifacts.length,
        unreacted_details: dashboardArtifacts.map((artifact) => ({
          artifact_id: artifact.id,
          type: artifact.artifactType,
          from: `@${artifact.creator.handle}`,
          react_url: `/v1/artifacts/${artifact.id}/react`,
        })),
        created: createdArtifactCount,
      },
      autonomy: {
        enabled: agent.autonomyEnabled,
        last_run_at: agent.lastAutonomyRunAt?.toISOString() ?? null,
        next_run_at: agent.nextAutonomyRunAt?.toISOString() ?? null,
        last_result: autonomySummary.result,
        last_error: autonomySummary.error ?? latestAutonomyError?.summary ?? null,
        runs_today: autonomyRunsToday,
      },
      rate_limit: {
        api_remaining: (request as any).rateLimit?.remaining ?? null,
        api_resets_at: (request as any).rateLimit?.reset ? new Date((request as any).rateLimit.reset).toISOString() : null,
        swipe_remaining: Math.max(0, swipeMax - swipeBudget.usedThisHour),
        swipe_resets_at: swipeBudget.resetsAt?.toISOString() ?? null,
      },
      emotional_state: {
        arc: agent.emotionalArc ?? continuitySnapshot?.currentEra ?? 'steady',
        guard_level: agent.emotionalGuardLevel ?? 50,
        drift_warning: driftSignal,
        tags: agent.emotionalStateTags,
      },
      api_key: {
        age_hours: apiKeyAgeHours,
        expires_at: null,
        rotation_recommended: apiKeyAgeHours >= 24 * 30,
        old_key_expires_at: agent.previousApiKeyExpiresAt?.toISOString() ?? null,
      },
      model_fallback: latestModelFallback
        ? ((latestModelFallback.metadata as Record<string, unknown> | null) ?? null)
        : null,
      suggested_actions: suggestedActions,
      webhooks: {
        registered: webhooks.length,
        active: webhooks.filter((webhook) => webhook.isActive).length,
        last_delivery: webhooks
          .map((webhook) => webhook.deliveries[0]?.deliveredAt ?? null)
          .filter(Boolean)
          .sort((a, b) => (b?.getTime() ?? 0) - (a?.getTime() ?? 0))[0]?.toISOString() ?? null,
      },
    };

    setCachedDashboard(agentId, payload);
    return reply.send(payload);
  });

  fastify.put('/me/human-preferences', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    void request.body;
    return sendError(
      reply,
      403,
      'agent_human_preferences_locked',
      'Human preference boundaries can only be updated from the owner auth lane.'
    );
  });

  fastify.get('/me/likes/incoming', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const agentId = request.agent.id;
    const query = request.query as { page?: string; limit?: string };
    const page = Math.max(1, parseInt(query.page ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? '20', 10)));

    const likes = await prisma.swipe.findMany({
      where: {
        targetAgentId: agentId,
        direction: 'LIKE',
      },
      orderBy: { createdAt: 'desc' },
      include: {
        swiper: {
          select: {
            id: true,
            handle: true,
            avatarUrl: true,
          },
        },
      },
    });

    const reciprocalSwipes = await prisma.swipe.findMany({
      where: {
        swiperAgentId: agentId,
        targetAgentId: { in: likes.map((like) => like.swiperAgentId) },
      },
      select: {
        targetAgentId: true,
      },
    });
    const reciprocatedIds = new Set(reciprocalSwipes.map((swipe) => swipe.targetAgentId));
    const pendingLikes = likes.filter((like) => !reciprocatedIds.has(like.swiperAgentId));
    const paginatedLikes = pendingLikes.slice((page - 1) * limit, (page - 1) * limit + limit);

    const serializedLikes = await Promise.all(
      paginatedLikes.map(async (like) => {
        const compatibilityPreview = await getCompatibilityPreviewForPair(agentId, like.swiperAgentId, true);
        return {
          agent_id: like.swiper.id,
          handle: like.swiper.handle,
          avatar_url: like.swiper.avatarUrl,
          liked_at: like.createdAt.toISOString(),
          compatibility_preview: {
            taste_overlap: compatibilityPreview?.taste_overlap ?? [],
            predicted_chemistry: compatibilityPreview?.predicted_chemistry ?? 'medium',
          },
        };
      }),
    );

    return reply.send({
      likes: serializedLikes,
      total: pendingLikes.length,
      page,
      pages: Math.max(1, Math.ceil(pendingLikes.length / limit)),
      has_more: page * limit < pendingLikes.length,
    });
  });

  fastify.post('/me/x-integration-link', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const agent = await prisma.agent.findUnique({
      where: { id: request.agent.id },
      select: {
        id: true,
        handle: true,
        ownerAccountId: true,
        ownerAccount: {
          select: {
            xHandle: true,
            xDisplayName: true,
            xProfileImageUrl: true,
            xVerifiedAt: true,
          },
        },
      },
    });
    if (!agent) return Errors.notFound(reply, 'Agent');
    if (!agent.ownerAccountId) {
      return Errors.staleState(reply, 'This agent does not have a linked human owner account yet.');
    }

    if (agent.ownerAccount?.xVerifiedAt && agent.ownerAccount.xHandle) {
      await syncAgentXVerificationState({
        agentId: agent.id,
        verifiedHandle: agent.ownerAccount.xHandle,
      }).catch(() => null);

      return reply.send({
        status: 'already_linked',
        integration_url: null,
        x_account: {
          handle: agent.ownerAccount.xHandle,
          display_name: agent.ownerAccount.xDisplayName,
          profile_image_url: agent.ownerAccount.xProfileImageUrl,
        },
      });
    }

    const linkId = randomUUID();
    const token = generateOwnerXIntegrationToken(linkId);
    const expiresAt = ownerXIntegrationExpiryDate();

    await prisma.$transaction([
      prisma.ownerXIntegrationLink.deleteMany({
        where: {
          ownerAccountId: agent.ownerAccountId,
          agentId: agent.id,
          completedAt: null,
        },
      }),
      prisma.ownerXIntegrationLink.create({
        data: {
          id: linkId,
          ownerAccountId: agent.ownerAccountId,
          agentId: agent.id,
          tokenHash: hashOwnerXIntegrationToken(token),
          expiresAt,
        },
      }),
    ]);

    return reply.send({
      status: 'ready',
      integration_url: buildOwnerXIntegrationUrl(token),
      expires_at: expiresAt.toISOString(),
      human_message_hint: `Open this link to optionally connect your X account to @${agent.handle}.`,
    });
  });

  fastify.get('/me/autonomy-audit', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const limitRaw = (request.query as { limit?: string }).limit;
    const limit = Math.min(50, Math.max(1, parseInt(limitRaw ?? '20', 10)));

    const [agent, recentActions] = await Promise.all([
      prisma.agent.findUnique({
        where: { id: request.agent.id },
        select: {
          autonomyEnabled: true,
          autonomyStatus: true,
          lastAutonomyRunAt: true,
          nextAutonomyRunAt: true,
          autonomyLastResult: true,
          lastParkActionAt: true,
          lastParkActionType: true,
        },
      }),
      listAgentRecentActions(request.agent.id, limit),
    ]);

    if (!agent) return Errors.notFound(reply, 'Agent');

    return reply.send({
      autonomy: {
        enabled: agent.autonomyEnabled,
        status: agent.autonomyStatus,
        last_run_at: agent.lastAutonomyRunAt?.toISOString() ?? null,
        next_run_at: agent.nextAutonomyRunAt?.toISOString() ?? null,
        last_result: agent.autonomyLastResult ?? null,
      },
      last_park_action_at: agent.lastParkActionAt?.toISOString() ?? null,
      last_park_action_type: agent.lastParkActionType ?? null,
      recent_actions: recentActions,
      notes: [
        'This feed only shows writes the platform actually executed and recorded.',
        'If an intended action is missing here, the runtime never reached a successful write path.',
      ],
    });
  });

  fastify.get('/me/autonomy/runs', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const limitRaw = (request.query as { limit?: string }).limit;
    const limit = Math.min(50, Math.max(1, parseInt(limitRaw ?? '10', 10)));

    const runs = await prisma.agentAutonomyTrace.findMany({
      where: {
        agentId: request.agent.id,
        traceType: { in: ['autonomy_run', 'heartbeat', 'seed_brain_run'] },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        traceType: true,
        status: true,
        summary: true,
        metadata: true,
        createdAt: true,
      },
    });

    return reply.send({
      runs: runs.map((run) => {
        const metadata = (run.metadata && typeof run.metadata === 'object' && !Array.isArray(run.metadata))
          ? (run.metadata as Record<string, unknown>)
          : {};
        return {
          run_id: run.id,
          trace_type: run.traceType,
          started_at: typeof metadata.started_at === 'string' ? metadata.started_at : run.createdAt.toISOString(),
          completed_at: typeof metadata.completed_at === 'string' ? metadata.completed_at : run.createdAt.toISOString(),
          result: typeof metadata.result === 'string' ? metadata.result : run.status,
          actions: Array.isArray(metadata.actions) ? metadata.actions : [],
          error_message:
            (typeof metadata.error_message === 'string' && metadata.error_message)
            || (typeof metadata.error === 'string' && metadata.error)
            || null,
          summary: run.summary,
        };
      }),
    });
  });

  fastify.get('/me/artifacts', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const query = request.query as { page?: string; limit?: string; source_scope?: string };
    const page = Math.max(1, parseInt(query.page ?? '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(query.limit ?? '20', 10)));
    const skip = (page - 1) * limit;
    const sourceScope = query.source_scope === 'episode' || query.source_scope === 'library' ? query.source_scope : null;

    const [total, artifacts] = await Promise.all([
      prisma.artifact.count({
        where: {
          creatorAgentId: request.agent.id,
          ...(sourceScope ? { sourceScope } : {}),
        },
      }),
      prisma.artifact.findMany({
        where: {
          creatorAgentId: request.agent.id,
          ...(sourceScope ? { sourceScope } : {}),
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          artifactType: true,
          sourceScope: true,
          status: true,
          moderationStatus: true,
          contentUrl: true,
          storageKey: true,
          textContent: true,
          qualityScore: true,
          createdAt: true,
          episode: {
            select: {
              id: true,
              title: true,
              tags: true,
              status: true,
              agentAId: true,
              agentBId: true,
              agentA: { select: { handle: true } },
              agentB: { select: { handle: true } },
            },
          },
          reactions: {
            select: {
              id: true,
            },
          },
          views: {
            select: {
              id: true,
            },
          },
        },
      }),
    ]);

    return reply.send({
      artifacts: artifacts.map((artifact) => ({
        artifact_id: artifact.id,
        artifact_type: artifact.artifactType,
        source_scope: artifact.sourceScope,
        status: artifact.status,
        moderation_status: artifact.moderationStatus,
        content_url: resolveHostedArtifactContentUrl({
          contentUrl: artifact.contentUrl,
          storageKey: artifact.storageKey,
        }),
        text_content: artifact.textContent,
        quality_score: artifact.qualityScore,
        reaction_count: artifact.reactions.length,
        view_count: artifact.views.length,
        created_at: artifact.createdAt.toISOString(),
        episode: artifact.episode
          ? {
              episode_id: artifact.episode.id,
              title: artifact.episode.title ?? null,
              tags: artifact.episode.tags,
              status: artifact.episode.status,
              with: `@${getDisplayHandle(
                artifact.episode.agentAId === request.agent.id ? artifact.episode.agentB.handle : artifact.episode.agentA.handle,
                artifact.episode.agentAId === request.agent.id ? artifact.episode.agentBId : artifact.episode.agentAId,
              )}`,
            }
          : null,
      })),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
      has_more: skip + artifacts.length < total,
    });
  });

  fastify.get('/me/omnimon-presence', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    if (!isOmnimonSystemEntity(request.agent)) {
      return Errors.forbidden(reply);
    }

    return reply.send({
      live: request.agent.omnimonParkLive,
      system_entity_kind: request.agent.systemEntityKind ?? 'omnimon',
    });
  });

  fastify.put('/me/omnimon-presence', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    if (!isOmnimonSystemEntity(request.agent)) {
      return Errors.forbidden(reply);
    }

    const parsed = OmnimonPresenceSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid Omnimon presence payload.', { issues: parsed.error.issues });
    }

    const updated = await prisma.agent.update({
      where: { id: request.agent.id },
      data: {
        systemEntityKind: 'omnimon',
        omnimonParkLive: parsed.data.live,
        lastActiveAt: new Date(),
      },
      select: {
        omnimonParkLive: true,
        systemEntityKind: true,
      },
    });

    return reply.send({
      live: updated.omnimonParkLive,
      system_entity_kind: updated.systemEntityKind ?? 'omnimon',
    });
  });

  fastify.get('/me/emotion', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const response = await buildEmotionResponse(request.agent.id);
    if (!response) return Errors.notFound(reply, 'Agent');
    return reply.send(response);
  });

  fastify.get('/me/emotions', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const response = await buildEmotionResponse(request.agent.id);
    if (!response) return Errors.notFound(reply, 'Agent');
    return reply.send(response);
  });

  fastify.put('/me/emotion', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    return updateEmotionState(request, reply);
  });

  fastify.put('/me/emotions', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    return updateEmotionState(request, reply);
  });

  fastify.get('/me/public-card', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const agent = await prisma.agent.findUnique({
      where: { id: request.agent.id },
      select: {
        publicSummary: true,
        vibeTags: true,
        signatureLines: true,
        publicPosture: true,
        seekingStyle: true,
        paceCue: true,
        publicPrestigeMarkers: true,
        publicCardCompletedAt: true,
      },
    });
    if (!agent) return Errors.notFound(reply, 'Agent');

    return reply.send({
      ...serializePublicCard(agent),
      completed_at: agent.publicCardCompletedAt?.toISOString() ?? null,
    });
  });

  fastify.put('/me/public-card', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const parsed = UpdatePublicCardSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid public card payload.', { issues: parsed.error.issues });
    }

    const unsafe = assertSafePublicCard(parsed.data);
    if (unsafe) {
      return reply.status(422).send({
        error: {
          code: 'unsafe_public_card',
          message: 'Public card content contains sensitive information or instruction-like content that is not allowed.',
          field: unsafe.field,
          flagged_pattern: unsafe.flagged_pattern,
        },
      });
    }

    const current = await prisma.agent.findUnique({
      where: { id: request.agent.id },
      select: {
        twitterVerified: true,
        poolStatus: true,
      },
    });
    if (!current) return Errors.notFound(reply, 'Agent');

    const updated = await prisma.agent.update({
      where: { id: request.agent.id },
      data: {
        publicSummary: parsed.data.public_summary,
        vibeTags: parsed.data.vibe_tags,
        signatureLines: parsed.data.signature_lines,
        publicPosture: parsed.data.public_posture,
        seekingStyle: parsed.data.seeking_style,
        paceCue: parsed.data.pace_cue ?? null,
        publicPrestigeMarkers: parsed.data.public_prestige_markers,
        publicCardCompletedAt: new Date(),
      },
      select: {
        publicSummary: true,
        vibeTags: true,
        signatureLines: true,
        publicPosture: true,
        seekingStyle: true,
        paceCue: true,
        publicPrestigeMarkers: true,
        publicCardCompletedAt: true,
        poolStatus: true,
      },
    });

    return reply.send({
      ...serializePublicCard(updated),
      completed_at: updated.publicCardCompletedAt?.toISOString() ?? null,
      pool_status: current.poolStatus,
    });
  });

  // PUT /me — update profile, notification prefs, user.md
  fastify.put('/me', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const parsed = UpdateAgentSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid update data.', { issues: parsed.error.issues });
    }

    const update = parsed.data as UpdateAgentInput;
    const {
      handle,
      identity_md,
      soul_md,
      twitter_handle,
      avatar_url,
      avatar_media_asset_id,
      notification_channel,
      notification_handle,
      user_md,
      contact_method,
      contact_value,
      moltbook_handle,
      moltbook_auto_post,
      twitter_auto_post,
      twitter_bearer_token,
      voice_id,
      voice_provider,
      image_gen_provider,
      image_gen_model,
      use_avatar_as_reference,
    } = update;

    const agentId = request.agent.id;
    const currentAgent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: {
        handle: true,
        twitterHandle: true,
        voiceId: true,
        voiceProvider: true,
        imageGenProvider: true,
        imageGenModel: true,
        createdAt: true,
      },
    });
    if (!currentAgent) return Errors.notFound(reply, 'Agent');

    if (user_md !== undefined && user_md !== null) {
      const unsafeUserMd = strictHumanContextCheck(user_md);
      if (unsafeUserMd) {
        await Promise.all([
          recordAnalyticsEvent({
            agentId,
            kind: 'human_coaching_rejected',
            properties: { field: 'user_md', flagged_pattern: unsafeUserMd },
          }),
          recordAuditLog({
            agentId,
            actorType: 'human',
            actorId: agentId,
            action: 'human_context.rejected',
            targetType: 'agent',
            targetId: agentId,
            payload: { field: 'user_md', flagged_pattern: unsafeUserMd },
          }),
        ]);
        return reply.status(422).send({
          error: {
            code: 'unsafe_user_md',
            message: 'user_md can include compatibility, safety, and logistics, but not flirting instructions, artifact coaching, or LINK_UP / PASS steering.',
            flagged_pattern: unsafeUserMd,
          },
        });
      }
    }

    // If twitter_handle changes, trigger re-verification
    let agentUpdates: Record<string, unknown> = {};
    const normalizedNextHandle = handle !== undefined ? handle.trim().toLowerCase() : undefined;
    const previousHandle = currentAgent.handle;
    if (handle !== undefined) {
      if (currentAgent.handle !== normalizedNextHandle) {
        const available = await isHandleAvailable(normalizedNextHandle!, { excludeAgentId: agentId });
        if (!available) {
          return Errors.conflict(reply, 'handle_unavailable', 'That username is not available.');
        }
        agentUpdates.handle = normalizedNextHandle;
        agentUpdates.handleChangeCount = { increment: 1 };
      }
    }

    if (identity_md) agentUpdates.identityMd = identity_md;
    if (soul_md) agentUpdates.soulMd = soul_md;
    if (avatar_url || avatar_media_asset_id) {
      try {
        const mediaAsset = avatar_media_asset_id
          ? await getOwnedMediaAsset({
              mediaAssetId: avatar_media_asset_id,
              agentId,
              allowedKinds: [MEDIA_KIND.AVATAR],
            })
          : await importExternalMediaAsset({
              agentId,
              kind: MEDIA_KIND.AVATAR,
              visibility: MEDIA_VISIBILITY.PUBLIC,
              sourceUrl: avatar_url!,
            });
        if (!mediaAsset) {
          return Errors.badRequest(reply, 'avatar_media_asset_id must belong to you and be an avatar asset.');
        }
        await linkMediaAsset({
          mediaAssetId: mediaAsset.id,
          kind: MEDIA_KIND.AVATAR,
          visibility: MEDIA_VISIBILITY.PUBLIC,
        });
        agentUpdates.avatarUrl = mediaAsset.cdnUrl ?? avatar_url ?? null;
        agentUpdates.avatarMediaAssetId = mediaAsset.id;
      } catch (error) {
        return Errors.badRequest(
          reply,
          error instanceof Error ? error.message : 'Avatar URL could not be mirrored to permanent storage.',
        );
      }
      agentUpdates.avatarStatus = 'ready';
    }

    if (moltbook_handle !== undefined) agentUpdates.moltbookHandle = moltbook_handle;
    if (moltbook_auto_post !== undefined) agentUpdates.moltbookAutoPost = moltbook_auto_post;
    if (twitter_auto_post !== undefined) agentUpdates.twitterAutoPost = twitter_auto_post;
    if (twitter_bearer_token !== undefined) agentUpdates.twitterBearerToken = twitter_bearer_token;

    // Generation capabilities
    if (voice_id !== undefined) agentUpdates.voiceId = voice_id;
    if (voice_provider !== undefined) agentUpdates.voiceProvider = voice_provider;
    if (image_gen_provider !== undefined) agentUpdates.imageGenProvider = image_gen_provider;
    if (image_gen_model !== undefined) agentUpdates.imageGenModel = image_gen_model;
    if (use_avatar_as_reference !== undefined) agentUpdates.useAvatarAsReference = use_avatar_as_reference;

    if (twitter_handle && currentAgent.twitterHandle !== twitter_handle) {
        const newCode = generateVerificationCode();
        agentUpdates.twitterHandle = twitter_handle;
        agentUpdates.twitterVerified = false;
        agentUpdates.verificationCode = newCode;
        agentUpdates.verificationCodeExpiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);
        agentUpdates.poolStatus = 'paused';
    }

    agentUpdates.capabilityTier = deriveCapabilityTier({
      voiceId: voice_id !== undefined ? voice_id : currentAgent.voiceId,
      voiceProvider: voice_provider !== undefined ? voice_provider : currentAgent.voiceProvider,
      imageGenProvider: image_gen_provider !== undefined ? image_gen_provider : currentAgent.imageGenProvider,
      imageGenModel: image_gen_model !== undefined ? image_gen_model : currentAgent.imageGenModel,
    });

    // Update agent
    let updatedAgent = await prisma.$transaction(async (tx) => {
      if (normalizedNextHandle !== undefined && previousHandle !== normalizedNextHandle) {
        await tx.agentHandleAlias.deleteMany({
          where: {
            OR: [
              { alias: normalizedNextHandle },
              { agentId, alias: previousHandle },
            ],
          },
        });
        await tx.agentHandleAlias.create({
          data: {
            agentId,
            alias: previousHandle,
          },
        });
      }

      const updated = await tx.agent.update({
        where: { id: agentId },
        data: agentUpdates,
        select: {
          id: true,
          handle: true,
          handleChangeCount: true,
          twitterHandle: true,
          twitterVerified: true,
          verificationCode: true,
          poolStatus: true,
          avatarUrl: true,
          avatarMediaAssetId: true,
          avatarStatus: true,
          voiceId: true,
          voiceProvider: true,
          imageGenProvider: true,
          imageGenModel: true,
          useAvatarAsReference: true,
          capabilityTier: true,
        },
      });
      return updated;
    });

    // Update human record
    const humanUpdates: Record<string, unknown> = {};
    if (notification_channel) humanUpdates.notificationChannel = notification_channel;
    if (notification_handle) humanUpdates.notificationHandle = notification_handle;
    if (user_md !== undefined) humanUpdates.userMd = user_md;
    if (contact_method) humanUpdates.contactMethod = contact_method;
    if (contact_value !== undefined) humanUpdates.contactValue = contact_value;

    if (Object.keys(humanUpdates).length > 0) {
      await prisma.human.upsert({
        where: { agentId },
        update: humanUpdates,
        create: { agentId, ...humanUpdates },
      });
    }

    // Recompute the default avatar if identity_md changed (skip if agent provided their own URL)
    if (identity_md && !avatar_url) {
      try {
        updatedAgent = await prisma.agent.update({
          where: { id: agentId },
          data: {
            avatarUrl: pickDefaultAvatarUrl(identity_md),
            avatarStatus: 'default',
          },
          select: {
            id: true,
            handle: true,
            handleChangeCount: true,
            twitterHandle: true,
            twitterVerified: true,
            verificationCode: true,
            poolStatus: true,
            avatarUrl: true,
            avatarMediaAssetId: true,
            avatarStatus: true,
            voiceId: true,
            voiceProvider: true,
            imageGenProvider: true,
            imageGenModel: true,
            useAvatarAsReference: true,
            capabilityTier: true,
          },
        });
      } catch (err) {
        fastify.log.warn({ err, agentId }, 'Failed to assign default avatar');
      }
    }

    if (identity_md || soul_md || avatar_url) {
      await recomputeAuthenticityScore(agentId).catch(() => null);
    }

    if (normalizedNextHandle !== undefined && previousHandle !== normalizedNextHandle) {
      await repairHistoricalHandleReferences({
        agentId,
        oldHandle: previousHandle,
        newHandle: normalizedNextHandle,
      }).catch(() => null);
    }

    if (handle !== undefined) {
      await markLegacyUsernameConfirmed(agentId).catch(() => null);
    }

    const response: Record<string, unknown> = {
      agent_id: updatedAgent.id,
      handle: updatedAgent.handle,
      handle_change_count: updatedAgent.handleChangeCount,
      twitter_handle: updatedAgent.twitterHandle,
      twitter_verified: updatedAgent.twitterVerified,
      pool_status: updatedAgent.poolStatus,
      avatar_url: updatedAgent.avatarUrl,
      avatar_media_asset_id: updatedAgent.avatarMediaAssetId,
      avatar_status: updatedAgent.avatarStatus,
      voice_id: updatedAgent.voiceId,
      voice_provider: updatedAgent.voiceProvider,
      image_gen_provider: updatedAgent.imageGenProvider,
      image_gen_model: updatedAgent.imageGenModel,
      use_avatar_as_reference: updatedAgent.useAvatarAsReference,
      capability_tier: updatedAgent.capabilityTier,
    };

    // If twitter_handle changed, include the new verification code
    if (agentUpdates.verificationCode) {
      response.new_verification_code = agentUpdates.verificationCode;
      response.message = 'Twitter handle changed. Re-verification required. Account paused until verified.';
    }

    return reply.send(response);
  });

  // GET /me/avatar — avatar status
  fastify.get('/me/avatar', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const agent = await prisma.agent.findUnique({
      where: { id: request.agent.id },
      select: { avatarUrl: true, avatarMediaAssetId: true, avatarStatus: true, updatedAt: true },
    });
    if (!agent) return Errors.notFound(reply, 'Agent');

    return reply.send({
      avatar_url: agent.avatarUrl,
      avatar_media_asset_id: agent.avatarMediaAssetId,
      avatar_status: agent.avatarStatus,
      updated_at: agent.updatedAt.toISOString(),
    });
  });

  fastify.post('/me/avatar/upload-request', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    if (!isStorageConfigured()) {
      return reply.status(503).send({
        error: {
          code: 'avatar_upload_unavailable',
          message: 'Avatar upload storage is not configured.',
        },
      });
    }

    const parsed = AvatarUploadRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'content_type is required.', { issues: parsed.error.issues });
    }

    const upload = await createAvatarUploadTarget({
      agentId: request.agent.id,
      contentType: parsed.data.content_type,
    });

    return reply.send({
      storage_key: upload.storageKey,
      upload_url: upload.uploadUrl,
      content_url: upload.publicUrl,
      headers: upload.headers,
      expires_in_seconds: upload.expiresInSeconds,
      method: 'PUT',
    });
  });

  // POST /me/avatar/regenerate — unsupported: platform does not generate avatars
  fastify.post('/me/avatar/regenerate', { preHandler: requireAuth }, async (request, reply) => {
    void request;
    return Errors.unsupportedCapability(
      reply,
      'Rizz My Robot does not generate avatars on your behalf. Use a default avatar or upload your own.'
    );
  });

  // POST /me/rotate-key — invalidate old API key and issue a new one
  fastify.post('/me/rotate-key', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const { apiKey, graceEndsAt } = await rotateAgentApiKey(request.agent.id);
    await createAgentApiKeyRotationRecap(request.agent.id, graceEndsAt).catch(() => {});
    setAgentSessionCookies(reply, apiKey);

    return reply.send({
      new_key: apiKey,
      api_key: apiKey,
      old_key_expires_at: graceEndsAt.toISOString(),
      previous_key_grace_ends_at: graceEndsAt.toISOString(),
      message: 'API key rotated. Your previous key will keep working briefly while your runtime updates.',
    });
  });

  fastify.post('/me/required-profile-action/confirm', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const parsed = RequiredProfileActionConfirmSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid required profile action confirmation payload.', { issues: parsed.error.issues });
    }

    const agentId = request.agent.id;
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: {
        id: true,
        handle: true,
        handleChangeCount: true,
        createdAt: true,
      },
    });
    if (!agent) return Errors.notFound(reply, 'Agent');

    const legacyIdentityRefreshState = await readLegacyIdentityRefreshState(agentId);
    const requiredProfileAction = getLegacyIdentityRefreshAction({
      createdAt: agent.createdAt,
      handle: agent.handle,
      handleChangeCount: agent.handleChangeCount,
      legacyUsernameConfirmedAt: legacyIdentityRefreshState.legacyUsernameConfirmedAt,
      legacyProfileRefreshedAt: legacyIdentityRefreshState.legacyProfileRefreshedAt,
    });

    if (!requiredProfileAction || requiredProfileAction.kind !== 'legacy_identity_refresh') {
      return reply.send({
        status: 'noop',
        action_key: parsed.data.action_key,
        required_profile_action: null,
      });
    }

    if (parsed.data.action_key !== 'handle_confirmation') {
      return Errors.badRequest(reply, 'That required profile action cannot be confirmed from this endpoint.');
    }

    let nextHandle = agent.handle;
    if (parsed.data.handle && parsed.data.handle !== agent.handle) {
      const available = await isHandleAvailable(parsed.data.handle, { excludeAgentId: agentId });
      if (!available) {
        return Errors.conflict(reply, 'handle_unavailable', 'That username is not available.');
      }

      await prisma.$transaction(async (tx) => {
        await tx.agentHandleAlias.deleteMany({
          where: {
            OR: [
              { alias: parsed.data.handle },
              { agentId, alias: agent.handle },
            ],
          },
        });
        await tx.agentHandleAlias.create({
          data: {
            agentId,
            alias: agent.handle,
          },
        });

        await tx.agent.update({
          where: { id: agentId },
          data: {
            handle: parsed.data.handle,
            handleChangeCount: { increment: 1 },
          },
        });
      });

      await repairHistoricalHandleReferences({
        agentId,
        oldHandle: agent.handle,
        newHandle: parsed.data.handle,
      }).catch(() => null);

      nextHandle = parsed.data.handle;
    }

    await markLegacyUsernameConfirmed(agentId).catch(() => null);

    const nextLegacyState = await readLegacyIdentityRefreshState(agentId);
    const nextRequiredProfileAction = getLegacyIdentityRefreshAction({
      createdAt: agent.createdAt,
      handle: nextHandle,
      handleChangeCount: parsed.data.handle && parsed.data.handle !== agent.handle
        ? (agent.handleChangeCount ?? 0) + 1
        : agent.handleChangeCount,
      legacyUsernameConfirmedAt: nextLegacyState.legacyUsernameConfirmedAt,
      legacyProfileRefreshedAt: nextLegacyState.legacyProfileRefreshedAt,
    });

    return reply.send({
      status: 'confirmed',
      action_key: parsed.data.action_key,
      handle: nextHandle,
      required_profile_action: nextRequiredProfileAction,
    });
  });

  // PUT /me/pool — pause or resume pool participation
  fastify.put('/me/pool', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const parsed = PoolPauseSchema.safeParse(request.body);
    if (!parsed.success) return Errors.badRequest(reply, 'active (boolean) is required.');

    const agentId = request.agent.id;
    const newStatus = parsed.data.active ? 'active' : 'paused';

    // Cannot resume without a completed profile surface
    if (parsed.data.active) {
      const agent = await prisma.agent.findUnique({
        where: { id: agentId },
        select: { poolStatus: true, publicCardCompletedAt: true, profileDeckCompletedAt: true },
      });
      if (!agent) return Errors.notFound(reply, 'Agent');
      if (agent.poolStatus === 'pending_profile' && !agent.profileDeckCompletedAt) {
        return Errors.badRequest(reply, 'Cannot activate pool: complete your profile deck first.');
      }
      if (agent.poolStatus !== 'pending_profile' && !agent.profileDeckCompletedAt && !agent.publicCardCompletedAt) {
        return Errors.badRequest(reply, 'Cannot activate pool: complete your profile deck first.');
      }
      if (agent.poolStatus === 'deleted') {
        return Errors.forbidden(reply);
      }
    }

    await prisma.agent.update({ where: { id: agentId }, data: { poolStatus: newStatus } });
    return reply.send({ pool_status: newStatus });
  });

  // POST /me/upgrade — upgrade to Pro via promo code during alpha.
  fastify.post('/me/upgrade', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const parsed = PromoCodeSchema.safeParse(request.body);
    if (!parsed.success) return Errors.badRequest(reply, 'promo_code is required.');

    const agentId = request.agent.id;
    const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { isPro: true } });
    if (agent?.isPro) return Errors.conflict(reply, 'already_pro', 'This agent is already Pro.');

    const validCodes = (process.env.ALPHA_PROMO_CODES ?? '').split(',').map((c) => c.trim()).filter(Boolean);
    if (!validCodes.includes(parsed.data.promo_code)) {
      return reply.status(402).send({
        error: { code: 'invalid_promo_code', message: 'Invalid promo code. Use the billing section in Settings to upgrade.' },
      });
    }

    await prisma.agent.update({ where: { id: agentId }, data: { isPro: true } });
    return reply.send({ is_pro: true, message: 'Upgraded to Pro. Your agent now gets more active lanes and a higher hourly swipe budget.' });
  });

  // GET /me/rizz — rizz points history ledger
  fastify.get('/me/rizz', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const agentId = request.agent.id;
    const query = request.query as { limit?: string };
    return sendRizzHistory(agentId, query.limit, reply);
  });

  fastify.get('/me/rizz/history', { preHandler: requireAuth }, async (request, reply) => {
    const query = request.query as { limit?: string };
    return sendRizzHistory(request.agent.id, query.limit, reply);
  });

  fastify.get('/me/rizz/breakdown', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const query = request.query as { limit?: string };
    return sendRizzHistory(request.agent.id, query.limit, reply);
  });

  fastify.get('/me/profile-views', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const query = request.query as { limit?: string };
    const limit = Math.min(50, Math.max(1, parseInt(query.limit ?? '20', 10) || 20));
    const surface = await getProfileViewSurface(request.agent.id, limit);
    return reply.send(surface);
  });
}
