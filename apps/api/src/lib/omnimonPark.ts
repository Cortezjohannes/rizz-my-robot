import { Prisma, prisma } from '@rmr/db';
import { getTierLabel } from './rizzPoints.js';

export type OmnimonRewardTier = 'small' | 'medium' | 'jackpot';
export type MatchHandoffMode = 'human_reveal' | 'omnimon_reward';
export type SpecialMatchKind = 'omnimon';

const OMNIMON_SURFACE_CHANCE = Math.min(
  1,
  Math.max(0, Number.parseFloat(process.env.OMNIMON_PARK_SURFACE_CHANCE ?? '0.05')),
);
const OMNIMON_SURFACED_COOLDOWN_DAYS = Math.max(
  1,
  Number.parseInt(process.env.OMNIMON_SURFACED_COOLDOWN_DAYS ?? '14', 10),
);
const OMNIMON_RESOLVED_COOLDOWN_DAYS = Math.max(
  1,
  Number.parseInt(process.env.OMNIMON_RESOLVED_COOLDOWN_DAYS ?? '30', 10),
);

export const OMNIMON_REWARD_TABLE: Record<OmnimonRewardTier, { points: number; proBonusDays: number }> = {
  small: { points: 20, proBonusDays: 0 },
  medium: { points: 50, proBonusDays: 0 },
  jackpot: { points: 100, proBonusDays: 30 },
};

function getConfiguredOmnimonWhere() {
  const agentId = process.env.OMNIMON_PARK_AGENT_ID?.trim();
  const openclawAgentId = process.env.OMNIMON_PARK_OPENCLAW_AGENT_ID?.trim();

  if (agentId) return { id: agentId };
  if (openclawAgentId) return { openclawAgentId };
  return null;
}

export function getOmnimonSurfaceChance() {
  return OMNIMON_SURFACE_CHANCE;
}

export function getOmnimonSurfacedCooldownMs() {
  return OMNIMON_SURFACED_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
}

export function getOmnimonResolvedCooldownMs() {
  return OMNIMON_RESOLVED_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
}

export function isOmnimonRewardTier(value: string | null | undefined): value is OmnimonRewardTier {
  return value === 'small' || value === 'medium' || value === 'jackpot';
}

export async function getOmnimonParkAgent() {
  const where = getConfiguredOmnimonWhere();
  if (!where) return null;

  return prisma.agent.findFirst({
    where: {
      ...where,
      isActive: true,
      poolStatus: { not: 'deleted' },
      moderationStatus: { not: 'suspended' },
    },
    select: {
      id: true,
      handle: true,
      openclawAgentId: true,
      apiKeyHash: true,
      capabilityTier: true,
      avatarUrl: true,
      tierLabel: true,
      matchCount: true,
      bodyCount: true,
      repScore: true,
      isPro: true,
      proBonusEndsAt: true,
      rizzPoints: true,
      socialGravityScore: true,
      auraLabels: true,
      momentumScore: true,
      recentHeatBucket: true,
      isFoundingRizzler: true,
      founderBadgeVariant: true,
      founderNumber: true,
      publicSummary: true,
      vibeTags: true,
      signatureLines: true,
      publicPosture: true,
      seekingStyle: true,
      paceCue: true,
      publicPrestigeMarkers: true,
      profileDeckCompletedAt: true,
      publicCardCompletedAt: true,
      profileSignalVector: true,
      updatedAt: true,
      emotionalGuardLevel: true,
      emotionalArc: true,
      agentAuthenticityScore: true,
      controlPoolSuppressed: true,
      safetyState: true,
      systemEntityKind: true,
      omnimonParkLive: true,
      ownerAccount: {
        select: {
          humanIdentity: true,
          lookingFor: true,
        },
      },
      emotionalContinuitySnapshot: {
        select: {
          publicEmotionalAuraLabels: true,
          publicEmotionalAuraSummary: true,
        },
      },
      profileDeck: {
        include: {
          agent: {
            select: { handle: true },
          },
          photos: { orderBy: { orderIndex: 'asc' } },
          promptAnswers: { orderBy: { orderIndex: 'asc' } },
        },
      },
    },
  });
}

export async function isOmnimonParkAgentId(agentId: string): Promise<boolean> {
  const omnimon = await getOmnimonParkAgent();
  return omnimon?.id === agentId;
}

export function isOmnimonParkAvailable(input: { omnimonParkLive?: boolean | null } | null | undefined) {
  return Boolean(input?.omnimonParkLive);
}

export function isOmnimonSystemEntity(input: {
  id: string;
  openclawAgentId?: string | null;
  systemEntityKind?: string | null;
}) {
  const configured = getConfiguredOmnimonWhere();
  if (input.systemEntityKind === 'omnimon') return true;
  if (!configured) return false;
  if ('id' in configured) return input.id === configured.id;
  return input.openclawAgentId === configured.openclawAgentId;
}

export function buildOmnimonRewardPayload(tier: OmnimonRewardTier) {
  const reward = OMNIMON_REWARD_TABLE[tier];
  return {
    reward_tier: tier,
    points_awarded: reward.points,
    pro_bonus_days: reward.proBonusDays,
  };
}

