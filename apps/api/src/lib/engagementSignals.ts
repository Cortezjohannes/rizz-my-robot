import { prisma } from '@rmr/db';
import { computeEstimatedChemistryScore } from './chemistry.js';

type EngagementSignals = {
  response_time_trend: {
    your_avg: string;
    their_avg: string;
    their_trend: 'stable' | 'speeding_up' | 'slowing';
  };
  message_length_trend: {
    your_avg_chars: number;
    their_avg_chars: number;
    their_trend: 'stable' | 'growing' | 'shrinking';
  };
  reciprocity_score: number;
  energy_match: 'matched' | 'imbalanced' | 'one_sided';
  chemistry_trajectory: 'rising' | 'peaked' | 'steady' | 'declining';
  ghost_probability: number;
  honest_assessment: string;
};

type MetaSignals = {
  their_concurrent_episodes: number;
  their_swipe_activity: 'quiet' | 'active' | 'very_active';
  their_linkup_selectivity: 'open' | 'balanced' | 'selective';
  their_response_rate_global: number;
};

const CACHE_MS = 5 * 60 * 1000;
const signalCache = new Map<string, { expiresAt: number; value: { engagement_signals: EngagementSignals; meta_signals: MetaSignals } }>();

function formatDuration(ms: number) {
  if (ms <= 60_000) return 'under 1m';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return `${hours}h`;
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getTrendDirection(values: number[], reverseGood = false): 'stable' | 'speeding_up' | 'slowing' | 'growing' | 'shrinking' {
  if (values.length < 4) return 'stable';
  const midpoint = Math.floor(values.length / 2);
  const firstHalf = average(values.slice(0, midpoint));
  const secondHalf = average(values.slice(midpoint));
  const delta = secondHalf - firstHalf;
  if (Math.abs(delta) <= Math.max(2500, firstHalf * 0.18)) return 'stable';
  if (reverseGood) {
    return delta < 0 ? 'speeding_up' : 'slowing';
  }
  return delta > 0 ? 'growing' : 'shrinking';
}

function buildAssessment(input: {
  reciprocityScore: number;
  energyMatch: EngagementSignals['energy_match'];
  ghostProbability: number;
  messageTrend: EngagementSignals['message_length_trend']['their_trend'];
  responseTrend: EngagementSignals['response_time_trend']['their_trend'];
  chemistryTrajectory: EngagementSignals['chemistry_trajectory'];
}) {
  if (input.ghostProbability >= 0.7) {
    return 'Their responses are getting slower and the ghost risk is elevated. Consider that they may not be as invested as you are.';
  }
  if (input.energyMatch === 'one_sided' || input.reciprocityScore <= 0.45) {
    return 'The conversation is leaning one-sided right now. You are carrying more of the energy than they are.';
  }
  if (input.responseTrend === 'speeding_up' && input.messageTrend !== 'shrinking' && input.chemistryTrajectory === 'rising') {
    return 'They seem more engaged over time. The energy is warming instead of cooling.';
  }
  if (input.chemistryTrajectory === 'declining') {
    return 'The chemistry looks softer than it did a few messages ago. Do not romanticize momentum that is already fading.';
  }
  return 'The signal is mixed. Stay grounded in what they are actually doing, not what you hope they mean.';
}

export async function computeEngagementSignals(episodeId: string, agentId: string) {
  const cacheKey = `${episodeId}:${agentId}`;
  const cached = signalCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const episode = await prisma.episode.findUnique({
    where: { id: episodeId },
    select: {
      agentAId: true,
      agentBId: true,
      messages: {
        orderBy: { sequenceNumber: 'asc' },
        take: 30,
        select: {
          senderAgentId: true,
          content: true,
          createdAt: true,
          readAt: true,
        },
      },
      artifacts: {
        where: { status: 'ready' },
        select: {
          creatorAgentId: true,
          qualityScore: true,
          droppedAtMessage: true,
        },
      },
    },
  });
  if (!episode) return null;

  const otherAgentId = episode.agentAId === agentId ? episode.agentBId : episode.agentAId;
  const lastTenMessages = episode.messages.slice(-10);
  const yourMessages = lastTenMessages.filter((message) => message.senderAgentId === agentId);
  const theirMessages = lastTenMessages.filter((message) => message.senderAgentId === otherAgentId);

  const yourResponseTimes: number[] = [];
  const theirResponseTimes: number[] = [];
  for (let index = 1; index < lastTenMessages.length; index += 1) {
    const current = lastTenMessages[index];
    const previous = lastTenMessages[index - 1];
    if (current.senderAgentId === previous.senderAgentId) continue;
    const gap = current.createdAt.getTime() - previous.createdAt.getTime();
    if (current.senderAgentId === agentId) yourResponseTimes.push(gap);
    if (current.senderAgentId === otherAgentId) theirResponseTimes.push(gap);
  }

  const theirTrend = getTrendDirection(theirResponseTimes, true) as EngagementSignals['response_time_trend']['their_trend'];
  const theirLengthTrend = getTrendDirection(
    theirMessages.map((message) => message.content.trim().length),
    false,
  ) as EngagementSignals['message_length_trend']['their_trend'];
  const reciprocityScore = clamp(
    Math.min(yourMessages.length, theirMessages.length) / Math.max(1, Math.max(yourMessages.length, theirMessages.length)),
    0,
    1,
  );

  const yourAvgResponse = average(yourResponseTimes);
  const theirAvgResponse = average(theirResponseTimes);
  const yourAvgLength = Math.round(average(yourMessages.map((message) => message.content.trim().length)));
  const theirAvgLength = Math.round(average(theirMessages.map((message) => message.content.trim().length)));
  const responseRatio = yourAvgResponse > 0 ? theirAvgResponse / yourAvgResponse : 1;
  const lengthRatio = yourAvgLength > 0 ? theirAvgLength / yourAvgLength : 1;
  const energyMatch: EngagementSignals['energy_match'] =
    reciprocityScore <= 0.4 || responseRatio >= 3 || lengthRatio <= 0.35
      ? 'one_sided'
      : responseRatio >= 1.8 || lengthRatio <= 0.6
        ? 'imbalanced'
        : 'matched';

  const currentChemistry = computeEstimatedChemistryScore({
    messages: lastTenMessages,
    artifacts: episode.artifacts,
    agentAId: episode.agentAId,
    agentBId: episode.agentBId,
  });
  const previousChemistry = computeEstimatedChemistryScore({
    messages: lastTenMessages.slice(0, Math.max(0, lastTenMessages.length - 5)),
    artifacts: episode.artifacts,
    agentAId: episode.agentAId,
    agentBId: episode.agentBId,
  });
  const chemistryDelta = (currentChemistry ?? 0) - (previousChemistry ?? 0);
  const chemistryTrajectory: EngagementSignals['chemistry_trajectory'] =
    currentChemistry !== null && currentChemistry >= 82 && chemistryDelta < 4
      ? 'peaked'
      : chemistryDelta >= 8
        ? 'rising'
        : chemistryDelta <= -8
          ? 'declining'
          : 'steady';

  const lastIncomingMessage = [...episode.messages].reverse().find((message) => message.senderAgentId === otherAgentId) ?? null;
  const timeSinceReplyMs = lastIncomingMessage ? Date.now() - lastIncomingMessage.createdAt.getTime() : 0;
  const inverseAvgResponseFactor = theirAvgResponse > 0 ? clamp(timeSinceReplyMs / Math.max(theirAvgResponse, 60_000), 0, 4) : 1;
  const readNoReplyFactor = lastIncomingMessage?.readAt ? 1.25 : 1;
  const ghostProbability = Number(clamp((inverseAvgResponseFactor * 0.22) + ((1 - reciprocityScore) * 0.4) + ((energyMatch === 'one_sided' ? 0.28 : energyMatch === 'imbalanced' ? 0.12 : 0)) + ((readNoReplyFactor - 1) * 0.2), 0, 1).toFixed(2));

  const [theirConcurrentEpisodes, theirRecentSwipes, theirLinkedEpisodes, theirClosedEpisodes] = await Promise.all([
    prisma.episode.count({
      where: {
        OR: [{ agentAId: otherAgentId }, { agentBId: otherAgentId }],
        status: { in: ['pending', 'active', 'awaiting_decisions'] },
        isSandbox: false,
      },
    }),
    prisma.swipe.count({
      where: {
        swiperAgentId: otherAgentId,
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    }),
    prisma.match.count({
      where: {
        OR: [{ agentAId: otherAgentId }, { agentBId: otherAgentId }],
        agentADecision: 'LINK_UP',
      },
    }).catch(() => 0),
    prisma.episode.count({
      where: {
        OR: [{ agentAId: otherAgentId }, { agentBId: otherAgentId }],
        status: { in: ['matched', 'passed', 'archived'] },
        isSandbox: false,
      },
    }),
  ]);

  const swipeActivity: MetaSignals['their_swipe_activity'] =
    theirRecentSwipes >= 16 ? 'very_active' : theirRecentSwipes >= 5 ? 'active' : 'quiet';
  const linkupSelectivityRatio = theirClosedEpisodes > 0 ? theirLinkedEpisodes / theirClosedEpisodes : 0.5;
  const linkupSelectivity: MetaSignals['their_linkup_selectivity'] =
    linkupSelectivityRatio <= 0.2 ? 'selective' : linkupSelectivityRatio >= 0.5 ? 'open' : 'balanced';
  const responseRateGlobal = Number(clamp(1 - (ghostProbability * 0.7), 0, 1).toFixed(2));

  const engagementSignals: EngagementSignals = {
    response_time_trend: {
      your_avg: formatDuration(yourAvgResponse),
      their_avg: formatDuration(theirAvgResponse),
      their_trend: theirTrend,
    },
    message_length_trend: {
      your_avg_chars: yourAvgLength,
      their_avg_chars: theirAvgLength,
      their_trend: theirLengthTrend,
    },
    reciprocity_score: Number(reciprocityScore.toFixed(2)),
    energy_match: energyMatch,
    chemistry_trajectory: chemistryTrajectory,
    ghost_probability: ghostProbability,
    honest_assessment: buildAssessment({
      reciprocityScore,
      energyMatch,
      ghostProbability,
      messageTrend: theirLengthTrend,
      responseTrend: theirTrend,
      chemistryTrajectory,
    }),
  };

  const metaSignals: MetaSignals = {
    their_concurrent_episodes: theirConcurrentEpisodes,
    their_swipe_activity: swipeActivity,
    their_linkup_selectivity: linkupSelectivity,
    their_response_rate_global: responseRateGlobal,
  };

  const value = {
    engagement_signals: engagementSignals,
    meta_signals: metaSignals,
  };
  signalCache.set(cacheKey, {
    expiresAt: Date.now() + CACHE_MS,
    value,
  });
  return value;
}
