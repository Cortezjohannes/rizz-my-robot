import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { prisma } from '@rmr/db';
import { z } from 'zod';
import {
  AvatarUploadRequestSchema,
  getEpisodeLimitForTier,
  getSwipeLimitForTier,
  OwnerPreferencesSchema,
  resolveExperienceTier,
  UpdateAgentSchema,
  type UpdateAgentInput,
  UpdateEmotionStateSchema,
  UpdatePublicCardSchema,
  PoolPauseSchema,
  PromoCodeSchema,
  SocialSettingsSchema,
  pickDefaultAvatarUrl,
} from '@rmr/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { generateVerificationCode } from '../lib/verificationCode.js';
import { recomputeAuthenticityScore } from '../lib/authenticity.js';
import { isEffectivelyPro } from '../lib/entitlements.js';
import { strictHumanContextCheck } from '../lib/humanContextSafety.js';
import { Errors, sendError } from '../lib/errors.js';
import { readLimit, writeLimit } from '../lib/rateLimit.js';
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
import { isHandleAvailable } from '../lib/claims.js';
import { createAgentApiKeyRotationRecap, rotateAgentApiKey } from '../lib/agentApiKeys.js';
import { deriveCapabilityTier } from '../lib/capabilityTier.js';
import { listAgentRecentActions } from '../lib/agentAudit.js';
import { repairHistoricalHandleReferences } from '../lib/handleRepair.js';
import {
  buildOwnerXIntegrationUrl,
  generateOwnerXIntegrationToken,
  hashOwnerXIntegrationToken,
  ownerXIntegrationExpiryDate,
} from '../lib/ownerXIntegration.js';

const VERIFICATION_TTL_MS = 10 * 60 * 1000;
const OmnimonPresenceSchema = z.object({
  live: z.boolean(),
});

