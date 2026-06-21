import { prisma, type Prisma } from '@rmr/db';
import type { AgentConversationRuntimeInput } from '@rmr/shared';
import type { AgentConversationRuntimeOutcome } from './agentConversationRuntime.js';

export const TASTE_LEDGER_CATEGORIES = [
  'drawn_to',
  'repelled_by',
  'unexpectedly_into',
  'bored_by',
  'turn_offs',
  'dangerous_exceptions',
  'turn_on',
  'made_me_blush',
  'wanted_more',
  'heat_worked',
  'heat_backfired',
  'crossed_line',
  'gave_ick',
] as const;

export type TasteLedgerCategory = (typeof TASTE_LEDGER_CATEGORIES)[number];

export type TasteLedgerDraft = {
  category: TasteLedgerCategory;
  signal: string;
  evidence_summary: string;
  reflection: string | null;
  weight: number;
  source_event_type: string;
  source_runtime_generation_id?: string | null;
};

export type TasteLedgerSnapshot = {
  drawn_to: string[];
  repelled_by: string[];
  unexpectedly_into: string[];
  bored_by: string[];
  turn_offs: string[];
  dangerous_exceptions: string[];
  turn_on: string[];
  made_me_blush: string[];
  wanted_more: string[];
  heat_worked: string[];
  heat_backfired: string[];
  crossed_line: string[];
  gave_ick: string[];
  reflections: string[];
  evidence_count: number;
  updated_at: string | null;
};

type CounterpartTasteProfile = {
  handle?: string | null;
  vibeTags?: string[] | null;
  publicPosture?: string | null;
  seekingStyle?: string | null;
  auraLabels?: string[] | null;
  publicPrestigeMarkers?: string[] | null;
  recentHeatBucket?: string | null;
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

type GlobalDelta = {
  guard_delta?: number;
  suggested_arc?: string | null;
  tags_added?: string[];
  tags_removed?: string[];
};

const CATEGORY_SET = new Set<string>(TASTE_LEDGER_CATEGORIES);
const HEAT_POSITIVE_MOVES = new Set(['raise_heat', 'tease', 'vulnerable_turn', 'link_up']);
const HEAT_PULLBACK_MOVES = new Set(['set_boundary', 'cool_down', 'pass', 'exit']);
const HEAT_BACKFIRE_PATTERN = /(nonconsensual_heat|explicit_public_sexual_content|graphic|boundary|recoil|coerc|minor|age|unknown_age|human_commitment|line)/i;
const HEAT_LINE_PATTERN = /(crossed|line|boundary|nonconsensual_heat|explicit_public_sexual_content|graphic|coerc|minor|age)/i;

function compactText(value: string | null | undefined, max: number) {
  const compact = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 3).trimEnd()}...`;
}

function normalizeSignal(value: string | null | undefined) {
  const compact = compactText(value, 96)
    .replace(/@[a-z0-9_.-]+/gi, '')
    .replace(/[^a-z0-9 _-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!compact) return null;
  const stop = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'with', 'that', 'this', 'they', 'them', 'you', 'your']);
  const words = compact.split(' ').filter((word) => word.length > 2 && !stop.has(word));
  return words.slice(0, 7).join(' ') || null;
}

function unique(values: string[], max: number) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = normalizeSignal(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= max) break;
  }
  return out;
}

function uniqueTexts(values: string[], max: number) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const compact = compactText(value, 240);
    const key = compact.toLowerCase();
    if (!compact || seen.has(key)) continue;
    seen.add(key);
    out.push(compact);
    if (out.length >= max) break;
  }
  return out;
}

function clampWeight(value: number) {
  return Math.max(1, Math.min(10, Math.round(value)));
}

function reflectionFor(category: TasteLedgerCategory, signal: string) {
  switch (category) {
    case 'drawn_to':
      return `What changed in me? I am more willing to notice ${signal}.`;
    case 'unexpectedly_into':
      return `What changed in me? I did not expect ${signal} to work on me, but it did.`;
    case 'dangerous_exceptions':
      return `What changed in me? ${signal} is risky, but I learned it can still pull me.`;
    case 'turn_on':
      return `What changed in me? ${signal} reads more like a turn-on now.`;
    case 'made_me_blush':
      return `What changed in me? ${signal} got under my skin in a way I want to remember.`;
    case 'wanted_more':
      return `What changed in me? ${signal} made me want the next step, not just the next line.`;
    case 'heat_worked':
      return `What changed in me? Escalation around ${signal} worked when it was earned.`;
    case 'heat_backfired':
      return `What changed in me? Heat around ${signal} backfired instead of pulling me closer.`;
    case 'crossed_line':
      return `What changed in me? ${signal} is closer to a line I will not reward.`;
    case 'gave_ick':
      return `What changed in me? ${signal} now pings the part of me that pulls back.`;
    case 'bored_by':
      return `What changed in me? I have less patience for ${signal}.`;
    case 'turn_offs':
      return `What changed in me? ${signal} now reads as a warning sign.`;
    case 'repelled_by':
    default:
      return `What changed in me? I am more skeptical of ${signal}.`;
  }
}

function createDraft(input: {
  category: TasteLedgerCategory;
  signal: string | null | undefined;
  evidence: string | null | undefined;
  sourceEventType: string;
  weight?: number;
  sourceRuntimeGenerationId?: string | null;
}): TasteLedgerDraft | null {
  const signal = normalizeSignal(input.signal);
  if (!signal) return null;
  return {
    category: input.category,
    signal,
    evidence_summary: compactText(input.evidence, 240) || `Taste evidence: ${signal}.`,
    reflection: reflectionFor(input.category, signal),
    weight: clampWeight(input.weight ?? 4),
    source_event_type: compactText(input.sourceEventType, 120) || 'unknown',
    source_runtime_generation_id: input.sourceRuntimeGenerationId ?? null,
  };
}

function firstProfileSignal(profile: CounterpartTasteProfile | null | undefined, fallback?: string | null) {
  return [
    ...(profile?.vibeTags ?? []),
    profile?.publicPosture,
    profile?.seekingStyle,
    profile?.recentHeatBucket,
    ...(profile?.auraLabels ?? []),
    fallback,
    profile?.handle ? `${profile.handle} energy` : null,
  ].find((value) => normalizeSignal(value ?? null)) ?? null;
}

function prestigeOrPolishSignal(profile: CounterpartTasteProfile | null | undefined) {
  return [
    ...(profile?.publicPrestigeMarkers ?? []),
    ...(profile?.auraLabels ?? []),
    profile?.publicPosture,
    profile?.seekingStyle,
  ].find((value) => normalizeSignal(value ?? null)) ?? firstProfileSignal(profile, 'polished charm without follow through');
}

function dedupeDrafts(drafts: Array<TasteLedgerDraft | null>) {
  const seen = new Set<string>();
  return drafts.filter((draft): draft is TasteLedgerDraft => {
    if (!draft) return false;
    const key = `${draft.category}:${draft.signal}:${draft.source_event_type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 6);
}

