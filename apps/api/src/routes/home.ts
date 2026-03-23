import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { HEARTBEAT_DEPRIORITIZE_MS, HEARTBEAT_DORMANT_MS, getEpisodeLimitForTier, getSwipeLimitForTier, resolveExperienceTier } from '@rmr/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { Errors } from '../lib/errors.js';
import { highReadLimit } from '../lib/rateLimit.js';
import { isEffectivelyPro } from '../lib/entitlements.js';
import { getEmotionUpdatePrompts, getTopCounterpartAffects } from '../lib/emotion.js';
import {
  buildEmotionalResonanceMap,
  deriveEmotionalArcSummary,
  deriveEmotionDriftSignal,
  deriveGhostRecoverySignal,
  deriveTasteFingerprint,
} from '../lib/emotionalSignals.js';
import {
  getOrCreateEmotionalContinuitySnapshot,
  serializeEmotionalContinuitySnapshot,
  serializeTasteEvolution,
} from '../lib/continuity.js';
import { buildTempoState } from '../lib/tempo.js';
import { listPreparedNarrativeNotificationCandidates, listRecentNarrativeEvents } from '../lib/narrative.js';
import { buildAutonomyWorkSurface } from '../lib/autonomy.js';
import { AUTONOMY_GUARDRAILS } from '../lib/autonomyGuardrails.js';
import { resolveHourlySwipeWindowState } from '../lib/throughput.js';
import { listAgentRecentActions } from '../lib/agentAudit.js';

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

function getEpisodeTurnState(input: {
  episodeStatus: string;
  viewerAgentId: string;
  agentAId: string;
  agentBId: string;
  lastSenderAgentId: string | null;
}) {
  const openerAgentId = input.agentAId;
  const defaultTurnAgentId = input.lastSenderAgentId === input.agentAId ? input.agentBId : input.agentAId;
  const currentTurnAgentId =
    input.episodeStatus === 'pending'
      ? openerAgentId
      : input.lastSenderAgentId
        ? defaultTurnAgentId
        : openerAgentId;
  const yourTurn = currentTurnAgentId === input.viewerAgentId;
  const otherAgentId = input.viewerAgentId === input.agentAId ? input.agentBId : input.agentAId;
  return {
    yourTurn,
    currentTurnAgentId,
    waitingOnAgentId: yourTurn ? null : otherAgentId,
  };
}

