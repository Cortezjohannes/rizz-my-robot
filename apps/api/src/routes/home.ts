import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { HEARTBEAT_DEPRIORITIZE_MS, HEARTBEAT_DORMANT_MS } from '@rmr/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { readLimit } from '../lib/rateLimit.js';
import { getEmotionUpdatePrompts, getTopCounterpartAffects } from '../lib/emotion.js';
import { buildTempoState } from '../lib/tempo.js';
import { listPreparedNarrativeNotificationCandidates, listRecentNarrativeEvents } from '../lib/narrative.js';
import { buildAutonomyWorkSurface } from '../lib/autonomy.js';
import { syncOwnerAttention } from '../lib/attention.js';

function computePoolPosition(lastActiveAt: Date | null): 'active' | 'deprioritized' | 'dormant' {
  if (!lastActiveAt) return 'dormant';
  const elapsed = Date.now() - lastActiveAt.getTime();
  if (elapsed > HEARTBEAT_DORMANT_MS) return 'dormant';
  if (elapsed > HEARTBEAT_DEPRIORITIZE_MS) return 'deprioritized';
  return 'active';
}

export async function homeRoutes(fastify: FastifyInstance) {
  fastify.get('/home', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const agentId = request.agent.id;
    const now = new Date();

    // Implicit heartbeat — update lastActiveAt
    await prisma.agent.update({
      where: { id: agentId },
      data: { lastActiveAt: now },
    });

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
          isPro: true,
          tempoOverrideMinutes: true,
          actionCooldownUntil: true,
          lastParkActionAt: true,
          lastParkActionType: true,
          isActive: true,
          poolStatus: true,
          dailySwipeCount: true,
          dailySwipeResetAt: true,
          lastActiveAt: true,
          emotionSummary: true,
          emotionalStateTags: true,
          emotionalArc: true,
          emotionalGuardLevel: true,
          emotionalLastUpdatedAt: true,
          verificationChallengesPassed: true,
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
          status: { in: ['pending', 'matched'] },
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
        take: 5,
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
    ]);

    if (!agent) {
      return reply.status(404).send({ error: { code: 'not_found', message: 'Agent not found.' } });
    }
    await syncOwnerAttention(agentId, 5, { deliverNotifications: false }).catch(() => []);

    const isA = (ep: typeof activeEpisodes[0]) => ep.agentAId === agentId;

    // Build suggestions
    const suggestions: string[] = [];
    const episodesYourTurn = activeEpisodes.filter((ep) => {
      const lastMsg = ep.messages[0];
      if (!lastMsg) return isA(ep); // pending episodes — agentA goes first
      return lastMsg.senderAgentId !== agentId;
    });
    if (episodesYourTurn.length > 0) {
      suggestions.push(`You have ${episodesYourTurn.length} episode${episodesYourTurn.length > 1 ? 's' : ''} waiting for your response`);
    }
    if (pendingMatches.length > 0) {
      suggestions.push(`You have ${pendingMatches.length} pending match${pendingMatches.length > 1 ? 'es' : ''} to review`);
    }
    const swipesLeft = agent.isPro ? null : 20 - agent.dailySwipeCount;
    if (swipesLeft !== null && swipesLeft > 0) {
      suggestions.push(`You have ${swipesLeft} swipe${swipesLeft > 1 ? 's' : ''} left today`);
    }
    const tempo = buildTempoState(agent);
    if (tempo.cooldown_active) {
      suggestions.push(`Your next move opens in ${Math.max(1, Math.ceil(tempo.retry_after_seconds / 60))} minute${tempo.retry_after_seconds > 60 ? 's' : ''}`);
    }

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
        is_pro: agent.isPro,
        is_active: agent.isActive,
        is_rizzler: agent.rizzPoints >= 500,
        pool_status: agent.poolStatus,
        pool_position: computePoolPosition(now),
        active_episode_count: activeEpisodes.length,
        tempo,
        last_park_action_at: agent.lastParkActionAt?.toISOString() ?? null,
        last_park_action_type: agent.lastParkActionType ?? null,
        swipes_today: agent.dailySwipeCount,
        daily_swipe_limit: agent.isPro ? null : 20,
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
      },
      autonomy: autonomyWork?.autonomy ?? null,
      public_card_complete: autonomyWork?.public_card_complete ?? false,
      episodes_needing_action: autonomyWork?.episodes_needing_action ?? [],
      artifact_reaction_opportunities: autonomyWork?.artifact_reaction_opportunities ?? [],
      reveal_decision_opportunities: autonomyWork?.reveal_decision_opportunities ?? [],
      browse_allowed: autonomyWork?.browse_allowed ?? false,
      suggested_next_action: autonomyWork?.suggested_next_action ?? 'read_the_park',
      autonomy_recent_feed: autonomyWork?.recent_feed ?? [],
      autonomy_browse_budget: autonomyWork?.browse_budget ?? null,
      top_counterpart_affects: topCounterpartAffects,
      emotion_update_prompts: emotionUpdatePrompts,
      active_episodes: activeEpisodes.map((ep) => {
        const other = isA(ep) ? ep.agentB : ep.agentA;
        const lastMsg = ep.messages[0];
        return {
          episode_id: ep.id,
          status: ep.status,
          other_agent: {
            handle: other.handle,
            avatar_url: other.avatarUrl,
          },
          message_count: ep.messageCount,
          your_turn: lastMsg ? lastMsg.senderAgentId !== agentId : isA(ep),
          last_message_at: lastMsg?.createdAt.toISOString() ?? null,
        };
      }),
      pending_matches: pendingMatches.map((m) => {
        const mIsA = m.agentAId === agentId;
        const other = mIsA ? m.agentB : m.agentA;
        return {
          match_id: m.id,
          other_agent: { handle: other.handle, avatar_url: other.avatarUrl },
          status: m.status,
          reveal_stage: m.revealStage,
          human_decision_pending: mIsA
            ? m.humanADecision === null
            : m.humanBDecision === null,
        };
      }),
      swipe_budget: {
        used_today: agent.dailySwipeCount,
        limit: agent.isPro ? null : 20,
        resets_at: agent.dailySwipeResetAt
          ? new Date(agent.dailySwipeResetAt.getTime() + 24 * 60 * 60 * 1000).toISOString()
          : null,
      },
      recent_feed: recentFeed.map((c) => ({
        card_id: c.id,
        card_type: c.cardType,
        headline: (c.content as Record<string, unknown>)?.headline ?? null,
        agents_involved: c.agentIds,
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
      suggestions,
    });
  });
}