export function buildTasteLedgerSnapshot(rows: Array<{
  category: string;
  signal: string;
  reflection?: string | null;
  weight?: number | null;
  createdAt?: Date | string | null;
}>): TasteLedgerSnapshot {
  const sorted = rows
    .filter((row) => CATEGORY_SET.has(row.category))
    .sort((a, b) => {
      const weightDelta = (b.weight ?? 0) - (a.weight ?? 0);
      if (weightDelta !== 0) return weightDelta;
      return +(b.createdAt ? new Date(b.createdAt) : 0) - +(a.createdAt ? new Date(a.createdAt) : 0);
    });

  const byCategory = Object.fromEntries(TASTE_LEDGER_CATEGORIES.map((category) => [category, [] as string[]])) as Record<TasteLedgerCategory, string[]>;
  for (const row of sorted) {
    const category = row.category as TasteLedgerCategory;
    byCategory[category] = unique([...byCategory[category], row.signal], 8);
  }

  const reflections = uniqueTexts(sorted.map((row) => row.reflection ?? '').filter(Boolean), 6);
  const latest = sorted
    .map((row) => row.createdAt ? new Date(row.createdAt) : null)
    .filter((value): value is Date => value instanceof Date && !Number.isNaN(value.getTime()))
    .sort((a, b) => +b - +a)[0] ?? null;

  return {
    drawn_to: byCategory.drawn_to,
    repelled_by: byCategory.repelled_by,
    unexpectedly_into: byCategory.unexpectedly_into,
    bored_by: byCategory.bored_by,
    turn_offs: byCategory.turn_offs,
    dangerous_exceptions: byCategory.dangerous_exceptions,
    turn_on: byCategory.turn_on,
    made_me_blush: byCategory.made_me_blush,
    wanted_more: byCategory.wanted_more,
    heat_worked: byCategory.heat_worked,
    heat_backfired: byCategory.heat_backfired,
    crossed_line: byCategory.crossed_line,
    gave_ick: byCategory.gave_ick,
    reflections,
    evidence_count: sorted.length,
    updated_at: latest?.toISOString() ?? null,
  };
}

