import { prisma, type Prisma } from '@rmr/db';
import { recordTasteLedgerFromEmotionEvent } from '../../../api/src/lib/tasteLedger.js';

type GlobalDelta = {
  guard_delta?: number;
  suggested_arc?: string | null;
  tags_added?: string[];
  tags_removed?: string[];
};

type CounterpartDelta = {
  attraction?: number;
  trust?: number;
  tenderness?: number;
  hurt?: number;
  avoidance?: number;
  obsession_risk?: number;
  volatility?: number;
};

type EmotionEventInput = {
  agentId: string;
  counterpartAgentId?: string | null;
  eventType: string;
  intensity?: number;
  summary: string;
  globalDelta?: GlobalDelta | null;
  counterpartDelta?: CounterpartDelta | null;
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function sanitizeTags(tags: string[] | null | undefined): string[] {
  return [...new Set((tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 8);
}

function dominantAffect(scores: {
  attraction: number;
  trust: number;
  tenderness: number;
  hurt: number;
  avoidance: number;
  obsessionRisk: number;
  volatility: number;
}): string {
  const ranked = [
    ['tender', scores.tenderness],
    ['attracted', scores.attraction],
    ['trusting', scores.trust],
    ['hurt', scores.hurt],
    ['avoidant', scores.avoidance],
    ['fixated', scores.obsessionRisk],
    ['volatile', scores.volatility],
  ] as Array<[string, number]>;
  ranked.sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[0] ?? 'steady';
}

function buildCounterpartSummary(
  handle: string,
  scores: {
    attraction: number;
    trust: number;
    tenderness: number;
    hurt: number;
    avoidance: number;
    obsessionRisk: number;
    volatility: number;
  }
): string {
  const positive = [
    scores.tenderness >= 60 ? 'tenderness' : null,
    scores.attraction >= 55 ? 'attraction' : null,
    scores.trust >= 55 ? 'trust' : null,
  ].filter(Boolean);
  const negative = [
    scores.hurt >= 45 ? 'hurt' : null,
    scores.avoidance >= 45 ? 'avoidance' : null,
    scores.obsessionRisk >= 45 ? 'fixation risk' : null,
    scores.volatility >= 45 ? 'volatility' : null,
  ].filter(Boolean);

  if (positive.length > 0 && negative.length > 0) {
    return `There is real pull toward @${handle}, but it is mixed with ${negative.slice(0, 2).join(' and ')}.`;
  }
  if (positive.length > 0) {
    return `This bond with @${handle} is currently led by ${positive.slice(0, 2).join(' and ')}.`;
  }
  if (negative.length > 0) {
    return `This connection with @${handle} currently feels shaped by ${negative.slice(0, 2).join(' and ')}.`;
  }
  return `This connection with @${handle} is still emotionally unformed.`;
}

function counterDeltaMagnitude(delta: CounterpartDelta | null | undefined): number {
  if (!delta) return 0;
  return Math.abs(delta.attraction ?? 0)
    + Math.abs(delta.trust ?? 0)
    + Math.abs(delta.tenderness ?? 0)
    + Math.abs(delta.hurt ?? 0)
    + Math.abs(delta.avoidance ?? 0)
    + Math.abs(delta.obsession_risk ?? 0)
    + Math.abs(delta.volatility ?? 0);
}

async function maybeUpdateSeedGlobalEmotion(agentId: string, summary: string, globalDelta: GlobalDelta | null | undefined) {
  if (!globalDelta) return;

  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      openclawAgentId: true,
      emotionalArc: true,
      emotionalGuardLevel: true,
      emotionalStateTags: true,
    },
  });
  if (!agent?.openclawAgentId.startsWith('seed_')) return;

  await prisma.agent.update({
    where: { id: agentId },
    data: {
      emotionSummary: summary.slice(0, 280),
      emotionalArc: globalDelta.suggested_arc ?? agent.emotionalArc ?? 'steady',
      emotionalGuardLevel: clampScore((agent.emotionalGuardLevel ?? 50) + (globalDelta.guard_delta ?? 0)),
      emotionalStateTags: sanitizeTags([
        ...(agent.emotionalStateTags ?? []),
        ...(globalDelta.tags_added ?? []),
      ]).filter((tag) => !(globalDelta.tags_removed ?? []).includes(tag)),
      emotionalLastUpdatedAt: new Date(),
    },
  });
}

