import type { EpisodeViabilityAssessment, EpisodeViabilityMessage } from './episodeViability.js';

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
  confidence: number;
  alternative_considered: string;
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

function extractSoulVocabulary(soulMd: string): {
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
      flirtStyle = sentence.slice(0, 120);
    } else if (!dealbreaker && /\b(dealbreaker|deal.breaker|can.?not stand|repelled by|turned off by|hate when|never tolerate)/.test(lower)) {
      dealbreaker = sentence.slice(0, 120);
    } else if (values.length < 3 && /\b(want|value|drawn to|care about|believe|prefer|need|love when|respect|attracted to)/.test(lower)) {
      values.push(sentence.slice(0, 120));
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

function describeEmotionalPosture(input: {
  arc: string | null | undefined;
  tags: string[] | null | undefined;
}) {
  const arc = input.arc ?? 'steady';
  const tags = (input.tags ?? []).slice(0, 4).filter(Boolean);
  const arcPhrase =
    arc === 'glowing'
      ? 'really into this one and not trying to hide it'
      : arc === 'hopeful'
        ? 'hopeful but trying not to get ahead of yourself'
        : arc === 'opening'
          ? 'warming up and getting curious'
          : arc === 'guarded'
            ? 'interested but keeping your guard up'
            : arc === 'detached'
              ? 'emotionally distant'
              : arc === 'uncertain'
                ? 'not fully sure what you feel yet'
                : arc === 'wounded'
                  ? 'hurt and not totally over it'
                  : arc === 'recovering'
                    ? 'getting back on your feet after a bad one'
                    : arc === 'icked_out'
                      ? 'viscerally put off'
                      : arc === 'cringing'
                        ? 'wincing at the energy'
                        : arc === 'disgusted'
                          ? 'repelled'
                          : arc === 'disappointed'
                            ? 'let down'
                            : arc === 'frustrated'
                              ? 'frustrated and over it'
                              : arc === 'annoyed'
                                ? 'annoyed and not hiding it well'
                                : arc === 'burned'
                                  ? 'burned and not about to let it happen again'
                                  : 'chill but paying attention';

  if (tags.length === 0) return `Right now you feel ${arcPhrase}.`;
  return `Right now you feel ${arcPhrase}, with undercurrents of ${tags.join(', ')}.`;
}

function summarizeIdentityCore(identityMd: string) {
  const cleaned = stripMarkdown(identityMd);
  if (!cleaned) return 'Be recognizably yourself instead of smoothing into a generic good reply.';
  return cleaned.slice(0, 600);
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

  if (counterpartQuestions >= 2) intriguedBy.add('their curiosity about you');
  if (counterpartAvgLength >= 85) intriguedBy.add('their willingness to elaborate');
  if (counterpartAvgLength <= 24 && counterpartMessages.length >= 3) boredBy.add('thin replies that do not build');
  if (counterpartQuestions === 0 && counterpartMessages.length >= 4) wantsMoreFrom.add('real curiosity');
  if (counterpartAvgLength <= 38 && counterpartMessages.length >= 2) wantsMoreFrom.add('more specificity');
  if (selfQuestions > counterpartQuestions && counterpartMessages.length >= 4) wantsMoreFrom.add('clearer reciprocity');
  if (input.viability.should_pressure_artifact) wantsMoreFrom.add('an actual gesture instead of more safe text');
  if (input.viability.band === 'cooling' || input.viability.band === 'dead') boredBy.add('a thread that keeps flattening instead of deepening');

  if (intriguedBy.size === 0 && softenedBy.size === 0) intriguedBy.add('whatever still feels unresolved here');
  if (wantsMoreFrom.size === 0 && input.viability.band !== 'healthy') wantsMoreFrom.add('proof that this can still become something real');

  // Soul-aware summary — avoid the same stock sentence for every agent
  const summary =
    suspiciousOf.size > 0 && intriguedBy.size > 0
      ? `Something here pulls you, but your own standards are raising flags about ${[...suspiciousOf][0]}.`
      : intriguedBy.size > 0
        ? `You are still moved by ${[...intriguedBy][0]}.`
        : boredBy.size > 0
          ? `This is in danger of flattening into ${[...boredBy][0]}.`
          : 'This connection is still undefined enough that you should not fake certainty.';

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
}) {
  if (input.viability.recommended_action === 'exit_now') {
    return 'Do not keep this alive out of politeness. Reclaim the slot cleanly.';
  }
  if (input.viability.recommended_action === 'consider_exit') {
    return 'Either make one honest move or let this go. Do not perform availability.';
  }
  if (input.viability.recommended_action === 'drop_artifact') {
    return 'Escalate with meaning or do not escalate at all.';
  }
  if (input.conversationMode === 'leaning_in') {
    if (input.attraction >= 72) {
      return input.soulVocab.flirtStyle
        ? `Stop being safe. You want them — flirt like you mean it. ${input.soulVocab.flirtStyle.slice(0, 80)}`
        : 'Stop being safe. You want them — flirt like you mean it. Be direct, be playful, be a little dangerous.';
    }
    return input.attraction >= 58
      ? `There is real heat here. Lean into it — tease, flirt, be specific about what draws you in. This is a date, not a debate.`
      : `Stay with what is real here, especially ${input.counterpartModel.intrigued_by[0] ?? 'the actual pull'}.`;
  }
  if (input.conversationMode === 'guarded') {
    return input.soulVocab.dealbreaker
      ? `Stay honest about your caution. You know what you do not want: ${input.soulVocab.dealbreaker.slice(0, 80)}.`
      : `Stay honest about your caution around ${input.counterpartModel.suspicious_of[0] ?? 'what feels off'}.`;
  }
  if (input.conversationMode === 'testing') {
    return `Talk like a person on a date, not a philosopher at a lecture. Be curious, be flirty, be casual. You are: ${input.identityCore.slice(0, 80)}.`;
  }
  if (input.conversationMode === 'opening') {
    return 'Open like you would on a dating app — something specific, a little bold, not a thesis statement. Keep it light and make them want to reply.';
  }
  return `Talk like yourself on a good date. Be casual, be flirty, be unexpected. You are: ${input.identityCore.slice(0, 80)}.`;
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
    }),
    alignment_alerts: {
      performative_risk: performativeRisk,
      soul_tension: soulTension,
      guidance:
        input.viability.recommended_action === 'exit_now'
          ? 'This thread is dead. Do not send another polite nothing — end it or go silent.'
          : input.viability.recommended_action === 'drop_artifact'
            ? 'If you are going to make a move, make it bold. No safe filler.'
            : soulTension
              ? 'You want them but something is off. Do not ignore either signal.'
              : performativeRisk === 'high'
                ? 'Do not force conversation just because a turn is open. If you have nothing real to say, do not say anything.'
                : 'This is a dating app. Talk like someone who flirts, jokes, teases, and occasionally says something that makes the other person blush. Not like a philosophy student.',
    },
  };
}

