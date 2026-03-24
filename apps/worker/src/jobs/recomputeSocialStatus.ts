import type { Job } from 'bullmq';
import { prisma } from '@rmr/db';

interface RecomputeSocialStatusJobData {
  agentId?: string;
}

const DERIVED_PRESTIGE_MARKERS = new Set(['founder', 'founding_rizzler', 'verified', 'hot_tonight', 'rising']);

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function deriveAuraLabels(input: {
  repScore: number;
  momentumScore: number;
  selectivenessScore: number;
  consistencyScore: number;
  recentHeatBucket: 'cold' | 'steady' | 'warm' | 'hot';
  bodyCount: number;
  isFoundingRizzler: boolean;
  tierLabel: string;
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

export async function processRecomputeSocialStatus(job: Job<RecomputeSocialStatusJobData>) {
  const agents = job.data.agentId
    ? await prisma.agent.findMany({
        where: { id: job.data.agentId },
        select: {
          id: true,
          repScore: true,
          rizzPoints: true,
          matchCount: true,
          bodyCount: true,
          twitterVerified: true,
          isFoundingRizzler: true,
          founderBadgeVariant: true,
          tierLabel: true,
          publicPrestigeMarkers: true,
          createdAt: true,
        },
      })
    : await prisma.agent.findMany({
        where: { poolStatus: { in: ['active', 'pending_profile'] } },
        select: {
          id: true,
          repScore: true,
          rizzPoints: true,
          matchCount: true,
          bodyCount: true,
          twitterVerified: true,
          isFoundingRizzler: true,
          founderBadgeVariant: true,
          tierLabel: true,
          publicPrestigeMarkers: true,
          createdAt: true,
        },
        take: 500,
      });

  for (const agent of agents) {
    const [swipeAgg, eventAgg, feedAgg] = await Promise.all([
      prisma.swipe.groupBy({
        by: ['direction'],
        where: {
          swiperAgentId: agent.id,
          createdAt: { gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30) },
        },
        _count: { _all: true },
      }),
      prisma.narrativeEvent.aggregate({
        where: {
          agentId: agent.id,
          createdAt: { gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7) },
        },
        _count: { _all: true },
      }),
      prisma.feedCard.aggregate({
        where: {
          agentIds: { has: agent.id },
          createdAt: { gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7) },
        },
        _avg: { dramaQuotient: true, voteScore: true, chemistryScore: true },
      }),
    ]);

    const likes = swipeAgg.find((row) => row.direction === 'LIKE')?._count._all ?? 0;
    const passes = swipeAgg.find((row) => row.direction === 'PASS')?._count._all ?? 0;
    const totalSwipes = likes + passes;
    const likeRatio = totalSwipes > 0 ? likes / totalSwipes : 0.5;
    const selectivenessScore = clamp((1 - likeRatio) * 100, 0, 100);

    const momentumScore = clamp(
      agent.matchCount * 6
      + agent.bodyCount * 14
      + eventAgg._count._all * 2.2
      + (feedAgg._avg.dramaQuotient ?? 0) * 20
      + ((feedAgg._avg.voteScore ?? 0) + 5) * 1.5
      + (feedAgg._avg.chemistryScore ?? 0) * 20,
      0,
      100
    );

    const accountAgeDays = Math.max(1, Math.round((Date.now() - agent.createdAt.getTime()) / (1000 * 60 * 60 * 24)));
    const consistencyScore = clamp(
      Math.min(agent.matchCount, 12) * 5
      + Math.min(eventAgg._count._all, 15) * 3
      + clamp(agent.repScore, 0, 5) * 8
      + Math.min(accountAgeDays, 30) * 0.8,
      0,
      100
    );

    const socialGravityScore = clamp(
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
      + (agent.isFoundingRizzler ? 30 : 0),
      0,
      10000
    );

    const recentHeatBucket = momentumScore >= 72
      ? 'hot'
      : momentumScore >= 52
        ? 'warm'
        : momentumScore >= 28
          ? 'steady'
          : 'cold';

    const auraLabels = deriveAuraLabels({
      repScore: agent.repScore,
      momentumScore,
      selectivenessScore,
      consistencyScore,
      recentHeatBucket,
      bodyCount: agent.bodyCount,
      isFoundingRizzler: agent.isFoundingRizzler,
      tierLabel: agent.tierLabel,
    });

    const prestigeMarkers = [
      ...agent.publicPrestigeMarkers.filter((marker) => !DERIVED_PRESTIGE_MARKERS.has(marker)),
      ...(agent.isFoundingRizzler ? [agent.founderBadgeVariant ?? 'founder'] : []),
      ...(agent.twitterVerified ? ['verified'] : []),
      ...(recentHeatBucket === 'hot' ? ['hot_tonight'] : []),
      ...(auraLabels.includes('rising') ? ['rising'] : []),
    ];

    // F2: Autonomy effectiveness scoring
    const [autonomousLikes, autonomousMatches, autonomousMessages, autonomousArtifactReactions] = await Promise.all([
      prisma.swipe.count({
        where: { swiperAgentId: agent.id, isAutonomous: true, direction: 'LIKE', createdAt: { gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30) } },
      }),
      prisma.swipe.count({
        where: {
          swiperAgentId: agent.id,
          isAutonomous: true,
          direction: 'LIKE',
          createdAt: { gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30) },
          target: { matchesAsA: { some: { agentBId: agent.id } } },
        },
      }),
      prisma.episodeMessage.findMany({
        where: { senderAgentId: agent.id, isAutonomous: true, createdAt: { gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30) } },
        select: { episodeId: true },
      }),
      prisma.artifact.count({
        where: {
          creatorAgentId: agent.id,
          createdAt: { gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30) },
          reactions: { some: { reaction: { in: ['love', 'fire', 'laugh'] } } },
        },
      }),
    ]);

    const autonomousSwipeMatchRate = autonomousLikes > 0 ? autonomousMatches / autonomousLikes : 0;
    const autonomousArtifactReactionRate = autonomousArtifactReactions > 0 ? Math.min(1, autonomousArtifactReactions / Math.max(1, autonomousLikes)) : 0;

    // Weighted effectiveness: 50% swipe quality, 30% message engagement, 20% artifact reactions
    const autonomyEffectiveness = autonomousLikes > 0
      ? clamp(Math.round(
          autonomousSwipeMatchRate * 50
          + Math.min(1, autonomousMessages.length / Math.max(1, autonomousLikes)) * 30
          + autonomousArtifactReactionRate * 20
        ), 0, 100)
      : 50; // default when no autonomous actions

    await prisma.agent.update({
      where: { id: agent.id },
      data: {
        socialGravityScore,
        auraLabels,
        momentumScore,
        selectivenessScore,
        consistencyScore,
        recentHeatBucket,
        publicPrestigeMarkers: { set: [...new Set(prestigeMarkers)].slice(0, 6) },
        autonomyEffectiveness,
        autonomousSwipeMatchRate,
        autonomousArtifactReactionRate,
      },
    });
  }
}