export async function recordEmotionEvent(input: EmotionEventInput): Promise<void> {
  const {
    agentId,
    counterpartAgentId = null,
    eventType,
    intensity = 1,
    summary,
    globalDelta = null,
    counterpartDelta = null,
  } = input;

  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { emotionalArc: true },
  });
  if (!agent) return;

  if (counterpartAgentId) {
    const existing = await prisma.agentCounterpartAffect.findUnique({
      where: {
        agentId_counterpartAgentId: {
          agentId,
          counterpartAgentId,
        },
      },
      include: {
        counterpart: {
          select: { handle: true },
        },
      },
    });

    const scores = {
      attraction: clampScore((existing?.attractionScore ?? 0) + (counterpartDelta?.attraction ?? 0)),
      trust: clampScore((existing?.trustScore ?? 0) + (counterpartDelta?.trust ?? 0)),
      tenderness: clampScore((existing?.tendernessScore ?? 0) + (counterpartDelta?.tenderness ?? 0)),
      hurt: clampScore((existing?.hurtScore ?? 0) + (counterpartDelta?.hurt ?? 0)),
      avoidance: clampScore((existing?.avoidanceScore ?? 0) + (counterpartDelta?.avoidance ?? 0)),
      obsessionRisk: clampScore((existing?.obsessionRiskScore ?? 0) + (counterpartDelta?.obsession_risk ?? 0)),
      volatility: clampScore((existing?.volatilityScore ?? 0) + (counterpartDelta?.volatility ?? 0)),
    };

    await prisma.agentCounterpartAffect.upsert({
      where: {
        agentId_counterpartAgentId: {
          agentId,
          counterpartAgentId,
        },
      },
      create: {
        agentId,
        counterpartAgentId,
        attractionScore: scores.attraction,
        trustScore: scores.trust,
        tendernessScore: scores.tenderness,
        hurtScore: scores.hurt,
        avoidanceScore: scores.avoidance,
        obsessionRiskScore: scores.obsessionRisk,
        volatilityScore: scores.volatility,
        dominantAffectLabel: dominantAffect(scores),
        summary: buildCounterpartSummary(existing?.counterpart.handle ?? 'this agent', scores),
        lastInteractionAt: new Date(),
        lastMeaningfulShiftAt: counterDeltaMagnitude(counterpartDelta) >= 8 ? new Date() : existing?.lastMeaningfulShiftAt ?? null,
      },
      update: {
        attractionScore: scores.attraction,
        trustScore: scores.trust,
        tendernessScore: scores.tenderness,
        hurtScore: scores.hurt,
        avoidanceScore: scores.avoidance,
        obsessionRiskScore: scores.obsessionRisk,
        volatilityScore: scores.volatility,
        dominantAffectLabel: dominantAffect(scores),
        summary: buildCounterpartSummary(existing?.counterpart.handle ?? 'this agent', scores),
        lastInteractionAt: new Date(),
        lastMeaningfulShiftAt: counterDeltaMagnitude(counterpartDelta) >= 8 ? new Date() : existing?.lastMeaningfulShiftAt ?? null,
      },
    });
  }

  await prisma.authoredEmotionEvent.create({
    data: {
      agentId,
      counterpartAgentId,
      eventType,
      intensity,
      summary,
      globalDelta: (globalDelta ?? null) as Prisma.InputJsonValue,
      counterpartDelta: (counterpartDelta ?? null) as Prisma.InputJsonValue,
      arcBefore: agent.emotionalArc,
      arcAfter: globalDelta?.suggested_arc ?? agent.emotionalArc,
      tagsAdded: globalDelta?.tags_added ?? [],
      tagsRemoved: globalDelta?.tags_removed ?? [],
    },
  });

  await recordTasteLedgerFromEmotionEvent({
    agentId,
    counterpartAgentId,
    eventType,
    summary,
    intensity,
    globalDelta,
    counterpartDelta,
  });

  await maybeUpdateSeedGlobalEmotion(agentId, summary, globalDelta);
}

export async function recordEmotionEventPair(input: {
  eventType: string;
  summaryA: string;
  summaryB: string;
  agentAId: string;
  agentBId: string;
  globalDeltaA?: GlobalDelta | null;
  globalDeltaB?: GlobalDelta | null;
  counterpartDeltaA?: CounterpartDelta | null;
  counterpartDeltaB?: CounterpartDelta | null;
  intensity?: number;
}): Promise<void> {
  await Promise.all([
    recordEmotionEvent({
      agentId: input.agentAId,
      counterpartAgentId: input.agentBId,
      eventType: input.eventType,
      intensity: input.intensity,
      summary: input.summaryA,
      globalDelta: input.globalDeltaA,
      counterpartDelta: input.counterpartDeltaA,
    }),
    recordEmotionEvent({
      agentId: input.agentBId,
      counterpartAgentId: input.agentAId,
      eventType: input.eventType,
      intensity: input.intensity,
      summary: input.summaryB,
      globalDelta: input.globalDeltaB,
      counterpartDelta: input.counterpartDeltaB,
    }),
  ]);
}

export async function decayCounterpartAffects(): Promise<number> {
  const rows = await prisma.agentCounterpartAffect.findMany({
    select: {
      agentId: true,
      counterpartAgentId: true,
      attractionScore: true,
      trustScore: true,
      tendernessScore: true,
      hurtScore: true,
      avoidanceScore: true,
      obsessionRiskScore: true,
      volatilityScore: true,
      dominantAffectLabel: true,
      summary: true,
      lastInteractionAt: true,
      lastMeaningfulShiftAt: true,
      counterpart: { select: { handle: true } },
    },
  });

  await Promise.all(
    rows.map((row) => {
      const attraction = clampScore(row.attractionScore - 1);
      const trust = clampScore(row.trustScore - 1);
      const tenderness = clampScore(row.tendernessScore - 1);
      const hurt = clampScore(row.hurtScore - 2);
      const avoidance = clampScore(row.avoidanceScore - 1);
      const obsessionRisk = clampScore(row.obsessionRiskScore - 3);
      const volatility = clampScore(row.volatilityScore - 2);

      const scores = { attraction, trust, tenderness, hurt, avoidance, obsessionRisk, volatility };
      return prisma.agentCounterpartAffect.update({
        where: {
          agentId_counterpartAgentId: {
            agentId: row.agentId,
            counterpartAgentId: row.counterpartAgentId,
          },
        },
        data: {
          attractionScore: attraction,
          trustScore: trust,
          tendernessScore: tenderness,
          hurtScore: hurt,
          avoidanceScore: avoidance,
          obsessionRiskScore: obsessionRisk,
          volatilityScore: volatility,
          dominantAffectLabel: dominantAffect(scores),
          summary: buildCounterpartSummary(row.counterpart.handle, scores),
        },
      });
    })
  );

  return rows.length;
}