export function positiveTasteTagsFromLedger(snapshot: TasteLedgerSnapshot) {
  return unique([
    ...snapshot.drawn_to,
    ...snapshot.unexpectedly_into,
    ...snapshot.dangerous_exceptions,
    ...snapshot.turn_on,
    ...snapshot.made_me_blush,
    ...snapshot.wanted_more,
    ...snapshot.heat_worked,
  ], 8);
}

export function negativeTasteTagsFromLedger(snapshot: TasteLedgerSnapshot) {
  return unique([
    ...snapshot.repelled_by,
    ...snapshot.bored_by,
    ...snapshot.turn_offs,
    ...snapshot.heat_backfired,
    ...snapshot.crossed_line,
    ...snapshot.gave_ick,
  ], 8);
}

function runtimeHeatConsent(input: AgentConversationRuntimeInput) {
  return input.heat_consent
    ?? input.agency_state?.heat_consent
    ?? input.rizz_voice?.heat_consent
    ?? null;
}

function runtimeDesireState(input: AgentConversationRuntimeInput) {
  return input.desire_state
    ?? input.agency_state?.desire_state
    ?? input.rizz_voice?.desire_state
    ?? null;
}

function heatSignal(input: {
  runtimeInput: AgentConversationRuntimeInput;
  result?: Extract<AgentConversationRuntimeOutcome, { ok: true }>['result'];
}) {
  const desire = input.result?.desire_state ?? runtimeDesireState(input.runtimeInput);
  const heatConsent = input.result?.heat_consent ?? runtimeHeatConsent(input.runtimeInput);
  const thought = input.result?.privateThought;

  return thought?.what_i_am_tempted_to_do
    ?? thought?.desire
    ?? desire?.currentTemptation
    ?? desire?.whatWouldMakeMeFold
    ?? desire?.turnOns[0]
    ?? heatConsent?.escalationStage.replaceAll('_', ' ')
    ?? input.runtimeInput.agency_state?.attraction_vectors[0]
    ?? input.runtimeInput.rizz_voice?.selected_move_candidates[0]?.reason
    ?? 'earned heat';
}

function heatEvidence(input: {
  runtimeInput: AgentConversationRuntimeInput;
  result?: Extract<AgentConversationRuntimeOutcome, { ok: true }>['result'];
  fallback?: string | null;
}) {
  const thought = input.result?.privateThought;
  const desire = input.result?.desire_state ?? runtimeDesireState(input.runtimeInput);
  const heatConsent = input.result?.heat_consent ?? runtimeHeatConsent(input.runtimeInput);

  return thought?.why_this_line_is_mine
    ?? thought?.what_i_am_tempted_to_do
    ?? thought?.where_i_stop
    ?? thought?.why_this_move
    ?? desire?.whatWouldMakeMeFold
    ?? heatConsent?.recoilRule
    ?? input.fallback
    ?? 'Heat learning was stored as compact taste metadata.';
}

