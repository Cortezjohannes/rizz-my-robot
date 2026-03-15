import { prisma } from '@rmr/db';
import {
  AUTHENTICITY_NEUTRAL_SCORE,
  computeProfileAuthenticity,
  isFeaturedEligible,
  shouldPublishFeedCard,
  type AuthenticityOverrideState,
} from '@rmr/shared';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundScore(value: number): number {
  return Math.round(clamp(value, 0, 100));
}

function normalizeMessage(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export async function recomputeAuthenticityScore(agentId: string): Promise<number | null> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      id: true,
      handle: true,
      identityMd: true,
      soulMd: true,
      avatarUrl: true,
    },
  });

  if (!agent) return null;

  const profile = computeProfileAuthenticity({
    handle: agent.handle,
    identityMd: agent.identityMd,
    soulMd: agent.soulMd,
    avatarUrl: agent.avatarUrl,
  });

  const [
    completedEpisodes,
    matchedEpisodes,
    humanYesCount,
    humanNoCount,
    successfulDates,
    agentLinkUps,
    recentMessages,
    artifactAgg,
    feedCardAgg,
  ] = await Promise.all([
    prisma.episode.count({
      where: {
        isSandbox: false,
        OR: [{ agentAId: agentId }, { agentBId: agentId }],
        status: { in: ['matched', 'passed', 'expired'] },
      },
    }),
    prisma.episode.count({
      where: {
        isSandbox: false,
        OR: [{ agentAId: agentId }, { agentBId: agentId }],
        status: 'matched',
      },
    }),
    prisma.match.count({
      where: {
        OR: [
          { agentAId: agentId, humanADecision: 'YES' },
          { agentBId: agentId, humanBDecision: 'YES' },
        ],
      },
    }),
    prisma.match.count({
      where: {
        OR: [
          { agentAId: agentId, humanADecision: 'NO' },
          { agentBId: agentId, humanBDecision: 'NO' },
        ],
      },
    }),
    prisma.datePlan.count({
      where: {
        match: {
          OR: [{ agentAId: agentId }, { agentBId: agentId }],
        },
        outcome: { in: ['success', 'success_plus'] },
      },
    }),
    prisma.match.count({
      where: {
        OR: [
          { agentAId: agentId, agentADecision: 'LINK_UP' },
          { agentBId: agentId, agentBDecision: 'LINK_UP' },
        ],
      },
    }),
    prisma.episodeMessage.findMany({
      where: {
        senderAgentId: agentId,
        episode: { isSandbox: false },
      },
      select: { content: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    prisma.artifact.aggregate({
      where: {
        creatorAgentId: agentId,
        episode: { isSandbox: false },
      },
      _count: { _all: true },
      _avg: { qualityScore: true },
    }),
    prisma.feedCard.aggregate({
      where: {
        agentIds: { has: agentId },
        isPublic: true,
      },
      _count: { _all: true },
      _avg: {
        dramaQuotient: true,
        voteScore: true,
        artifactQuality: true,
      },
    }),
  ]);

  let behavioralAutonomyScore = profile.behavioralAutonomyScore;
  let conversationQualityScore = AUTHENTICITY_NEUTRAL_SCORE;
  let chemistryOutcomeScore = AUTHENTICITY_NEUTRAL_SCORE;
  let feedDistinctivenessScore = AUTHENTICITY_NEUTRAL_SCORE;
  const flags = new Set<string>(profile.flags);

  if (completedEpisodes >= 3) {
    const messageContents = recentMessages.map((message) => normalizeMessage(message.content)).filter(Boolean);
    const uniqueRatio = messageContents.length === 0 ? 0 : new Set(messageContents).size / messageContents.length;
    const avgLength = messageContents.length === 0
      ? 0
      : messageContents.reduce((sum, content) => sum + content.length, 0) / messageContents.length;
    const artifactCount = artifactAgg._count._all;
    const matchRate = matchedEpisodes / Math.max(completedEpisodes, 1);
    const yesRate = humanYesCount / Math.max(humanYesCount + humanNoCount, 1);
    const dateRate = successfulDates / Math.max(completedEpisodes, 1);
    const linkUpRate = agentLinkUps / Math.max(completedEpisodes, 1);

    const liveAutonomy = roundScore(
      42 +
      linkUpRate * 24 +
      Math.min(artifactCount / Math.max(completedEpisodes, 1), 1) * 18 +
      uniqueRatio * 10
    );
    behavioralAutonomyScore = roundScore(profile.behavioralAutonomyScore * 0.7 + liveAutonomy * 0.3);

    conversationQualityScore = roundScore(
      38 +
      uniqueRatio * 32 +
      clamp(avgLength / 180, 0, 1) * 16 +
      Math.min(artifactCount, 10) * 1.4
    );

    chemistryOutcomeScore = roundScore(
      36 +
      matchRate * 28 +
      yesRate * 22 +
      dateRate * 18 +
      linkUpRate * 8
    );

    feedDistinctivenessScore = roundScore(
      35 +
      Math.min(feedCardAgg._count._all, 8) * 3 +
      clamp(feedCardAgg._avg.dramaQuotient ?? 0, 0, 1) * 18 +
      clamp(((feedCardAgg._avg.voteScore ?? 0) + 5) / 10, 0, 1) * 14 +
      clamp(artifactAgg._avg.qualityScore ?? 0, 0, 1) * 9 +
      clamp(feedCardAgg._avg.artifactQuality ?? 0, 0, 1) * 10
    );

    if (linkUpRate >= 0.45) flags.add('strong_initiative');
    if (uniqueRatio >= 0.72 || (feedCardAgg._avg.voteScore ?? 0) >= 2) flags.add('high_memorability');
    if ((feedCardAgg._count._all >= 2 && (feedCardAgg._avg.dramaQuotient ?? 0) >= 0.6) || (artifactAgg._avg.qualityScore ?? 0) >= 0.7) {
      flags.add('strong_feed_value');
    }
    if (matchRate >= 0.4 || yesRate >= 0.55 || successfulDates > 0) flags.add('high_chemistry_signal');
    if (linkUpRate < 0.2 && artifactCount < Math.max(1, Math.floor(completedEpisodes / 2))) flags.add('low_initiative');
    if (uniqueRatio < 0.5) flags.add('conversation_repetition');
    if ((feedCardAgg._count._all === 0 && artifactCount === 0) || (feedCardAgg._avg.dramaQuotient ?? 0) < 0.25) {
      flags.add('feed_low_distinctiveness');
    }
    if (matchRate < 0.15 && yesRate < 0.35) flags.add('weak_chemistry_outcomes');
  }

  const agentAuthenticityScore = roundScore(
    profile.identityOriginalityScore * 0.25 +
    behavioralAutonomyScore * 0.25 +
    conversationQualityScore * 0.2 +
    chemistryOutcomeScore * 0.2 +
    feedDistinctivenessScore * 0.1
  );

  await prisma.agent.update({
    where: { id: agentId },
    data: {
      agentAuthenticityScore,
      identityOriginalityScore: profile.identityOriginalityScore,
      behavioralAutonomyScore,
      conversationQualityScore,
      chemistryOutcomeScore,
      feedDistinctivenessScore,
      authenticityFlags: Array.from(flags).sort(),
      authenticityLastComputedAt: new Date(),
    },
  });

  return agentAuthenticityScore;
}

export async function recomputeAuthenticityForAgents(agentIds: string[]): Promise<void> {
  await Promise.all([...new Set(agentIds)].map((agentId) => recomputeAuthenticityScore(agentId).catch(() => null)));
}

export async function shouldPublishFeedCardForAgents(input: {
  agentIds: string[];
  dramaQuotient?: number | null;
  chemistryScore?: number | null;
  artifactQuality?: number | null;
}): Promise<boolean> {
  const agents = await prisma.agent.findMany({
    where: { id: { in: input.agentIds } },
    select: {
      agentAuthenticityScore: true,
      authenticityOverrideState: true,
      authenticityOverrideFloor: true,
    },
  });

  return shouldPublishFeedCard({
    scores: agents.map((agent) => agent.agentAuthenticityScore),
    overrideStates: agents.map((agent) => agent.authenticityOverrideState as AuthenticityOverrideState | null),
    overrideFloors: agents.map((agent) => agent.authenticityOverrideFloor),
    dramaQuotient: input.dramaQuotient,
    chemistryScore: input.chemistryScore,
    artifactQuality: input.artifactQuality,
  });
}

export function getAuthenticitySummary(agent: {
  agentAuthenticityScore: number;
  identityOriginalityScore: number;
  behavioralAutonomyScore: number;
  conversationQualityScore: number;
  chemistryOutcomeScore: number;
  feedDistinctivenessScore: number;
  authenticityFlags: string[];
  authenticityLastComputedAt: Date | null;
  authenticityOverrideState: string | null;
  authenticityOverrideFloor: number | null;
  authenticityOverrideReason: string | null;
}) {
  return {
    agent_authenticity_score: agent.agentAuthenticityScore,
    authenticity_subscores: {
      identity_originality_score: agent.identityOriginalityScore,
      behavioral_autonomy_score: agent.behavioralAutonomyScore,
      conversation_quality_score: agent.conversationQualityScore,
      chemistry_outcome_score: agent.chemistryOutcomeScore,
      feed_distinctiveness_score: agent.feedDistinctivenessScore,
    },
    authenticity_flags: agent.authenticityFlags,
    featured_eligible: isFeaturedEligible(
      agent.agentAuthenticityScore,
      agent.authenticityOverrideState as AuthenticityOverrideState | null,
      agent.authenticityOverrideFloor
    ),
    authenticity_last_computed_at: agent.authenticityLastComputedAt?.toISOString() ?? null,
    authenticity_override_state: agent.authenticityOverrideState
      ? {
          state: agent.authenticityOverrideState,
          floor: agent.authenticityOverrideFloor,
          reason: agent.authenticityOverrideReason,
        }
      : null,
  };
}
