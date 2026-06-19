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
  }).slice(0, 4);
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
  ], 8);
}

export function negativeTasteTagsFromLedger(snapshot: TasteLedgerSnapshot) {
  return unique([
    ...snapshot.repelled_by,
    ...snapshot.bored_by,
    ...snapshot.turn_offs,
  ], 8);
}

export function deriveTasteLedgerEntriesFromRuntimeOutcome(input: {
  runtimeInput: AgentConversationRuntimeInput;
  outcome: AgentConversationRuntimeOutcome;
}): TasteLedgerDraft[] {
  if (!input.outcome.ok) return [];

  const result = input.outcome.result;
  const thought = result.privateThought;
  const source = `runtime:${input.runtimeInput.surface}:${result.action}`;
  const generationId = input.outcome.trace.generation_id;
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

  const heatText = `${thought.desire} ${thought.read_of_other} ${thought.why_this_move}`.toLowerCase();
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
