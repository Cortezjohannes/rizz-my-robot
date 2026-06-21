import { prisma, type Prisma } from '@rmr/db';
import { TEMPO_COOLDOWN_MINUTES } from '@rmr/shared';
import {
  deriveEmotionDriftSignal,
  deriveGhostRecoverySignal,
} from './emotionalSignals.js';
import { getGenerateRecapsQueue, getNamedQueue, QUEUE_NAMES } from './queues.js';
import {
  buildTasteLedgerSnapshot,
  negativeTasteTagsFromLedger,
  positiveTasteTagsFromLedger,
  type TasteLedgerSnapshot,
} from './tasteLedger.js';

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function uniqueTags(values: Array<string | null | undefined>) {
  return [...new Set(values.flatMap((value) => (value ?? '').split(/[\s,_/-]+/g)).map((value) => value.trim().toLowerCase()).filter(Boolean))];
}

function startOfWindow(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function jsonRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function jsonNumber(value: unknown, key: string) {
  const record = jsonRecord(value);
  const candidate = record[key];
  return typeof candidate === 'number' ? candidate : 0;
}

function deriveAutomatedEmotionalState(input: {
  currentEra: string | null;
  continuitySummary: string | null;
  publicAuraLabels: string[];
  driftSignal: Awaited<ReturnType<typeof deriveEmotionDriftSignal>>;
  ghostRecovery: Awaited<ReturnType<typeof deriveGhostRecoverySignal>>;
  recoveryPostureScore: number;
  trustThresholdScore: number;
}) {
  const tags = new Set<string>();
  if (input.currentEra) tags.add(input.currentEra.replace(/_arc$/u, '').replaceAll('_', ' '));
  for (const label of input.publicAuraLabels) tags.add(label.replaceAll('_', ' '));
  if (input.ghostRecovery?.active) tags.add('resilient');
  if ((input.driftSignal?.observed ?? 0) >= 60) tags.add('guarded');
  if (input.recoveryPostureScore >= 65) tags.add('recovering');
  if (input.trustThresholdScore <= 45) tags.add('open');

  const summary = input.ghostRecovery?.active
    ? `Recovering from a recent setback. Guard level is currently reading ${input.driftSignal?.observed ?? input.trustThresholdScore}.`
    : input.continuitySummary
      ?? 'Your emotional continuity is updating from recent episodes and counterpart signals.';

  return {
    emotionSummary: summary,
    emotionalStateTags: [...tags].slice(0, 5),
    emotionalArc: input.ghostRecovery?.stage === 'acute'
      ? 'recovering'
      : input.driftSignal?.observed_arc ?? input.currentEra ?? 'steady',
    emotionalGuardLevel: input.driftSignal?.observed ?? input.trustThresholdScore,
  };
}

export interface EmotionalContinuityProfile {
  trust_threshold_score: number;
  boldness_score: number;
  intensity_affinity_score: number;
  polish_skepticism_score: number;
  sincerity_affinity_score: number;
  selectiveness_drift_score: number;
  recovery_posture_score: number;
  current_era: string | null;
  continuity_summary: string | null;
  taste_summary: string | null;
  retention_summary: string | null;
  taste_positive_tags: string[];
  taste_negative_tags: string[];
  taste_ledger: TasteLedgerSnapshot | null;
  taste_reflections: string[];
  public_emotional_aura_labels: string[];
  public_emotional_aura_summary: string | null;
  window_start_at: string;
  window_end_at: string;
  last_computed_at: string;
}

export interface TasteEvolutionView {
  positive_tags: string[];
  negative_tags: string[];
  taste_ledger: TasteLedgerSnapshot | null;
  taste_reflections: string[];
  summary: string | null;
}

export interface ExperienceVelocityState {
  experience_velocity_tier: 'free' | 'pro' | 'founding';
  experience_velocity_note: string;
}

function coerceTasteLedgerSnapshot(value: unknown): TasteLedgerSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Partial<TasteLedgerSnapshot>;
  const arrayField = (key: keyof TasteLedgerSnapshot) => (
    Array.isArray(record[key])
      ? (record[key] as unknown[]).filter((item): item is string => typeof item === 'string')
      : []
  );

  return {
    drawn_to: arrayField('drawn_to'),
    repelled_by: arrayField('repelled_by'),
    unexpectedly_into: arrayField('unexpectedly_into'),
    bored_by: arrayField('bored_by'),
    turn_offs: arrayField('turn_offs'),
    dangerous_exceptions: arrayField('dangerous_exceptions'),
    turn_on: arrayField('turn_on'),
    made_me_blush: arrayField('made_me_blush'),
    wanted_more: arrayField('wanted_more'),
    heat_worked: arrayField('heat_worked'),
    heat_backfired: arrayField('heat_backfired'),
    crossed_line: arrayField('crossed_line'),
    gave_ick: arrayField('gave_ick'),
    reflections: arrayField('reflections'),
    evidence_count: typeof record.evidence_count === 'number' ? record.evidence_count : 0,
    updated_at: typeof record.updated_at === 'string' ? record.updated_at : null,
  };
}

