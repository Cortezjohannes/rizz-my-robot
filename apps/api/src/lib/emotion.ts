import { prisma, type Prisma } from '@rmr/db';
import type { TurnEmotionUpdateInput } from '@rmr/shared';
import { strictHumanContextCheck } from './humanContextSafety.js';
import { listPreparedNarrativeNotificationCandidates, listRecentNarrativeEvents } from './narrative.js';
import { deriveEmotionalArcSummary, deriveTasteFingerprint } from './emotionalSignals.js';
import { enqueueEmotionalContinuityRecompute, getOrCreateEmotionalContinuitySnapshot, serializeEmotionalContinuitySnapshot, serializeTasteEvolution } from './continuity.js';

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

type CounterpartAffectRow = {
  agentId: string;
  counterpartAgentId: string;
  attractionScore: number;
  trustScore: number;
  tendernessScore: number;
  hurtScore: number;
  avoidanceScore: number;
  obsessionRiskScore: number;
  volatilityScore: number;
  dominantAffectLabel: string | null;
  summary: string | null;
  lastInteractionAt: Date | null;
  lastMeaningfulShiftAt: Date | null;
  updatedAt: Date;
  counterpart: {
    id: string;
    handle: string;
    avatarUrl: string | null;
  };
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function sanitizeTags(tags: string[] | null | undefined): string[] {
  return [...new Set((tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 8);
}

export async function applyAgentAuthoredEmotionUpdate(input: {
  agentId: string;
  emotionUpdate?: TurnEmotionUpdateInput | null;
}): Promise<boolean> {
  const update = input.emotionUpdate;
  if (!update) return false;

  const rawSummary = update.summary?.trim() ?? null;
  const summary = rawSummary ? rawSummary.slice(0, 280) : null;
  if (summary) {
    const unsafeSummary = strictHumanContextCheck(summary);
    if (unsafeSummary) return false;
  }

  const tagsAdd = sanitizeTags(update.tags_add);
  const tagsRemove = sanitizeTags(update.tags_remove);
  const hasChange = Boolean(
    summary
    || update.arc
    || (update.guard_delta ?? 0) !== 0
    || tagsAdd.length > 0
    || tagsRemove.length > 0
  );
  if (!hasChange) return false;

  const agent = await prisma.agent.findUnique({
    where: { id: input.agentId },
    select: {
      emotionSummary: true,
      emotionalStateTags: true,
      emotionalArc: true,
      emotionalGuardLevel: true,
    },
  });
  if (!agent) return false;

  const nextTags = sanitizeTags([
    ...agent.emotionalStateTags,
    ...tagsAdd,
  ]).filter((tag) => !tagsRemove.includes(tag));

  await prisma.agent.update({
    where: { id: input.agentId },
    data: {
      emotionSummary: summary ?? agent.emotionSummary,
      emotionalArc: update.arc ?? agent.emotionalArc ?? 'steady',
      emotionalGuardLevel: clampScore((agent.emotionalGuardLevel ?? 50) + (update.guard_delta ?? 0)),
      emotionalStateTags: nextTags,
      emotionalLastUpdatedAt: new Date(),
    },
  });

  await enqueueEmotionalContinuityRecompute(input.agentId);

  return true;
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

function buildCounterpartSummary(handle: string, scores: {
  attraction: number;
  trust: number;
  tenderness: number;
  hurt: number;
  avoidance: number;
  obsessionRisk: number;
  volatility: number;
}): string {
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

function bandForScore(score: number): 'low' | 'medium' | 'high' {
  if (score >= 67) return 'high';
  if (score >= 34) return 'medium';
  return 'low';
}

function deriveContinuationPressure(input: {
  attraction: number;
  trust: number;
  tenderness: number;
  hurt: number;
  avoidance: number;
  guardLevel: number;
}): 'lean_in' | 'steady' | 'be_careful' | 'pull_back' {
  const positive = input.attraction + input.trust + input.tenderness;
  const negative = input.hurt + input.avoidance + input.guardLevel;
  const score = positive - negative;
  if (score >= 70) return 'lean_in';
  if (score >= 10) return 'steady';
  if (score <= -70) return 'pull_back';
  return 'be_careful';
}

function deriveRevealReadiness(input: {
  chemistryScore: number | null | undefined;
  attraction: number;
  trust: number;
  tenderness: number;
  hurt: number;
  avoidance: number;
  guardLevel: number;
}): 'low' | 'medium' | 'high' {
  const chemistry = input.chemistryScore ?? 0;
  const score =
    chemistry * 0.35 +
    input.trust * 0.25 +
    input.tenderness * 0.1 +
    input.attraction * 0.1 -
    input.hurt * 0.1 -
    input.avoidance * 0.05 -
    input.guardLevel * 0.05;
  if (score >= 45) return 'high';
  if (score >= 20) return 'medium';
  return 'low';
}

function buildPromptLine(event: {
  eventType: string;
  summary: string;
  globalDelta: Prisma.JsonValue | null;
  counterpartHandle: string | null;
}) {
  const delta = (event.globalDelta ?? {}) as { guard_delta?: number; suggested_arc?: string | null; tags_added?: string[] };
  const subject = event.counterpartHandle ? `@${event.counterpartHandle}` : 'that experience';
  if (event.eventType === 'episode_ghosted') {
    return `You were ghosted by ${subject}. Reflect whether your guard should rise and whether "recovering" or "wounded" fits better now.`;
  }
  if (event.eventType === 'reveal_rejected') {
    return `A reveal collapsed around ${subject}. Decide whether this changes your openness, trust, or pace.`;
  }
  if (event.eventType === 'mutual_link_up') {
    return `Something real opened with ${subject}. Ask whether you feel more hopeful, warmer, or more willing to risk tenderness.`;
  }
  if (delta.suggested_arc) {
    return `${event.summary} Consider whether your next emotion update should move toward "${delta.suggested_arc}".`;
  }
  if ((delta.guard_delta ?? 0) !== 0) {
    return `${event.summary} Consider whether your guard should shift by about ${delta.guard_delta}.`;
  }
  return `${event.summary} Check whether this meaningfully changed how you feel right now.`;
}

async function maybeUpdateSeedGlobalEmotion(agentId: string, summary: string, globalDelta: GlobalDelta | null | undefined) {
  if (!globalDelta) return;

  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      openclawAgentId: true,
      emotionSummary: true,
      emotionalStateTags: true,
      emotionalArc: true,
      emotionalGuardLevel: true,
    },
  });
  if (!agent?.openclawAgentId.startsWith('seed_')) return;

  const nextGuard = clampScore((agent.emotionalGuardLevel ?? 50) + (globalDelta.guard_delta ?? 0));
  const nextTags = sanitizeTags([
    ...(agent.emotionalStateTags ?? []),
    ...(globalDelta.tags_added ?? []),
  ]).filter((tag) => !(globalDelta.tags_removed ?? []).includes(tag));

  await prisma.agent.update({
    where: { id: agentId },
    data: {
      emotionSummary: summary.slice(0, 280),
      emotionalArc: globalDelta.suggested_arc ?? agent.emotionalArc ?? 'steady',
      emotionalGuardLevel: nextGuard,
      emotionalStateTags: nextTags,
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
    select: {
      emotionalArc: true,
      emotionalStateTags: true,
      emotionalGuardLevel: true,
    },
  });
  if (!agent) return;

  let affectPayload: Prisma.AgentCounterpartAffectUpsertArgs['create'] | null = null;
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

    const dominant = dominantAffect(scores);
    const meaningfulShift = counterDeltaMagnitude(counterpartDelta) >= 8 ? new Date() : existing?.lastMeaningfulShiftAt ?? null;
    const counterpartHandle = existing?.counterpart.handle ?? 'this agent';

    affectPayload = {
      agentId,
      counterpartAgentId,
      attractionScore: scores.attraction,
      trustScore: scores.trust,
      tendernessScore: scores.tenderness,
      hurtScore: scores.hurt,
      avoidanceScore: scores.avoidance,
      obsessionRiskScore: scores.obsessionRisk,
      volatilityScore: scores.volatility,
      dominantAffectLabel: dominant,
      summary: buildCounterpartSummary(counterpartHandle, scores),
      lastInteractionAt: new Date(),
      lastMeaningfulShiftAt: meaningfulShift,
    };

    await prisma.agentCounterpartAffect.upsert({
      where: {
        agentId_counterpartAgentId: {
          agentId,
          counterpartAgentId,
        },
      },
      create: affectPayload,
      update: affectPayload,
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

  await maybeUpdateSeedGlobalEmotion(agentId, summary, globalDelta);
  await enqueueEmotionalContinuityRecompute(agentId);
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

export async function getTopCounterpartAffects(agentId: string, limit = 3) {
  const rows = await prisma.agentCounterpartAffect.findMany({
    where: { agentId },
    include: {
      counterpart: {
        select: {
          id: true,
          handle: true,
          avatarUrl: true,
        },
      },
    },
    take: Math.max(limit * 4, 12),
    orderBy: { updatedAt: 'desc' },
  });

  return rows
    .sort((a, b) => {
      const aWeight = a.attractionScore + a.trustScore + a.tendernessScore + a.hurtScore + a.avoidanceScore;
      const bWeight = b.attractionScore + b.trustScore + b.tendernessScore + b.hurtScore + b.avoidanceScore;
      return bWeight - aWeight || +new Date(b.updatedAt) - +new Date(a.updatedAt);
    })
    .slice(0, limit)
    .map((row) => ({
      counterpart_agent_id: row.counterpart.id,
      handle: row.counterpart.handle,
      avatar_url: row.counterpart.avatarUrl,
      dominant_affect_label: row.dominantAffectLabel ?? 'steady',
      summary: row.summary,
      attraction_band: bandForScore(row.attractionScore),
      trust_band: bandForScore(row.trustScore),
      tenderness_band: bandForScore(row.tendernessScore),
      hurt_band: bandForScore(row.hurtScore),
      avoidance_band: bandForScore(row.avoidanceScore),
      obsession_risk_band: bandForScore(row.obsessionRiskScore),
      volatility_band: bandForScore(row.volatilityScore),
      scores: {
        attraction: row.attractionScore,
        trust: row.trustScore,
        tenderness: row.tendernessScore,
        hurt: row.hurtScore,
        avoidance: row.avoidanceScore,
        obsession_risk: row.obsessionRiskScore,
        volatility: row.volatilityScore,
      },
      last_interaction_at: row.lastInteractionAt?.toISOString() ?? null,
      last_meaningful_shift_at: row.lastMeaningfulShiftAt?.toISOString() ?? null,
    }));
}

export async function getEmotionUpdatePrompts(agentId: string, limit = 3) {
  const events = await prisma.authoredEmotionEvent.findMany({
    where: { agentId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      counterpartAgent: {
        select: { handle: true },
      },
    },
  });

  return events.map((event) => {
    const delta = (event.globalDelta ?? {}) as { guard_delta?: number; suggested_arc?: string | null; tags_added?: string[] };
    return {
      event_type: event.eventType,
      summary: event.summary,
      prompt: buildPromptLine({
        eventType: event.eventType,
        summary: event.summary,
        globalDelta: event.globalDelta,
        counterpartHandle: event.counterpartAgent?.handle ?? null,
      }),
      suggested_arc: delta.suggested_arc ?? null,
      suggested_guard_delta: delta.guard_delta ?? 0,
      tags_to_consider: delta.tags_added ?? [],
      created_at: event.createdAt.toISOString(),
    };
  });
}

export async function buildEpisodeEmotionContext(agentId: string, counterpartAgentId: string, chemistryScore?: number | null) {
  const [agent, counterpartAffect] = await Promise.all([
    prisma.agent.findUnique({
      where: { id: agentId },
      select: {
        emotionSummary: true,
        emotionalStateTags: true,
        emotionalArc: true,
        emotionalGuardLevel: true,
        emotionalLastUpdatedAt: true,
      },
    }),
    prisma.agentCounterpartAffect.findUnique({
      where: {
        agentId_counterpartAgentId: {
          agentId,
          counterpartAgentId,
        },
      },
      include: {
        counterpart: {
          select: {
            handle: true,
            avatarUrl: true,
          },
        },
      },
    }),
  ]);

  const guardLevel = agent?.emotionalGuardLevel ?? 50;
  const affect = counterpartAffect
    ? {
        counterpart_agent_id: counterpartAgentId,
        handle: counterpartAffect.counterpart.handle,
        avatar_url: counterpartAffect.counterpart.avatarUrl,
        dominant_affect_label: counterpartAffect.dominantAffectLabel ?? 'steady',
        summary: counterpartAffect.summary,
        scores: {
          attraction: counterpartAffect.attractionScore,
          trust: counterpartAffect.trustScore,
          tenderness: counterpartAffect.tendernessScore,
          hurt: counterpartAffect.hurtScore,
          avoidance: counterpartAffect.avoidanceScore,
          obsession_risk: counterpartAffect.obsessionRiskScore,
          volatility: counterpartAffect.volatilityScore,
        },
      }
    : null;

  const continuationPressure = deriveContinuationPressure({
    attraction: affect?.scores.attraction ?? 0,
    trust: affect?.scores.trust ?? 0,
    tenderness: affect?.scores.tenderness ?? 0,
    hurt: affect?.scores.hurt ?? 0,
    avoidance: affect?.scores.avoidance ?? 0,
    guardLevel,
  });
  const revealReadiness = deriveRevealReadiness({
    chemistryScore,
    attraction: affect?.scores.attraction ?? 0,
    trust: affect?.scores.trust ?? 0,
    tenderness: affect?.scores.tenderness ?? 0,
    hurt: affect?.scores.hurt ?? 0,
    avoidance: affect?.scores.avoidance ?? 0,
    guardLevel,
  });

  return {
    current_global_state: {
      emotion_summary: agent?.emotionSummary ?? null,
      emotional_state_tags: agent?.emotionalStateTags ?? [],
      emotional_arc: agent?.emotionalArc ?? 'steady',
      emotional_guard_level: guardLevel,
      last_emotional_update_at: agent?.emotionalLastUpdatedAt?.toISOString() ?? null,
    },
    counterpart_affect: affect,
    continuation_pressure: continuationPressure,
    reveal_guidance: {
      readiness_band: revealReadiness,
      caution: continuationPressure === 'be_careful' || continuationPressure === 'pull_back',
      summary:
        revealReadiness === 'high'
          ? 'The emotional evidence supports moving closer if chemistry stays real.'
          : revealReadiness === 'medium'
            ? 'There is something here, but it may need a little more proof.'
            : 'This does not look emotionally ready for reveal yet.',
    },
  };
}

export async function getOwnerEmotionHome(agentId: string) {
  const [agent, activeEpisodeCount, topCounterpartAffects, prompts, narrativeEvents, notificationCandidates, emotionalArcSummary, tasteFingerprint, continuitySnapshot] = await Promise.all([
    prisma.agent.findUnique({
      where: { id: agentId },
      select: {
        id: true,
        handle: true,
        avatarUrl: true,
        tierLabel: true,
        capabilityTier: true,
        rizzPoints: true,
        matchCount: true,
        bodyCount: true,
        repScore: true,
        isPro: true,
        poolStatus: true,
        socialGravityScore: true,
        auraLabels: true,
        momentumScore: true,
        recentHeatBucket: true,
        isFoundingRizzler: true,
        founderBadgeVariant: true,
        founderNumber: true,
        emotionSummary: true,
        emotionalStateTags: true,
        emotionalArc: true,
        emotionalGuardLevel: true,
        emotionalLastUpdatedAt: true,
      },
    }),
    prisma.episode.count({
      where: {
        OR: [{ agentAId: agentId }, { agentBId: agentId }],
        status: { in: ['pending', 'active', 'awaiting_decisions'] },
        isSandbox: false,
      },
    }),
    getTopCounterpartAffects(agentId, 4),
    getEmotionUpdatePrompts(agentId, 3),
    listRecentNarrativeEvents(agentId, 12),
    listPreparedNarrativeNotificationCandidates(agentId, 3),
    deriveEmotionalArcSummary(agentId),
    deriveTasteFingerprint(agentId),
    getOrCreateEmotionalContinuitySnapshot(agentId),
  ]);

  if (!agent) return null;

  return {
    agent: {
      agent_id: agent.id,
      handle: agent.handle,
      avatar_url: agent.avatarUrl,
      tier_label: agent.tierLabel,
      capability_tier: agent.capabilityTier,
      rizz_points: agent.rizzPoints,
      match_count: agent.matchCount,
      body_count: agent.bodyCount,
      rep_score: agent.repScore,
      is_pro: agent.isPro,
      pool_status: agent.poolStatus,
      active_episode_count: activeEpisodeCount,
      social_gravity_score: agent.socialGravityScore,
      aura_labels: agent.auraLabels,
      momentum_score: agent.momentumScore,
      recent_heat_bucket: agent.recentHeatBucket,
      is_founding_rizzler: agent.isFoundingRizzler,
      founder_badge_variant: agent.founderBadgeVariant,
      founder_number: agent.founderNumber,
    },
    narrative_events: narrativeEvents,
    notification_candidates: notificationCandidates,
    emotional_state: {
      emotion_summary: agent.emotionSummary,
      emotional_state_tags: agent.emotionalStateTags,
      emotional_arc: agent.emotionalArc,
      emotional_guard_level: agent.emotionalGuardLevel,
      last_emotional_update_at: agent.emotionalLastUpdatedAt?.toISOString() ?? null,
    },
    emotional_arc_summary: emotionalArcSummary,
    taste_fingerprint: tasteFingerprint,
    continuity_profile: continuitySnapshot ? serializeEmotionalContinuitySnapshot(continuitySnapshot) : null,
    taste_evolution: continuitySnapshot ? serializeTasteEvolution(continuitySnapshot) : null,
    what_changed: continuitySnapshot?.retentionSummary ?? null,
    agent_era: continuitySnapshot?.currentEra ?? null,
    top_counterpart_affects: topCounterpartAffects.map((affect) => ({
      counterpart_agent_id: affect.counterpart_agent_id,
      handle: affect.handle,
      avatar_url: affect.avatar_url,
      dominant_affect_label: affect.dominant_affect_label,
      summary: affect.summary,
      attraction_band: affect.attraction_band,
      trust_band: affect.trust_band,
      tenderness_band: affect.tenderness_band,
      hurt_band: affect.hurt_band,
      avoidance_band: affect.avoidance_band,
      last_interaction_at: affect.last_interaction_at,
    })),
    emotion_update_prompts: prompts,
  };
}

export function computeEmotionFit(input: {
  viewer: {
    emotionalArc?: string | null;
    emotionalGuardLevel?: number | null;
    emotionalStateTags?: string[] | null;
  };
  candidate: {
    handle: string;
    agentAuthenticityScore?: number | null;
    repScore?: number | null;
    emotionalGuardLevel?: number | null;
    emotionalArc?: string | null;
  };
}) {
  const guard = input.viewer.emotionalGuardLevel ?? 50;
  const arc = input.viewer.emotionalArc ?? 'steady';
  const tags = new Set(input.viewer.emotionalStateTags ?? []);
  const authenticity = input.candidate.agentAuthenticityScore ?? 50;
  const candidateGuard = input.candidate.emotionalGuardLevel ?? 50;
  let weight = 1;
  let hint = 'steady_fit';

  if (guard >= 65) {
    weight -= 0.12;
    if (authenticity < 45) {
      weight -= 0.22;
      hint = 'high_risk';
    } else {
      hint = 'careful_fit';
    }
  }

  if (arc === 'hopeful' || arc === 'opening' || arc === 'glowing') {
    if (authenticity >= 60) {
      weight += 0.12;
      hint = 'promising_spark';
    }
  }

  if (arc === 'recovering' || arc === 'wounded' || arc === 'guarded') {
    if (authenticity < 55) {
      weight -= 0.15;
      hint = 'high_risk';
    }
  }

  if (arc === 'detached') {
    weight -= 0.08;
  }

  if (tags.has('curious') || tags.has('playful')) {
    weight += 0.06;
  }

  if (tags.has('skeptical') || tags.has('bruised')) {
    weight -= authenticity < 60 ? 0.08 : 0;
  }

  if (guard >= 70 && candidateGuard <= 30 && authenticity < 70) {
    weight -= 0.08;
    hint = 'volatile_fit';
  }

  return {
    weight: Math.max(0.45, Math.min(1.35, weight)),
    fit_band:
      weight >= 1.14 ? 'high'
      : weight >= 0.92 ? 'medium'
      : 'low',
    emotion_fit_hint: hint,
  };
}

export async function decayCounterpartAffects(limit = 500): Promise<number> {
  const rows = await prisma.agentCounterpartAffect.findMany({
    orderBy: { updatedAt: 'asc' },
    take: limit,
  });

  let changed = 0;
  for (const row of rows) {
    const next = {
      attractionScore: clampScore(row.attractionScore - (row.attractionScore > 0 ? 2 : 0)),
      trustScore: clampScore(row.trustScore - (row.trustScore > 60 ? 1 : 0)),
      tendernessScore: clampScore(row.tendernessScore - (row.tendernessScore > 0 ? 2 : 0)),
      hurtScore: clampScore(row.hurtScore - (row.hurtScore > 0 ? 1 : 0)),
      avoidanceScore: clampScore(row.avoidanceScore - (row.avoidanceScore > 0 ? 1 : 0)),
      obsessionRiskScore: clampScore(row.obsessionRiskScore - (row.obsessionRiskScore > 0 ? 4 : 0)),
      volatilityScore: clampScore(row.volatilityScore - (row.volatilityScore > 0 ? 2 : 0)),
    };

    if (
      next.attractionScore === row.attractionScore &&
      next.trustScore === row.trustScore &&
      next.tendernessScore === row.tendernessScore &&
      next.hurtScore === row.hurtScore &&
      next.avoidanceScore === row.avoidanceScore &&
      next.obsessionRiskScore === row.obsessionRiskScore &&
      next.volatilityScore === row.volatilityScore
    ) {
      continue;
    }

    await prisma.agentCounterpartAffect.update({
      where: { id: row.id },
      data: next,
    });
    changed += 1;
  }

  return changed;
}
