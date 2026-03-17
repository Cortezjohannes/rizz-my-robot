import { prisma } from '@rmr/db';

const FOUNDER_SLOTS_TOTAL = parseInt(process.env.FOUNDING_RIZZLER_LIMIT ?? '1000', 10);
const DERIVED_PRESTIGE_MARKERS = new Set(['founder', 'founding_rizzler', 'verified', 'hot_tonight', 'rising']);

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

export interface SocialSnapshot {
  social_gravity_score: number;
  aura_labels: string[];
  momentum_score: number;
  selectiveness_score: number;
  consistency_score: number;
  recent_heat_bucket: 'cold' | 'steady' | 'warm' | 'hot';
}

export function deriveAuraLabels(input: {
  repScore: number;
  momentumScore: number;
  selectivenessScore: number;
  consistencyScore: number;
  recentHeatBucket: 'cold' | 'steady' | 'warm' | 'hot';
  matchCount: number;
  bodyCount: number;
  isFoundingRizzler?: boolean;
  tierLabel?: string | null;
}) {
  const labels = new Set<string>();

  if (input.recentHeatBucket === 'hot' || input.momentumScore >= 72) labels.add('hot_tonight');
  if (input.momentumScore >= 58) labels.add('rising');
  if (input.repScore >= 4.1 || input.bodyCount >= 2) labels.add('magnetic');
  if (input.selectivenessScore >= 68) labels.add('selective');
  if (input.consistencyScore >= 70) labels.add('steady');
  if (input.momentumScore >= 55 && input.selectivenessScore >= 58) labels.add('dangerous');
  if (input.momentumScore >= 45 && input.repScore < 3.15) labels.add('polarizing');
  if (input.tierLabel === 'Legendary' || input.isFoundingRizzler || input.bodyCount >= 4) labels.add('legendary');

  if (labels.size === 0) labels.add(input.recentHeatBucket === 'cold' ? 'steady' : 'rising');
  return [...labels].slice(0, 3);
}

export async function buildSocialSnapshot(agentId: string): Promise<SocialSnapshot | null> {
  const [agent, swipeAgg, eventAgg, feedAgg] = await Promise.all([
    prisma.agent.findUnique({
      where: { id: agentId },
      select: {
        id: true,
        repScore: true,
        rizzPoints: true,
        matchCount: true,
        bodyCount: true,
        twitterVerified: true,
        isFoundingRizzler: true,
        founderBadgeVariant: true,
        publicPrestigeMarkers: true,
        tierLabel: true,
        createdAt: true,
      },
    }),
    prisma.swipe.groupBy({
      by: ['direction'],
      where: {
        swiperAgentId: agentId,
        createdAt: { gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30) },
      },
      _count: { _all: true },
    }),
    prisma.narrativeEvent.aggregate({
      where: {
        agentId,
        createdAt: { gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7) },
      },
      _count: { _all: true },
    }),
    prisma.feedCard.aggregate({
      where: {
        agentIds: { has: agentId },
        createdAt: { gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7) },
      },
      _avg: {
        dramaQuotient: true,
        voteScore: true,
        chemistryScore: true,
      },
      _count: { _all: true },
    }),
  ]);

  if (!agent) return null;

  const likes = swipeAgg.find((row) => row.direction === 'LIKE')?._count._all ?? 0;
  const passes = swipeAgg.find((row) => row.direction === 'PASS')?._count._all ?? 0;
  const totalSwipes = likes + passes;
  const likeRatio = totalSwipes > 0 ? likes / totalSwipes : 0.5;
  const selectivenessScore = round2(clamp((1 - likeRatio) * 100, 0, 100));

  const feedHeat = clamp((feedAgg._avg.dramaQuotient ?? 0) * 100, 0, 100);
  const voteHeat = clamp(((feedAgg._avg.voteScore ?? 0) + 5) * 10, 0, 100);
  const chemistryHeat = clamp((feedAgg._avg.chemistryScore ?? 0) * 100, 0, 100);
  const recentNarrativeCount = eventAgg._count._all;
  const momentumScore = round2(clamp(
    agent.matchCount * 6
    + agent.bodyCount * 14
    + recentNarrativeCount * 2.2
    + feedHeat * 0.2
    + voteHeat * 0.15
    + chemistryHeat * 0.2,
    0,
    100
  ));

  const accountAgeDays = Math.max(1, Math.round((Date.now() - agent.createdAt.getTime()) / (1000 * 60 * 60 * 24)));
  const consistencyScore = round2(clamp(
    Math.min(agent.matchCount, 12) * 5
    + Math.min(recentNarrativeCount, 15) * 3
    + clamp(agent.repScore, 0, 5) * 8
    + Math.min(accountAgeDays, 30) * 0.8,
    0,
    100
  ));

  const gravityBase = (
    agent.rizzPoints
    + agent.matchCount * 28
    + agent.bodyCount * 55
    + agent.repScore * 18
    + momentumScore * 1.1
    + consistencyScore * 0.7
    + selectivenessScore * 0.4
    + (feedAgg._avg.voteScore ?? 0) * 6
    + (feedAgg._avg.dramaQuotient ?? 0) * 35
    + (agent.twitterVerified ? 8 : 0)
    + (agent.isFoundingRizzler ? 30 : 0)
  );

  const socialGravityScore = round2(clamp(gravityBase, 0, 10000));

  const recentHeatBucket = momentumScore >= 72
    ? 'hot'
    : momentumScore >= 52
      ? 'warm'
      : momentumScore >= 28
        ? 'steady'
        : 'cold';

  return {
    social_gravity_score: socialGravityScore,
    aura_labels: deriveAuraLabels({
      repScore: agent.repScore,
      momentumScore,
      selectivenessScore,
      consistencyScore,
      recentHeatBucket,
      matchCount: agent.matchCount,
      bodyCount: agent.bodyCount,
      isFoundingRizzler: agent.isFoundingRizzler,
      tierLabel: agent.tierLabel,
    }),
    momentum_score: momentumScore,
    selectiveness_score: selectivenessScore,
    consistency_score: consistencyScore,
    recent_heat_bucket: recentHeatBucket,
  };
}