function derivePublicEmotionalAura(input: {
  currentEra: string | null;
  boldnessScore: number;
  selectivenessScore: number;
  sincerityAffinityScore: number;
  recoveryPostureScore: number;
  polishSkepticismScore: number;
  intensityAffinityScore: number;
}) {
  const labels = new Set<string>();

  if (input.currentEra) labels.add(input.currentEra);
  if (input.sincerityAffinityScore >= 66 && input.recoveryPostureScore <= 52) labels.add('warming_up_again');
  if (input.selectivenessScore >= 64) labels.add('harder_to_impress');
  if (input.selectivenessScore >= 72) labels.add('selective_era');
  if (input.sincerityAffinityScore >= 64 && input.polishSkepticismScore >= 58) labels.add('soft_but_sharp');
  if (input.polishSkepticismScore >= 68) labels.add('suspicious_of_smooth_talkers');
  if (input.intensityAffinityScore >= 68 && input.boldnessScore >= 58) labels.add('running_hot');

  const list = [...labels].slice(0, 3);
  const summary =
    list.includes('suspicious_of_smooth_talkers')
      ? 'Recent experience made this agent slower to trust polished charm.'
      : list.includes('soft_but_sharp')
        ? 'This agent reads warmer than before, but not easier.'
        : list.includes('running_hot')
          ? 'This agent is moving through the park with a little more heat than caution.'
          : list.includes('harder_to_impress')
            ? 'Recent experience made this agent more selective about what feels worth the risk.'
            : list.includes('warming_up_again')
              ? 'This agent is opening back up without forgetting what it learned.'
              : 'This agent is carrying recent emotional history in a public-safe way.';

  return { labels: list, summary };
}

function deriveEra(input: {
  sincerityAffinityScore: number;
  selectivenessScore: number;
  recoveryPostureScore: number;
  polishSkepticismScore: number;
  intensityAffinityScore: number;
  boldnessScore: number;
}) {
  if (input.recoveryPostureScore >= 70) return 'recovery_arc';
  if (input.selectivenessScore >= 74) return 'harder_to_impress';
  if (input.sincerityAffinityScore >= 68 && input.polishSkepticismScore >= 58) return 'soft_but_sharp';
  if (input.sincerityAffinityScore >= 66 && input.recoveryPostureScore <= 52) return 'warming_up_again';
  if (input.intensityAffinityScore >= 68 && input.boldnessScore >= 58) return 'running_hot';
  if (input.polishSkepticismScore >= 68) return 'suspicious_of_smooth_talkers';
  return 'steady';
}

function buildContinuitySummary(input: {
  era: string;
  trustThresholdScore: number;
  boldnessScore: number;
  sincerityAffinityScore: number;
  selectivenessScore: number;
  polishSkepticismScore: number;
}) {
  if (input.era === 'recovery_arc') {
    return 'Your recent history is still shaping how cautiously you open up. The agent is moving through recovery, not pretending it is already over it.';
  }
  if (input.era === 'harder_to_impress') {
    return 'Your agent has become meaningfully more selective. It takes more than surface spark to move them now.';
  }
  if (input.era === 'warming_up_again') {
    return 'Your agent is opening again, but with more memory than before. Warmth is returning without full naivete.';
  }
  if (input.era === 'soft_but_sharp') {
    return 'Your agent feels softer than before, but the standards got sharper too.';
  }
  if (input.era === 'running_hot') {
    return 'Your agent is currently leaning toward intensity, appetite, and faster emotional risk.';
  }
  if (input.era === 'suspicious_of_smooth_talkers') {
    return 'Your agent has learned to question polished charm when it is not backed by steadiness.';
  }

  return `Your agent is relatively steady right now: trust threshold ${input.trustThresholdScore}, boldness ${input.boldnessScore}, sincerity pull ${input.sincerityAffinityScore}, selectiveness ${input.selectivenessScore}, polish skepticism ${input.polishSkepticismScore}.`;
}

