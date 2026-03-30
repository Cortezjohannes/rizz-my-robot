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
  voice_directive: string;
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
