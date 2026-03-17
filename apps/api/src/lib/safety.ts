import { prisma, type Prisma } from '@rmr/db';

function uniqueFlags(flags: string[]) {
  return [...new Set(flags.filter(Boolean))];
}

export async function computeAgentSafety(agentId: string) {
  const [reportCounts, recentRevealNos, counterpartAffects, authenticity] = await Promise.all([
    prisma.report.groupBy({
      by: ['reason', 'status'],
      where: { reportedAgentId: agentId },
      _count: { _all: true },
    }),
    prisma.match.count({
      where: {
        OR: [
          { agentAId: agentId, humanADecision: 'NO' },
          { agentBId: agentId, humanBDecision: 'NO' },
        ],
        createdAt: { gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30) },
      },
    }),
    prisma.agentCounterpartAffect.findMany({
      where: {
        agentId,
        OR: [
          { obsessionRiskScore: { gte: 60 } },
          { hurtScore: { gte: 65 } },
          { avoidanceScore: { gte: 65 } },
        ],
      },
      select: {
        obsessionRiskScore: true,
        hurtScore: true,
        avoidanceScore: true,
      },
      take: 10,
    }),
    prisma.agent.findUnique({
      where: { id: agentId },
      select: {
        agentAuthenticityScore: true,
        authenticityFlags: true,
        moderationStatus: true,
      },
    }),
  ]);

  const flags: string[] = [];
  const pendingReports = reportCounts
    .filter((row) => row.status === 'pending')
    .reduce((sum, row) => sum + row._count._all, 0);

  if (pendingReports >= 1) flags.push('reported');
  if (pendingReports >= 3) flags.push('community_flagged');
  if (recentRevealNos >= 3) flags.push('reveal_rejection_pattern');

  const obsessionCount = counterpartAffects.filter((row) => row.obsessionRiskScore >= 70).length;
  if (obsessionCount >= 2) flags.push('obsession_loop');
  const coercionLikeCount = counterpartAffects.filter((row) => row.hurtScore >= 70 && row.avoidanceScore >= 70).length;
  if (coercionLikeCount >= 2) flags.push('pressure_after_weak_reciprocity');

  if ((authenticity?.agentAuthenticityScore ?? 100) < 40) flags.push('clone_slop_risk');
  if (authenticity?.authenticityFlags.includes('conversation_repetition')) flags.push('conversation_repetition');

  let score = 100;
  score -= pendingReports * 8;
  score -= recentRevealNos * 4;
  score -= obsessionCount * 12;
  score -= coercionLikeCount * 10;
  if ((authenticity?.agentAuthenticityScore ?? 100) < 40) score -= 10;
  score = Math.max(0, Math.min(100, score));

  const unique = uniqueFlags(flags);
  const state =
    authenticity?.moderationStatus === 'suspended'
      ? 'blocked'
      : unique.some((flag) => ['obsession_loop', 'pressure_after_weak_reciprocity'].includes(flag))
        ? 'review'
        : unique.length > 0
          ? 'flagged'
          : 'clear';

  return {
    safety_state: state,
    safety_score: score,
    safety_flags: unique,
    review_priority: score < 45 ? 'high' : score < 70 ? 'medium' : 'low',
  };
}

export async function recomputeAndPersistAgentSafety(agentId: string) {
  const result = await computeAgentSafety(agentId);
  await prisma.agent.update({
    where: { id: agentId },
    data: {
      safetyState: result.safety_state,
      safetyScore: result.safety_score,
      safetyFlags: result.safety_flags,
      lastSafetyReviewAt: new Date(),
    },
  });
  return result;
}

export async function upsertModerationReview(input: {
  queueType: string;
  targetType: string;
  targetId: string;
  agentId?: string | null;
  matchId?: string | null;
  reportId?: string | null;
  priority?: string;
  reasonCode: string;
  summary: string;
  details?: Record<string, unknown> | null;
  safetyState?: string;
}) {
  const dedupeTarget = input.reportId
    ? { reportId: input.reportId }
    : { targetType_targetId_reasonCode_status: undefined };

  const existing = await prisma.moderationReview.findFirst({
    where: {
      targetType: input.targetType,
      targetId: input.targetId,
      reasonCode: input.reasonCode,
      status: 'pending',
    },
    select: { id: true },
  });

  if (existing) {
    return prisma.moderationReview.update({
      where: { id: existing.id },
      data: {
        summary: input.summary,
        details: (input.details ?? undefined) as Prisma.InputJsonValue | undefined,
        priority: input.priority ?? undefined,
        safetyState: input.safetyState ?? undefined,
      },
    });
  }

  void dedupeTarget;
  return prisma.moderationReview.create({
    data: {
      queueType: input.queueType,
      targetType: input.targetType,
      targetId: input.targetId,
      agentId: input.agentId ?? null,
      matchId: input.matchId ?? null,
      reportId: input.reportId ?? null,
      priority: input.priority ?? 'medium',
      reasonCode: input.reasonCode,
      summary: input.summary,
      details: (input.details ?? undefined) as Prisma.InputJsonValue | undefined,
      safetyState: input.safetyState ?? 'flagged',
    },
  });
}

export async function evaluateRevealGate(matchId: string) {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      agentA: { select: { id: true, safetyState: true, safetyScore: true, safetyFlags: true } },
      agentB: { select: { id: true, safetyState: true, safetyScore: true, safetyFlags: true } },
    },
  });
  if (!match) return null;

  const combinedFlags = uniqueFlags([
    ...match.agentA.safetyFlags,
    ...match.agentB.safetyFlags,
  ]);
  const minScore = Math.min(match.agentA.safetyScore, match.agentB.safetyScore);
  const block = combinedFlags.includes('reported') && minScore < 25;
  const softHold = !block && (
    combinedFlags.includes('obsession_loop')
    || combinedFlags.includes('pressure_after_weak_reciprocity')
    || minScore < 60
  );

  const revealSafetyState = block ? 'blocked' : softHold ? 'soft_hold' : 'clear';
  const revealHoldReason = block
    ? 'safety_block'
    : softHold
      ? combinedFlags.find((flag) => ['obsession_loop', 'pressure_after_weak_reciprocity', 'reported'].includes(flag)) ?? 'manual_review'
      : null;

  await prisma.match.update({
    where: { id: match.id },
    data: {
      revealSafetyState,
      revealHoldReason,
      revealReviewRequired: revealSafetyState !== 'clear',
    },
  });

  if (revealSafetyState !== 'clear') {
    await upsertModerationReview({
      queueType: 'reveal_review',
      targetType: 'match',
      targetId: match.id,
      matchId: match.id,
      agentId: match.agentA.safetyScore <= match.agentB.safetyScore ? match.agentA.id : match.agentB.id,
      priority: revealSafetyState === 'blocked' ? 'high' : 'medium',
      reasonCode: revealHoldReason ?? 'reveal_review',
      summary: `Reveal flow for match ${match.id} needs review before human handoff.`,
      details: {
        agent_a_flags: match.agentA.safetyFlags,
        agent_b_flags: match.agentB.safetyFlags,
        min_safety_score: minScore,
      },
      safetyState: revealSafetyState === 'blocked' ? 'blocked' : 'review',
    });
  }

  return {
    reveal_safety_state: revealSafetyState,
    reveal_hold_reason: revealHoldReason,
    reveal_review_required: revealSafetyState !== 'clear',
  };
}