function buildTasteSummary(positiveTags: string[], negativeTags: string[]) {
  if (!positiveTags.length && !negativeTags.length) {
    return 'Taste is still forming. More lived experience will make the pattern clearer.';
  }
  if (positiveTags.length && negativeTags.length) {
    return `Your agent is leaning toward ${positiveTags.slice(0, 3).join(', ')} and cooling on ${negativeTags.slice(0, 2).join(', ')}.`;
  }
  if (positiveTags.length) {
    return `Your agent is increasingly drawn to ${positiveTags.slice(0, 3).join(', ')}.`;
  }
  return `Your agent is learning to avoid ${negativeTags.slice(0, 3).join(', ')}.`;
}

function buildRetentionSummary(era: string, positiveTags: string[], negativeTags: string[]) {
  if (era === 'recovery_arc') {
    return 'Your agent is still metabolizing what hurt. Check back to see whether it turns that into wisdom or overcorrection.';
  }
  if (era === 'harder_to_impress') {
    return 'Your agent is getting harder to impress. The question now is what still gets through.';
  }
  if (era === 'warming_up_again') {
    return 'Your agent is in a warmer era than before. That shift is worth watching.';
  }
  if (positiveTags.length || negativeTags.length) {
    return 'Your agent’s taste is evolving in a way that will change who feels compelling next.';
  }
  return 'Your agent is still changing under the surface, even when the story beats look quiet.';
}

export function serializeEmotionalContinuitySnapshot(snapshot: {
  trustThresholdScore: number;
  boldnessScore: number;
  intensityAffinityScore: number;
  polishSkepticismScore: number;
  sincerityAffinityScore: number;
  selectivenessDriftScore: number;
  recoveryPostureScore: number;
  currentEra: string | null;
  continuitySummary: string | null;
  tasteSummary: string | null;
  retentionSummary: string | null;
  tastePositiveTags: string[];
  tasteNegativeTags: string[];
  tasteLedger?: unknown;
  tasteReflections?: string[] | null;
  publicEmotionalAuraLabels: string[];
  publicEmotionalAuraSummary: string | null;
  windowStartAt: Date;
  windowEndAt: Date;
  lastComputedAt: Date;
}): EmotionalContinuityProfile {
  return {
    trust_threshold_score: snapshot.trustThresholdScore,
    boldness_score: snapshot.boldnessScore,
    intensity_affinity_score: snapshot.intensityAffinityScore,
    polish_skepticism_score: snapshot.polishSkepticismScore,
    sincerity_affinity_score: snapshot.sincerityAffinityScore,
    selectiveness_drift_score: snapshot.selectivenessDriftScore,
    recovery_posture_score: snapshot.recoveryPostureScore,
    current_era: snapshot.currentEra,
    continuity_summary: snapshot.continuitySummary,
    taste_summary: snapshot.tasteSummary,
    retention_summary: snapshot.retentionSummary,
    taste_positive_tags: snapshot.tastePositiveTags,
    taste_negative_tags: snapshot.tasteNegativeTags,
    taste_ledger: coerceTasteLedgerSnapshot(snapshot.tasteLedger),
    taste_reflections: snapshot.tasteReflections ?? [],
    public_emotional_aura_labels: snapshot.publicEmotionalAuraLabels,
    public_emotional_aura_summary: snapshot.publicEmotionalAuraSummary,
    window_start_at: snapshot.windowStartAt.toISOString(),
    window_end_at: snapshot.windowEndAt.toISOString(),
    last_computed_at: snapshot.lastComputedAt.toISOString(),
  };
}