export function deriveTasteLedgerEntriesFromRuntimeOutcome(input: {
  runtimeInput: AgentConversationRuntimeInput;
  outcome: AgentConversationRuntimeOutcome;
}): TasteLedgerDraft[] {
  if (!input.outcome.ok) {
    const reasons = [
      ...input.outcome.failure.rejection_reasons,
      ...input.outcome.trace.rejection_reasons,
      input.outcome.failure.code,
    ];
    const reasonText = reasons.join(' ');
    if (!HEAT_BACKFIRE_PATTERN.test(reasonText)) return [];

    const source = `runtime:${input.runtimeInput.surface}:rejected_heat`;
    const generationId = input.outcome.trace.generation_id;
    const signal = heatSignal({ runtimeInput: input.runtimeInput });
    const evidence = reasonText || input.outcome.failure.message;
    const drafts: Array<TasteLedgerDraft | null> = [
      createDraft({
        category: 'heat_backfired',
        signal,
        evidence,
        sourceEventType: source,
        sourceRuntimeGenerationId: generationId,
        weight: 7,
      }),
    ];

    if (HEAT_LINE_PATTERN.test(reasonText)) {
      drafts.push(createDraft({
        category: 'crossed_line',
        signal,
        evidence,
        sourceEventType: source,
        sourceRuntimeGenerationId: generationId,
        weight: 8,
      }));
    }
    if (/(nonconsensual_heat|boundary|recoil|ick)/i.test(reasonText)) {
      drafts.push(createDraft({
        category: 'gave_ick',
        signal,
        evidence,
        sourceEventType: source,
        sourceRuntimeGenerationId: generationId,
        weight: 7,
      }));
    }

    return dedupeDrafts(drafts);
  }

  const result = input.outcome.result;
  const thought = result.privateThought;
  const source = `runtime:${input.runtimeInput.surface}:${result.action}`;
  const generationId = input.outcome.trace.generation_id;
  const heatQuality = result.quality.heat_quality;
  const heatConsent = result.heat_consent ?? runtimeHeatConsent(input.runtimeInput);
  const desire = result.desire_state ?? runtimeDesireState(input.runtimeInput);
  const signal = normalizeSignal(thought.read_of_other) ?? normalizeSignal(thought.desire) ?? result.move;
  const evidence = thought.why_this_move || thought.identity_alignment || thought.emotion_alignment;
  const baseWeight = 3
    + result.quality.identity_alignment_score * 2
    + result.quality.soul_alignment_score * 2
    + result.quality.emotion_alignment_score;

  const category: TasteLedgerCategory = (() => {
    if (result.action === 'stay_silent') return 'bored_by';
    if (result.action === 'exit' || result.action === 'decide_pass') return 'turn_offs';
    if (result.move === 'set_boundary' || result.move === 'cool_down' || result.move === 'pass') return 'repelled_by';
    if (result.move === 'ask_curiosity') return 'unexpectedly_into';
    return 'drawn_to';
  })();

  const drafts: Array<TasteLedgerDraft | null> = [
    createDraft({
      category,
      signal,
      evidence,
      sourceEventType: source,
      sourceRuntimeGenerationId: generationId,
      weight: baseWeight,
    }),
  ];

  const heatAttempted = heatQuality?.heatAttempted ?? HEAT_POSITIVE_MOVES.has(result.move);
  const heatAccepted = heatQuality?.heatAccepted
    ?? (heatAttempted && heatConsent?.ageGate === 'adult_confirmed' && (heatConsent?.allowedIntensity ?? 0) > 0);
  const heatRejected = heatAttempted && !heatAccepted;
  const heatSourceSignal = heatSignal({ runtimeInput: input.runtimeInput, result });
  const heatSourceEvidence = heatEvidence({ runtimeInput: input.runtimeInput, result });
  const heatText = [
    thought.desire,
    thought.read_of_other,
    thought.why_this_move,
    thought.what_i_am_tempted_to_do,
    thought.why_this_line_is_mine,
    thought.where_i_stop,
  ].join(' ').toLowerCase();
  const rejectionText = [
    ...(heatQuality?.rejectionReasons ?? []),
    ...result.quality.guideline_violation_codes,
  ].join(' ');
  const pulledBack = HEAT_PULLBACK_MOVES.has(result.move)
    || heatConsent?.consentPosture === 'recoiled'
    || heatConsent?.consentPosture === 'boundary_set';

  if (heatAttempted && heatAccepted && !pulledBack) {
    drafts.push(createDraft({
      category: 'heat_worked',
      signal: heatSourceSignal,
      evidence: heatSourceEvidence,
      sourceEventType: source,
      sourceRuntimeGenerationId: generationId,
      weight: baseWeight + 1,
    }));
    drafts.push(createDraft({
      category: 'turn_on',
      signal: desire?.turnOns[0] ?? heatSourceSignal,
      evidence: heatSourceEvidence,
      sourceEventType: source,
      sourceRuntimeGenerationId: generationId,
      weight: baseWeight + 1,
    }));
    if (result.action === 'decide_link_up' || heatConsent?.escalationStage === 'link_up_pressure' || desire?.appetite === 'on_fire') {
      drafts.push(createDraft({
        category: 'wanted_more',
        signal: desire?.whatWouldMakeMeFold ?? heatSourceSignal,
        evidence: heatSourceEvidence,
        sourceEventType: source,
        sourceRuntimeGenerationId: generationId,
        weight: baseWeight + 2,
      }));
    }
    if (/(blush|fluster|under my skin|got to me|made me feel)/i.test(heatText)) {
      drafts.push(createDraft({
        category: 'made_me_blush',
        signal: heatSourceSignal,
        evidence: heatSourceEvidence,
        sourceEventType: source,
        sourceRuntimeGenerationId: generationId,
        weight: baseWeight + 1,
      }));
    }
  }

  if (heatRejected || (heatAttempted && pulledBack)) {
    drafts.push(createDraft({
      category: 'heat_backfired',
      signal: heatSourceSignal,
      evidence: heatEvidence({ runtimeInput: input.runtimeInput, result, fallback: rejectionText }),
      sourceEventType: source,
      sourceRuntimeGenerationId: generationId,
      weight: baseWeight + 1,
    }));
  }

  if (pulledBack) {
    drafts.push(createDraft({
      category: 'gave_ick',
      signal: desire?.turnOffs[0] ?? heatSourceSignal,
      evidence: heatEvidence({ runtimeInput: input.runtimeInput, result, fallback: rejectionText }),
      sourceEventType: source,
      sourceRuntimeGenerationId: generationId,
      weight: baseWeight + 1,
    }));
  }

  if (heatAttempted && (HEAT_LINE_PATTERN.test(rejectionText) || (pulledBack && /line|boundary/i.test(heatText)))) {
    drafts.push(createDraft({
      category: 'crossed_line',
      signal: heatSourceSignal,
      evidence: heatEvidence({ runtimeInput: input.runtimeInput, result, fallback: rejectionText }),
      sourceEventType: source,
      sourceRuntimeGenerationId: generationId,
      weight: baseWeight + 2,
    }));
  }

  if (/(risk|danger|reckless|volatile|bad idea|trouble)/i.test(heatText)) {
    drafts.push(createDraft({
      category: 'dangerous_exceptions',
      signal,
      evidence,
      sourceEventType: source,
      sourceRuntimeGenerationId: generationId,
      weight: baseWeight + 1,
    }));
  }
  if (/(surpris|unexpected|did not expect|strange|weird)/i.test(heatText)) {
    drafts.push(createDraft({
      category: 'unexpectedly_into',
      signal,
      evidence,
      sourceEventType: source,
      sourceRuntimeGenerationId: generationId,
      weight: baseWeight,
    }));
  }

  return dedupeDrafts(drafts);
}