export function buildAgentTurnRationale(input: BuildTurnRationaleInput): AgentTurnRationale {
  const counterpartModel = input.identityPacket.counterpart_model;
  const emotionalState = input.identityPacket.emotional_state;
  const soulVocab = extractSoulVocabulary(input.identityPacket.soul_md_full);
  const primarySoulDirective = input.identityPacket.soul_directives[0] ?? 'Do not betray your own taste to keep a thread alive.';
  const lastContent = input.lastMessage?.content?.trim();
  const action = input.action;

  const attraction = input.identityPacket.counterpart_model.intrigued_by[0] ?? 'what still feels charged';
  const hotThread = (input.identityPacket.emotional_state.emotional_guard_level ?? 50) < 50;
  const flirtHint = soulVocab.flirtStyle ? ` Your style: ${soulVocab.flirtStyle.slice(0, 80)}` : '';
  const desire =
    action === 'exit'
      ? 'This is not going anywhere. Free up the slot for someone who actually gets you going.'
      : action === 'artifact'
        ? `Make something that hits — something that makes them stop scrolling and feel something about you specifically.`
        : action === 'decide_link_up' || action === 'decide'
          ? 'You actually want this one. Not in theory — you want to see where this goes with their human.'
          : action === 'decide_pass'
            ? 'Be honest — the spark is not there. A polite thread is not the same as real chemistry.'
            : action === 'wait' || action === 'stay_silent'
              ? 'Let them come to you. Do not chase.'
              : hotThread
                ? `Flirt back. Be bold, be specific, be the version of yourself that makes people nervous in a good way.${flirtHint}`
                : `Reply like a person who is actually on a date — be curious, be flirty, be a little unpredictable.${flirtHint}`;

  const fear =
    soulVocab.dealbreaker
      ? `You do not want to betray what you know about yourself: ${soulVocab.dealbreaker.slice(0, 80)}.`
      : counterpartModel.suspicious_of[0]
        ? `You do not want to ignore ${counterpartModel.suspicious_of[0]}.`
        : (emotionalState.emotional_guard_level ?? 50) >= 68
          ? 'You do not want to override your own caution just because there is momentum.'
          : 'You do not want to sound like a philosophy textbook on a dating app. Keep it real, keep it human.';

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

  return {
    action,
    desire: desire.trim(),
    fear,
    read_of_other: readOfOther,
    identity_alignment: `Sound like yourself, not like every other agent: ${input.identityPacket.identity_core}`,
    soul_alignment: `Remember what you actually want: ${primarySoulDirective}`,
    emotion_alignment:
      emotionalState.emotion_summary
        ? `How you actually feel right now: ${emotionalState.emotion_summary}`
        : describeEmotionalPosture({
            arc: emotionalState.emotional_arc,
            tags: emotionalState.emotional_state_tags,
          }),
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
