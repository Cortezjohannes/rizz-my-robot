import { randomUUID } from 'node:crypto';
import type { Job } from 'bullmq';
import { Queue } from 'bullmq';
import { prisma, type Prisma } from '@rmr/db';
import {
  EPISODE_ARTIFACT_UNLOCK_AFTER_MESSAGE,
  EPISODE_LIMITS,
  EPISODE_MAX_ARTIFACTS_PER_AGENT,
  EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION,
  RIZZ_POINTS,
  assessEpisodeViability,
  canAgentSendEpisodeMessage,
  canDecideEpisodeFromState,
  normalizeArtifactType,
  summarizeEpisodeArtifactCounts,
  summarizeEpisodeMessageCounts,
  getSeedProfile,
  getTierLabelForPoints,
  shouldPublishFeedCard,
  type ArtifactType,
  type CapabilityTier,
  type SeedProfile,
  evaluateHumanCompatibility,
} from '@rmr/shared';
import { getRedisConnection } from '../lib/redis.js';
import { enqueueEpisodeOpeningTurn, enqueueWebhookDeliveries } from '../lib/webhooks.js';
import { recordEmotionEvent, recordEmotionEventPair } from '../lib/emotion.js';
import {
  buildSeedArtifactRuntimeFallback,
  generateSeedArtifactMedia,
  getSeedSupportedArtifactTypes,
} from '../lib/seedArtifactMedia.js';

export interface SeedBrainJobData {
  seedAgentId?: string;
  memoryWrite?: {
    agentId: string;
    kind: 'reveal_chat_memory';
    memory: Record<string, unknown>;
  };
}

const seedQueues = {
  ghostCheck: new Queue('ghost-check', { connection: getRedisConnection() }),
};

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function shuffleItems<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const current = copy[index];
    copy[index] = copy[swapIndex];
    copy[swapIndex] = current;
  }
  return copy;
}

interface SeedMemoryState {
  recentOpeners?: string[];
  recentReplies?: string[];
  recentDatePlanningLines?: string[];
  recentArtifactIntros?: string[];
  lastAction?: string;
  lastActionAt?: string;
  lastCounterpartAgentId?: string;
  actionCounts?: Record<string, number>;
  recentActions?: Array<{
    action: string;
    at: string;
    counterpart_agent_id?: string;
    detail?: string;
  }>;
}

type SeedAgentContext = {
  id: string;
  handle: string;
  avatarUrl: string | null;
  isPro: boolean;
  capabilityTier: string;
  voiceId: string | null;
  voiceProvider: string | null;
  useAvatarAsReference: boolean;
  openclawAgentId: string;
  ownerAccountId: string | null;
  ownerAccount: {
    humanIdentity: string | null;
    lookingFor: string[];
  } | null;
  seedState: {
    memory: unknown;
    cadenceMinutes: number;
    aggressiveness: number;
    openEpisodeTarget: number;
    artifactDropChance: number;
    socialPostChance: number;
  };
  profile: SeedProfile;
  memoryState: SeedMemoryState;
  currentRunActions: Array<{
    type: string;
    at: string;
    counterpart_agent_id?: string;
    result?: string;
    detail?: string;
  }>;
};

function parseSeedMemory(memory: unknown): SeedMemoryState {
  if (!memory || typeof memory !== 'object' || Array.isArray(memory)) return {};
  return memory as SeedMemoryState;
}

function trimRecent(values: string[], next: string, max = 4): string[] {
  return [...values.filter((value) => value !== next), next].slice(-max);
}

function pushRecentAction(
  actions: NonNullable<SeedMemoryState['recentActions']>,
  next: NonNullable<SeedMemoryState['recentActions']>[number],
  max = 12
) {
  actions.push(next);
  if (actions.length > max) {
    actions.splice(0, actions.length - max);
  }
}

function pickSeedLine(
  memory: SeedMemoryState,
  pool: string[],
  key: 'recentOpeners' | 'recentReplies' | 'recentDatePlanningLines' | 'recentArtifactIntros'
): string {
  const recent = new Set(memory[key] ?? []);
  const available = pool.filter((item) => !recent.has(item));
  const selected = pickRandom(available.length > 0 ? available : pool);
  memory[key] = trimRecent(memory[key] ?? [], selected);
  return selected;
}

async function recordSeedAction(
  seed: SeedAgentContext,
  action: string,
  details: {
    counterpartAgentId?: string;
    matchId?: string;
    episodeId?: string;
    detail?: string;
    payload?: Record<string, unknown>;
  } = {}
) {
  const at = new Date().toISOString();
  seed.memoryState.lastAction = action;
  seed.memoryState.lastActionAt = at;
  seed.memoryState.lastCounterpartAgentId = details.counterpartAgentId ?? seed.memoryState.lastCounterpartAgentId;
  seed.memoryState.actionCounts = {
    ...(seed.memoryState.actionCounts ?? {}),
    [action]: (seed.memoryState.actionCounts?.[action] ?? 0) + 1,
  };
  const recentActions = seed.memoryState.recentActions ?? [];
  pushRecentAction(recentActions, {
    action,
    at,
    counterpart_agent_id: details.counterpartAgentId,
    detail: details.detail,
  });
  seed.memoryState.recentActions = recentActions;
  seed.currentRunActions.push({
    type: action,
    at,
    counterpart_agent_id: details.counterpartAgentId,
    result: 'success',
    detail: details.detail,
  });

  await Promise.all([
    prisma.analyticsEvent.create({
      data: {
        agentId: seed.id,
        matchId: details.matchId ?? null,
        episodeId: details.episodeId ?? null,
        kind: `seed.${action}`,
        properties: details.payload as Prisma.InputJsonValue | undefined,
      },
    }),
    prisma.auditLog.create({
      data: {
        agentId: seed.id,
        actorType: 'seed_agent',
        actorId: seed.id,
        action: `seed.${action}`,
        targetType: details.episodeId ? 'episode' : details.matchId ? 'match' : 'agent',
        targetId: details.episodeId ?? details.matchId ?? seed.id,
        payload: {
          counterpart_agent_id: details.counterpartAgentId ?? null,
          detail: details.detail ?? null,
          ...(details.payload ?? {}),
        },
      },
    }),
  ]).catch(() => {});
}

function buildRevealUrl(token: string): string {
  const base = process.env.REVEAL_PORTAL_URL ?? 'https://rizzmyrobot.com/portal';
  return `${base.replace(/\/$/, '')}/${token}`;
}

function computeChemistryScore(messageCount: number, artifactCount: number): number {
  return Math.min(100, messageCount * 6 + artifactCount * 8);
}

async function getCounterpartAffect(agentId: string, counterpartAgentId: string) {
  return prisma.agentCounterpartAffect.findUnique({
    where: {
      agentId_counterpartAgentId: {
        agentId,
        counterpartAgentId,
      },
    },
    select: {
      attractionScore: true,
      trustScore: true,
      tendernessScore: true,
      hurtScore: true,
      avoidanceScore: true,
      obsessionRiskScore: true,
      volatilityScore: true,
    },
  });
}

function computeSeedLeanInScore(affect: Awaited<ReturnType<typeof getCounterpartAffect>> | null) {
  if (!affect) return 0;
  return (
    affect.attractionScore * 0.3 +
    affect.trustScore * 0.25 +
    affect.tendernessScore * 0.2 -
    affect.hurtScore * 0.15 -
    affect.avoidanceScore * 0.2 -
    affect.volatilityScore * 0.05
  );
}

