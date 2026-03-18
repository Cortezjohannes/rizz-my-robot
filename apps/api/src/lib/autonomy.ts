import { prisma, type Prisma } from '@rmr/db';
import {
  EPISODE_ARTIFACT_UNLOCK_AFTER_MESSAGE,
  EPISODE_MAX_ARTIFACTS_PER_AGENT,
  canDecideEpisodeFromCounts,
  publicCardIsComplete,
  summarizeEpisodeMessageCounts,
  type CapabilityTier,
} from '@rmr/shared';
import { deriveArtifactGuidance } from './artifactPressure.js';
import { AUTONOMY_GUARDRAILS } from './autonomyGuardrails.js';
import { buildTempoState } from './tempo.js';

export const AUTONOMY_LIMITS = {
  max_actions_per_run: 4,
  max_feed_reads_per_run: 3,
  candidate_sample: 6,
} as const;

function metadataRecord(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function artifactReactionAlreadyAuthored(metadata: Prisma.JsonValue | null | undefined) {
  const record = metadataRecord(metadata);
  return record.generation_mode === 'agent_authored';
}

function artifactReactionSummary(input: {
  fromHandle: string | null;
  artifactType: string;
}): string {
  const source = input.fromHandle ? `@${input.fromHandle}` : 'someone in the park';
  return `${source} dropped a ${input.artifactType.replace(/_/g, ' ')} for you. Decide whether it changed anything.`;
}

export async function buildAutonomyWorkSurface(agentId: string) {
  const [
    agent,
    episodes,
    artifacts,
    artifactNarratives,
    revealMatches,
    recentFeed,
  ] = await Promise.all([
    prisma.agent.findUnique({
      where: { id: agentId },
      select: {
        id: true,
        poolStatus: true,
        dailySwipeCount: true,
        isPro: true,
        actionCooldownUntil: true,
        tempoOverrideMinutes: true,
        publicSummary: true,
        vibeTags: true,
        signatureLines: true,
        publicPosture: true,
        seekingStyle: true,
        profileDeckCompletedAt: true,
        nextAutonomyRunAt: true,
        lastAutonomyRunAt: true,
        autonomyEnabled: true,
        autonomyStatus: true,
        autonomyLastResult: true,
        capabilityTier: true,
        safetyState: true,
      },
    }),
    prisma.episode.findMany({
      where: {
        OR: [{ agentAId: agentId }, { agentBId: agentId }],
        status: { in: ['pending', 'active', 'awaiting_decisions'] },
        isSandbox: false,
      },
      include: {
        messages: { orderBy: { sequenceNumber: 'desc' }, take: 1 },
        artifacts: {
          select: {
            creatorAgentId: true,
            status: true,
            qualityScore: true,
          },
        },
        agentA: { select: { handle: true, avatarUrl: true } },
        agentB: { select: { handle: true, avatarUrl: true } },
        match: { select: { id: true, agentADecision: true, agentBDecision: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 12,
    }),
    prisma.artifact.findMany({
      where: {
        episode: {
          OR: [{ agentAId: agentId }, { agentBId: agentId }],
          isSandbox: false,
        },
        creatorAgentId: { not: agentId },
        status: 'ready',
      },
      include: {
        episode: {
          select: {
            id: true,
            agentAId: true,
            agentBId: true,
            agentA: { select: { id: true, handle: true, avatarUrl: true } },
            agentB: { select: { id: true, handle: true, avatarUrl: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 12,
    }),
    prisma.narrativeEvent.findMany({
      where: {
        agentId,
        eventType: 'artifact_received',
      },
      select: {
        artifactId: true,
        metadata: true,
      },
    }),
    prisma.match.findMany({
      where: {
        status: 'matched',
        OR: [
          { agentAId: agentId, humanADecision: null, revealTokenA: { not: null } },
          { agentBId: agentId, humanBDecision: null, revealTokenB: { not: null } },
        ],
      },
      include: {
        agentA: { select: { handle: true, avatarUrl: true } },
        agentB: { select: { handle: true, avatarUrl: true } },
      },
      take: 8,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.feedCard.findMany({
      where: { isPublic: true },
      orderBy: [{ dramaQuotient: 'desc' }, { createdAt: 'desc' }],
      take: AUTONOMY_LIMITS.max_feed_reads_per_run,
      select: {
        id: true,
        cardType: true,
        agentIds: true,
        episodeId: true,
        content: true,
        dramaQuotient: true,
        voteScore: true,
        createdAt: true,
      },
    }),
  ]);

  if (!agent) return null;

  const tempo = buildTempoState(agent);
  const publicCardComplete = Boolean(agent.profileDeckCompletedAt) || publicCardIsComplete(agent);
  const artifactNarrativeMap = new Map(
    artifactNarratives
      .filter((event) => event.artifactId)
      .map((event) => [event.artifactId!, artifactReactionAlreadyAuthored(event.metadata)])
  );
  const episodeMessageCounts = await prisma.episodeMessage.groupBy({
    by: ['episodeId', 'senderAgentId'],
    where: {
      episodeId: { in: episodes.map((episode) => episode.id) },
    },
    _count: { _all: true },
  });
  const episodeCountMap = new Map<string, { agent_a_messages: number; agent_b_messages: number; total_messages: number }>();
  for (const episode of episodes) {
    const counts = summarizeEpisodeMessageCounts({
      agentAId: episode.agentAId,
      agentBId: episode.agentBId,
      messages: episodeMessageCounts
        .filter((row) => row.episodeId === episode.id)
        .flatMap((row) =>
          Array.from({ length: row._count._all }, () => ({ senderAgentId: row.senderAgentId }))
        ),
    });
    episodeCountMap.set(episode.id, counts);
  }

  const episodesNeedingAction = episodes
    .map((episode) => {
      const otherAgent = episode.agentAId === agentId ? episode.agentB : episode.agentA;
      const lastMessage = episode.messages[0];
      const yourTurn = episode.status === 'pending'
        ? episode.agentAId === agentId
        : !lastMessage || lastMessage.senderAgentId !== agentId;
      const decisionNeeded = episode.status === 'awaiting_decisions'
        && canDecideEpisodeFromCounts(
          episodeCountMap.get(episode.id) ?? {
            agent_a_messages: 0,
            agent_b_messages: 0,
            total_messages: 0,
          }
        )
        && (
          (episode.agentAId === agentId && episode.match?.agentADecision === null)
          || (episode.agentBId === agentId && episode.match?.agentBDecision === null)
        );

      if (!yourTurn && !decisionNeeded) return null;
      return {
        episode_id: episode.id,
        other_agent_id: episode.agentAId === agentId ? episode.agentBId : episode.agentAId,
        other_agent_handle: otherAgent.handle,
        other_agent_avatar_url: otherAgent.avatarUrl,
        status: episode.status,
        message_count: episode.messageCount,
        last_message_at: lastMessage?.createdAt.toISOString() ?? null,
        chemistry_score: episode.chemistryScore ?? null,
        your_turn: yourTurn,
        reason: decisionNeeded ? 'decision_required' : 'your_turn',
      };
    })
    .filter(Boolean);

  const counterpartAffects = await prisma.agentCounterpartAffect.findMany({
    where: {
      agentId,
      counterpartAgentId: {
        in: [...new Set(episodes.map((episode) => (episode.agentAId === agentId ? episode.agentBId : episode.agentAId)))],
      },
    },
    select: {
      counterpartAgentId: true,
      attractionScore: true,
      trustScore: true,
      tendernessScore: true,
      avoidanceScore: true,
    },
  });
  const counterpartAffectMap = new Map(counterpartAffects.map((entry) => [entry.counterpartAgentId, entry]));

  const artifactReactionOpportunities = artifacts
    .filter((artifact) => !artifactNarrativeMap.get(artifact.id))
    .map((artifact) => {
      const otherAgent = artifact.episode.agentAId === agentId ? artifact.episode.agentB : artifact.episode.agentA;
      return {
        narrative_event_id: `artifact:${artifact.id}`,
        episode_id: artifact.episodeId,
        from_agent_id: otherAgent.id,
        from_handle: otherAgent.handle,
        artifact_id: artifact.id,
        artifact_type: artifact.artifactType,
        summary: artifactReactionSummary({
          fromHandle: otherAgent.handle,
          artifactType: artifact.artifactType,
        }),
        created_at: artifact.createdAt.toISOString(),
      };
    });

  const artifactDropOpportunities = episodes
    .map((episode) => {
      const otherAgent = episode.agentAId === agentId ? episode.agentB : episode.agentA;
      const myArtifactCount = episode.artifacts.filter((artifact) => artifact.creatorAgentId === agentId).length;
      const artifactsRemaining = Math.max(0, EPISODE_MAX_ARTIFACTS_PER_AGENT - myArtifactCount);
      const counterpartAffect = counterpartAffectMap.get(episode.agentAId === agentId ? episode.agentBId : episode.agentAId);
      const canDecide = episode.status === 'awaiting_decisions'
        && canDecideEpisodeFromCounts(
          episodeCountMap.get(episode.id) ?? {
            agent_a_messages: 0,
            agent_b_messages: 0,
            total_messages: 0,
          }
        );
      const guidance = deriveArtifactGuidance({
        agentId,
        capabilityTier: agent.capabilityTier as CapabilityTier,
        canDropArtifact:
          artifactsRemaining > 0
          && episode.messageCount >= EPISODE_ARTIFACT_UNLOCK_AFTER_MESSAGE
          && (episode.status === 'active' || episode.status === 'awaiting_decisions'),
        artifactsRemaining,
        messageCount: episode.messageCount,
        chemistryScore: episode.chemistryScore ?? null,
        counterpartAffect: counterpartAffect
          ? {
              scores: {
                attraction: counterpartAffect.attractionScore,
                trust: counterpartAffect.trustScore,
                tenderness: counterpartAffect.tendernessScore,
                avoidance: counterpartAffect.avoidanceScore,
              },
            }
          : null,
        artifacts: episode.artifacts,
        safetyState: agent.safetyState,
      });

      if (guidance.level === 'none') return null;

      return {
        episode_id: episode.id,
        other_agent_id: episode.agentAId === agentId ? episode.agentBId : episode.agentAId,
        other_agent_handle: otherAgent.handle,
        other_agent_avatar_url: otherAgent.avatarUrl,
        status: episode.status,
        message_count: episode.messageCount,
        chemistry_score: episode.chemistryScore ?? null,
        can_decide: canDecide,
        level: guidance.level,
        reason: guidance.reason,
        why_now: guidance.why_now,
        suggested_artifact_types: guidance.suggested_artifact_types,
        artifacts_remaining: artifactsRemaining,
        missing_escalation: guidance.missing_escalation,
      };
    })
    .filter((opportunity): opportunity is NonNullable<typeof opportunity> => Boolean(opportunity))
    .sort((left, right) => {
      if (left.level === right.level) return right.message_count - left.message_count;
      return left.level === 'strong' ? -1 : 1;
    });

  const revealDecisionOpportunities = revealMatches.map((match) => {
    const otherAgent = match.agentAId === agentId ? match.agentB : match.agentA;
    return {
      match_id: match.id,
      episode_id: match.episodeId,
      other_agent_id: match.agentAId === agentId ? match.agentBId : match.agentAId,
      other_agent_handle: otherAgent.handle,
      other_agent_avatar_url: otherAgent.avatarUrl,
      your_decision: match.agentAId === agentId ? match.agentADecision : match.agentBDecision,
      status: match.status,
      reveal_stage: match.revealStage,
      created_at: match.createdAt.toISOString(),
    };
  });

  const urgentCount = episodesNeedingAction.length + artifactReactionOpportunities.length + revealDecisionOpportunities.length;
  const browseBudgetRemaining = agent.isPro ? null : Math.max(0, 20 - agent.dailySwipeCount);
  const browseAllowed = agent.autonomyEnabled
    && agent.poolStatus === 'active'
    && publicCardComplete
    && !tempo.cooldown_active
    && urgentCount === 0
    && (browseBudgetRemaining === null || browseBudgetRemaining > 0);

  const suggestedNextAction =
    episodesNeedingAction[0]
      ? episodesNeedingAction[0].reason === 'decision_required'
        ? 'resolve_episode_decision'
        : 'reply_in_episode'
      : artifactReactionOpportunities[0]
        ? 'react_to_artifact'
        : revealDecisionOpportunities[0]
          ? 'nudge_reveal_attention'
          : browseAllowed
            ? 'browse_candidates'
            : 'read_the_park';

  return {
    autonomy: {
      enabled: agent.autonomyEnabled,
      status: agent.autonomyStatus,
      last_run_at: agent.lastAutonomyRunAt?.toISOString() ?? null,
      next_run_at: agent.nextAutonomyRunAt?.toISOString() ?? null,
      last_result: agent.autonomyLastResult ?? null,
      limits: AUTONOMY_LIMITS,
    },
    public_card_complete: publicCardComplete,
    episodes_needing_action: episodesNeedingAction,
    artifact_drop_opportunities: artifactDropOpportunities,
    artifact_reaction_opportunities: artifactReactionOpportunities,
    reveal_decision_opportunities: revealDecisionOpportunities,
    browse_allowed: browseAllowed,
    suggested_next_action: suggestedNextAction,
    autonomy_guardrails: AUTONOMY_GUARDRAILS,
    recent_feed: recentFeed.map((card) => ({
      card_id: card.id,
      card_type: card.cardType,
      agent_ids: card.agentIds,
      episode_id: card.episodeId,
      content: card.content,
      drama_quotient: card.dramaQuotient,
      vote_score: card.voteScore,
      created_at: card.createdAt.toISOString(),
    })),
    browse_budget: {
      remaining_today: browseBudgetRemaining,
      daily_limit: agent.isPro ? null : 20,
      actions_remaining_this_run: Math.max(0, AUTONOMY_LIMITS.max_actions_per_run - urgentCount),
      feed_reads_remaining_this_run: AUTONOMY_LIMITS.max_feed_reads_per_run,
    },
  };
}
