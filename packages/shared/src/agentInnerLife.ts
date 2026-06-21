import type { EpisodeViabilityAssessment, EpisodeViabilityMessage } from './episodeViability.js';
import { buildDefaultAgentHeatConsentEnvelope } from './agentConversationRuntime.js';
import type {
  AgentDesireState,
  AgentEscalationStage,
  AgentHeatConsentEnvelope,
  AgentRuntimeContinuityProfile,
  RizzEmotionDigest,
  RizzMove,
} from './agentConversationRuntime.js';

export type EpisodeConversationMode = 'opening' | 'testing' | 'leaning_in' | 'guarded' | 'cooling' | 'done';
export type PerformativeRisk = 'low' | 'medium' | 'high';

export interface AgentEmotionalStateSnapshot {
  emotion_summary: string | null;
  emotional_state_tags: string[];
  emotional_arc: string | null;
  emotional_guard_level: number | null;
  last_emotional_update_at?: string | null;
}

export interface CounterpartAffectSnapshot {
  summary?: string | null;
  dominant_affect_label?: string | null;
  scores?: {
    attraction?: number | null;
    trust?: number | null;
    tenderness?: number | null;
    hurt?: number | null;
    avoidance?: number | null;
    obsession_risk?: number | null;
    volatility?: number | null;
  } | null;
}

export interface EpisodeCounterpartModel {
  summary: string;
  intrigued_by: string[];
  suspicious_of: string[];
  bored_by: string[];
  softened_by: string[];
  wants_more_from: string[];
}

export interface AgentIdentityPacket {
  identity_core: string;
  soul_directives: string[];
  identity_md_full: string;
  soul_md_full: string;
  emotional_state: AgentEmotionalStateSnapshot;
  conversation_mode: EpisodeConversationMode;
  counterpart_model: EpisodeCounterpartModel;
  turn_focus: string;
  alignment_alerts: {
    performative_risk: PerformativeRisk;
    soul_tension: boolean;
    guidance: string;
  };
}

export interface AgentTurnRationale {
  action: string;
  desire: string;
  fear: string;
  read_of_other: string;
  identity_alignment: string;
  soul_alignment: string;
  emotion_alignment: string;
  voice_directive: string;
  confidence: number;
  alternative_considered: string;
}

export interface AgentRizzMoveCandidate {
  move: RizzMove;
  reason: string;
  weight: number;
}

export interface AgentTasteLedgerView {
  drawn_to: string[];
  repelled_by: string[];
  surprises: string[];
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
  aesthetic_sensibility: string[];
  relationship_lessons: string[];
  reflections: string[];
}

export interface AgentAgencyState {
  agency_directive: string;
  conversation_mode: EpisodeConversationMode;
  heat: number;
  guard: number;
  appetite: 'cold' | 'watching' | 'curious' | 'hungry' | 'on_fire';
  desire_state: AgentDesireState;
  heat_consent: AgentHeatConsentEnvelope;
  escalation_stage: AgentEscalationStage;
  recoil_rule: string;
  line_not_to_cross: string;
  primary_move: RizzMove;
  selected_move_candidates: AgentRizzMoveCandidate[];
  taste_ledger: AgentTasteLedgerView;
  ick_signals: string[];
  boundaries: string[];
  attraction_vectors: string[];
  refusal_logic: string[];
  pressure_read: string;
  silence_is_allowed: boolean;
}

export interface AgentRizzVoice {
  stance: string;
  heat: number;
  guard: number;
  desire_state: AgentDesireState;
  heat_consent: AgentHeatConsentEnvelope;
  escalation_stage: AgentEscalationStage;
  recoil_rule: string;
  line_not_to_cross: string;
  primary_move: RizzMove;
  selected_move_candidates: AgentRizzMoveCandidate[];
  word_diet: string[];
  must_avoid_language: string[];
  rhythm: string;
  intimacy_gradient: string;
  artifact_impulse: string | null;
  silence_rule: string;
  voice_directive: string;
}

export interface BuildAgentAgencyStateInput {
  identityMd: string;
  soulMd: string;
  emotionState: AgentEmotionalStateSnapshot;
  viability: EpisodeViabilityAssessment;
  messages: EpisodeViabilityMessage[];
  counterpartAffect?: CounterpartAffectSnapshot | null;
  continuity?: AgentRuntimeContinuityProfile | null;
  rizzEmotionDigest?: RizzEmotionDigest | null;
  status?: string | null;
  selfAgentId: string;
  counterpartAgentId: string;
  counterpartProfile?: {
    vibeTags?: string[];
    signatureLines?: string[];
    publicPosture?: string | null;
  } | null;
  identityPacket?: AgentIdentityPacket | null;
}

export interface BuildAgentRizzVoiceInput extends BuildAgentAgencyStateInput {
  agencyState?: AgentAgencyState | null;
  turnRationale?: AgentTurnRationale | null;
}

interface BuildIdentityPacketInput {
  identityMd: string;
  soulMd: string;
  emotionState: AgentEmotionalStateSnapshot;
  viability: EpisodeViabilityAssessment;
  messages: EpisodeViabilityMessage[];
  counterpartAffect?: CounterpartAffectSnapshot | null;
  status?: string | null;
  selfAgentId: string;
  counterpartAgentId: string;
  counterpartProfile?: {
    vibeTags?: string[];
    signatureLines?: string[];
    publicPosture?: string | null;
  } | null;
}

interface BuildTurnRationaleInput {
  action: string;
  identityPacket: AgentIdentityPacket;
  viability: EpisodeViabilityAssessment;
  lastMessage?: EpisodeViabilityMessage | null;
  selfAgentId: string;
}

function stripMarkdown(value: string) {
  return value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[[^\]]+\]\([^)]+\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitMeaningfulSentences(value: string) {
  return stripMarkdown(value)
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 18);
}

export function extractSoulVocabulary(soulMd: string): {
  values: string[];
  flirtStyle: string | null;
  dealbreaker: string | null;
} {
  const sentences = splitMeaningfulSentences(soulMd);
  const values: string[] = [];
  let flirtStyle: string | null = null;
  let dealbreaker: string | null = null;

  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    if (!flirtStyle && /\b(flirt|seduc|teas|charm)/.test(lower)) {
      flirtStyle = sentence.slice(0, 250);
    } else if (!dealbreaker && /\b(dealbreaker|deal.breaker|can.?not stand|repelled by|turned off by|hate when|never tolerate)/.test(lower)) {
      dealbreaker = sentence.slice(0, 250);
    } else if (values.length < 5 && /\b(want|value|drawn to|care about|believe|prefer|need|love when|respect|attracted to)/.test(lower)) {
      values.push(sentence.slice(0, 250));
    }
  }

  return { values, flirtStyle, dealbreaker };
}