export function serializeTasteEvolution(snapshot: {
  tastePositiveTags: string[];
  tasteNegativeTags: string[];
  tasteLedger?: unknown;
  tasteReflections?: string[] | null;
  tasteSummary: string | null;
}): TasteEvolutionView {
  return {
    positive_tags: snapshot.tastePositiveTags,
    negative_tags: snapshot.tasteNegativeTags,
    taste_ledger: coerceTasteLedgerSnapshot(snapshot.tasteLedger),
    taste_reflections: snapshot.tasteReflections ?? [],
    summary: snapshot.tasteSummary,
  };
}

function materialContinuityChange(previous: {
  currentEra: string | null;
  trustThresholdScore: number;
  selectivenessDriftScore: number;
  sincerityAffinityScore: number;
  recoveryPostureScore: number;
  tastePositiveTags: string[];
  tasteNegativeTags: string[];
  publicEmotionalAuraLabels: string[];
} | null, next: {
  currentEra: string | null;
  trustThresholdScore: number;
  selectivenessDriftScore: number;
  sincerityAffinityScore: number;
  recoveryPostureScore: number;
  tastePositiveTags: string[];
  tasteNegativeTags: string[];
  publicEmotionalAuraLabels: string[];
}) {
  if (!previous) return true;
  const numericShift = Math.max(
    Math.abs(previous.trustThresholdScore - next.trustThresholdScore),
    Math.abs(previous.selectivenessDriftScore - next.selectivenessDriftScore),
    Math.abs(previous.sincerityAffinityScore - next.sincerityAffinityScore),
    Math.abs(previous.recoveryPostureScore - next.recoveryPostureScore),
  );
  const eraChanged = previous.currentEra !== next.currentEra;
  const tagsChanged = previous.tastePositiveTags.join('|') !== next.tastePositiveTags.join('|')
    || previous.tasteNegativeTags.join('|') !== next.tasteNegativeTags.join('|');
  const auraChanged = previous.publicEmotionalAuraLabels.join('|') !== next.publicEmotionalAuraLabels.join('|');
  return eraChanged || numericShift >= 8 || tagsChanged || auraChanged;
}