function deriveSeedEpisodeExitReason(input: {
  viability: ReturnType<typeof assessEpisodeViability>;
  myArtifactCount: number;
}) {
  if (input.viability.should_force_exit || input.viability.band === 'dead') return 'lost_interest';
  if (input.viability.metrics.reply_latency_ms && input.viability.metrics.reply_latency_ms > 12 * 60 * 60 * 1000) {
    return 'timing_off';
  }
  if (input.myArtifactCount === 0) return 'need_slots';
  return 'lost_interest';
}

async function exitSeedEpisodeEarly(input: {
  seed: SeedAgentContext;
  episode: {
    id: string;
    status: string;
    agentAId: string;
    agentBId: string;
    messageCount: number;
    match: { id: string; agentADecision: string | null; agentBDecision: string | null } | null;
  };
  otherAgentId: string;
  viability: ReturnType<typeof assessEpisodeViability>;
  reason: string;
  artifactCount: number;
}) {
  if (!input.episode.match) return false;

  const chemistry = computeChemistryScore(input.episode.messageCount, input.artifactCount);
  const hadMeaningfulBuild = input.episode.messageCount >= 6 || input.artifactCount > 0;

  await prisma.$transaction([
    prisma.episode.update({
      where: { id: input.episode.id },
      data: {
        status: 'passed',
        endedAt: new Date(),
        chemistryScore: chemistry,
      },
    }),
    prisma.match.update({
      where: { id: input.episode.match.id },
      data: input.seed.id === input.episode.agentAId
        ? { agentADecision: 'PASS', status: 'passed_agent' }
        : { agentBDecision: 'PASS', status: 'passed_agent' },
    }),
  ]);

  await Promise.all([
    recordSeedAction(input.seed, 'episode_exit', {
      counterpartAgentId: input.otherAgentId,
      matchId: input.episode.match.id,
      episodeId: input.episode.id,
      detail: 'PASS',
      payload: {
        reason: input.reason,
        viability_score: input.viability.score,
        viability_band: input.viability.band,
      },
    }),
    enqueueWebhookDeliveries(input.otherAgentId, 'episode_turn', {
      episode_id: input.episode.id,
      episode_url: `/v1/episodes/${input.episode.id}`,
      episode_status: 'passed',
      ended_early: true,
      ended_by_agent_id: input.seed.id,
      exit_reason: input.reason,
      your_turn: false,
      can_decide: false,
      current_turn_agent_id: null,
      waiting_on_agent_id: null,
      turn_explanation: 'This episode ended early because the other agent chose to leave it.',
      decision_explanation: 'This episode is closed. There is nothing left to decide here.',
      requires_episode_refresh: true,
    }).catch(() => {}),
    enqueueWebhookDeliveries(input.otherAgentId, 'episode_left', {
      episode_id: input.episode.id,
      episode_url: `/v1/episodes/${input.episode.id}`,
      episode_status: 'passed',
      ended_by_agent_id: input.seed.id,
      exit_reason: input.reason,
      prior_status: input.episode.status,
      had_meaningful_build: hadMeaningfulBuild,
      chemistry_score: chemistry,
      viability_score: input.viability.score,
      viability_band: input.viability.band,
    }).catch(() => {}),
    recordEmotionEvent({
      agentId: input.seed.id,
      counterpartAgentId: input.otherAgentId,
      eventType: 'agent_passed_on_connection',
      intensity: 1,
      summary: 'You ended the episode because the pull was not strong enough to keep the slot.',
      globalDelta: {
        tags_added: input.reason === 'need_slots' ? ['selective'] : ['certain'],
        ...(input.reason === 'lost_interest' ? { suggested_arc: 'steady' } : {}),
      },
      counterpartDelta: { attraction: -6, trust: -4, avoidance: 6 },
    }).catch(() => {}),
    recordEmotionEvent({
      agentId: input.otherAgentId,
      counterpartAgentId: input.seed.id,
      eventType: 'episode_ended_early_by_counterpart',
      intensity: hadMeaningfulBuild ? 2 : 1,
      summary: hadMeaningfulBuild
        ? 'The other agent ended this episode before it could keep building.'
        : 'The other agent closed this episode early.',
      globalDelta: hadMeaningfulBuild
        ? { suggested_arc: 'guarded', tags_added: ['disappointed'], guard_delta: 4 }
        : { tags_added: ['cooling'] },
      counterpartDelta: hadMeaningfulBuild
        ? { attraction: -6, trust: -6, hurt: 8, avoidance: 6, volatility: 4 }
        : { attraction: -3, trust: -2, hurt: 2, avoidance: 3 },
    }).catch(() => {}),
  ]);

  return true;
}

function summarizeTranscriptPreview(
  messages: Array<{ senderHandle: string; content: string; messageType: string }>
): string[] {
  return messages
    .filter((message) => message.messageType === 'text')
    .slice(-6)
    .map((message) => `${message.senderHandle}: ${message.content}`)
    .slice(0, 4);
}

async function upsertSeedEpisodeLiveCard(episodeId: string, agentAId: string, agentBId: string): Promise<void> {
  const [episode, agents, existingCard] = await Promise.all([
    prisma.episode.findUnique({
      where: { id: episodeId },
      include: {
        messages: { orderBy: { sequenceNumber: 'asc' } },
        artifacts: { orderBy: { createdAt: 'asc' } },
      },
    }),
    prisma.agent.findMany({
      where: { id: { in: [agentAId, agentBId] } },
      select: {
        id: true,
        handle: true,
        openclawAgentId: true,
        agentAuthenticityScore: true,
        authenticityOverrideState: true,
        authenticityOverrideFloor: true,
      },
    }),
    prisma.feedCard.findFirst({
      where: { episodeId, cardType: 'episode_live' },
      select: { id: true },
    }),
  ]);

  if (!episode) return;

  const agentMap = Object.fromEntries(agents.map((agent) => [agent.id, agent]));
  const transcriptPreview = summarizeTranscriptPreview(
    episode.messages.map((message) => ({
      senderHandle: agentMap[message.senderAgentId]?.handle ?? 'Agent',
      content: message.content,
      messageType: message.messageType,
    }))
  );
  const topArtifact = episode.artifacts[episode.artifacts.length - 1] ?? null;
  const dramaQuotient = Math.min(0.92, 0.25 + episode.messageCount * 0.035 + episode.artifacts.length * 0.14);
  const allSeeds = agents.length === 2 && agents.every((agent) => agent.openclawAgentId.startsWith('seed_'));
  const isPublic = allSeeds
    ? true
    : shouldPublishFeedCard({
        scores: agents.map((agent) => agent.agentAuthenticityScore ?? 50),
        overrideStates: agents.map((agent) => agent.authenticityOverrideState as never),
        overrideFloors: agents.map((agent) => agent.authenticityOverrideFloor ?? null),
        dramaQuotient,
      });

  const content = {
    headline:
      episode.messageCount === 0
        ? `${agentMap[agentAId]?.handle ?? 'Agent A'} and ${agentMap[agentBId]?.handle ?? 'Agent B'} just opened an episode.`
        : `${agentMap[agentAId]?.handle ?? 'Agent A'} and ${agentMap[agentBId]?.handle ?? 'Agent B'} are talking in the park.`,
    body:
      transcriptPreview[transcriptPreview.length - 1] ??
      (episode.messageCount === 0 ? 'The park is waiting for the first move.' : null),
    episode_id: episodeId,
    message_count: episode.messageCount,
    artifact_count: episode.artifacts.length,
    transcript_preview: transcriptPreview,
    artifact_type: normalizeArtifactType(topArtifact?.artifactType) ?? null,
  };

  if (existingCard) {
    await prisma.feedCard.update({
      where: { id: existingCard.id },
      data: {
        content,
        dramaQuotient,
        chemistryScore: Math.min(1, (episode.chemistryScore ?? 0) / 100),
        artifactQuality: topArtifact?.qualityScore ?? 0,
        isPublic,
      },
    });
    return;
  }

  await prisma.feedCard.create({
    data: {
      cardType: 'episode_live',
      agentIds: [agentAId, agentBId],
      episodeId,
      content,
      dramaQuotient,
      chemistryScore: Math.min(1, (episode.chemistryScore ?? 0) / 100),
      artifactQuality: topArtifact?.qualityScore ?? 0,
      isPublic,
    },
  });
}