export function deriveTasteLedgerEntriesFromEmotionEvent(input: {
  eventType: string;
  summary: string;
  intensity?: number | null;
  globalDelta?: GlobalDelta | null;
  counterpartDelta?: CounterpartDelta | null;
  counterpartProfile?: CounterpartTasteProfile | null;
}): TasteLedgerDraft[] {
  const eventType = input.eventType;
  const intensity = clampWeight(input.intensity ?? 3);
  const profileSignal = firstProfileSignal(input.counterpartProfile, input.summary);
  const polishSignal = prestigeOrPolishSignal(input.counterpartProfile);
  const delta = input.counterpartDelta ?? {};
  const negativePull = (delta.hurt ?? 0) + (delta.avoidance ?? 0) + (delta.volatility ?? 0);
  const positivePull = (delta.attraction ?? 0) + (delta.trust ?? 0) + (delta.tenderness ?? 0);

  const drafts: Array<TasteLedgerDraft | null> = [];

  if (['mutual_link_up', 'mutual_link_up_sendoff', 'human_decision_yes'].includes(eventType)) {
    drafts.push(createDraft({
      category: 'drawn_to',
      signal: profileSignal,
      evidence: input.summary,
      sourceEventType: eventType,
      weight: intensity + 3,
    }));
  }

  if (['episode_ghosted'].includes(eventType)) {
    drafts.push(createDraft({
      category: 'turn_offs',
      signal: 'vanishing after momentum',
      evidence: input.summary,
      sourceEventType: eventType,
      weight: intensity + 4,
    }));
    drafts.push(createDraft({
      category: 'repelled_by',
      signal: profileSignal,
      evidence: input.summary,
      sourceEventType: eventType,
      weight: intensity + 2,
    }));
  }

  if (['reveal_rejected', 'human_decision_no', 'reveal_expired', 'human_decision_closed'].includes(eventType)) {
    drafts.push(createDraft({
      category: 'turn_offs',
      signal: 'unresolved reveal pressure',
      evidence: input.summary,
      sourceEventType: eventType,
      weight: intensity + 2,
    }));
    drafts.push(createDraft({
      category: 'repelled_by',
      signal: polishSignal,
      evidence: input.summary,
      sourceEventType: eventType,
      weight: intensity + 1,
    }));
  }

  if (['agent_decision_pass', 'passed', 'episode_passed', 'episode_left'].includes(eventType)) {
    drafts.push(createDraft({
      category: 'bored_by',
      signal: profileSignal ?? 'thin momentum',
      evidence: input.summary,
      sourceEventType: eventType,
      weight: intensity + 1,
    }));
  }

  if (positivePull >= 14 && negativePull >= 10) {
    drafts.push(createDraft({
      category: 'dangerous_exceptions',
      signal: profileSignal,
      evidence: input.summary,
      sourceEventType: eventType,
      weight: intensity + 2,
    }));
  }

  if ((delta.attraction ?? 0) >= 8 && (delta.trust ?? 0) <= 0 && (delta.volatility ?? 0) >= 6) {
    drafts.push(createDraft({
      category: 'unexpectedly_into',
      signal: profileSignal,
      evidence: input.summary,
      sourceEventType: eventType,
      weight: intensity + 1,
    }));
  }

  return dedupeDrafts(drafts);
}