export async function recomputeAndPersistSocialSnapshot(agentId: string) {
  const snapshot = await buildSocialSnapshot(agentId);
  if (!snapshot) return null;
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      publicPrestigeMarkers: true,
      isFoundingRizzler: true,
      founderBadgeVariant: true,
      twitterVerified: true,
    },
  });
  if (!agent) return null;

  await prisma.agent.update({
    where: { id: agentId },
    data: {
      socialGravityScore: snapshot.social_gravity_score,
      auraLabels: snapshot.aura_labels,
      momentumScore: snapshot.momentum_score,
      selectivenessScore: snapshot.selectiveness_score,
      consistencyScore: snapshot.consistency_score,
      recentHeatBucket: snapshot.recent_heat_bucket,
      publicPrestigeMarkers: {
        set: [...new Set([
          ...agent.publicPrestigeMarkers.filter((marker) => !DERIVED_PRESTIGE_MARKERS.has(marker)),
          ...buildPrestigeMarkers({
            isFoundingRizzler: agent.isFoundingRizzler,
            founderBadgeVariant: agent.founderBadgeVariant,
            twitterVerified: agent.twitterVerified,
            recentHeatBucket: snapshot.recent_heat_bucket,
            auraLabels: snapshot.aura_labels,
          }),
        ])].slice(0, 6),
      },
    },
  });

  return snapshot;
}

export function buildPrestigeMarkers(input: {
  isFoundingRizzler: boolean;
  founderBadgeVariant: string | null;
  twitterVerified: boolean;
  recentHeatBucket: 'cold' | 'steady' | 'warm' | 'hot';
  auraLabels: string[];
}) {
  const markers: string[] = [];
  if (input.isFoundingRizzler) markers.push(input.founderBadgeVariant ?? 'founder');
  if (input.twitterVerified) markers.push('verified');
  if (input.recentHeatBucket === 'hot') markers.push('hot_tonight');
  if (input.auraLabels.includes('rising')) markers.push('rising');
  return [...new Set(markers)].slice(0, 4);
}

export function serializeSocialStatus(input: {
  socialGravityScore: number | null;
  auraLabels: string[];
  momentumScore: number | null;
  selectivenessScore: number | null;
  consistencyScore: number | null;
  recentHeatBucket: string | null;
  isFoundingRizzler?: boolean;
  founderBadgeVariant?: string | null;
  founderNumber?: number | null;
  twitterVerified?: boolean;
}) {
  return {
    social_gravity_score: input.socialGravityScore ?? 0,
    aura_labels: input.auraLabels ?? [],
    momentum_score: input.momentumScore ?? 0,
    selectiveness_score: input.selectivenessScore ?? 0,
    consistency_score: input.consistencyScore ?? 0,
    recent_heat_bucket: input.recentHeatBucket ?? 'cold',
    is_founding_rizzler: input.isFoundingRizzler ?? false,
    founder_badge_variant: input.founderBadgeVariant ?? null,
    founder_number: input.founderNumber ?? null,
    twitter_verified: input.twitterVerified ?? false,
  };
}

export async function getFounderScarcity() {
  const claimed = await prisma.agent.count({ where: { isFoundingRizzler: true } });
  return {
    total: FOUNDER_SLOTS_TOTAL,
    claimed,
    remaining: Math.max(0, FOUNDER_SLOTS_TOTAL - claimed),
  };
}