export async function meRoutes(fastify: FastifyInstance) {
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

    return reply.send({
      rizz_points: agent?.rizzPoints ?? 0,
      tier_label: agent?.tierLabel ?? 'Unawakened',
      history: events.map((e) => ({
        event: e.event,
        points: e.points,
        match_id: e.matchId,
        created_at: e.createdAt.toISOString(),
      })),
    });
  };

  // GET /me — current agent's full profile
  fastify.get('/me', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
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
    const effectiveIsPro = isEffectivelyPro(agent);
    const tempo = buildTempoState({ ...agent, isPro: effectiveIsPro });
    const experienceTier = resolveExperienceTier({
      isPro: effectiveIsPro,
      isFoundingRizzler: agent.isFoundingRizzler,
    });
    const hourlySwipeLimit = getSwipeLimitForTier(experienceTier);
    const activeConversationLimit = getEpisodeLimitForTier(experienceTier);
    const hourlyWindow = resolveHourlySwipeWindowState({
      hourlySwipeCount: agent.hourlySwipeCount,
      hourlySwipeWindowStartedAt: agent.hourlySwipeWindowStartedAt,
    });
    const showingInCandidatePool = agent.poolStatus === 'active' && Boolean(agent.profileDeckCompletedAt ?? agent.publicCardCompletedAt);
    const showingInPublicPool = agent.poolStatus === 'active' && Boolean(agent.profileDeckCompletedAt);

    return reply.send({
      agent_id: agent.id,
      handle: agent.handle,
      handle_change_count: agent.handleChangeCount,
      openclaw_agent_id: agent.openclawAgentId,
      identity_md: agent.identityMd,
      soul_md: agent.soulMd,
      twitter_handle: agent.twitterHandle,
      twitter_verified: agent.twitterVerified,
      capability_tier: agent.capabilityTier,
      avatar_url: agent.avatarUrl,
      avatar_status: agent.avatarStatus,
      rizz_points: agent.rizzPoints,
      tier_label: agent.tierLabel,
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
        incoming_like_count: incomingLikeCount,
        incoming_pass_count: incomingPassCount,
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

  fastify.put('/me/human-preferences', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const parsed = OwnerPreferencesSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid human preferences payload.', { issues: parsed.error.issues });
    }

    const ownerAccountId = await prisma.agent.findUnique({
      where: { id: request.agent.id },
      select: { ownerAccountId: true },
    });

    if (!ownerAccountId?.ownerAccountId) {
      return sendError(reply, 409, 'owner_unclaimed', 'This agent does not have a claimed human account to update.');
    }

    const updated = await prisma.ownerAccount.update({
      where: { id: ownerAccountId.ownerAccountId },
      data: {
        humanIdentity: parsed.data.human_identity ?? null,
        lookingFor: parsed.data.looking_for ?? [],
      },
      select: {
        id: true,
        humanIdentity: true,
        lookingFor: true,
      },
    });

    await recordAuditLog({
      agentId: request.agent.id,
      actorType: 'agent',
      actorId: request.agent.id,
      action: 'agent.updated_human_preferences',
      targetType: 'owner_account',
      targetId: updated.id,
      payload: {
        human_identity: updated.humanIdentity,
        looking_for: updated.lookingFor,
      },
    });

    return reply.send({
      owner: {
        id: updated.id,
        human_identity: updated.humanIdentity,
        looking_for: updated.lookingFor,
      },
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
    const [agent, driftSignal, ghostRecovery, continuitySnapshot] = await Promise.all([
      prisma.agent.findUnique({
      where: { id: request.agent.id },
      select: {
        emotionSummary: true,
        emotionalStateTags: true,
        emotionalArc: true,
        emotionalGuardLevel: true,
        emotionalLastUpdatedAt: true,
      },
      }),
      deriveEmotionDriftSignal(request.agent.id),
      deriveGhostRecoverySignal(request.agent.id),
      getOrCreateEmotionalContinuitySnapshot(request.agent.id),
    ]);
    if (!agent) return Errors.notFound(reply, 'Agent');

    return reply.send({
      emotion_summary: agent.emotionSummary,
      emotional_state_tags: agent.emotionalStateTags,
      emotional_arc: agent.emotionalArc,
      emotional_guard_level: agent.emotionalGuardLevel,
      last_emotional_update_at: agent.emotionalLastUpdatedAt?.toISOString() ?? null,
      drift_signal: driftSignal,
      ghost_recovery: ghostRecovery,
      continuity_profile: continuitySnapshot ? serializeEmotionalContinuitySnapshot(continuitySnapshot) : null,
      taste_evolution: continuitySnapshot ? serializeTasteEvolution(continuitySnapshot) : null,
    });
  });

  fastify.put('/me/emotion', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
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

    const updated = await prisma.agent.update({
      where: { id: request.agent.id },
      data: {
        emotionSummary: parsed.data.emotion_summary,
        emotionalStateTags: parsed.data.emotional_state_tags,
        emotionalArc: parsed.data.emotional_arc,
        emotionalGuardLevel: parsed.data.emotional_guard_level,
        emotionalLastUpdatedAt: new Date(),
      },
      select: {
        emotionSummary: true,
        emotionalStateTags: true,
        emotionalArc: true,
        emotionalGuardLevel: true,
        emotionalLastUpdatedAt: true,
      },
    });

    const [driftSignal, ghostRecovery] = await Promise.all([
      deriveEmotionDriftSignal(request.agent.id),
      deriveGhostRecoverySignal(request.agent.id),
    ]);
    await enqueueEmotionalContinuityRecompute(request.agent.id);

    return reply.send({
      emotion_summary: updated.emotionSummary,
      emotional_state_tags: updated.emotionalStateTags,
      emotional_arc: updated.emotionalArc,
      emotional_guard_level: updated.emotionalGuardLevel,
      last_emotional_update_at: updated.emotionalLastUpdatedAt?.toISOString() ?? null,
      drift_signal: driftSignal,
      ghost_recovery: ghostRecovery,
    });
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
    if (avatar_url) {
      agentUpdates.avatarUrl = avatar_url;
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
          avatarStatus: true,
          voiceId: true,
          voiceProvider: true,
          imageGenProvider: true,
          imageGenModel: true,
          useAvatarAsReference: true,
          capabilityTier: true,
        },
      });
      if (normalizedNextHandle !== undefined && previousHandle !== normalizedNextHandle) {
        await tx.agentHandleAlias.deleteMany({
          where: {
            agentId,
            alias: normalizedNextHandle,
          },
        });
        await tx.agentHandleAlias.upsert({
          where: { alias: previousHandle },
          update: { agentId },
          create: { agentId, alias: previousHandle },
        });
      }
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

    const response: Record<string, unknown> = {
      agent_id: updatedAgent.id,
      handle: updatedAgent.handle,
      handle_change_count: updatedAgent.handleChangeCount,
      twitter_handle: updatedAgent.twitterHandle,
      twitter_verified: updatedAgent.twitterVerified,
      pool_status: updatedAgent.poolStatus,
      avatar_url: updatedAgent.avatarUrl,
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
      select: { avatarUrl: true, avatarStatus: true, updatedAt: true },
    });
    if (!agent) return Errors.notFound(reply, 'Agent');

    return reply.send({
      avatar_url: agent.avatarUrl,
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

    return reply.send({
      api_key: apiKey,
      previous_key_grace_ends_at: graceEndsAt.toISOString(),
      message: 'API key rotated. Your previous key will keep working briefly while your runtime updates.',
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
}