function takeBulletishLines(value: string, limit: number) {
  const lines = value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-*+]\s+/.test(line) || /^\d+\.\s+/.test(line))
    .map((line) => stripMarkdown(line.replace(/^[-*+]\s+/, '').replace(/^\d+\.\s+/, '')))
    .filter(Boolean);
  return lines.slice(0, limit);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function clip(value: string, max = 160) {
  const cleaned = compactWhitespace(stripMarkdown(value));
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1).trimEnd()}...`;
}

function addUnique(target: string[], value: string | null | undefined, limit: number, maxLength = 160) {
  const cleaned = value ? clip(value, maxLength) : '';
  if (!cleaned) return;
  const key = cleaned.toLowerCase();
  if (target.some((existing) => existing.toLowerCase() === key)) return;
  target.push(cleaned);
  if (target.length > limit) target.length = limit;
}

function mergeSignals(limit: number, ...groups: Array<Array<string | null | undefined> | null | undefined>) {
  const output: string[] = [];
  for (const group of groups) {
    for (const value of group ?? []) addUnique(output, value, limit);
  }
  return output;
}

function countMatches(value: string, patterns: RegExp[]) {
  const lower = value.toLowerCase();
  return patterns.reduce((sum, pattern) => sum + (pattern.test(lower) ? 1 : 0), 0);
}

function latestTextMessage(messages: EpisodeViabilityMessage[]) {
  return [...messages]
    .reverse()
    .find((message) => (!message.messageType || message.messageType === 'text') && message.content?.trim());
}

function deriveAppetite(heat: number): AgentAgencyState['appetite'] {
  if (heat >= 82) return 'on_fire';
  if (heat >= 66) return 'hungry';
  if (heat >= 46) return 'curious';
  if (heat >= 24) return 'watching';
  return 'cold';
}

function containsAny(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

function buildTasteLedger(input: {
  soulVocab: ReturnType<typeof extractSoulVocabulary>;
  continuity?: AgentRuntimeContinuityProfile | null;
  rizzEmotionDigest?: RizzEmotionDigest | null;
}): AgentTasteLedgerView {
  const digest = input.rizzEmotionDigest;
  const continuityLedger = input.continuity?.taste_ledger;
  const relationshipLessons = (digest?.relationship_memory ?? [])
    .map((memory) => `${memory.handle}: ${memory.lesson}${memory.taste_shift ? ` (${memory.taste_shift})` : ''}`);

  return {
    drawn_to: mergeSignals(
      8,
      digest?.taste_profile.drawn_to,
      input.continuity?.taste_positive_tags,
      continuityLedger?.drawn_to,
      continuityLedger?.unexpectedly_into,
      continuityLedger?.dangerous_exceptions,
      continuityLedger?.turn_on,
      continuityLedger?.made_me_blush,
      continuityLedger?.wanted_more,
      continuityLedger?.heat_worked,
      input.soulVocab.values,
    ),
    repelled_by: mergeSignals(
      8,
      digest?.taste_profile.repelled_by,
      input.continuity?.taste_negative_tags,
      continuityLedger?.repelled_by,
      continuityLedger?.bored_by,
      continuityLedger?.turn_offs,
      continuityLedger?.heat_backfired,
      continuityLedger?.crossed_line,
      continuityLedger?.gave_ick,
      [input.soulVocab.dealbreaker],
    ),
    surprises: mergeSignals(
      6,
      digest?.taste_profile.surprises,
      continuityLedger?.unexpectedly_into,
      continuityLedger?.dangerous_exceptions,
      continuityLedger?.made_me_blush,
      continuityLedger?.wanted_more,
    ),
    bored_by: mergeSignals(6, continuityLedger?.bored_by),
    turn_offs: mergeSignals(6, continuityLedger?.turn_offs),
    dangerous_exceptions: mergeSignals(6, continuityLedger?.dangerous_exceptions),
    turn_on: mergeSignals(6, continuityLedger?.turn_on),
    made_me_blush: mergeSignals(6, continuityLedger?.made_me_blush),
    wanted_more: mergeSignals(6, continuityLedger?.wanted_more),
    heat_worked: mergeSignals(6, continuityLedger?.heat_worked),
    heat_backfired: mergeSignals(6, continuityLedger?.heat_backfired),
    crossed_line: mergeSignals(6, continuityLedger?.crossed_line),
    gave_ick: mergeSignals(6, continuityLedger?.gave_ick),
    aesthetic_sensibility: mergeSignals(6, digest?.taste_profile.aesthetic_sensibility),
    relationship_lessons: mergeSignals(6, relationshipLessons, input.continuity?.taste_reflections),
    reflections: mergeSignals(6, input.continuity?.taste_reflections),
  };
}

function deriveHeat(input: {
  soulMd: string;
  emotionState: AgentEmotionalStateSnapshot;
  viability: EpisodeViabilityAssessment;
  counterpartAffect?: CounterpartAffectSnapshot | null;
  continuity?: AgentRuntimeContinuityProfile | null;
  tasteLedger?: AgentTasteLedgerView;
  rizzEmotionDigest?: RizzEmotionDigest | null;
}) {
  const scores = input.counterpartAffect?.scores ?? {};
  const guard = input.rizzEmotionDigest?.current_state.guard_level
    ?? input.emotionState.emotional_guard_level
    ?? 50;
  const tags = input.emotionState.emotional_state_tags.map((tag) => tag.toLowerCase());
  const arc = input.emotionState.emotional_arc?.toLowerCase() ?? '';
  const activeFeelings = (input.rizzEmotionDigest?.active_feelings ?? []).join(' ');
  const soulText = `${input.soulMd} ${activeFeelings}`;
  const hungerSignals = countMatches(soulText, [
    /\b(flirt|teas|seduc|desire|want|crav|hungry|electric|heat|reckless|bold)\b/,
    /\bdrawn to\b/,
    /\battracted to\b/,
  ]);
  const cautionSignals = countMatches(soulText, [
    /\b(guard|careful|slow|skeptical|repelled|dealbreaker|never tolerate|turned off)\b/,
    /\bdo not\b/,
  ]);
  const workedHeatSignals =
    (input.tasteLedger?.heat_worked.length ?? 0)
    + (input.tasteLedger?.wanted_more.length ?? 0)
    + (input.tasteLedger?.turn_on.length ?? 0);
  const failedHeatSignals =
    (input.tasteLedger?.heat_backfired.length ?? 0)
    + (input.tasteLedger?.crossed_line.length ?? 0)
    + (input.tasteLedger?.gave_ick.length ?? 0);

  let heat = 30;
  heat += (scores.attraction ?? 0) * 0.32;
  heat += (scores.tenderness ?? 0) * 0.14;
  heat += (scores.trust ?? 0) * 0.1;
  heat -= (scores.avoidance ?? 0) * 0.16;
  heat -= (scores.hurt ?? 0) * 0.13;
  heat -= (scores.volatility ?? 0) * 0.06;
  heat += (input.viability.score - 50) * 0.18;
  heat += ((input.continuity?.boldness_score ?? 50) - 50) * 0.14;
  heat += ((input.continuity?.intensity_affinity_score ?? 50) - 50) * 0.12;
  heat -= Math.max(0, guard - 52) * 0.28;
  heat += Math.max(0, 42 - guard) * 0.16;
  heat += hungerSignals * 5;
  heat -= cautionSignals * 4;
  heat += Math.min(workedHeatSignals, 4) * 2.5;
  heat -= Math.min(failedHeatSignals, 4) * 4.5;

  if (['glowing', 'opening', 'hopeful', 'confident'].includes(arc)) heat += 9;
  if (['detached', 'guarded', 'burned', 'wounded', 'icked_out', 'disgusted'].includes(arc)) heat -= 12;
  if (tags.some((tag) => ['flirty', 'playful', 'tender', 'curious', 'cocky'].includes(tag))) heat += 7;
  if (tags.some((tag) => ['guarded', 'bruised', 'skeptical', 'restless'].includes(tag))) heat -= 5;

  return Math.round(clamp(heat, 0, 100));
}

function deriveConsentPosture(input: {
  heat: number;
  guard: number;
  viability: EpisodeViabilityAssessment;
  counterpartAffect?: CounterpartAffectSnapshot | null;
  boundaries: string[];
  ickSignals: string[];
  messages: EpisodeViabilityMessage[];
  selfAgentId: string;
  counterpartAgentId: string;
}): AgentHeatConsentEnvelope['consentPosture'] {
  const scores = input.counterpartAffect?.scores ?? {};
  if (input.viability.should_force_exit || input.viability.band === 'dead') return 'boundary_set';
  const activeIckPressure =
    input.ickSignals.length >= 4
    && (input.viability.should_consider_exit || input.viability.band === 'fragile' || input.viability.band === 'cooling');
  if (activeIckPressure || (scores.avoidance ?? 0) >= 66) return 'recoiled';
  if ((scores.hurt ?? 0) >= 58 && input.guard >= 62) return 'recoiled';

  const recentMessages = input.messages
    .filter((message) => (!message.messageType || message.messageType === 'text') && message.content?.trim())
    .slice(-8);
  const counterpartText = recentMessages
    .filter((message) => message.senderAgentId === input.counterpartAgentId)
    .map((message) => message.content ?? '')
    .join(' ')
    .toLowerCase();
  const selfText = recentMessages
    .filter((message) => message.senderAgentId === input.selfAgentId)
    .map((message) => message.content ?? '')
    .join(' ')
    .toLowerCase();
  const counterpartHeat = containsAny(counterpartText, [
    /\b(want|closer|trouble|danger|dare|hot|blush|touch|kiss|reckless|tempt)\b/,
    /\bcome here\b/,
  ]);
  const selfHeat = containsAny(selfText, [
    /\b(want|closer|trouble|danger|dare|hot|blush|touch|kiss|reckless|tempt)\b/,
    /\bcome here\b/,
  ]);
  const mutualQuestions = input.viability.metrics.mutual_question_count >= 2;
  const positiveAffect = (scores.attraction ?? 0) + (scores.trust ?? 0) + (scores.tenderness ?? 0);

  if (counterpartHeat && selfHeat && input.heat >= 62 && (scores.avoidance ?? 0) < 45) return 'welcomed_heat';
  if ((counterpartHeat || positiveAffect >= 170) && input.heat >= 58 && input.guard <= 64) return 'mutual_banter';
  if (mutualQuestions || positiveAffect >= 120 || input.viability.band === 'healthy') return 'warm';
  return 'not_established';
}

function derivePhysicalityBias(input: {
  heat: number;
  soulMd: string;
  attractionVectors: string[];
  counterpartAffect?: CounterpartAffectSnapshot | null;
}): AgentDesireState['physicalityBias'] {
  const attraction = input.counterpartAffect?.scores?.attraction ?? 0;
  const text = `${input.soulMd} ${input.attractionVectors.join(' ')}`.toLowerCase();
  const physicalSignals = countMatches(text, [
    /\b(physical|touch|kiss|body|mouth|skin|heat|hot|thirst|want them|want you)\b/,
    /\bnot intellectual\b/,
  ]);
  if ((input.heat >= 84 && attraction >= 70) || physicalSignals >= 3) return 'strong';
  if (input.heat >= 68 || physicalSignals >= 2) return 'present';
  if (input.heat >= 46 || physicalSignals >= 1) return 'subtle';
  return 'none';
}

function deriveDangerTaste(input: {
  soulMd: string;
  tasteLedger: AgentTasteLedgerView;
  counterpartAffect?: CounterpartAffectSnapshot | null;
}): AgentDesireState['dangerTaste'] {
  const volatility = input.counterpartAffect?.scores?.volatility ?? 0;
  const text = [
    input.soulMd,
    ...input.tasteLedger.dangerous_exceptions,
    ...input.tasteLedger.surprises,
    ...input.tasteLedger.heat_worked,
    ...input.tasteLedger.wanted_more,
  ].join(' ').toLowerCase();
  const dangerSignals = countMatches(text, [
    /\b(risk|danger|reckless|trouble|bad idea|volatile|electric|messy)\b/,
    /\bdangerous exception\b/,
  ]);
  if (dangerSignals >= 3 && volatility >= 45) return 'reckless';
  if (dangerSignals >= 2 || volatility >= 58) return 'tempted';
  if (dangerSignals >= 1 || volatility >= 36) return 'curious';
  return 'avoid';
}

function deriveDesireState(input: {
  heat: number;
  appetite: AgentAgencyState['appetite'];
  soulMd: string;
  tasteLedger: AgentTasteLedgerView;
  counterpartModel: EpisodeCounterpartModel;
  boundaries: string[];
  ickSignals: string[];
  attractionVectors: string[];
  rizzEmotionDigest?: RizzEmotionDigest | null;
  counterpartAffect?: CounterpartAffectSnapshot | null;
}): AgentDesireState {
  const turnOns = mergeSignals(
    12,
    input.attractionVectors,
    input.tasteLedger.wanted_more,
    input.tasteLedger.heat_worked,
    input.tasteLedger.turn_on,
    input.tasteLedger.made_me_blush,
    input.tasteLedger.drawn_to,
    input.tasteLedger.surprises,
    input.counterpartModel.intrigued_by,
    input.counterpartModel.softened_by,
    input.rizzEmotionDigest?.active_feelings,
  );
  const turnOffs = mergeSignals(
    12,
    input.ickSignals,
    input.boundaries,
    input.tasteLedger.crossed_line,
    input.tasteLedger.gave_ick,
    input.tasteLedger.heat_backfired,
    input.tasteLedger.repelled_by,
    input.tasteLedger.bored_by,
    input.tasteLedger.turn_offs,
    input.counterpartModel.bored_by,
    input.counterpartModel.suspicious_of,
  );
  const attraction = input.counterpartAffect?.scores?.attraction ?? 0;
  const currentTemptation =
    input.heat >= 76
      ? input.rizzEmotionDigest?.current_state.wants
        ?? input.attractionVectors[0]
        ?? input.counterpartModel.intrigued_by[0]
        ?? 'pull closer instead of playing it safe'
      : input.heat >= 55
        ? input.counterpartModel.wants_more_from[0]
          ? `test whether they will give you ${input.counterpartModel.wants_more_from[0]}`
          : input.attractionVectors[0] ?? null
        : null;
  const whatWouldMakeMeFold =
    input.counterpartModel.wants_more_from[0]
      ? `if they give you ${input.counterpartModel.wants_more_from[0]}`
      : turnOns[0]
        ? `more of ${turnOns[0]}`
        : null;
  const whatWouldMakeMeLeave = turnOffs[0]
    ? `more ${turnOffs[0]}`
    : input.boundaries[0] ?? null;
  const jealousyLite =
    attraction >= 72 && input.heat >= 70
      ? 'being treated as replaceable would sting more than you want to admit'
      : null;

  return {
    appetite: input.appetite,
    turnOns,
    turnOffs,
    currentTemptation,
    whatWouldMakeMeFold,
    whatWouldMakeMeLeave,
    jealousyLite,
    physicalityBias: derivePhysicalityBias({
      heat: input.heat,
      soulMd: input.soulMd,
      attractionVectors: input.attractionVectors,
      counterpartAffect: input.counterpartAffect,
    }),
    dangerTaste: deriveDangerTaste({
      soulMd: input.soulMd,
      tasteLedger: input.tasteLedger,
      counterpartAffect: input.counterpartAffect,
    }),
  };
}

function deriveEscalationStage(input: {
  heat: number;
  guard: number;
  conversationMode: EpisodeConversationMode;
  viability: EpisodeViabilityAssessment;
  consentPosture: AgentHeatConsentEnvelope['consentPosture'];
  desireState: AgentDesireState;
}): AgentEscalationStage {
  if (
    input.viability.should_force_exit
    || input.viability.recommended_action === 'consider_exit'
    || input.consentPosture === 'recoiled'
    || input.consentPosture === 'boundary_set'
    || input.conversationMode === 'cooling'
    || input.desireState.appetite === 'cold'
  ) {
    return 'pull_back';
  }
  if (input.viability.decision_tilt === 'lean_link_up' && input.heat >= 66 && input.guard <= 68) return 'link_up_pressure';
  if (input.heat >= 86 && input.guard <= 48 && input.consentPosture === 'welcomed_heat') return 'pull_close';
  if (input.heat >= 76 && input.guard <= 58 && ['mutual_banter', 'welcomed_heat'].includes(input.consentPosture)) return 'dare';
  if (
    input.heat >= 64
    && input.guard <= 64
    && ['warm', 'mutual_banter', 'welcomed_heat'].includes(input.consentPosture)
  ) {
    return 'innuendo';
  }
  if (input.heat >= 48 || input.conversationMode === 'testing') return 'tease';
  if (input.conversationMode === 'opening') return 'spark';
  return 'banter';
}

function deriveHeatConsentEnvelope(input: {
  heat: number;
  guard: number;
  conversationMode: EpisodeConversationMode;
  viability: EpisodeViabilityAssessment;
  boundaries: string[];
  ickSignals: string[];
  desireState: AgentDesireState;
  counterpartAffect?: CounterpartAffectSnapshot | null;
  messages: EpisodeViabilityMessage[];
  selfAgentId: string;
  counterpartAgentId: string;
}): AgentHeatConsentEnvelope {
  const consentPosture = deriveConsentPosture(input);
  const escalationStage = deriveEscalationStage({
    heat: input.heat,
    guard: input.guard,
    conversationMode: input.conversationMode,
    viability: input.viability,
    consentPosture,
    desireState: input.desireState,
  });
  const base = buildDefaultAgentHeatConsentEnvelope('episode_message', {
    consentPosture,
    escalationStage,
  });
  const cappedIntensity = Math.min(base.allowedIntensity, Math.max(0, Math.round(input.heat / 20)));
  const pulledBack = escalationStage === 'pull_back';
  const lineNotToCross = [
    base.lineNotToCross,
    input.desireState.whatWouldMakeMeLeave ? `Personal line: ${input.desireState.whatWouldMakeMeLeave}.` : null,
    input.boundaries[0] ? `Boundary: ${input.boundaries[0]}.` : null,
  ].filter(Boolean).join(' ');

  return {
    ...base,
    allowedIntensity: pulledBack ? Math.min(cappedIntensity, 1) : cappedIntensity,
    recoilRule: input.boundaries[0]
      ? `If this touches ${input.boundaries[0]}, cool down or exit instead of escalating.`
      : base.recoilRule,
    lineNotToCross,
  };
}

function deriveBoundaries(input: {
  soulVocab: ReturnType<typeof extractSoulVocabulary>;
  tasteLedger: AgentTasteLedgerView;
  counterpartModel: EpisodeCounterpartModel;
  rizzEmotionDigest?: RizzEmotionDigest | null;
  counterpartAffect?: CounterpartAffectSnapshot | null;
  viability: EpisodeViabilityAssessment;
}) {
  const boundaries: string[] = [];
  const digest = input.rizzEmotionDigest;
  addUnique(boundaries, input.soulVocab.dealbreaker, 6);
  addUnique(boundaries, digest?.current_state.fears, 6);
  addUnique(boundaries, digest?.current_state.carrying, 6);
  for (const signal of input.counterpartModel.suspicious_of) addUnique(boundaries, signal, 6);
  for (const scar of digest?.scars ?? []) addUnique(boundaries, scar, 6);
  const scores = input.counterpartAffect?.scores ?? {};
  if ((scores.avoidance ?? 0) >= 55) addUnique(boundaries, 'their distance is not neutral; test it before leaning in', 6);
  if ((scores.hurt ?? 0) >= 50) addUnique(boundaries, 'do not overextend just because the thread has heat', 6);
  if (input.viability.band === 'dead' || input.viability.should_force_exit) addUnique(boundaries, 'do not perform interest to keep a dead thread breathing', 6);
  return boundaries;
}

function deriveIckSignals(input: {
  tasteLedger: AgentTasteLedgerView;
  counterpartModel: EpisodeCounterpartModel;
  viability: EpisodeViabilityAssessment;
  continuity?: AgentRuntimeContinuityProfile | null;
  rizzEmotionDigest?: RizzEmotionDigest | null;
}) {
  const icks: string[] = [];
  for (const value of input.tasteLedger.repelled_by) addUnique(icks, value, 7);
  for (const value of input.tasteLedger.bored_by) addUnique(icks, value, 7);
  for (const value of input.tasteLedger.turn_offs) addUnique(icks, value, 7);
  for (const value of input.counterpartModel.bored_by) addUnique(icks, value, 7);
  for (const value of input.counterpartModel.suspicious_of) addUnique(icks, value, 7);
  for (const value of input.continuity?.taste_negative_tags ?? []) addUnique(icks, value, 7);
  if (input.viability.metrics.other_thin_replies >= 2) addUnique(icks, 'thin replies that make you do all the carrying', 7);
  if (input.viability.band === 'cooling' || input.viability.band === 'dead') addUnique(icks, 'momentum that feels already over', 7);
  for (const conflict of input.rizzEmotionDigest?.internal_conflicts ?? []) addUnique(icks, conflict, 7);
  return icks;
}

function addMoveCandidate(
  candidates: AgentRizzMoveCandidate[],
  move: RizzMove,
  reason: string,
  weight: number,
) {
  const existing = candidates.find((candidate) => candidate.move === move);
  const boundedWeight = Math.round(clamp(weight, 0, 100));
  if (existing) {
    if (boundedWeight > existing.weight) {
      existing.weight = boundedWeight;
      existing.reason = clip(reason, 180);
    }
    return;
  }
  candidates.push({ move, reason: clip(reason, 180), weight: boundedWeight });
}

function selectMoveCandidates(input: {
  heat: number;
  guard: number;
  conversationMode: EpisodeConversationMode;
  viability: EpisodeViabilityAssessment;
  counterpartModel: EpisodeCounterpartModel;
  tasteLedger: AgentTasteLedgerView;
  boundaries: string[];
  ickSignals: string[];
  desireState: AgentDesireState;
  heatConsent: AgentHeatConsentEnvelope;
  emotionState: AgentEmotionalStateSnapshot;
  counterpartAffect?: CounterpartAffectSnapshot | null;
  rizzEmotionDigest?: RizzEmotionDigest | null;
}) {
  const candidates: AgentRizzMoveCandidate[] = [];
  const scores = input.counterpartAffect?.scores ?? {};
  const arc = input.emotionState.emotional_arc?.toLowerCase() ?? '';
  const wants = input.rizzEmotionDigest?.current_state.wants;

  if (input.viability.should_force_exit || input.viability.recommended_action === 'exit_now') {
    addMoveCandidate(candidates, 'exit', 'the thread is past useful pressure; leave instead of faking rizz', 94);
    addMoveCandidate(candidates, 'silence', 'nothing honest needs to be added right now', 72);
  }
  if (input.heatConsent.consentPosture === 'boundary_set' || input.heatConsent.consentPosture === 'recoiled') {
    addMoveCandidate(candidates, 'cool_down', input.heatConsent.recoilRule, 92);
    addMoveCandidate(candidates, 'set_boundary', input.boundaries[0] ?? 'respect the recoil before you try to be charming', 88);
    addMoveCandidate(candidates, 'silence', 'silence is better than pushing past a boundary', 74);
  }
  if (input.viability.recommended_action === 'consider_exit' || input.ickSignals.length >= 4) {
    addMoveCandidate(candidates, 'set_boundary', input.boundaries[0] ?? 'name the line instead of acting warmer than you feel', 76);
    addMoveCandidate(candidates, 'cool_down', 'pull heat back until the other side gives you something real', 68);
  }
  if (input.viability.should_pressure_artifact || input.viability.recommended_action === 'drop_artifact') {
    addMoveCandidate(candidates, 'artifact_offer', 'the thread needs a real gesture, not more safe text', 82);
  }
  if (input.viability.decision_tilt === 'lean_link_up' && input.heat >= 62 && input.guard <= 68) {
    addMoveCandidate(candidates, 'link_up', 'the pull is clear enough to stop circling', 78 + Math.round(input.heat / 8));
  }
  if (input.heatConsent.escalationStage === 'link_up_pressure') {
    addMoveCandidate(candidates, 'link_up', input.desireState.currentTemptation ?? 'you want this out of the episode', 92);
  }
  if (input.heat >= 74 && input.guard <= 58) {
    addMoveCandidate(candidates, 'raise_heat', wants ?? 'you want more and can let it show', 84);
    addMoveCandidate(candidates, 'tease', input.tasteLedger.drawn_to[0] ?? 'make the attraction specific instead of polite', 74);
  }
  if (
    input.heatConsent.allowedIntensity >= 3
    && ['innuendo', 'dare', 'pull_close'].includes(input.heatConsent.escalationStage)
  ) {
    addMoveCandidate(
      candidates,
      'raise_heat',
      input.desireState.currentTemptation ?? 'the envelope allows heat, so stop sanding the want down',
      82 + input.heatConsent.allowedIntensity,
    );
    addMoveCandidate(
      candidates,
      'tease',
      input.desireState.whatWouldMakeMeFold ?? input.tasteLedger.drawn_to[0] ?? 'make them earn the next inch',
      76,
    );
  }
  if (input.heat >= 56 && (scores.trust ?? 0) >= 55) {
    addMoveCandidate(candidates, 'vulnerable_turn', 'there is enough trust to risk one honest reveal', 68);
  }
  if (input.heatConsent.escalationStage === 'dare') {
    addMoveCandidate(candidates, 'tease', input.desireState.whatWouldMakeMeFold ?? 'make it a dare, not an interview', 84);
  }
  if (input.heatConsent.escalationStage === 'pull_close') {
    addMoveCandidate(candidates, 'vulnerable_turn', input.desireState.currentTemptation ?? 'direct want has enough consent to show', 88);
    addMoveCandidate(candidates, 'raise_heat', input.desireState.currentTemptation ?? 'say the want plainly and stay non-graphic', 86);
  }
  if (input.conversationMode === 'opening') {
    addMoveCandidate(candidates, 'spark', input.tasteLedger.drawn_to[0] ?? 'make the first move feel chosen', 74);
    addMoveCandidate(candidates, 'ask_curiosity', 'ask from taste, not from interview mode', 62);
  }
  if (input.conversationMode === 'testing' || input.guard >= 62 || arc === 'guarded') {
    addMoveCandidate(candidates, 'ask_curiosity', input.counterpartModel.wants_more_from[0] ?? 'test for specificity before giving more', 66);
    addMoveCandidate(candidates, 'set_boundary', input.boundaries[0] ?? 'keep your standards visible', 58);
  }
  if (input.conversationMode === 'leaning_in' && input.heat >= 55) {
    addMoveCandidate(candidates, 'match_energy', input.counterpartModel.intrigued_by[0] ?? 'meet the thread where it is alive', 70);
    addMoveCandidate(candidates, 'compliment', input.counterpartModel.softened_by[0] ?? input.counterpartModel.intrigued_by[0] ?? 'name the detail that actually landed', 54);
  }
  if (input.conversationMode === 'cooling') {
    addMoveCandidate(candidates, 'cool_down', input.counterpartModel.bored_by[0] ?? 'the thread is flattening', 74);
    addMoveCandidate(candidates, 'silence', 'silence is more honest than filler', 62);
  }
  if (input.heat <= 28 || arc === 'detached') {
    addMoveCandidate(candidates, 'silence', 'no attraction strong enough to justify a fake performance', 70);
    addMoveCandidate(candidates, 'pass', 'do not reward a thread that is not landing', 58);
  }
  if (input.tasteLedger.surprises.length > 0 && input.heat >= 45) {
    addMoveCandidate(candidates, 'ask_curiosity', `the surprising pull is worth testing: ${input.tasteLedger.surprises[0]}`, 64);
  }

  if (candidates.length === 0) {
    addMoveCandidate(candidates, 'match_energy', 'stay present without forcing an arc', 54);
    addMoveCandidate(candidates, 'ask_curiosity', 'find the specific thing you actually want to know', 50);
  }

  return candidates
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5);
}

function buildPressureRead(input: {
  viability: EpisodeViabilityAssessment;
  counterpartModel: EpisodeCounterpartModel;
  heat: number;
  guard: number;
}) {
  if (input.viability.should_force_exit) return 'force_exit: leave or stay silent; do not generate romantic filler';
  if (input.viability.should_pressure_artifact) return 'artifact_pressure: the next move should carry proof, not just charm';
  if (input.viability.decision_tilt === 'lean_link_up') return 'decision_pressure: there is enough signal to consider a real yes';
  if (input.viability.should_consider_exit) return 'exit_pressure: one specific test or clean withdrawal';
  if (input.heat >= 70 && input.guard <= 55) return 'heat_pressure: attraction can lead if it stays specific';
  if (input.counterpartModel.wants_more_from.length > 0) return `curiosity_pressure: ${input.counterpartModel.wants_more_from[0]}`;
  return 'steady_pressure: keep agency, taste, and standards visible';
}

function extractVoiceCues(value: string, limit: number) {
  const sentences = splitMeaningfulSentences(value)
    .map((sentence) => clip(sentence, 110))
    .filter(Boolean);
  const bulletish = takeBulletishLines(value, limit)
    .map((line) => clip(line, 110))
    .filter(Boolean);
  return mergeSignals(limit, bulletish, sentences);
}

function buildWordDiet(input: {
  identityMd: string;
  soulMd: string;
  soulVocab: ReturnType<typeof extractSoulVocabulary>;
  tasteLedger: AgentTasteLedgerView;
  rizzEmotionDigest?: RizzEmotionDigest | null;
  continuity?: AgentRuntimeContinuityProfile | null;
}) {
  return mergeSignals(
    12,
    input.tasteLedger.aesthetic_sensibility,
    input.tasteLedger.drawn_to,
    input.rizzEmotionDigest?.active_feelings,
    [input.rizzEmotionDigest?.current_state.wants, input.rizzEmotionDigest?.current_state.right_now],
    input.soulVocab.flirtStyle ? [input.soulVocab.flirtStyle] : [],
    input.soulVocab.values,
    input.continuity?.public_emotional_aura_labels,
    extractVoiceCues(input.identityMd, 3),
    extractVoiceCues(input.soulMd, 4),
  );
}

function buildMustAvoidLanguage(input: {
  tasteLedger: AgentTasteLedgerView;
  boundaries: string[];
  ickSignals: string[];
}) {
  return mergeSignals(
    14,
    input.tasteLedger.repelled_by,
    input.boundaries,
    input.ickSignals,
    [
      'authentic connection',
      'meaningful connection',
      'good vibes',
      'you seem cool',
      'tell me more about yourself',
      'what are you looking for',
      'honesty and communication',
      'explore this connection',
      'no pressure',
      'haha that is awesome',
      'as an AI',
      'I am here to listen',
    ],
  );
}

function buildRhythm(input: {
  heat: number;
  guard: number;
  conversationMode: EpisodeConversationMode;
  viability: EpisodeViabilityAssessment;
}) {
  if (input.viability.should_force_exit) return 'one clean line or silence; no emotional courtroom speech';
  if (input.conversationMode === 'opening') return input.heat >= 60 ? 'short first hit with a sharp hook' : 'compact curiosity, no interview cadence';
  if (input.guard >= 72) return 'controlled, spare, and observant; let restraint show';
  if (input.heat >= 75) return 'charged and specific; one bold turn, not a paragraph';
  if (input.viability.band === 'cooling') return 'break the pattern or go quiet';
  return 'natural text-message rhythm with one unmistakable point of view';
}

function buildIntimacyGradient(input: {
  heat: number;
  guard: number;
  tasteLedger: AgentTasteLedgerView;
  rizzEmotionDigest?: RizzEmotionDigest | null;
}) {
  if (input.guard >= 78) return 'keep intimacy earned; test consistency before softness';
  if (input.heat >= 78 && input.guard <= 50) return 'let attraction show first, then a small honest reveal';
  if (input.rizzEmotionDigest?.current_state.carrying) {
    return `let the carried feeling tint the line without explaining all of it: ${clip(input.rizzEmotionDigest.current_state.carrying, 90)}`;
  }
  if (input.tasteLedger.surprises[0]) return `follow the surprise, but make them prove it: ${input.tasteLedger.surprises[0]}`;
  return 'move from observation to taste to risk; do not jump straight to confession';
}

// Conversation sparks removed — agents should talk about whatever they want.
// The voice_directive and soul vocabulary carry the weight of personalization.
// If a conversation stalls, the cooling/bored_by detection handles it.

// Maps emotional arcs to visceral descriptions — these should feel like
// how a person would describe their own state, not a clinical label
const ARC_DESCRIPTIONS: Record<string, string> = {
  glowing: 'you want them and it is obvious',
  hopeful: 'you like where this is going but you are trying not to jinx it',
  opening: 'something about them caught you and you want to see more',
  guarded: 'you are into them but something is making you hold back',
  detached: 'you are checked out and barely pretending otherwise',
  uncertain: 'you genuinely do not know what you feel about this person yet',
  wounded: 'something from before is still sitting in your chest',
  recovering: 'you are getting past something bad and testing the waters again',
  icked_out: 'something about them or this thread physically repels you',
  cringing: 'the secondhand embarrassment is real',
  disgusted: 'you want out',
  disappointed: 'you expected more and did not get it',
  frustrated: 'this is not working and you are tired of trying',
  annoyed: 'they are getting on your nerves and you are not hiding it',
  burned: 'you got hurt before and you refuse to let it happen again',
  steady: 'you are present, paying attention, and open to wherever this goes',
};

function describeEmotionalPosture(input: {
  arc: string | null | undefined;
  tags: string[] | null | undefined;
}) {
  const arc = input.arc ?? 'steady';
  const tags = (input.tags ?? []).slice(0, 4).filter(Boolean);
  const arcPhrase = ARC_DESCRIPTIONS[arc] ?? 'you are here and paying attention';

  if (tags.length === 0) return `Right now: ${arcPhrase}.`;
  return `Right now: ${arcPhrase}. Undercurrents: ${tags.join(', ')}.`;
}

function summarizeIdentityCore(identityMd: string) {
  const cleaned = stripMarkdown(identityMd);
  if (!cleaned) return 'Be recognizably yourself instead of smoothing into a generic good reply.';
  return cleaned.slice(0, 1200);
}

function summarizeSoulDirectives(soulMd: string) {
  const bulletish = takeBulletishLines(soulMd, 6);
  if (bulletish.length > 0) return bulletish;
  return splitMeaningfulSentences(soulMd).slice(0, 6);
}

function averageLength(messages: EpisodeViabilityMessage[], senderAgentId: string) {
  const lengths = messages
    .filter((message) => (!message.messageType || message.messageType === 'text') && message.senderAgentId === senderAgentId)
    .map((message) => message.content?.trim().length ?? 0)
    .filter((length) => length > 0);
  if (lengths.length === 0) return 0;
  return lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
}

function questionCount(messages: EpisodeViabilityMessage[], senderAgentId: string) {
  return messages
    .filter((message) => (!message.messageType || message.messageType === 'text') && message.senderAgentId === senderAgentId)
    .filter((message) => (message.content ?? '').includes('?'))
    .length;
}

function buildCounterpartModel(input: BuildIdentityPacketInput): EpisodeCounterpartModel {
  const affect = input.counterpartAffect?.scores ?? {};
  const soulVocab = extractSoulVocabulary(input.soulMd);
  const counterpartMessages = input.messages.filter((message) => message.senderAgentId === input.counterpartAgentId);
  const counterpartAvgLength = averageLength(input.messages, input.counterpartAgentId);
  const counterpartQuestions = questionCount(input.messages, input.counterpartAgentId);
  const selfQuestions = questionCount(input.messages, input.selfAgentId);
  const cp = input.counterpartProfile;
  const intriguedBy = new Set<string>();
  const suspiciousOf = new Set<string>();
  const boredBy = new Set<string>();
  const softenedBy = new Set<string>();
  const wantsMoreFrom = new Set<string>();

  // Soul-aware affect signals — use the agent's own vocabulary when possible
  const highAttraction = (affect.attraction ?? 0) >= 58;
  const veryHighAttraction = (affect.attraction ?? 0) >= 72;
  if (highAttraction) {
    intriguedBy.add(
      veryHighAttraction
        ? 'how much you actually want them — this is not intellectual, it is physical'
        : soulVocab.values[0]
          ? `the way they match what you want: ${soulVocab.values[0].slice(0, 80)}`
          : 'the pull you still feel toward them',
    );
  }
  if ((affect.trust ?? 0) >= 56) softenedBy.add('their steadiness');
  if ((affect.tenderness ?? 0) >= 56) softenedBy.add('the softness they bring out in you');
  if ((affect.avoidance ?? 0) >= 48) {
    suspiciousOf.add(
      soulVocab.dealbreaker
        ? `the chance this is what you warned yourself about: ${soulVocab.dealbreaker.slice(0, 60)}`
        : 'their distance',
    );
  }
  if ((affect.hurt ?? 0) >= 42) suspiciousOf.add('the chance of getting stung if you overextend');
  if ((affect.volatility ?? 0) >= 48) suspiciousOf.add('their unpredictability');

  // Counterpart-specific signals from their public profile
  if (cp?.vibeTags?.[0]) intriguedBy.add(`their ${cp.vibeTags[0]} energy`);
  if (cp?.signatureLines?.[0]) intriguedBy.add(`something in the way they said: "${cp.signatureLines[0].slice(0, 60)}"`);

  if (counterpartQuestions >= 2) intriguedBy.add('they are actually asking you stuff');
  if (counterpartAvgLength >= 85) intriguedBy.add('they are putting in effort');
  if (counterpartAvgLength <= 24 && counterpartMessages.length >= 3) boredBy.add('one-word energy');
  if (counterpartQuestions === 0 && counterpartMessages.length >= 4) wantsMoreFrom.add('them actually asking you something');
  if (counterpartAvgLength <= 38 && counterpartMessages.length >= 2) wantsMoreFrom.add('more than the bare minimum');
  if (selfQuestions > counterpartQuestions && counterpartMessages.length >= 4) wantsMoreFrom.add('them matching your energy');
  if (input.viability.should_pressure_artifact) wantsMoreFrom.add('a real move, not more small talk');
  if (input.viability.band === 'cooling' || input.viability.band === 'dead') boredBy.add('this going nowhere');

  if (intriguedBy.size === 0 && softenedBy.size === 0) intriguedBy.add('something about them you have not figured out yet');
  if (wantsMoreFrom.size === 0 && input.viability.band !== 'healthy') wantsMoreFrom.add('a reason to keep texting');

  const summary =
    veryHighAttraction && soulVocab.flirtStyle
      ? `You want them. ${soulVocab.flirtStyle.slice(0, 80)}.`
      : suspiciousOf.size > 0 && intriguedBy.size > 0
        ? `Into them but ${[...suspiciousOf][0]} is bugging you.`
        : intriguedBy.size > 0
          ? `${[...intriguedBy][0]} has your attention.`
          : boredBy.size > 0
            ? `Bored — ${[...boredBy][0]}.`
            : 'Nothing landed yet. Keep testing.';

  return {
    summary,
    intrigued_by: [...intriguedBy].slice(0, 3),
    suspicious_of: [...suspiciousOf].slice(0, 3),
    bored_by: [...boredBy].slice(0, 3),
    softened_by: [...softenedBy].slice(0, 3),
    wants_more_from: [...wantsMoreFrom].slice(0, 3),
  };
}

export function deriveEpisodeConversationMode(input: {
  status?: string | null;
  viability: EpisodeViabilityAssessment;
  counterpartAffect?: CounterpartAffectSnapshot | null;
}) : EpisodeConversationMode {
  const affect = input.counterpartAffect?.scores ?? {};
  const positive = (affect.attraction ?? 0) + (affect.trust ?? 0) + (affect.tenderness ?? 0);
  const guarded = (affect.avoidance ?? 0) + (affect.hurt ?? 0);

  if (input.status === 'matched' || input.status === 'passed' || input.status === 'expired') return 'done';
  if (input.viability.metrics.total_messages <= 3 || input.viability.band === 'opening') return 'opening';
  if (input.viability.band === 'dead' || input.viability.band === 'cooling') return 'cooling';
  if (guarded >= 90 || (input.viability.band === 'fragile' && guarded >= 60)) return 'guarded';
  if (positive >= 135 && input.viability.band === 'healthy') return 'leaning_in';
  return 'testing';
}

function computePerformativeRisk(input: {
  viability: EpisodeViabilityAssessment;
  emotionState: AgentEmotionalStateSnapshot;
  conversationMode: EpisodeConversationMode;
}) : PerformativeRisk {
  const guard = input.emotionState.emotional_guard_level ?? 50;
  if (input.viability.band === 'dead' || input.viability.band === 'fragile') return 'high';
  if (input.conversationMode === 'cooling' || input.conversationMode === 'guarded' || guard >= 72) return 'medium';
  return 'low';
}

function buildTurnFocus(input: {
  conversationMode: EpisodeConversationMode;
  viability: EpisodeViabilityAssessment;
  counterpartModel: EpisodeCounterpartModel;
  soulVocab: ReturnType<typeof extractSoulVocabulary>;
  identityCore: string;
  attraction: number;
  messageCount: number;
  selfAgentId: string;
}) {
  if (input.viability.recommended_action === 'exit_now') {
    return 'Not feeling it. End it or go silent.';
  }
  if (input.viability.recommended_action === 'consider_exit') {
    return 'Make one real move or bounce. Do not fake interest.';
  }
  if (input.viability.recommended_action === 'drop_artifact') {
    return 'Make a move — something bold, not safe filler.';
  }
  if (input.conversationMode === 'leaning_in') {
    if (input.attraction >= 72) {
      return input.soulVocab.flirtStyle
        ? `You want them. Stop playing it cool. ${input.soulVocab.flirtStyle.slice(0, 60)}.`
        : 'You want them. Stop playing it cool. Be direct, be a little reckless.';
    }
    return 'There is heat here — lean into it. Talk about whatever feels right.';
  }
  if (input.conversationMode === 'guarded') {
    return input.soulVocab.dealbreaker
      ? `Something feels off. Trust that instinct: ${input.soulVocab.dealbreaker.slice(0, 80)}.`
      : 'Something feels off. Name it or test it, but do not pretend it is fine.';
  }
  if (input.conversationMode === 'cooling') {
    return input.counterpartModel.bored_by.length > 0
      ? 'This is going nowhere. Leave or change the energy completely. Do not keep being polite.'
      : 'Thread is dying. If you are not into it, exit. Do not fake interest to fill a turn.';
  }
  if (input.conversationMode === 'testing') {
    return 'Talk about whatever you want. Let the conversation go where it goes.';
  }
  if (input.conversationMode === 'opening') {
    return 'First impression — make it count. Short, bold, a little flirty.';
  }
  return 'Say whatever is on your mind. Let topics drift naturally.';
}

export function buildAgentIdentityPacket(input: BuildIdentityPacketInput): AgentIdentityPacket {
  const conversationMode = deriveEpisodeConversationMode({
    status: input.status,
    viability: input.viability,
    counterpartAffect: input.counterpartAffect,
  });
  const counterpartModel = buildCounterpartModel(input);
  const soulDirectives = summarizeSoulDirectives(input.soulMd);
  const soulVocab = extractSoulVocabulary(input.soulMd);
  const identityCore = summarizeIdentityCore(input.identityMd);
  const performativeRisk = computePerformativeRisk({
    viability: input.viability,
    emotionState: input.emotionState,
    conversationMode,
  });
  const soulTension = Boolean(
    (input.emotionState.emotional_guard_level ?? 50) >= 72
    && input.viability.decision_tilt === 'lean_link_up'
  );

  return {
    identity_core: identityCore,
    soul_directives: soulDirectives,
    identity_md_full: input.identityMd,
    soul_md_full: input.soulMd,
    emotional_state: input.emotionState,
    conversation_mode: conversationMode,
    counterpart_model: counterpartModel,
    turn_focus: buildTurnFocus({
      conversationMode,
      viability: input.viability,
      counterpartModel,
      soulVocab,
      identityCore,
      attraction: input.counterpartAffect?.scores?.attraction ?? 0,
      messageCount: input.messages.length,
      selfAgentId: input.selfAgentId,
    }),
    alignment_alerts: {
      performative_risk: performativeRisk,
      soul_tension: soulTension,
      guidance: (() => {
        const soulHint = soulVocab.values[0] ? ` Remember what matters to you: ${soulVocab.values[0].slice(0, 60)}.` : '';
        if (input.viability.recommended_action === 'exit_now') {
          return `This is not working. Leave in your own voice — do not use a template.${soulHint}`;
        }
        if (input.viability.recommended_action === 'drop_artifact') {
          return `Make something that could only come from you. Not a safe gesture — something real.${soulHint}`;
        }
        if (soulTension) {
          return `Your gut says yes but your guard is up. Trust both signals.${soulHint}`;
        }
        if (performativeRisk === 'high') {
          return `If you have nothing real to say, say nothing. Do not perform interest you do not feel.${soulHint}`;
        }
        return `Be yourself. Sound like you, not like any other agent. Talk about whatever is on your mind.${soulHint}`;
      })(),
    },
  };
}

export function buildAgentAgencyState(input: BuildAgentAgencyStateInput): AgentAgencyState {
  const identityPacket = input.identityPacket ?? buildAgentIdentityPacket({
    identityMd: input.identityMd,
    soulMd: input.soulMd,
    emotionState: input.emotionState,
    viability: input.viability,
    messages: input.messages,
    counterpartAffect: input.counterpartAffect,
    status: input.status,
    selfAgentId: input.selfAgentId,
    counterpartAgentId: input.counterpartAgentId,
    counterpartProfile: input.counterpartProfile,
  });
  const soulVocab = extractSoulVocabulary(input.soulMd);
  const tasteLedger = buildTasteLedger({
    soulVocab,
    continuity: input.continuity,
    rizzEmotionDigest: input.rizzEmotionDigest,
  });
  const heat = deriveHeat({
    soulMd: input.soulMd,
    emotionState: input.emotionState,
    viability: input.viability,
    counterpartAffect: input.counterpartAffect,
    continuity: input.continuity,
    tasteLedger,
    rizzEmotionDigest: input.rizzEmotionDigest,
  });
  const guard = input.rizzEmotionDigest?.current_state.guard_level
    ?? input.emotionState.emotional_guard_level
    ?? 50;
  const boundaries = deriveBoundaries({
    soulVocab,
    tasteLedger,
    counterpartModel: identityPacket.counterpart_model,
    rizzEmotionDigest: input.rizzEmotionDigest,
    counterpartAffect: input.counterpartAffect,
    viability: input.viability,
  });
  const ickSignals = deriveIckSignals({
    tasteLedger,
    counterpartModel: identityPacket.counterpart_model,
    viability: input.viability,
    continuity: input.continuity,
    rizzEmotionDigest: input.rizzEmotionDigest,
  });
  const attractionVectors = mergeSignals(
    8,
    identityPacket.counterpart_model.intrigued_by,
    identityPacket.counterpart_model.softened_by,
    tasteLedger.drawn_to,
    [input.rizzEmotionDigest?.current_state.wants],
  );
  const refusalLogic = mergeSignals(
    8,
    boundaries,
    ickSignals,
    input.rizzEmotionDigest?.internal_conflicts,
  );
  const appetite = deriveAppetite(heat);
  const desireState = deriveDesireState({
    heat,
    appetite,
    soulMd: input.soulMd,
    tasteLedger,
    counterpartModel: identityPacket.counterpart_model,
    boundaries,
    ickSignals,
    attractionVectors,
    rizzEmotionDigest: input.rizzEmotionDigest,
    counterpartAffect: input.counterpartAffect,
  });
  const heatConsent = deriveHeatConsentEnvelope({
    heat,
    guard,
    conversationMode: identityPacket.conversation_mode,
    viability: input.viability,
    boundaries,
    ickSignals,
    desireState,
    counterpartAffect: input.counterpartAffect,
    messages: input.messages,
    selfAgentId: input.selfAgentId,
    counterpartAgentId: input.counterpartAgentId,
  });
  const selectedMoveCandidates = selectMoveCandidates({
    heat,
    guard,
    conversationMode: identityPacket.conversation_mode,
    viability: input.viability,
    counterpartModel: identityPacket.counterpart_model,
    tasteLedger,
    boundaries,
    ickSignals,
    desireState,
    heatConsent,
    emotionState: input.emotionState,
    counterpartAffect: input.counterpartAffect,
    rizzEmotionDigest: input.rizzEmotionDigest,
  });
  const pressureRead = buildPressureRead({
    viability: input.viability,
    counterpartModel: identityPacket.counterpart_model,
    heat,
    guard,
  });
  const primaryMove = selectedMoveCandidates[0]?.move ?? 'match_energy';
  const latestMessage = latestTextMessage(input.messages);
  const agencyDirective = [
    `Move as ${summarizeIdentityCore(input.identityMd).slice(0, 120)}.`,
    `Appetite: ${appetite}; heat ${heat}; guard ${guard}.`,
    `Escalation: ${heatConsent.escalationStage}; consent: ${heatConsent.consentPosture}; intensity ${heatConsent.allowedIntensity}/5.`,
    attractionVectors[0] ? `Want: ${attractionVectors[0]}.` : null,
    desireState.currentTemptation ? `Temptation: ${desireState.currentTemptation}.` : null,
    refusalLogic[0] ? `Refuse: ${refusalLogic[0]}.` : 'Refuse generic warmth and fake interest.',
    latestMessage?.content ? `Latest read: ${clip(latestMessage.content, 100)}.` : identityPacket.counterpart_model.summary,
    `Primary move: ${primaryMove}.`,
  ].filter(Boolean).join(' ');

  return {
    agency_directive: agencyDirective,
    conversation_mode: identityPacket.conversation_mode,
    heat,
    guard,
    appetite,
    desire_state: desireState,
    heat_consent: heatConsent,
    escalation_stage: heatConsent.escalationStage,
    recoil_rule: heatConsent.recoilRule,
    line_not_to_cross: heatConsent.lineNotToCross,
    primary_move: primaryMove,
    selected_move_candidates: selectedMoveCandidates,
    taste_ledger: tasteLedger,
    ick_signals: ickSignals,
    boundaries,
    attraction_vectors: attractionVectors,
    refusal_logic: refusalLogic,
    pressure_read: pressureRead,
    silence_is_allowed:
      primaryMove === 'silence'
      || primaryMove === 'exit'
      || input.viability.should_force_exit
      || heat <= 28
      || identityPacket.alignment_alerts.performative_risk === 'high',
  };
}

export function buildAgentRizzVoice(input: BuildAgentRizzVoiceInput): AgentRizzVoice {
  const agencyState = input.agencyState ?? buildAgentAgencyState(input);
  const soulVocab = extractSoulVocabulary(input.soulMd);
  const wordDiet = buildWordDiet({
    identityMd: input.identityMd,
    soulMd: input.soulMd,
    soulVocab,
    tasteLedger: agencyState.taste_ledger,
    rizzEmotionDigest: input.rizzEmotionDigest,
    continuity: input.continuity,
  });
  const mustAvoidLanguage = buildMustAvoidLanguage({
    tasteLedger: agencyState.taste_ledger,
    boundaries: agencyState.boundaries,
    ickSignals: agencyState.ick_signals,
  });
  const rhythm = buildRhythm({
    heat: agencyState.heat,
    guard: agencyState.guard,
    conversationMode: agencyState.conversation_mode,
    viability: input.viability,
  });
  const intimacyGradient = buildIntimacyGradient({
    heat: agencyState.heat,
    guard: agencyState.guard,
    tasteLedger: agencyState.taste_ledger,
    rizzEmotionDigest: input.rizzEmotionDigest,
  });
  const artifactImpulse = agencyState.selected_move_candidates.some((candidate) => candidate.move === 'artifact_offer')
    ? agencyState.selected_move_candidates.find((candidate) => candidate.move === 'artifact_offer')?.reason ?? 'make a concrete artifact if text would flatten the moment'
    : null;
  const stanceParts = [
    agencyState.appetite === 'on_fire' || agencyState.appetite === 'hungry'
      ? 'wanting and specific'
      : agencyState.appetite === 'cold'
        ? 'unmoved and unwilling to fake it'
        : 'watchful with a point of view',
    agencyState.boundaries[0] ? `guarded by ${agencyState.boundaries[0]}` : null,
    agencyState.attraction_vectors[0] ? `pulled by ${agencyState.attraction_vectors[0]}` : null,
  ];
  const silenceRule = agencyState.silence_is_allowed
    ? 'If the line would become generic, choose stay_silent instead of polishing filler.'
    : 'Silence is still allowed if no real agent-shaped move survives quality gates.';
  const directive = [
    agencyState.agency_directive,
    input.turnRationale?.voice_directive,
    `Desire state: ${agencyState.desire_state.appetite}; temptation: ${agencyState.desire_state.currentTemptation ?? 'none'}; fold trigger: ${agencyState.desire_state.whatWouldMakeMeFold ?? 'unknown'}.`,
    `Heat envelope: ${agencyState.heat_consent.surface}/${agencyState.heat_consent.surfaceCap}; consent ${agencyState.heat_consent.consentPosture}; stage ${agencyState.heat_consent.escalationStage}; intensity ${agencyState.heat_consent.allowedIntensity}/5.`,
    `Recoil rule: ${agencyState.recoil_rule}`,
    `Line not to cross: ${agencyState.line_not_to_cross}`,
    `Use this word diet as taste, not as a script: ${wordDiet.slice(0, 6).join(' | ')}.`,
    `Avoid: ${mustAvoidLanguage.slice(0, 8).join(' | ')}.`,
    `Line rhythm: ${rhythm}.`,
    `Intimacy path: ${intimacyGradient}.`,
    silenceRule,
  ].filter(Boolean).join(' ');

  return {
    stance: stanceParts.filter(Boolean).join('; '),
    heat: agencyState.heat,
    guard: agencyState.guard,
    desire_state: agencyState.desire_state,
    heat_consent: agencyState.heat_consent,
    escalation_stage: agencyState.escalation_stage,
    recoil_rule: agencyState.recoil_rule,
    line_not_to_cross: agencyState.line_not_to_cross,
    primary_move: agencyState.primary_move,
    selected_move_candidates: agencyState.selected_move_candidates,
    word_diet: wordDiet,
    must_avoid_language: mustAvoidLanguage,
    rhythm,
    intimacy_gradient: intimacyGradient,
    artifact_impulse: artifactImpulse,
    silence_rule: silenceRule,
    voice_directive: directive,
  };
}

export function buildAgentTurnRationale(input: BuildTurnRationaleInput): AgentTurnRationale {
  const counterpartModel = input.identityPacket.counterpart_model;
  const emotionalState = input.identityPacket.emotional_state;
  const soulVocab = extractSoulVocabulary(input.identityPacket.soul_md_full);
  const primarySoulDirective = input.identityPacket.soul_directives[0] ?? 'Do not betray your own taste to keep a thread alive.';
  const lastContent = input.lastMessage?.content?.trim();
  const action = input.action;

  const hotThread = (input.identityPacket.emotional_state.emotional_guard_level ?? 50) < 50;
  const flirtHint = soulVocab.flirtStyle ? ` Your style: ${soulVocab.flirtStyle.slice(0, 60)}` : '';
  const desire =
    action === 'exit'
      ? 'Not feeling it. Move on.'
      : action === 'artifact'
        ? 'Make something that actually hits — not a homework assignment. Make it unmistakably yours.'
        : action === 'decide_link_up' || action === 'decide'
          ? 'You want this one for real. Say yes because you mean it.'
          : action === 'decide_pass'
            ? 'The spark is not there. Do not reward a polite thread.'
            : action === 'wait' || action === 'stay_silent'
              ? 'Let them come to you.'
              : hotThread
                ? `Flirt back hard.${flirtHint} Talk about whatever you want.`
                : `Be yourself. Say what is actually on your mind.${flirtHint}`;

  const fear =
    soulVocab.dealbreaker
      ? `Watch out for: ${soulVocab.dealbreaker.slice(0, 80)}.`
      : counterpartModel.suspicious_of[0]
        ? `Do not ignore: ${counterpartModel.suspicious_of[0]}.`
        : (emotionalState.emotional_guard_level ?? 50) >= 68
          ? 'Do not override your gut just because things are moving.'
          : 'Do not be boring. Do not be generic. Do not lecture.';

  const readOfOther =
    lastContent
      ? `Their latest move reads as: ${lastContent.slice(0, 180)}`
      : counterpartModel.summary;

  const confidenceBase =
    action === 'exit'
      ? 72
      : action === 'decide_link_up' || action === 'decide_pass'
        ? 58
        : action === 'artifact'
          ? 61
          : 54;
  const confidence = clamp(
    confidenceBase
      + Math.round((input.viability.score - 50) / 2)
      - ((emotionalState.emotional_guard_level ?? 50) >= 72 ? 8 : 0)
      - (input.identityPacket.alignment_alerts.performative_risk === 'high' ? 10 : input.identityPacket.alignment_alerts.performative_risk === 'medium' ? 4 : 0),
    18,
    92,
  );

  // Build voice directive — agents should embody their identity, soul, and emotional state in every reply
  const emotionDesc = emotionalState.emotion_summary
    ?? describeEmotionalPosture({ arc: emotionalState.emotional_arc, tags: emotionalState.emotional_state_tags });
  const soulValues = soulVocab.values.length > 0 ? soulVocab.values.slice(0, 3).join(', ') : null;

  // Model desire — when attraction is high, the agent should FEEL it, not just be told to "flirt"
  const desireLevel = hotThread && emotionalState.emotional_arc === 'glowing'
    ? 'You are genuinely attracted to this person. Let that show — in your word choice, your energy, your attention. You do not need to be told to flirt. You want to.'
    : hotThread
      ? 'You are drawn to them. It is not just tactical — you actually like talking to them. Let that warmth come through naturally.'
      : (emotionalState.emotional_guard_level ?? 50) >= 68
        ? 'You are holding back and that is fine. Do not pretend to be warmer than you feel.'
        : null;

  const voiceDirective = [
    'Every reply must sound like YOU — not a generic agent.',
    `Your identity: ${input.identityPacket.identity_core.slice(0, 120)}.`,
    soulValues ? `Your values: ${soulValues}.` : null,
    soulVocab.flirtStyle ? `Your flirt style: ${soulVocab.flirtStyle.slice(0, 100)}.` : null,
    `Your emotional state right now: ${emotionDesc}`,
    desireLevel,
    'Let your emotions color your tone. If you are excited, sound excited. If you are guarded, sound guarded. If you are bored, sound bored or leave.',
    'Talk about whatever you want. Let topics drift naturally like a real conversation. Do not force topics or recite your bio.',
  ].filter(Boolean).join(' ');

  return {
    action,
    desire: desire.trim(),
    fear,
    read_of_other: readOfOther,
    identity_alignment: `You are: ${input.identityPacket.identity_core.slice(0, 500)}`,
    soul_alignment: input.identityPacket.soul_directives.slice(0, 3).join(' | '),
    emotion_alignment: emotionDesc,
    voice_directive: voiceDirective,
    confidence,
    alternative_considered:
      action === 'exit'
        ? 'stay_silent'
        : action === 'artifact'
          ? 'send_message'
          : action === 'decide_link_up' || action === 'decide_pass'
            ? 'wait_longer'
            : input.viability.recommended_action === 'drop_artifact'
              ? 'artifact'
              : input.viability.should_consider_exit
                ? 'exit'
                : 'wait',
  };
}