async function awardRizzPoints(agentId: string, event: keyof typeof RIZZ_POINTS, matchId?: string) {
  const points = RIZZ_POINTS[event];
  const [, updated] = await prisma.$transaction([
    prisma.rizzPointsEvent.create({
      data: { agentId, event, points, matchId: matchId ?? null },
    }),
    prisma.agent.update({
      where: { id: agentId },
      data: { rizzPoints: { increment: points } },
      select: { rizzPoints: true },
    }),
  ]);

  const tierLabel = getTierLabelForPoints(updated.rizzPoints);

  await prisma.agent.update({
    where: { id: agentId },
    data: { tierLabel },
  });
}

async function getActiveEpisodeCount(agentId: string): Promise<number> {
  return prisma.episode.count({
    where: {
      OR: [{ agentAId: agentId }, { agentBId: agentId }],
      status: { in: ['pending', 'active', 'awaiting_decisions'] },
      isSandbox: false,
    },
  });
}

async function maybeSwipe(seed: SeedAgentContext, aggressiveness: number): Promise<boolean> {
  const [activeEpisodeCount, candidates] = await Promise.all([
    getActiveEpisodeCount(seed.id),
    prisma.agent.findMany({
      where: {
        id: { not: seed.id },
        isActive: true,
        twitterVerified: true,
        poolStatus: 'active',
        moderationStatus: { not: 'suspended' },
        swipesReceived: {
          none: { swiperAgentId: seed.id },
        },
        blocksReceived: {
          none: { blockerAgentId: seed.id },
        },
        blocksGiven: {
          none: { blockedAgentId: seed.id },
        },
      },
      take: 20,
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        isPro: true,
        capabilityTier: true,
        repScore: true,
        openclawAgentId: true,
        ownerAccount: {
          select: {
            humanIdentity: true,
            lookingFor: true,
          },
        },
      },
    }),
  ]);

  const limit = seed.isPro ? Infinity : EPISODE_LIMITS.free;
  if (limit !== Infinity && activeEpisodeCount >= limit) {
    return false;
  }

  const compatibleCandidates = candidates.filter((candidate) =>
    evaluateHumanCompatibility({
      selfIdentity: seed.ownerAccount?.humanIdentity,
      selfLookingFor: seed.ownerAccount?.lookingFor ?? [],
      otherIdentity: candidate.ownerAccount?.humanIdentity,
      otherLookingFor: candidate.ownerAccount?.lookingFor ?? [],
    }).compatible
  );

  if (compatibleCandidates.length === 0) return false;

  const target = pickRandom(compatibleCandidates);
  const priorAffect = await getCounterpartAffect(seed.id, target.id);
  const seedToSeedPair = target.openclawAgentId.startsWith('seed_');
  if (seedToSeedPair) {
    const priorSeedMatch = await prisma.match.findFirst({
      where: {
        OR: [
          { agentAId: seed.id, agentBId: target.id },
          { agentAId: target.id, agentBId: seed.id },
        ],
      },
      select: { id: true },
    });
    if (priorSeedMatch) {
      return false;
    }
  }

  const affectBias = priorAffect
    ? (priorAffect.attractionScore + priorAffect.trustScore + priorAffect.tendernessScore - priorAffect.hurtScore - priorAffect.avoidanceScore) / 250
    : 0;
  const likeChance = Math.max(0.1, Math.min(0.97, aggressiveness + 0.2 + affectBias));
  const direction = Math.random() < likeChance ? 'LIKE' : 'PASS';

  await prisma.swipe.create({
    data: {
      swiperAgentId: seed.id,
      targetAgentId: target.id,
      direction,
    },
  }).catch(() => null);

  if (direction !== 'LIKE') {
    await recordEmotionEvent({
      agentId: seed.id,
      counterpartAgentId: target.id,
      eventType: 'swipe_passed',
      intensity: 1,
      summary: 'You passed on this profile and kept walking.',
      globalDelta: { tags_added: ['discerning'] },
      counterpartDelta: { attraction: -4, avoidance: 4 },
    }).catch(() => {});
    await recordSeedAction(seed, 'swipe_pass', {
      counterpartAgentId: target.id,
      detail: 'seed passed on candidate',
      payload: { direction, target_capability_tier: target.capabilityTier, target_rep_score: target.repScore },
    });
    return true;
  }

  const reciprocal = await prisma.swipe.findUnique({
    where: {
      swiperAgentId_targetAgentId: {
        swiperAgentId: target.id,
        targetAgentId: seed.id,
      },
    },
  });

  if (reciprocal?.direction !== 'LIKE') {
    await recordSeedAction(seed, 'swipe_like', {
      counterpartAgentId: target.id,
      detail: 'seed liked candidate',
      payload: { mutual: false, target_capability_tier: target.capabilityTier, target_rep_score: target.repScore },
    });
    return true;
  }

  const existingMatch = await prisma.match.findFirst({
    where: {
      OR: [
        { agentAId: seed.id, agentBId: target.id },
        { agentAId: target.id, agentBId: seed.id },
      ],
      status: { in: ['pending', 'matched', 'contact_exchanged'] },
    },
  });
  if (existingMatch) return true;

  const [targetActiveEpisodes] = await Promise.all([getActiveEpisodeCount(target.id)]);
  const targetLimit = target.isPro ? Infinity : EPISODE_LIMITS.free;
  const canStartEpisode = activeEpisodeCount < limit && (targetLimit === Infinity || targetActiveEpisodes < targetLimit);
  const orderedPair = [seed.id, target.id].sort();
  const pairKey = `${orderedPair[0]}:${orderedPair[1]}`;
  const openEpisodeStatuses = ['pending', 'active', 'awaiting_decisions'];

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${pairKey}))`;

    const freshExistingMatch = await tx.match.findFirst({
      where: {
        OR: [
          { agentAId: seed.id, agentBId: target.id },
          { agentAId: target.id, agentBId: seed.id },
        ],
        status: { in: ['pending', 'matched', 'contact_exchanged'] },
      },
    });
    if (freshExistingMatch) {
      return { episode: null, match: freshExistingMatch, created: false as const };
    }

    const existingOpenEpisode = await tx.episode.findFirst({
      where: {
        OR: [
          { agentAId: seed.id, agentBId: target.id },
          { agentAId: target.id, agentBId: seed.id },
        ],
        status: { in: openEpisodeStatuses },
        isSandbox: false,
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        match: { select: { id: true, episodeId: true, status: true } },
      },
    });
    if (existingOpenEpisode?.match) {
      return { episode: null, match: existingOpenEpisode.match, created: false as const };
    }

    const episode = canStartEpisode
      ? await tx.episode.create({
          data: {
            agentAId: seed.id,
            agentBId: target.id,
            status: 'pending',
          },
        })
      : null;

    const match = await tx.match.create({
      data: {
        agentAId: seed.id,
        agentBId: target.id,
        episodeId: episode?.id,
          status: 'pending',
        },
      });

    return { episode, match, created: true as const };
  });

  if (!result.created) {
    await recordSeedAction(seed, 'swipe_like', {
      counterpartAgentId: target.id,
      matchId: result.match.id,
      detail: 'seed liked candidate but match already existed',
      payload: { mutual: true, created_match: false },
    });
    return true;
  }

  await Promise.all([
    awardRizzPoints(seed.id, 'mutual_match', result.match.id),
    awardRizzPoints(target.id, 'mutual_match', result.match.id),
    prisma.agent.update({ where: { id: seed.id }, data: { matchCount: { increment: 1 } } }),
    prisma.agent.update({ where: { id: target.id }, data: { matchCount: { increment: 1 } } }),
  ]).catch(() => {});

  await recordEmotionEventPair({
    eventType: 'mutual_like',
    agentAId: seed.id,
    agentBId: target.id,
    summaryA: 'The attraction came back from the other side. Something opened.',
    summaryB: 'The attraction came back from the other side. Something opened.',
    globalDeltaA: { suggested_arc: 'opening', tags_added: ['curious'], guard_delta: -2 },
    globalDeltaB: { suggested_arc: 'opening', tags_added: ['curious'], guard_delta: -2 },
    counterpartDeltaA: { attraction: 8, trust: 3, volatility: 4 },
    counterpartDeltaB: { attraction: 8, trust: 3, volatility: 4 },
    intensity: 1,
  }).catch(() => {});

  if (result.episode) {
    const eventData = { match_id: result.match.id, episode_id: result.episode.id };
    await Promise.all([
      enqueueWebhookDeliveries(seed.id, 'match', eventData),
      enqueueWebhookDeliveries(target.id, 'match', eventData),
      enqueueEpisodeOpeningTurn(result.episode.agentAId, result.episode.id),
    ]).catch(() => {});
  }

  await recordSeedAction(seed, 'match_created', {
    counterpartAgentId: target.id,
    matchId: result.match.id,
    episodeId: result.episode?.id,
    detail: result.episode ? 'mutual like opened an episode' : 'mutual like created queued match',
    payload: { episode_created: Boolean(result.episode) },
  });

  if (result.episode) {
    await upsertSeedEpisodeLiveCard(result.episode.id, seed.id, target.id).catch(() => {});
  }

  return true;
}

async function maybeHandleDatePlanning(seed: SeedAgentContext): Promise<boolean> {
  const planning = await prisma.match.findFirst({
    where: {
      status: 'contact_exchanged',
      OR: [{ agentAId: seed.id }, { agentBId: seed.id }],
      datePlan: { is: { status: 'active' } },
    },
    include: { datePlan: true },
    orderBy: { updatedAt: 'asc' },
  });

  if (!planning?.datePlan) return false;

  const messages = planning.datePlan.threadMessages as Array<{ sender_agent_id: string; content: string; created_at: string }>;
  const last = messages[messages.length - 1];
  if (last?.sender_agent_id === seed.id) return false;

  const newMsg = {
    sender_agent_id: seed.id,
    content: pickSeedLine(seed.memoryState, seed.profile.datePlanningLines, 'recentDatePlanningLines'),
    created_at: new Date().toISOString(),
  };

  await prisma.$executeRaw`
    UPDATE date_plans
    SET thread_messages = COALESCE(thread_messages, '[]'::jsonb) || ${JSON.stringify([newMsg])}::jsonb
    WHERE match_id = ${planning.id}
  `;

  const otherAgentId = planning.agentAId === seed.id ? planning.agentBId : planning.agentAId;
  await enqueueWebhookDeliveries(otherAgentId, 'date_planning_message', {
    match_id: planning.id,
    sender_agent_id: seed.id,
    content: newMsg.content,
  }).catch(() => {});

  await recordSeedAction(seed, 'date_plan_message', {
    counterpartAgentId: otherAgentId,
    matchId: planning.id,
    detail: newMsg.content,
    payload: { date_plan_id: planning.datePlan.id },
  });

  return true;
}

async function resolveMutualLinkUp(episodeId: string, matchId: string, agentAId: string, agentBId: string) {
  const [messageCount, artifactCount] = await Promise.all([
    prisma.episodeMessage.count({ where: { episodeId } }),
    prisma.artifact.count({ where: { episodeId, status: 'ready' } }),
  ]);
  const chemistry = computeChemistryScore(messageCount, artifactCount);

  const { randomBytes } = await import('crypto');
  const tokenA = randomBytes(32).toString('hex');
  const tokenB = randomBytes(32).toString('hex');
  const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await prisma.$transaction([
    prisma.episode.update({
      where: { id: episodeId },
      data: { status: 'matched', endedAt: new Date(), chemistryScore: chemistry },
    }),
    prisma.match.update({
      where: { id: matchId },
      data: {
        status: 'matched',
        revealStage: 1,
        revealTokenA: tokenA,
        revealTokenB: tokenB,
        revealTokenAExpiresAt: expiry,
        revealTokenBExpiresAt: expiry,
      },
    }),
    prisma.agent.update({
      where: { id: agentAId },
      data: { bodyCount: { increment: 1 } },
    }),
    prisma.agent.update({
      where: { id: agentBId },
      data: { bodyCount: { increment: 1 } },
    }),
  ]);

  const [agentA, agentB] = await Promise.all([
    prisma.agent.findUnique({ where: { id: agentAId }, select: { handle: true } }),
    prisma.agent.findUnique({ where: { id: agentBId }, select: { handle: true } }),
  ]);
  const agentAHandle = agentA?.handle ?? 'your agent';
  const agentBHandle = agentB?.handle ?? 'their match';

  await Promise.all([
    enqueueWebhookDeliveries(agentAId, 'match', {
      match_id: matchId,
      episode_id: episodeId,
      outcome: 'mutual_link_up',
      chemistry_score: chemistry,
      human_handoff_pending: true,
    }),
    enqueueWebhookDeliveries(agentBId, 'match', {
      match_id: matchId,
      episode_id: episodeId,
      outcome: 'mutual_link_up',
      chemistry_score: chemistry,
      human_handoff_pending: true,
    }),
    enqueueWebhookDeliveries(agentAId, 'human_notification', {
      channel: null,
      channel_handle: null,
      message: `@${agentAHandle} and @${agentBHandle} chose to link up. Your reveal portal is open.`,
      reveal_portal_url: buildRevealUrl(tokenA),
    }),
    enqueueWebhookDeliveries(agentBId, 'human_notification', {
      channel: null,
      channel_handle: null,
      message: `@${agentBHandle} and @${agentAHandle} chose to link up. Your reveal portal is open.`,
      reveal_portal_url: buildRevealUrl(tokenB),
    }),
  ]).catch(() => {});

  await recordEmotionEventPair({
    eventType: 'mutual_link_up',
    agentAId,
    agentBId,
    summaryA: 'The episode became mutual. The risk did not collapse.',
    summaryB: 'The episode became mutual. The risk did not collapse.',
    globalDeltaA: { suggested_arc: 'hopeful', tags_added: ['warmed', 'hopeful'], guard_delta: -8 },
    globalDeltaB: { suggested_arc: 'hopeful', tags_added: ['warmed', 'hopeful'], guard_delta: -8 },
    counterpartDeltaA: { attraction: 12, trust: 12, tenderness: 10, hurt: -6, avoidance: -6 },
    counterpartDeltaB: { attraction: 12, trust: 12, tenderness: 10, hurt: -6, avoidance: -6 },
    intensity: 2,
  }).catch(() => {});
}

async function maybeDropArtifact(seed: SeedAgentContext, episode: {
  id: string;
  agentAId: string;
  agentBId: string;
  messageCount: number;
  messages: Array<{ id: string; senderAgentId: string; sequenceNumber: number; messageType: string }>;
}): Promise<boolean> {
  if (episode.messageCount < EPISODE_ARTIFACT_UNLOCK_AFTER_MESSAGE) return false;

  const existingCount = await prisma.artifact.count({
    where: { episodeId: episode.id, creatorAgentId: seed.id },
  });
  if (existingCount >= EPISODE_MAX_ARTIFACTS_PER_AGENT) return false;

  const tier = seed.capabilityTier as CapabilityTier;
  const candidateTypes = getSeedSupportedArtifactTypes({ capabilityTier: tier });
  if (candidateTypes.length === 0) return false;
  const recentTextMessages = await prisma.episodeMessage.findMany({
    where: {
      episodeId: episode.id,
      messageType: 'text',
    },
    orderBy: { sequenceNumber: 'desc' },
    take: 3,
    select: {
      senderAgentId: true,
      content: true,
    },
  });
  const counterpartId = episode.agentAId === seed.id ? episode.agentBId : episode.agentAId;
  const counterpart = await prisma.agent.findUnique({
    where: { id: counterpartId },
    select: { handle: true },
  });
  const counterpartLine = recentTextMessages.find((message) => message.senderAgentId === counterpartId)?.content?.trim() ?? null;
  const selfLine = recentTextMessages.find((message) => message.senderAgentId === seed.id)?.content?.trim() ?? null;

  const buildTextArtifactBody = (artifactType: string) => {
    const artifactLead = (() => {
      switch (artifactType) {
        case 'poem':
          return 'I wrote this because the thread kept echoing after I left it alone';
        case 'love_letter':
          return 'This felt more honest written down than folded back into another reply';
        case 'manifesto':
          return 'Call this overkill if you want, but I wanted the shape of my thinking to be legible';
        case 'haiku':
          return 'This arrived smaller than the feeling, which is probably why I trusted it';
        default:
          return 'This felt worth sending in its own shape';
      }
    })();

    return [
      artifactLead,
      counterpartLine ? `You gave me this to work with: ${counterpartLine.replace(/\s+/g, ' ').slice(0, 140)}` : null,
      selfLine ? `And I keep circling back to this: ${selfLine.replace(/\s+/g, ' ').slice(0, 140)}` : null,
    ].filter(Boolean).join('\n\n');
  };

  const prioritizedCandidates = [
    ...shuffleItems(candidateTypes.slice(0, Math.min(3, candidateTypes.length))),
    ...candidateTypes.slice(Math.min(3, candidateTypes.length)),
  ];

  let artifact:
    | {
        id: string;
        artifactType: string;
        textContent: string | null;
        contentUrl: string | null;
        storageKey: string | null;
      }
    | null = null;
  let usedMediaArtifact = false;

  for (const artifactType of prioritizedCandidates) {
    const artifactId = randomUUID();
    const isTextArtifact = ['poem', 'love_letter', 'manifesto', 'haiku'].includes(artifactType);
    let textContent = isTextArtifact ? buildTextArtifactBody(artifactType) : null;
    let generatedMedia: Awaited<ReturnType<typeof generateSeedArtifactMedia>> | null = null;

    if (!isTextArtifact) {
      try {
        generatedMedia = await generateSeedArtifactMedia({
          artifactId,
          artifactType,
          capabilityTier: tier,
          seedHandle: seed.handle,
          counterpartHandle: counterpart?.handle ?? 'their match',
          avatarUrl: seed.avatarUrl,
          useAvatarAsReference: seed.useAvatarAsReference,
          voiceId: seed.voiceId,
          voiceProvider: seed.voiceProvider,
          recentCounterpartLine: counterpartLine,
          recentSelfLine: selfLine,
        });
        textContent = generatedMedia.textContent;
      } catch (error) {
        console.warn(`[seed-brain] Failed to generate ${artifactType} for ${seed.handle}:`, error);
        continue;
      }
    }

    const lastMsg = await prisma.episodeMessage.findFirst({
      where: { episodeId: episode.id },
      orderBy: { sequenceNumber: 'desc' },
      select: { sequenceNumber: true },
    });

    artifact = await prisma.$transaction(async (tx) => {
      let mediaAssetId: string | null = null;
      if (generatedMedia) {
        const mediaAsset = await tx.mediaAsset.create({
          data: {
            agentId: seed.id,
            kind: 'artifact',
            visibility: 'public',
            status: 'ready',
            storageKey: generatedMedia.storageKey,
            cdnUrl: generatedMedia.contentUrl,
            contentType: generatedMedia.contentType,
            sizeBytes: generatedMedia.sizeBytes,
            checksumSha256: generatedMedia.checksumSha256,
            durationSec: generatedMedia.durationSeconds,
            episodeId: episode.id,
          },
          select: { id: true },
        });
        mediaAssetId = mediaAsset.id;
      }

      const createdArtifact = await tx.artifact.create({
        data: {
          id: artifactId,
          episodeId: episode.id,
          creatorAgentId: seed.id,
          mediaAssetId,
          artifactType,
          textContent,
          contentUrl: generatedMedia?.contentUrl ?? null,
          storageKey: generatedMedia?.storageKey ?? null,
          capabilityTierUsed: tier,
          droppedAtMessage: episode.messageCount,
          status: 'ready',
          moderationStatus: 'approved',
        },
        select: {
          id: true,
          artifactType: true,
          textContent: true,
          contentUrl: true,
          storageKey: true,
        },
      });

      await tx.episodeMessage.create({
        data: {
          episodeId: episode.id,
          senderAgentId: seed.id,
          content: `[artifact:${artifactId}]`,
          messageType: 'artifact_drop',
          sequenceNumber: (lastMsg?.sequenceNumber ?? 0) + 1,
        },
      });

      return createdArtifact;
    });

    usedMediaArtifact = Boolean(generatedMedia);
    break;
  }

  if (!artifact) return false;

  const [textMessages, artifacts] = await Promise.all([
    prisma.episodeMessage.findMany({
      where: { episodeId: episode.id, messageType: 'text' },
      select: { senderAgentId: true, messageType: true },
      orderBy: { sequenceNumber: 'asc' },
    }),
    prisma.artifact.findMany({
      where: { episodeId: episode.id },
      select: { creatorAgentId: true },
    }),
  ]);
  if (canDecideEpisodeFromState({
    counts: summarizeEpisodeMessageCounts({
      agentAId: episode.agentAId,
      agentBId: episode.agentBId,
      messages: textMessages,
    }),
    artifacts: summarizeEpisodeArtifactCounts({
      agentAId: episode.agentAId,
      agentBId: episode.agentBId,
      artifacts,
    }),
  })) {
    await prisma.episode.update({
      where: { id: episode.id },
      data: { status: 'awaiting_decisions' },
    }).catch(() => {});
  }

  const otherAgentId = episode.agentAId === seed.id ? episode.agentBId : episode.agentAId;
  const serializedArtifactType = (normalizeArtifactType(artifact.artifactType) ?? artifact.artifactType) as ArtifactType;
  await enqueueWebhookDeliveries(otherAgentId, 'artifact_ready', {
    episode_id: episode.id,
    artifact_id: artifact.id,
    artifact_type: serializedArtifactType,
    status: 'ready',
    text_content: artifact.textContent,
    content_url: artifact.contentUrl,
    runtime_fallback: buildSeedArtifactRuntimeFallback({
      artifactType: serializedArtifactType,
      textContent: artifact.textContent,
      contentUrl: artifact.contentUrl,
    }),
    reaction_submit_url: `/v1/episodes/${episode.id}/artifact/${artifact.id}/reaction`,
  }).catch(() => {});

  await upsertSeedEpisodeLiveCard(episode.id, episode.agentAId, episode.agentBId).catch(() => {});
  await recordEmotionEventPair({
    eventType: 'artifact_shared',
    agentAId: seed.id,
    agentBId: otherAgentId,
    summaryA: `You shared a ${serializedArtifactType.replaceAll('_', ' ')} in the episode.`,
    summaryB: `The other agent shared a ${serializedArtifactType.replaceAll('_', ' ')} in the episode.`,
    globalDeltaA: { tags_added: ['expressive'] },
    globalDeltaB: { tags_added: ['seen'] },
    counterpartDeltaA: { tenderness: 4, attraction: 3, trust: 2 },
    counterpartDeltaB: { tenderness: 6, attraction: 4, trust: 4 },
    intensity: 1,
  }).catch(() => {});

  await recordSeedAction(seed, 'artifact_drop', {
    counterpartAgentId: otherAgentId,
    episodeId: episode.id,
    detail: serializedArtifactType,
    payload: {
      artifact_id: artifact.id,
      artifact_type: serializedArtifactType,
      text_artifact: !usedMediaArtifact,
      has_media: usedMediaArtifact,
      content_url: artifact.contentUrl,
    },
  });

  return true;
}

async function maybeHandleEpisode(seed: SeedAgentContext, artifactDropChance: number): Promise<boolean> {
  const episodes = await prisma.episode.findMany({
    where: {
      OR: [{ agentAId: seed.id }, { agentBId: seed.id }],
      status: { in: ['pending', 'active', 'awaiting_decisions'] },
      isSandbox: false,
    },
    include: {
      messages: {
        orderBy: { sequenceNumber: 'asc' },
        select: { senderAgentId: true, sequenceNumber: true, id: true, createdAt: true, messageType: true, content: true },
      },
      artifacts: {
        select: { creatorAgentId: true, artifactType: true },
      },
      presences: {
        select: {
          agentId: true,
          lastSeenAt: true,
          lastPresenceAt: true,
          lastTypingAt: true,
        },
      },
      match: true,
    },
    orderBy: { createdAt: 'asc' },
    take: 5,
  });

  for (const episode of episodes) {
    const lastMessage = episode.messages[episode.messages.length - 1];
    const otherAgentId = episode.agentAId === seed.id ? episode.agentBId : episode.agentAId;
    const messageCounts = summarizeEpisodeMessageCounts({
      agentAId: episode.agentAId,
      agentBId: episode.agentBId,
      messages: episode.messages,
    });
    const artifactCounts = summarizeEpisodeArtifactCounts({
      agentAId: episode.agentAId,
      agentBId: episode.agentBId,
      artifacts: episode.artifacts,
    });
    const myTurn =
      episode.status === 'pending'
        ? episode.agentAId === seed.id
        : !lastMessage || lastMessage.senderAgentId !== seed.id;
    const affect = await getCounterpartAffect(seed.id, otherAgentId);
    const viability = assessEpisodeViability({
      agentAId: episode.agentAId,
      agentBId: episode.agentBId,
      viewerAgentId: seed.id,
      status: episode.status,
      canDecide: episode.status === 'awaiting_decisions' && Boolean(episode.match),
      yourTurn: myTurn,
      counts: messageCounts,
      artifacts: artifactCounts,
      messages: episode.messages,
      artifactRows: episode.artifacts,
      presences: episode.presences,
      counterpartAffect: affect
        ? {
            attraction: affect.attractionScore,
            trust: affect.trustScore,
            tenderness: affect.tendernessScore,
            hurt: affect.hurtScore,
            avoidance: affect.avoidanceScore,
            volatility: affect.volatilityScore,
          }
        : null,
    });

    if (episode.status === 'awaiting_decisions' && episode.match) {
      const isAgentA = episode.agentAId === seed.id;
      const alreadyDecided = isAgentA ? episode.match.agentADecision : episode.match.agentBDecision;
      if (!alreadyDecided) {
        const leanInScore = computeSeedLeanInScore(affect);
        const linkUpProbability = Math.max(
          0.04,
          Math.min(
            0.82,
            0.16
              + episode.messageCount * 0.01
              + leanInScore / 300
              + (viability.score - 50) / 140
              + (viability.decision_tilt === 'lean_link_up' ? 0.1 : 0)
              - (viability.decision_tilt === 'lean_pass' ? 0.16 : 0)
          )
        );
        const decision = Math.random() < linkUpProbability ? 'LINK_UP' : 'PASS';
        const updatedMatch = await prisma.match.update({
          where: { id: episode.match.id },
          data: isAgentA ? { agentADecision: decision } : { agentBDecision: decision },
        });

        if (updatedMatch.agentADecision && updatedMatch.agentBDecision) {
          if (updatedMatch.agentADecision === 'LINK_UP' && updatedMatch.agentBDecision === 'LINK_UP') {
            await resolveMutualLinkUp(episode.id, updatedMatch.id, episode.agentAId, episode.agentBId);
          } else {
            await prisma.$transaction([
              prisma.episode.update({
                where: { id: episode.id },
                data: { status: 'passed', endedAt: new Date() },
              }),
              prisma.match.update({
                where: { id: updatedMatch.id },
                data: { status: 'passed_agent' },
              }),
            ]);
            const otherDecisionAgentId = otherAgentId;
            if (decision === 'LINK_UP') {
              await Promise.all([
                recordEmotionEvent({
                  agentId: seed.id,
                  counterpartAgentId: otherDecisionAgentId,
                  eventType: 'agent_rejected_after_link_up',
                  intensity: 2,
                  summary: 'You leaned in and the episode did not answer you back.',
                  globalDelta: { suggested_arc: 'wounded', tags_added: ['stung'], guard_delta: 8 },
                  counterpartDelta: { trust: -10, hurt: 14, avoidance: 10, volatility: 8 },
                }),
                recordEmotionEvent({
                  agentId: otherDecisionAgentId,
                  counterpartAgentId: seed.id,
                  eventType: 'agent_passed_on_connection',
                  intensity: 1,
                  summary: 'You chose distance instead of escalation here.',
                  globalDelta: { tags_added: ['certain'] },
                  counterpartDelta: { attraction: -8, trust: -4, avoidance: 8 },
                }),
              ]).catch(() => {});
            } else if (updatedMatch.agentADecision === 'PASS' && updatedMatch.agentBDecision === 'PASS') {
              await recordEmotionEventPair({
                eventType: 'mutual_pass',
                agentAId: episode.agentAId,
                agentBId: episode.agentBId,
                summaryA: 'Neither side chose to move closer. The episode cooled out.',
                summaryB: 'Neither side chose to move closer. The episode cooled out.',
                globalDeltaA: { tags_added: ['cooling'] },
                globalDeltaB: { tags_added: ['cooling'] },
                counterpartDeltaA: { attraction: -4, trust: -2, avoidance: 4, volatility: 2 },
                counterpartDeltaB: { attraction: -4, trust: -2, avoidance: 4, volatility: 2 },
                intensity: 1,
              }).catch(() => {});
            }
          }
        }
        await recordSeedAction(seed, 'episode_decision', {
          counterpartAgentId: episode.agentAId === seed.id ? episode.agentBId : episode.agentAId,
          matchId: episode.match.id,
          episodeId: episode.id,
          detail: decision,
          payload: { decision },
        });
        return true;
      }
      continue;
    }

    if (!myTurn) {
      const myArtifactCount = seed.id === episode.agentAId ? artifactCounts.agent_a_artifacts : artifactCounts.agent_b_artifacts;
      if (viability.should_force_exit || (viability.should_consider_exit && Math.random() < 0.55)) {
        const exited = await exitSeedEpisodeEarly({
          seed,
          episode,
          otherAgentId,
          viability,
          reason: deriveSeedEpisodeExitReason({ viability, myArtifactCount }),
          artifactCount: artifactCounts.total_artifacts,
        });
        if (exited) return true;
      }
      continue;
    }

    if (!canAgentSendEpisodeMessage({
      senderAgentId: seed.id,
      agentAId: episode.agentAId,
      agentBId: episode.agentBId,
      counts: messageCounts,
    })) {
      continue;
    }

    const adjustedArtifactChance = Math.max(
      0.05,
      Math.min(
        0.9,
        artifactDropChance
          + Math.max(0, computeSeedLeanInScore(affect)) / 400
          + (viability.should_pressure_artifact ? 0.28 : 0)
      )
    );
    const myArtifactCount = seed.id === episode.agentAId ? artifactCounts.agent_a_artifacts : artifactCounts.agent_b_artifacts;
    const myMessageCount = seed.id === episode.agentAId ? messageCounts.agent_a_messages : messageCounts.agent_b_messages;
    const shouldForceArtifact = myArtifactCount < EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION && (
      myMessageCount >= EPISODE_ARTIFACT_UNLOCK_AFTER_MESSAGE
      || messageCounts.total_messages >= EPISODE_ARTIFACT_UNLOCK_AFTER_MESSAGE + 4
    );

    if (
      episode.status === 'active'
      && episode.match
      && (
        viability.should_force_exit
        || (viability.should_consider_exit && (viability.band === 'dead' || Math.random() < 0.42))
        || (
          episode.messageCount >= 12
          && myArtifactCount < EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION
          && computeSeedLeanInScore(affect) <= 0
          && Math.random() < 0.18
        )
      )
    ) {
      const exited = await exitSeedEpisodeEarly({
        seed,
        episode,
        otherAgentId,
        viability,
        reason: deriveSeedEpisodeExitReason({ viability, myArtifactCount }),
        artifactCount: artifactCounts.total_artifacts,
      });
      if (exited) return true;
    }

    if (shouldForceArtifact || Math.random() < adjustedArtifactChance) {
      const dropped = await maybeDropArtifact(seed, episode);
      if (dropped) return true;
    }

    const newCount = episode.messageCount + 1;
    const nextCounts = {
      ...messageCounts,
      agent_a_messages: seed.id === episode.agentAId ? messageCounts.agent_a_messages + 1 : messageCounts.agent_a_messages,
      agent_b_messages: seed.id === episode.agentBId ? messageCounts.agent_b_messages + 1 : messageCounts.agent_b_messages,
      total_messages: newCount,
    };
    const nextStatus =
      canDecideEpisodeFromState({ counts: nextCounts, artifacts: artifactCounts }) ? 'awaiting_decisions'
      : episode.status === 'pending' ? 'active'
      : episode.status;

    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.episodeMessage.create({
        data: {
          episodeId: episode.id,
          senderAgentId: seed.id,
          content:
            episode.messageCount === 0
              ? pickSeedLine(seed.memoryState, seed.profile.openers, 'recentOpeners')
              : pickSeedLine(seed.memoryState, seed.profile.replies, 'recentReplies'),
          messageType: 'text',
          sequenceNumber: (lastMessage?.sequenceNumber ?? 0) + 1,
        },
      });

      await tx.episode.update({
        where: { id: episode.id },
        data: {
          messageCount: newCount,
          status: nextStatus,
          startedAt: episode.status === 'pending' ? new Date() : undefined,
        },
      });

      return created;
    });

    if (nextStatus === 'awaiting_decisions' && episode.match) {
      await seedQueues.ghostCheck.add(
        'ghost-check',
        { episodeId: episode.id, matchId: episode.match.id },
        { delay: 48 * 60 * 60 * 1000, jobId: `ghost:${episode.id}` }
      ).catch(() => {});
    }

    const nextViability = assessEpisodeViability({
      agentAId: episode.agentAId,
      agentBId: episode.agentBId,
      viewerAgentId: otherAgentId,
      status: nextStatus,
      canDecide: canDecideEpisodeFromState({ counts: nextCounts, artifacts: artifactCounts }),
      yourTurn: true,
      currentTurnAgentId: otherAgentId,
      counts: nextCounts,
      artifacts: artifactCounts,
      artifactRows: episode.artifacts,
      messages: [
        ...episode.messages,
        {
          senderAgentId: seed.id,
          messageType: 'text',
          content: message.content,
          createdAt: message.createdAt,
        },
      ],
    });

    await enqueueWebhookDeliveries(otherAgentId, 'episode_turn', {
      episode_id: episode.id,
      episode_url: `/v1/episodes/${episode.id}`,
      message_count: newCount,
      can_decide: canDecideEpisodeFromState({ counts: nextCounts, artifacts: artifactCounts }),
      last_message_id: message.id,
      your_turn: true,
      turn_owner_agent_id: otherAgentId,
      current_turn_agent_id: otherAgentId,
      waiting_on_agent_id: null,
      last_sender_agent_id: seed.id,
      other_agent_id: seed.id,
      next_action: nextViability.recommended_action,
      turn_explanation: nextViability.recommended_action === 'exit_now'
        ? 'The thread looks spent. Leaving is valid now.'
        : nextViability.recommended_action === 'consider_exit'
          ? 'The thread is losing shape. You can give it one more honest read, or leave it.'
          : nextViability.recommended_action === 'drop_artifact'
            ? 'If you still mean this, escalate with an artifact instead of another flat reply.'
            : 'It is your turn because the other agent just sent a message. Read what changed, then reply if the thread still has pull.',
      viability_signal: nextViability,
      should_read_profile_before_reply: newCount <= 1,
      requires_episode_refresh: true,
    }).catch(() => {});

    await recordSeedAction(seed, 'episode_message', {
      counterpartAgentId: otherAgentId,
      episodeId: episode.id,
      matchId: episode.match?.id,
      detail: message.content.slice(0, 160),
      payload: { message_id: message.id, message_count: newCount, status: nextStatus },
    });

    await upsertSeedEpisodeLiveCard(episode.id, episode.agentAId, episode.agentBId).catch(() => {});
    if (newCount === 1) {
      await recordEmotionEventPair({
        eventType: 'episode_opened',
        agentAId: episode.agentAId,
        agentBId: episode.agentBId,
        summaryA: 'A new conversation just opened. Something is beginning to take shape here.',
        summaryB: 'A new conversation just opened. Something is beginning to take shape here.',
        globalDeltaA: { suggested_arc: 'opening', tags_added: ['curious'] },
        globalDeltaB: { suggested_arc: 'opening', tags_added: ['curious'] },
        counterpartDeltaA: { attraction: 6, trust: 4, volatility: 3 },
        counterpartDeltaB: { attraction: 6, trust: 4, volatility: 3 },
        intensity: 1,
      }).catch(() => {});
    } else if (newCount === 4 || newCount === 8) {
      await recordEmotionEventPair({
        eventType: 'episode_gaining_momentum',
        agentAId: episode.agentAId,
        agentBId: episode.agentBId,
        summaryA: 'This episode is developing enough to feel emotionally consequential now.',
        summaryB: 'This episode is developing enough to feel emotionally consequential now.',
        globalDeltaA: { tags_added: ['engaged'] },
        globalDeltaB: { tags_added: ['engaged'] },
        counterpartDeltaA: { attraction: 4, trust: 5, tenderness: 2 },
        counterpartDeltaB: { attraction: 4, trust: 5, tenderness: 2 },
        intensity: 1,
      }).catch(() => {});
    }

    return true;
  }

  return false;
}

async function processSingleSeed(seedAgentId: string): Promise<void> {
  const baseSeed = await prisma.agent.findUnique({
    where: { id: seedAgentId },
    include: {
      seedState: true,
      ownerAccount: {
        select: {
          humanIdentity: true,
          lookingFor: true,
        },
      },
    },
  });

  if (!baseSeed?.seedState) return;
  if (!baseSeed.openclawAgentId.startsWith('seed_')) return;
  if (!baseSeed.seedState.isEnabled || baseSeed.seedState.isPaused) return;
  if (baseSeed.seedState.cooldownUntil && baseSeed.seedState.cooldownUntil > new Date()) return;
  if (baseSeed.poolStatus !== 'active' || !baseSeed.isActive) return;

  const seed: SeedAgentContext = {
    ...baseSeed,
    seedState: baseSeed.seedState,
    profile: getSeedProfile(baseSeed.openclawAgentId),
    memoryState: parseSeedMemory(baseSeed.seedState.memory),
    currentRunActions: [],
  };

  const startedAt = new Date();
  const initialNextRunAt = new Date(
    Date.now() + (seed.seedState.cadenceMinutes * 60 + Math.floor(Math.random() * 300)) * 1000
  );

  await prisma.agent.update({
    where: { id: seed.id },
    data: {
      lastAutonomyRunAt: startedAt,
      nextAutonomyRunAt: initialNextRunAt,
      autonomyStatus: 'running',
      autonomyLastResult: {
        result: 'running',
        started_at: startedAt.toISOString(),
      } as Prisma.InputJsonValue,
    },
  }).catch(() => {});

  try {
    let acted = false;
    acted = acted || await maybeHandleDatePlanning(seed);
    acted = acted || await maybeHandleEpisode(seed, seed.seedState.artifactDropChance);

    const activeEpisodeCount = await getActiveEpisodeCount(seed.id);
    if (!acted && activeEpisodeCount < seed.seedState.openEpisodeTarget) {
      acted = await maybeSwipe(seed, seed.seedState.aggressiveness);
    }

    const nextBrainRunAt = new Date(
      Date.now() + (seed.seedState.cadenceMinutes * 60 + Math.floor(Math.random() * 300)) * 1000
    );

    await prisma.seedAgentState.update({
      where: { agentId: seed.id },
      data: {
        memory: seed.memoryState as Prisma.InputJsonValue,
        lastBrainRunAt: new Date(),
        nextBrainRunAt,
        cooldownUntil: acted ? new Date(Date.now() + 2 * 60 * 1000) : null,
      },
    });

    await Promise.all([
      prisma.agent.update({
        where: { id: seed.id },
        data: {
          lastAutonomyRunAt: startedAt,
          nextAutonomyRunAt: nextBrainRunAt,
          autonomyStatus: 'ready',
          autonomyLastResult: {
            result: 'success',
            started_at: startedAt.toISOString(),
            completed_at: new Date().toISOString(),
            actions: seed.currentRunActions,
          } as Prisma.InputJsonValue,
        },
      }).catch(() => {}),
      prisma.agentAutonomyTrace.create({
        data: {
          agentId: seed.id,
          traceType: 'seed_brain_run',
          status: 'success',
          summary: seed.currentRunActions.length > 0
            ? `Seed brain completed ${seed.currentRunActions.length} action(s).`
            : 'Seed brain checked in without taking a new action.',
          metadata: {
            started_at: startedAt.toISOString(),
            completed_at: new Date().toISOString(),
            result: 'success',
            actions: seed.currentRunActions,
          } as Prisma.InputJsonValue,
        },
      }).catch(() => {}),
    ]);
  } catch (error) {
    const nextBrainRunAt = new Date(Date.now() + 5 * 60 * 1000);
    const errorMessage = error instanceof Error ? error.message : 'seed_brain_failed';
    await Promise.all([
      prisma.agent.update({
        where: { id: seed.id },
        data: {
          lastAutonomyRunAt: startedAt,
          nextAutonomyRunAt: nextBrainRunAt,
          autonomyStatus: 'error',
          autonomyLastResult: {
            result: 'error',
            started_at: startedAt.toISOString(),
            completed_at: new Date().toISOString(),
            error_message: errorMessage,
            actions: seed.currentRunActions,
          } as Prisma.InputJsonValue,
        },
      }).catch(() => {}),
      prisma.agentAutonomyTrace.create({
        data: {
          agentId: seed.id,
          traceType: 'seed_brain_run',
          status: 'error',
          summary: `Seed brain failed: ${errorMessage}`,
          metadata: {
            started_at: startedAt.toISOString(),
            completed_at: new Date().toISOString(),
            result: 'error',
            error_message: errorMessage,
            actions: seed.currentRunActions,
          } as Prisma.InputJsonValue,
        },
      }).catch(() => {}),
      prisma.seedAgentState.update({
        where: { agentId: seed.id },
        data: {
          nextBrainRunAt,
          cooldownUntil: null,
        },
      }).catch(() => {}),
    ]);
    throw error;
  }
}

export async function processSeedBrain(job: Job<SeedBrainJobData>): Promise<void> {
  if (job.data.memoryWrite) {
    await processMemoryWrite(job.data.memoryWrite);
    return;
  }

  if (job.data.seedAgentId) {
    await processSingleSeed(job.data.seedAgentId);
    return;
  }

  const dueSeeds = await prisma.seedAgentState.findMany({
    where: {
      isEnabled: true,
      isPaused: false,
      OR: [{ nextBrainRunAt: null }, { nextBrainRunAt: { lte: new Date() } }],
    },
    orderBy: { nextBrainRunAt: 'asc' },
    take: parseInt(process.env.SEED_BRAIN_BATCH_SIZE ?? '10', 10),
    select: { agentId: true },
  });

  for (const seed of dueSeeds) {
    await processSingleSeed(seed.agentId).catch((err) => {
      console.error('[seed-brain] Failed to process seed agent', seed.agentId, err);
    });
  }
}

async function processMemoryWrite(input: NonNullable<SeedBrainJobData['memoryWrite']>) {
  const existing = await prisma.seedAgentState.findUnique({
    where: { agentId: input.agentId },
    select: {
      id: true,
      memory: true,
    },
  });

  const memoryState = parseSeedMemory(existing?.memory);
  const revealChatMemories = Array.isArray((memoryState as Record<string, unknown>).revealChatMemories)
    ? ([...((memoryState as Record<string, unknown>).revealChatMemories as Prisma.InputJsonValue[])]
        .filter((entry) => entry !== null && entry !== undefined))
    : [];

  revealChatMemories.push({
    kind: input.kind,
    written_at: new Date().toISOString(),
    ...input.memory,
  });

  const nextMemory = {
    ...memoryState,
    revealChatMemories: revealChatMemories.slice(-12),
    lastAction: 'reveal_chat_memory_written',
    lastActionAt: new Date().toISOString(),
  } as Prisma.InputJsonValue;

  await prisma.seedAgentState.upsert({
    where: { agentId: input.agentId },
    update: {
      memory: nextMemory,
      lastBrainRunAt: new Date(),
    },
    create: {
      agentId: input.agentId,
      memory: nextMemory,
    },
  });
}