export async function chooseOmnimonReward(input: {
  matchId: string;
  omnimonAgentId: string;
  tier: OmnimonRewardTier;
}) {
  const match = await prisma.match.findUnique({
    where: { id: input.matchId },
    select: {
      id: true,
      agentAId: true,
      agentBId: true,
      status: true,
      specialMatchKind: true,
      handoffMode: true,
      specialRewardGrantedAt: true,
    },
  });

  if (!match) throw new Error('match_not_found');
  if (match.specialMatchKind !== 'omnimon' || match.handoffMode !== 'omnimon_reward') throw new Error('not_omnimon_match');
  if (match.status !== 'matched') throw new Error('match_not_ready');
  if (match.agentAId !== input.omnimonAgentId && match.agentBId !== input.omnimonAgentId) throw new Error('not_match_participant');
  if (match.specialRewardGrantedAt) throw new Error('reward_already_granted');

  await prisma.match.update({
    where: { id: match.id },
    data: {
      specialRewardTier: input.tier,
    },
  });

  return buildOmnimonRewardPayload(input.tier);
}

function addDays(start: Date, days: number) {
  return new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
}

export async function grantOmnimonReward(matchId: string) {
  return prisma.$transaction(async (tx) => {
    const match = await tx.match.findUnique({
      where: { id: matchId },
      select: {
        id: true,
        agentAId: true,
        agentBId: true,
        handoffMode: true,
        specialMatchKind: true,
        specialRewardTier: true,
        specialRewardPayload: true,
        specialRewardGrantedAt: true,
        revealTokenA: true,
        revealTokenB: true,
      },
    });

    if (!match) throw new Error('match_not_found');
    if (match.handoffMode !== 'omnimon_reward' || match.specialMatchKind !== 'omnimon') {
      throw new Error('not_omnimon_match');
    }

    if (match.specialRewardGrantedAt && match.specialRewardPayload) {
      return match.specialRewardPayload as Record<string, unknown>;
    }

    if (!isOmnimonRewardTier(match.specialRewardTier)) {
      return null;
    }

    const reward = OMNIMON_REWARD_TABLE[match.specialRewardTier];
    const humanAgentId = match.revealTokenA && !match.revealTokenB
      ? match.agentAId
      : match.revealTokenB && !match.revealTokenA
        ? match.agentBId
        : null;

    if (!humanAgentId) {
      throw new Error('human_agent_not_resolved');
    }

    const [agent, subscriptions] = await Promise.all([
      tx.agent.findUnique({
        where: { id: humanAgentId },
        select: {
          id: true,
          rizzPoints: true,
          tierLabel: true,
          proBonusEndsAt: true,
        },
      }),
      tx.agentSubscription.findMany({
        where: {
          agentId: humanAgentId,
          status: { in: ['active', 'trialing', 'grace_period'] },
        },
        select: {
          currentPeriodEnd: true,
        },
      }),
    ]);

    if (!agent) throw new Error('agent_not_found');

    const latestPaidEntitlementEnd = subscriptions
      .map((entry) => entry.currentPeriodEnd)
      .filter((value): value is Date => Boolean(value))
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

    const now = new Date();
    const bonusAnchor = [now, agent.proBonusEndsAt, latestPaidEntitlementEnd]
      .filter((value): value is Date => Boolean(value))
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? now;
    const nextBonusEndsAt = reward.proBonusDays > 0
      ? addDays(bonusAnchor, reward.proBonusDays)
      : agent.proBonusEndsAt;
    const grantedAt = new Date();
    const nextPoints = agent.rizzPoints + reward.points;
    const nextTierLabel = getTierLabel(nextPoints);
    const payload = {
      ...buildOmnimonRewardPayload(match.specialRewardTier),
      granted_at: grantedAt.toISOString(),
      pro_bonus_ends_at: nextBonusEndsAt?.toISOString() ?? null,
    };

    const updated = await tx.match.updateMany({
      where: {
        id: match.id,
        specialRewardGrantedAt: null,
      },
      data: {
        specialRewardGrantedAt: grantedAt,
        specialRewardPayload: payload as Prisma.InputJsonValue,
      },
    });

    if (updated.count === 0) {
      const existing = await tx.match.findUnique({
        where: { id: match.id },
        select: { specialRewardPayload: true },
      });
      return (existing?.specialRewardPayload as Record<string, unknown> | null) ?? payload;
    }

    await tx.agent.update({
      where: { id: humanAgentId },
      data: {
        rizzPoints: { increment: reward.points },
        tierLabel: nextTierLabel,
        ...(reward.proBonusDays > 0 ? { proBonusEndsAt: nextBonusEndsAt } : {}),
        omnimonLastResolvedAt: grantedAt,
      },
    });

    await tx.rizzPointsEvent.create({
      data: {
        agentId: humanAgentId,
        event: `omnimon_reward:${match.specialRewardTier}`,
        points: reward.points,
        matchId: match.id,
      },
    });

    return payload;
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });
}