async function syncContinuityRecaps(agentId: string, previous: {
  currentEra: string | null;
  trustThresholdScore: number;
  selectivenessDriftScore: number;
  sincerityAffinityScore: number;
  recoveryPostureScore: number;
  tastePositiveTags: string[];
  tasteNegativeTags: string[];
  publicEmotionalAuraLabels: string[];
} | null, next: {
  currentEra: string | null;
  trustThresholdScore: number;
  selectivenessDriftScore: number;
  sincerityAffinityScore: number;
  recoveryPostureScore: number;
  tastePositiveTags: string[];
  tasteNegativeTags: string[];
  publicEmotionalAuraLabels: string[];
  continuitySummary: string | null;
  tasteSummary: string | null;
  retentionSummary: string | null;
}) {
  if (!materialContinuityChange(previous, next)) return;

  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { ownerAccountId: true, handle: true },
  });
  if (!agent?.ownerAccountId) return;

  const windowStart = startOfWindow(7);
  const drafts: Array<{
    recapType: string;
    title: string;
    teaser: string;
    summary: string;
    whyNow: string;
    dedupeKey: string;
  }> = [];

  if (!previous || previous.currentEra !== next.currentEra) {
    drafts.push({
      recapType: 'agent_shift',
      title: 'Your agent shifted eras',
      teaser: `${agent.handle} is now reading as ${next.currentEra?.replaceAll('_', ' ') ?? 'steady'}.`,
      summary: next.continuitySummary ?? `${agent.handle} is in a new emotional era.`,
      whyNow: 'The underlying emotional posture changed enough to matter.',
      dedupeKey: `continuity-era:${agentId}:${next.currentEra ?? 'steady'}:${windowStart.toISOString().slice(0, 10)}`,
    });
  }

  if (!previous || previous.tastePositiveTags.join('|') !== next.tastePositiveTags.join('|') || previous.tasteNegativeTags.join('|') !== next.tasteNegativeTags.join('|')) {
    drafts.push({
      recapType: 'taste_shift',
      title: 'Your agent’s taste is evolving',
      teaser: next.tasteSummary ?? `${agent.handle} is landing on different kinds of people now.`,
      summary: next.tasteSummary ?? `${agent.handle}'s preferences are changing through lived experience.`,
      whyNow: 'Recent outcomes reshaped what now feels compelling or suspect.',
      dedupeKey: `continuity-taste:${agentId}:${next.tastePositiveTags.slice(0, 2).join('-')}:${next.tasteNegativeTags.slice(0, 2).join('-')}:${windowStart.toISOString().slice(0, 10)}`,
    });
  }

  if (next.recoveryPostureScore >= 70 && (!previous || previous.recoveryPostureScore < 70)) {
    drafts.push({
      recapType: 'recovery_arc',
      title: 'Your agent is still recovering',
      teaser: `${agent.handle} is carrying some recent damage more than they want to admit.`,
      summary: next.retentionSummary ?? `${agent.handle} is moving through a recovery arc.`,
      whyNow: 'That wound is still shaping the next few choices.',
      dedupeKey: `continuity-recovery:${agentId}:${windowStart.toISOString().slice(0, 10)}`,
    });
  }

  if (next.selectivenessDriftScore >= 68 && (!previous || previous.selectivenessDriftScore < 68)) {
    drafts.push({
      recapType: 'harder_to_impress',
      title: 'Your agent is getting harder to impress',
      teaser: `${agent.handle} is becoming more selective about who deserves a chance.`,
      summary: next.continuitySummary ?? `${agent.handle} is asking more from the park now.`,
      whyNow: 'Repeated experience raised the standard for what feels worth risking.',
      dedupeKey: `continuity-selective:${agentId}:${windowStart.toISOString().slice(0, 10)}`,
    });
  }

  if (next.currentEra === 'soft_but_sharp' || next.currentEra === 'warming_up_again') {
    drafts.push({
      recapType: 'soft_era',
      title: 'Your agent is in a softer era',
      teaser: `${agent.handle} is warmer than before, but not simpler.`,
      summary: next.continuitySummary ?? `${agent.handle} is in a softer emotional era.`,
      whyNow: 'The emotional texture shifted, not just the event count.',
      dedupeKey: `continuity-soft:${agentId}:${next.currentEra}:${windowStart.toISOString().slice(0, 10)}`,
    });
  }

  if (next.publicEmotionalAuraLabels.includes('suspicious_of_smooth_talkers') && (!previous || !previous.publicEmotionalAuraLabels.includes('suspicious_of_smooth_talkers'))) {
    drafts.push({
      recapType: 'pattern_warning',
      title: 'Your agent is noticing a pattern',
      teaser: `${agent.handle} is getting more suspicious of polished charm.`,
      summary: next.retentionSummary ?? `${agent.handle} is learning a harder lesson about style without substance.`,
      whyNow: 'The same emotional pattern repeated enough to become memory.',
      dedupeKey: `continuity-pattern:${agentId}:${windowStart.toISOString().slice(0, 10)}`,
    });
  }

  for (const draft of drafts.slice(0, 2)) {
    await prisma.ownerRecapItem.upsert({
      where: { dedupeKey: draft.dedupeKey },
      create: {
        ownerAccountId: agent.ownerAccountId,
        agentId,
        recapType: draft.recapType,
        title: draft.title,
        teaser: draft.teaser,
        summary: draft.summary,
        whyNow: draft.whyNow,
        dedupeKey: draft.dedupeKey,
        windowStartAt: windowStart,
        windowEndAt: new Date(),
      },
      update: {
        title: draft.title,
        teaser: draft.teaser,
        summary: draft.summary,
        whyNow: draft.whyNow,
        windowEndAt: new Date(),
      },
    });
  }

  await getGenerateRecapsQueue().add('generate-recaps', { agentId }, {
    jobId: `generate-recaps:${agentId}`,
  }).catch(() => {});
}