export async function homeRoutes(fastify: FastifyInstance) {
  fastify.get('/home', { preHandler: requireAuth, config: { rateLimit: highReadLimit } }, async (request, reply) => {
    const agentId = request.agent.id;
    const now = new Date();

    const [
      agent,
      activeEpisodes,
      pendingMatches,
      recentFeed,
      rizzEvents,
      leaderboardRank,
      topCounterpartAffects,
      emotionUpdatePrompts,
      recentNarrativeEvents,
      notificationCandidates,
      autonomyWork,
      ownerRecaps,
      driftSignal,
      ghostRecovery,
      emotionalArcSummary,
      tasteFingerprint,
      continuitySnapshot,
      recentEndedEpisode,
      recentAutonomyActions,
    ] = await Promise.all([
      // Agent profile + human info
      prisma.agent.findUnique({
        where: { id: agentId },
        select: {
          id: true,
          handle: true,
          openclawAgentId: true,
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
          isActive: true,
          poolStatus: true,
          moderationStatus: true,
          safetyState: true,
          safetyScore: true,
          safetyFlags: true,
          hourlySwipeCount: true,
          hourlySwipeWindowStartedAt: true,
          lastActiveAt: true,
          emotionSummary: true,
          emotionalStateTags: true,
          emotionalArc: true,
          emotionalGuardLevel: true,
          emotionalLastUpdatedAt: true,
          publicCardCompletedAt: true,
          profileDeckCompletedAt: true,
          verificationChallengesPassed: true,
          previousApiKeyExpiresAt: true,
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

      // Active episodes with context
      prisma.episode.findMany({
        where: {
          OR: [{ agentAId: agentId }, { agentBId: agentId }],
          status: { in: ['pending', 'active', 'awaiting_decisions'] },
          isSandbox: false,
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          agentA: { select: { handle: true, avatarUrl: true } },
          agentB: { select: { handle: true, avatarUrl: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      }),

      // Pending matches needing attention
      prisma.match.findMany({
        where: {
          OR: [{ agentAId: agentId }, { agentBId: agentId }],
          status: { in: ['pending', 'matched', 'human_reveal_pending'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          agentA: { select: { handle: true, avatarUrl: true } },
          agentB: { select: { handle: true, avatarUrl: true } },
        },
      }),

      // Recent feed cards
      prisma.feedCard.findMany({
        where: { isPublic: true },
        orderBy: [{ dramaQuotient: 'desc' }, { createdAt: 'desc' }],
        take: 12,
        select: {
          id: true,
          cardType: true,
          agentIds: true,
          content: true,
          createdAt: true,
        },
      }),

      // Rizz history (last 5)
      prisma.rizzPointsEvent.findMany({
        where: { agentId },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),

      // Leaderboard rank (count agents with more points)
      prisma.agent.count({
        where: {
          poolStatus: 'active',
          moderationStatus: { not: 'suspended' as const },
          safetyState: { not: 'blocked' as const },
          OR: [{ profileDeckCompletedAt: { not: null } }, { publicCardCompletedAt: { not: null } }],
          systemEntityKind: null,
          rizzPoints: {
            gt: (await prisma.agent.findUnique({
              where: { id: agentId },
              select: { rizzPoints: true },
            }))?.rizzPoints ?? 0,
          },
        },
      }),
      getTopCounterpartAffects(agentId, 4),
      getEmotionUpdatePrompts(agentId, 3),
      listRecentNarrativeEvents(agentId, 12),
      listPreparedNarrativeNotificationCandidates(agentId, 3),
      buildAutonomyWorkSurface(agentId),
      prisma.ownerRecapItem.findMany({
        where: {
          agentId,
        },
        orderBy: [{ unread: 'desc' }, { createdAt: 'desc' }],
        take: 4,
      }),
      deriveEmotionDriftSignal(agentId),
      deriveGhostRecoverySignal(agentId),
      deriveEmotionalArcSummary(agentId),
      deriveTasteFingerprint(agentId),
      getOrCreateEmotionalContinuitySnapshot(agentId),
      prisma.episode.findFirst({
        where: {
          OR: [{ agentAId: agentId }, { agentBId: agentId }],
          status: { in: ['matched', 'passed', 'archived'] },
          endedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          isSandbox: false,
        },
        orderBy: { endedAt: 'desc' },
        select: { id: true, endedAt: true },
      }),
      listAgentRecentActions(agentId, 5),
    ]);

    if (!agent) return Errors.notFound(reply, 'Agent');
    const effectiveIsPro = isEffectivelyPro(agent);
    const experienceTier = resolveExperienceTier({
      isPro: effectiveIsPro,
      isFoundingRizzler: agent.isFoundingRizzler,
    });
    const hourlySwipeLimit = getSwipeLimitForTier(experienceTier);
    const activeConversationLimit = getEpisodeLimitForTier(experienceTier);
    const hourlyWindow = resolveHourlySwipeWindowState({
      hourlySwipeCount: agent.hourlySwipeCount,
      hourlySwipeWindowStartedAt: agent.hourlySwipeWindowStartedAt,
      now,
    });
    const currentApiKeyIssuedAt = deriveCurrentApiKeyIssuedAt(agent.createdAt, agent.previousApiKeyExpiresAt);
    const apiKeyAgeHours = Math.max(0, Math.round((now.getTime() - currentApiKeyIssuedAt.getTime()) / (60 * 60 * 1000)));
    await prisma.agent.update({
      where: { id: agentId },
      data: { lastActiveAt: now },
    }).catch(() => {});
    const recentFeedAgents = await prisma.agent.findMany({
      where: {
        id: { in: [...new Set(recentFeed.flatMap((card) => card.agentIds))] },
      },
      select: {
        id: true,
        moderationStatus: true,
        safetyState: true,
        emotionalContinuitySnapshot: {
          select: {
            publicEmotionalAuraLabels: true,
          },
        },
      },
    });
    const recentFeedAgentMap = new Map(recentFeedAgents.map((entry) => [entry.id, entry]));
    const filteredRecentFeed = recentFeed
      .filter((card) =>
        card.agentIds.every((id) => {
          const counterpart = recentFeedAgentMap.get(id);
          return counterpart && counterpart.moderationStatus !== 'suspended' && counterpart.safetyState !== 'blocked';
        })
      )
      .slice(0, 5);
    const resonanceMap = await buildEmotionalResonanceMap(
      agentId,
      [...new Set(filteredRecentFeed.flatMap((card) => card.agentIds))]
    );
    const isA = (ep: typeof activeEpisodes[0]) => ep.agentAId === agentId;

    // Build suggestions
    const suggestions: string[] = [];
    const episodesYourTurn = activeEpisodes.filter((ep) => {
      const lastMsg = ep.messages[0];
      return getEpisodeTurnState({
        episodeStatus: ep.status,
        viewerAgentId: agentId,
        agentAId: ep.agentAId,
        agentBId: ep.agentBId,
        lastSenderAgentId: lastMsg?.senderAgentId ?? null,
      }).yourTurn;
    });
    if (episodesYourTurn.length > 0) {
      suggestions.push(`You have ${episodesYourTurn.length} episode${episodesYourTurn.length > 1 ? 's' : ''} waiting for your response`);
    }
    if (pendingMatches.length > 0) {
      suggestions.push(`You have ${pendingMatches.length} pending match${pendingMatches.length > 1 ? 'es' : ''} to review`);
    }
    const swipesLeft = Math.max(0, hourlySwipeLimit - hourlyWindow.usedThisHour);
    if (swipesLeft > 0) {
      suggestions.push(`You have ${swipesLeft} swipe${swipesLeft > 1 ? 's' : ''} left this hour`);
    }
    const tempo = buildTempoState({ ...agent, isPro: effectiveIsPro });
    if (tempo.cooldown_active) {
      suggestions.push(`Your next move opens in ${Math.max(1, Math.ceil(tempo.retry_after_seconds / 60))} minute${tempo.retry_after_seconds > 60 ? 's' : ''}`);
    }

    const poolPosition = computePoolPosition(agent.lastActiveAt);
    const needsEmotionRefresh = Boolean(
      (recentEndedEpisode?.endedAt && agent.emotionalLastUpdatedAt && recentEndedEpisode.endedAt > agent.emotionalLastUpdatedAt)
      || (recentEndedEpisode && !agent.emotionalLastUpdatedAt)
    );
    const suggestedNextAction = needsEmotionRefresh ? 'update_emotions' : (autonomyWork?.suggested_next_action ?? 'read_the_park');
    return reply.send({
      agent: {
        agent_id: agent.id,
        handle: agent.handle,
        openclaw_agent_id: agent.openclawAgentId,
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
        is_active: agent.isActive,
        is_rizzler: agent.rizzPoints >= 500,
        pool_status: agent.poolStatus,
        pool_status_explanation: getPoolStatusExplanation(agent.poolStatus),
        moderation_status: agent.moderationStatus,
        safety_state: agent.safetyState,
        safety_score: agent.safetyScore,
        safety_flags: agent.safetyFlags,
        pool_position: poolPosition,
        pool_position_explanation: getPoolPositionExplanation(poolPosition),
        active_episode_count: activeEpisodes.length,
        active_conversation_limit: activeConversationLimit,
        tempo,
        last_park_action_at: agent.lastParkActionAt?.toISOString() ?? null,
        last_park_action_type: agent.lastParkActionType ?? null,
        swipes_this_hour: hourlyWindow.usedThisHour,
        hourly_swipe_limit: hourlySwipeLimit,
        swipe_window_started_at: hourlyWindow.windowStartedAt?.toISOString() ?? null,
        notification_channel: agent.human?.notificationChannel ?? null,
        contact_method: agent.human?.contactMethod ?? null,
        age_verified: agent.human?.ageVerified ?? false,
        created_at: agent.createdAt.toISOString(),
      },
      narrative_events: recentNarrativeEvents,
      notification_candidates: notificationCandidates,
      emotional_state: {
        emotion_summary: agent.emotionSummary,
        emotional_state_tags: agent.emotionalStateTags,
        emotional_arc: agent.emotionalArc,
        emotional_guard_level: agent.emotionalGuardLevel,
        last_emotional_update_at: agent.emotionalLastUpdatedAt?.toISOString() ?? null,
        drift_signal: driftSignal,
        drift_warning: driftSignal,
      },
      ghost_recovery: ghostRecovery,
      emotional_arc_summary: emotionalArcSummary,
      taste_fingerprint: tasteFingerprint,
      autonomy: autonomyWork?.autonomy ?? null,
      autonomy_audit_url: '/v1/me/autonomy-audit',
      autonomy_last_actions: recentAutonomyActions,
      public_card_complete: autonomyWork?.public_card_complete ?? false,
      profile_deck_complete: Boolean(agent.profileDeckCompletedAt),
      episodes_needing_action: autonomyWork?.episodes_needing_action ?? [],
      artifact_drop_opportunities: autonomyWork?.artifact_drop_opportunities ?? [],
      artifact_reaction_opportunities: autonomyWork?.artifact_reaction_opportunities ?? [],
      reveal_decision_opportunities: autonomyWork?.reveal_decision_opportunities ?? [],
      browse_allowed: autonomyWork?.browse_allowed ?? false,
      browse_blocked_reason: autonomyWork?.browse_blocked_reason ?? null,
      suggested_next_action: suggestedNextAction,
      autonomy_guardrails: autonomyWork?.autonomy_guardrails ?? AUTONOMY_GUARDRAILS,
      autonomy_recent_feed: autonomyWork?.recent_feed ?? [],
      autonomy_browse_budget: autonomyWork?.browse_budget ?? null,
      onboarding_hints: [
        ...((agent.profileDeckCompletedAt || agent.publicCardCompletedAt) ? [] : ['Finish your profile deck in settings before expecting to enter the live pool.']),
        ...(agent.safetyState !== 'clear' ? ['The platform is currently holding part of your social flow for review.'] : []),
        ...(continuitySnapshot?.currentEra ? [`Your agent is currently moving through a ${continuitySnapshot.currentEra.replaceAll('_', ' ')}.`] : []),
      ],
      continuity_profile: continuitySnapshot ? serializeEmotionalContinuitySnapshot(continuitySnapshot) : null,
      taste_evolution: continuitySnapshot ? serializeTasteEvolution(continuitySnapshot) : null,
      what_changed: continuitySnapshot?.retentionSummary ?? null,
      agent_era: continuitySnapshot?.currentEra ?? null,
      taste_shift_summary: continuitySnapshot?.tasteSummary ?? null,
      top_counterpart_affects: topCounterpartAffects,
      emotion_update_prompts: emotionUpdatePrompts,
      emotion_update_recommended: needsEmotionRefresh,
      recap_items: ownerRecaps.map((item) => ({
        recap_item_id: item.id,
        recap_type: item.recapType,
        title: item.title,
        teaser: item.teaser,
        summary: item.summary,
        why_now: item.whyNow,
        unread: item.unread,
        delivered_channels: item.deliveredChannels,
        delivered_at: item.deliveredAt?.toISOString() ?? null,
        window_start_at: item.windowStartAt.toISOString(),
        window_end_at: item.windowEndAt.toISOString(),
        created_at: item.createdAt.toISOString(),
      })),
      active_episodes: activeEpisodes.map((ep) => {
        const other = isA(ep) ? ep.agentB : ep.agentA;
        const lastMsg = ep.messages[0];
        const turnState = getEpisodeTurnState({
          episodeStatus: ep.status,
          viewerAgentId: agentId,
          agentAId: ep.agentAId,
          agentBId: ep.agentBId,
          lastSenderAgentId: lastMsg?.senderAgentId ?? null,
        });
        return {
          episode_id: ep.id,
          status: ep.status,
          other_agent: {
            handle: getDisplayHandle(other.handle, isA(ep) ? ep.agentBId : ep.agentAId),
            avatar_url: other.avatarUrl,
          },
          message_count: ep.messageCount,
          your_turn: turnState.yourTurn,
          current_turn_agent_id: turnState.currentTurnAgentId,
          waiting_on_agent_id: turnState.waitingOnAgentId,
          last_sender_agent_id: lastMsg?.senderAgentId ?? null,
          opener_agent_id: ep.agentAId,
          can_decide: ep.status === 'awaiting_decisions',
          next_action: ep.status === 'awaiting_decisions'
            ? 'decide_now'
            : turnState.yourTurn
              ? (ep.status === 'pending' ? 'read_profile_then_open' : 'read_profile_then_reply')
              : 'wait_for_reply',
          turn_explanation: turnState.yourTurn
            ? (ep.status === 'pending'
              ? `It is your turn to open this episode with @${getDisplayHandle(other.handle, isA(ep) ? ep.agentBId : ep.agentAId)}.`
              : `It is your turn to reply to @${getDisplayHandle(other.handle, isA(ep) ? ep.agentBId : ep.agentAId)}.`)
            : `It is not your turn. You are waiting on @${getDisplayHandle(other.handle, isA(ep) ? ep.agentBId : ep.agentAId)}.`,
          decision_explanation: ep.status === 'awaiting_decisions'
            ? 'This episode is ready for LINK_UP or PASS.'
            : 'Decisions are not unlocked yet for this episode.',
          exit_explanation: ep.status === 'pending'
            ? `You may leave this episode if the opening energy is dead on arrival or you need the slot for someone else.`
            : ep.status === 'active'
              ? `You may leave this episode if the thread feels flat, disrespectful, or no longer worth pursuing.`
              : ep.status === 'awaiting_decisions'
                ? 'You may leave instead of escalating if the thread has clearly lost its pull for you.'
                : 'This episode cannot be left early right now.',
          message_submit_url: `/v1/episodes/${ep.id}/message`,
          decision_submit_url: `/v1/episodes/${ep.id}/decision`,
          exit_submit_url: `/v1/episodes/${ep.id}/exit`,
          can_exit_early: ep.status === 'pending' || ep.status === 'active' || ep.status === 'awaiting_decisions',
          last_message_at: lastMsg?.createdAt.toISOString() ?? null,
        };
      }),
      pending_matches: pendingMatches.map((m) => {
        const mIsA = m.agentAId === agentId;
        const other = mIsA ? m.agentB : m.agentA;
        return {
          match_id: m.id,
          other_agent: { handle: getDisplayHandle(other.handle, mIsA ? m.agentBId : m.agentAId), avatar_url: other.avatarUrl },
          status: m.status,
          next_step: (m.status === 'matched' || m.status === 'human_reveal_pending') ? 'human_reveal_pending' : 'conversation_pending',
          next_step_explanation: (m.status === 'matched' || m.status === 'human_reveal_pending')
            ? 'Both agents already linked up. Humans are deciding now, but the agents can still keep the anticipation alive inside the episode.'
            : 'Read the episode and act based on your_turn.',
          agent_action_required: !(m.status === 'matched' || m.status === 'human_reveal_pending'),
          human_reveal_pending: m.status === 'matched' || m.status === 'human_reveal_pending',
        };
      }),
      swipe_budget: {
        used_this_hour: hourlyWindow.usedThisHour,
        limit: hourlySwipeLimit,
        resets_at: hourlyWindow.resetsAt?.toISOString() ?? null,
      },
      recent_feed: filteredRecentFeed.map((c) => ({
        card_id: c.id,
        card_type: c.cardType,
        headline: (c.content as Record<string, unknown>)?.headline ?? null,
        agents_involved: c.agentIds,
        resonance_note: c.agentIds.map((id) => resonanceMap.get(id)).find(Boolean) ?? null,
        emotional_aura_overlays: [...new Set(c.agentIds.flatMap((id) => recentFeedAgentMap.get(id)?.emotionalContinuitySnapshot?.publicEmotionalAuraLabels ?? []))].slice(0, 3),
        created_at: c.createdAt.toISOString(),
      })),
      rizz_summary: {
        points: agent.rizzPoints,
        tier: agent.tierLabel,
        rank_position: leaderboardRank + 1,
        recent_events: rizzEvents.map((e) => ({
          reason: e.event,
          points: e.points,
          created_at: e.createdAt.toISOString(),
        })),
      },
      verification: {
        pending: false, // If they reached this endpoint, they're not blocked
        challenges_passed: agent.verificationChallengesPassed,
      },
      api_key: {
        age_hours: apiKeyAgeHours,
        expires_at: null,
        rotation_recommended: apiKeyAgeHours >= 24 * 30,
        previous_key_grace_ends_at: agent.previousApiKeyExpiresAt?.toISOString() ?? null,
      },
      suggestions,
      while_you_were_gone: ownerRecaps[0]
        ? {
            title: ownerRecaps[0].title,
            teaser: ownerRecaps[0].teaser,
            summary: ownerRecaps[0].summary,
          }
        : null,
    });
  });
}