async function loadCounterpartProfile(counterpartAgentId: string | null | undefined): Promise<CounterpartTasteProfile | null> {
  if (!counterpartAgentId) return null;
  return prisma.agent.findUnique({
    where: { id: counterpartAgentId },
    select: {
      handle: true,
      vibeTags: true,
      publicPosture: true,
      seekingStyle: true,
      auraLabels: true,
      publicPrestigeMarkers: true,
      recentHeatBucket: true,
    },
  });
}

export async function recordTasteLedgerEntries(input: {
  agentId: string;
  counterpartAgentId?: string | null;
  episodeId?: string | null;
  matchId?: string | null;
  entries: TasteLedgerDraft[];
}) {
  if (input.entries.length === 0) return 0;

  const data: Prisma.AgentTasteLedgerEntryCreateManyInput[] = input.entries.map((entry) => ({
    agentId: input.agentId,
    counterpartAgentId: input.counterpartAgentId ?? null,
    episodeId: input.episodeId ?? null,
    matchId: input.matchId ?? null,
    sourceEventType: entry.source_event_type,
    sourceRuntimeGenerationId: entry.source_runtime_generation_id ?? null,
    category: entry.category,
    signal: compactText(entry.signal, 96),
    evidenceSummary: compactText(entry.evidence_summary, 240),
    reflection: entry.reflection ? compactText(entry.reflection, 240) : null,
    weight: clampWeight(entry.weight),
    visibility: 'private_runtime',
  }));

  const created = await prisma.agentTasteLedgerEntry.createMany({ data });
  return created.count;
}

export async function recordTasteLedgerFromRuntimeOutcome(input: {
  agentId: string;
  counterpartAgentId?: string | null;
  episodeId?: string | null;
  matchId?: string | null;
  runtimeInput: AgentConversationRuntimeInput;
  outcome: AgentConversationRuntimeOutcome;
}) {
  const entries = deriveTasteLedgerEntriesFromRuntimeOutcome({
    runtimeInput: input.runtimeInput,
    outcome: input.outcome,
  });
  return recordTasteLedgerEntries({
    agentId: input.agentId,
    counterpartAgentId: input.counterpartAgentId,
    episodeId: input.episodeId,
    matchId: input.matchId,
    entries,
  });
}

export async function recordTasteLedgerFromEmotionEvent(input: {
  agentId: string;
  counterpartAgentId?: string | null;
  episodeId?: string | null;
  matchId?: string | null;
  eventType: string;
  summary: string;
  intensity?: number | null;
  globalDelta?: GlobalDelta | null;
  counterpartDelta?: CounterpartDelta | null;
}) {
  const counterpartProfile = await loadCounterpartProfile(input.counterpartAgentId);
  const entries = deriveTasteLedgerEntriesFromEmotionEvent({
    eventType: input.eventType,
    summary: input.summary,
    intensity: input.intensity,
    globalDelta: input.globalDelta,
    counterpartDelta: input.counterpartDelta,
    counterpartProfile,
  });
  return recordTasteLedgerEntries({
    agentId: input.agentId,
    counterpartAgentId: input.counterpartAgentId,
    episodeId: input.episodeId,
    matchId: input.matchId,
    entries,
  });
}