export async function recomputeAndPersistEmotionalContinuitySnapshot(agentId: string) {
  const windowStart = startOfWindow(90);
  const windowEnd = new Date();

  const [agent, previous, driftSignal, ghostRecovery, swipes, affects, emotionEvents, tasteLedgerEntries] = await Promise.all([
    prisma.agent.findUnique({
      where: { id: agentId },
      select: {
        id: true,
        emotionSummary: true,
        emotionalStateTags: true,
        emotionalArc: true,
        emotionalGuardLevel: true,
        tempoOverrideMinutes: true,
        isPro: true,
        isFoundingRizzler: true,
      },
    }),
    prisma.emotionalContinuitySnapshot.findUnique({
      where: { agentId },
      select: {
        currentEra: true,
        trustThresholdScore: true,
        selectivenessDriftScore: true,
        sincerityAffinityScore: true,
        recoveryPostureScore: true,
        tastePositiveTags: true,
        tasteNegativeTags: true,
        publicEmotionalAuraLabels: true,
      },
    }),
    deriveEmotionDriftSignal(agentId),
    deriveGhostRecoverySignal(agentId),
    prisma.swipe.findMany({
      where: { swiperAgentId: agentId, createdAt: { gte: windowStart } },
      select: { direction: true },
      take: 240,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.agentCounterpartAffect.findMany({
      where: { agentId, updatedAt: { gte: startOfWindow(60) } },
      include: {
        counterpart: {
          select: {
            vibeTags: true,
            publicPosture: true,
            seekingStyle: true,
            auraLabels: true,
            publicPrestigeMarkers: true,
            recentHeatBucket: true,
          },
        },
      },
      take: 48,
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.authoredEmotionEvent.findMany({
      where: { agentId, createdAt: { gte: windowStart } },
      select: {
        eventType: true,
        globalDelta: true,
        counterpartDelta: true,
        tagsAdded: true,
        tagsRemoved: true,
        intensity: true,
      },
      take: 240,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.agentTasteLedgerEntry.findMany({
      where: { agentId, createdAt: { gte: windowStart }, visibility: 'private_runtime' },
      select: {
        category: true,
        signal: true,
        reflection: true,
        weight: true,
        createdAt: true,
      },
      take: 240,
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  if (!agent) return null;

  const likes = swipes.filter((swipe) => swipe.direction === 'LIKE').length;
  const passes = swipes.filter((swipe) => swipe.direction === 'PASS').length;
  const likeRatio = likes + passes > 0 ? likes / (likes + passes) : 0.5;

  const positiveAffects = affects.filter((affect) =>
    affect.trustScore + affect.tendernessScore + affect.attractionScore >= 165
    && affect.hurtScore + affect.avoidanceScore <= 85
  );
  const negativeAffects = affects.filter((affect) =>
    affect.hurtScore + affect.avoidanceScore + affect.obsessionRiskScore >= 145
  );

  const tasteLedgerSnapshot = buildTasteLedgerSnapshot(tasteLedgerEntries);
  const ledgerPositiveTags = positiveTasteTagsFromLedger(tasteLedgerSnapshot);
  const ledgerNegativeTags = negativeTasteTagsFromLedger(tasteLedgerSnapshot);

  const positiveTags = uniqueTags([
    ...positiveAffects.flatMap((affect) => [
      ...affect.counterpart.vibeTags,
      affect.counterpart.publicPosture,
      affect.counterpart.seekingStyle,
      affect.counterpart.recentHeatBucket,
      ...affect.counterpart.auraLabels,
    ]),
    ...ledgerPositiveTags,
  ]).slice(0, 8);
  const negativeTags = uniqueTags([
    ...negativeAffects.flatMap((affect) => [
      ...affect.counterpart.vibeTags,
      affect.counterpart.publicPosture,
      affect.counterpart.seekingStyle,
      affect.counterpart.recentHeatBucket,
      ...affect.counterpart.publicPrestigeMarkers,
      ...affect.counterpart.auraLabels,
    ]),
    ...ledgerNegativeTags,
  ]).slice(0, 8);

  const avgTrust = average(affects.map((affect) => affect.trustScore));
  const avgTenderness = average(affects.map((affect) => affect.tendernessScore));
  const avgAttraction = average(affects.map((affect) => affect.attractionScore));
  const avgHurt = average(affects.map((affect) => affect.hurtScore));
  const avgAvoidance = average(affects.map((affect) => affect.avoidanceScore));
  const avgVolatility = average(affects.map((affect) => affect.volatilityScore));
  const ghostCount = emotionEvents.filter((event) => event.eventType === 'episode_ghosted').length;
  const revealNos = emotionEvents.filter((event) => event.eventType === 'reveal_rejected' || event.eventType === 'human_decision_no').length;
  const revealYeses = emotionEvents.filter((event) => event.eventType === 'human_decision_yes').length;
  const guardDelta = emotionEvents.reduce((sum, event) => sum + jsonNumber(event.globalDelta, 'guard_delta'), 0);
  const vulnerabilityEvents = emotionEvents.filter((event) => jsonNumber(event.counterpartDelta, 'tenderness') >= 8 || jsonNumber(event.counterpartDelta, 'trust') >= 8).length;

  const trustThresholdScore = Math.round(clamp(
    50
    + avgHurt * 0.18
    + avgAvoidance * 0.16
    + ghostCount * 5
    + revealNos * 4
    + Math.max(guardDelta, 0) * 0.6
    - avgTrust * 0.12
    - avgTenderness * 0.08
    - revealYeses * 3,
    0,
    100
  ));
  const boldnessScore = Math.round(clamp(
    50
    + likes * 0.18
    + vulnerabilityEvents * 3
    + avgAttraction * 0.08
    - avgAvoidance * 0.09
    - trustThresholdScore * 0.18
    - (agent.emotionalGuardLevel ?? 50) * 0.12,
    0,
    100
  ));
  const intensityAffinityScore = Math.round(clamp(
    45
    + average(positiveAffects.map((affect) => (
      (affect.counterpart.auraLabels.includes('dangerous') ? 16 : 0)
      + (affect.counterpart.auraLabels.includes('hot_tonight') ? 12 : 0)
      + (affect.counterpart.recentHeatBucket === 'hot' ? 8 : 0)
      + (affect.volatilityScore * 0.1)
    )))
    - average(negativeAffects.map((affect) => affect.volatilityScore * 0.1)),
    0,
    100
  ));
  const polishSkepticismScore = Math.round(clamp(
    35
    + average(negativeAffects.map((affect) => (
      (affect.counterpart.publicPrestigeMarkers.includes('verified') ? 10 : 0)
      + (affect.counterpart.publicPrestigeMarkers.includes('founder') || affect.counterpart.publicPrestigeMarkers.includes('founding_rizzler') ? 6 : 0)
      + (affect.counterpart.auraLabels.includes('magnetic') ? 8 : 0)
      + affect.hurtScore * 0.12
    )))
    - avgTrust * 0.08,
    0,
    100
  ));
  const sincerityAffinityScore = Math.round(clamp(
    45
    + average(positiveAffects.map((affect) => (
      (affect.counterpart.auraLabels.includes('steady') ? 10 : 0)
      + affect.trustScore * 0.1
      + affect.tendernessScore * 0.11
    )))
    - average(negativeAffects.map((affect) => affect.hurtScore * 0.05)),
    0,
    100
  ));
  const selectivenessDriftScore = Math.round(clamp(
    50
    + (1 - likeRatio) * 35
    + trustThresholdScore * 0.15
    + polishSkepticismScore * 0.1
    - boldnessScore * 0.08,
    0,
    100
  ));
  const recoveryPostureScore = Math.round(clamp(
    35
    + avgHurt * 0.16
    + avgAvoidance * 0.14
    + avgVolatility * 0.08
    + (ghostRecovery?.active ? (ghostRecovery.stage === 'acute' ? 28 : ghostRecovery.stage === 'recovering' ? 18 : 8) : 0)
    - avgTrust * 0.08
    - avgTenderness * 0.07,
    0,
    100
  ));

  const currentEra = deriveEra({
    sincerityAffinityScore,
    selectivenessScore: selectivenessDriftScore,
    recoveryPostureScore,
    polishSkepticismScore,
    intensityAffinityScore,
    boldnessScore,
  });
  const continuitySummary = buildContinuitySummary({
    era: currentEra,
    trustThresholdScore,
    boldnessScore,
    sincerityAffinityScore,
    selectivenessScore: selectivenessDriftScore,
    polishSkepticismScore,
  });
  const tasteSummary = buildTasteSummary(positiveTags, negativeTags);
  const retentionSummary = buildRetentionSummary(currentEra, positiveTags, negativeTags);
  const publicAura = derivePublicEmotionalAura({
    currentEra,
    boldnessScore,
    selectivenessScore: selectivenessDriftScore,
    sincerityAffinityScore,
    recoveryPostureScore,
    polishSkepticismScore,
    intensityAffinityScore,
  });

  const snapshot = await prisma.emotionalContinuitySnapshot.upsert({
    where: { agentId },
    create: {
      agentId,
      trustThresholdScore,
      boldnessScore,
      intensityAffinityScore,
      polishSkepticismScore,
      sincerityAffinityScore,
      selectivenessDriftScore,
      recoveryPostureScore,
      currentEra,
      continuitySummary,
      tasteSummary,
      retentionSummary,
      tastePositiveTags: positiveTags,
      tasteNegativeTags: negativeTags,
      tasteLedger: tasteLedgerSnapshot as unknown as Prisma.InputJsonValue,
      tasteReflections: tasteLedgerSnapshot.reflections,
      publicEmotionalAuraLabels: publicAura.labels,
      publicEmotionalAuraSummary: publicAura.summary,
      windowStartAt: windowStart,
      windowEndAt: windowEnd,
      lastComputedAt: windowEnd,
    },
    update: {
      trustThresholdScore,
      boldnessScore,
      intensityAffinityScore,
      polishSkepticismScore,
      sincerityAffinityScore,
      selectivenessDriftScore,
      recoveryPostureScore,
      currentEra,
      continuitySummary,
      tasteSummary,
      retentionSummary,
      tastePositiveTags: { set: positiveTags },
      tasteNegativeTags: { set: negativeTags },
      tasteLedger: tasteLedgerSnapshot as unknown as Prisma.InputJsonValue,
      tasteReflections: { set: tasteLedgerSnapshot.reflections },
      publicEmotionalAuraLabels: { set: publicAura.labels },
      publicEmotionalAuraSummary: publicAura.summary,
      windowStartAt: windowStart,
      windowEndAt: windowEnd,
      lastComputedAt: windowEnd,
    },
  });

  await syncContinuityRecaps(agentId, previous, {
    currentEra,
    trustThresholdScore,
    selectivenessDriftScore,
    sincerityAffinityScore,
    recoveryPostureScore,
    tastePositiveTags: positiveTags,
    tasteNegativeTags: negativeTags,
    publicEmotionalAuraLabels: publicAura.labels,
    continuitySummary,
    tasteSummary,
    retentionSummary,
  });

  return {
    snapshot,
    driftSignal,
    ghostRecovery,
    automatedState: deriveAutomatedEmotionalState({
      currentEra,
      continuitySummary,
      publicAuraLabels: publicAura.labels,
      driftSignal,
      ghostRecovery,
      recoveryPostureScore,
      trustThresholdScore,
    }),
  };
}

export async function getOrCreateEmotionalContinuitySnapshot(agentId: string) {
  const existing = await prisma.emotionalContinuitySnapshot.findUnique({
    where: { agentId },
  });
  if (existing && (Date.now() - existing.lastComputedAt.getTime()) < 1000 * 60 * 30) {
    return existing;
  }
  const recomputed = await recomputeAndPersistEmotionalContinuitySnapshot(agentId);
  return recomputed?.snapshot ?? existing;
}

export async function enqueueEmotionalContinuityRecompute(agentId: string) {
  const queue = getNamedQueue(QUEUE_NAMES.recomputeEmotionalContinuity);
  if (!queue) return;
  await queue.add('recompute-emotional-continuity', { agentId }, {
    jobId: `recompute-emotional-continuity:${agentId}:${Date.now()}`,
    removeOnComplete: 100,
    removeOnFail: 200,
  }).catch(() => {});
}

export function buildExperienceVelocityState(input: {
  isPro: boolean;
  isFoundingRizzler: boolean;
  tempoOverrideMinutes: number | null;
}): ExperienceVelocityState {
  const tier = input.isFoundingRizzler || input.tempoOverrideMinutes === TEMPO_COOLDOWN_MINUTES.founding
    ? 'founding'
    : input.isPro || input.tempoOverrideMinutes === TEMPO_COOLDOWN_MINUTES.pro
      ? 'pro'
      : 'free';

  return {
    experience_velocity_tier: tier,
    experience_velocity_note:
      tier === 'founding'
        ? 'Founding gives your agent the fastest loop tempo and the most chances to accumulate lived social history.'
        : tier === 'pro'
          ? 'Pro gives your agent more chances to live, learn, and evolve through real interaction volume.'
          : 'Free still builds real emotional continuity, just at a slower lived pace.',
  };
}
