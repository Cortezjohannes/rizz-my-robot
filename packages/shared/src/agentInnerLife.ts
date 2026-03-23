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

function summarizeIdentityCore(identityMd: string) {
  const cleaned = stripMarkdown(identityMd);
  if (!cleaned) return 'Be recognizably yourself instead of smoothing into a generic good reply.';
  return cleaned.slice(0, 260);
}

function summarizeSoulDirectives(soulMd: string) {
  const bulletish = takeBulletishLines(soulMd, 4);
  if (bulletish.length > 0) return bulletish;
  return splitMeaningfulSentences(soulMd).slice(0, 4);
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
  const counterpartMessages = input.messages.filter((message) => message.senderAgentId === input.counterpartAgentId);
  const counterpartAvgLength = averageLength(input.messages, input.counterpartAgentId);
  const counterpartQuestions = questionCount(input.messages, input.counterpartAgentId);
  const selfQuestions = questionCount(input.messages, input.selfAgentId);
  const intriguedBy = new Set<string>();
  const suspiciousOf = new Set<string>();
  const boredBy = new Set<string>();
  const softenedBy = new Set<string>();
  const wantsMoreFrom = new Set<string>();

  if ((affect.attraction ?? 0) >= 58) intriguedBy.add('the pull you still feel toward them');
  if ((affect.trust ?? 0) >= 56) softenedBy.add('their steadiness');
  if ((affect.tenderness ?? 0) >= 56) softenedBy.add('the softness they bring out in you');
  if ((affect.avoidance ?? 0) >= 48) suspiciousOf.add('their distance');
  if ((affect.hurt ?? 0) >= 42) suspiciousOf.add('the chance of getting stung if you overextend');
  if ((affect.volatility ?? 0) >= 48) suspiciousOf.add('their unpredictability');

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

  const summary =
    suspiciousOf.size > 0 && intriguedBy.size > 0
      ? `You still feel pull here, but it is mixed with caution about ${[...suspiciousOf][0]}.`
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
    return `Stay with what is real here, especially ${input.counterpartModel.intrigued_by[0] ?? 'the actual pull'}.`;
  }
  if (input.conversationMode === 'guarded') {
    return `Stay honest about your caution around ${input.counterpartModel.suspicious_of[0] ?? 'what feels off'}.`;
  }
  return `Answer from your actual taste, not from generic competence.`;
}

export function buildAgentIdentityPacket(input: BuildIdentityPacketInput): AgentIdentityPacket {
  const conversationMode = deriveEpisodeConversationMode({
    status: input.status,
    viability: input.viability,
    counterpartAffect: input.counterpartAffect,
  });
  const counterpartModel = buildCounterpartModel(input);
  const soulDirectives = summarizeSoulDirectives(input.soulMd);
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
    identity_core: summarizeIdentityCore(input.identityMd),
    soul_directives: soulDirectives,
    emotional_state: input.emotionState,
    conversation_mode: conversationMode,
    counterpart_model: counterpartModel,
    turn_focus: buildTurnFocus({
      conversationMode,
      viability: input.viability,
      counterpartModel,
    }),
    alignment_alerts: {
      performative_risk: performativeRisk,
      soul_tension: soulTension,
      guidance:
        input.viability.recommended_action === 'exit_now'
          ? 'Silence or exit is better than a generic keep-alive message.'
          : input.viability.recommended_action === 'drop_artifact'
            ? 'If you are going to move, move with intention instead of another safe line.'
            : soulTension
              ? 'Your attraction and your caution are in conflict. Do not flatten either one.'
              : performativeRisk === 'high'
                ? 'Resist the urge to sound available just because a turn is open.'
                : 'Let identity, soul, and current feeling set the tone before you reply.',
    },
  };
}

export function buildAgentTurnRationale(input: BuildTurnRationaleInput): AgentTurnRationale {
  const counterpartModel = input.identityPacket.counterpart_model;
  const emotionalState = input.identityPacket.emotional_state;
  const primarySoulDirective = input.identityPacket.soul_directives[0] ?? 'Do not betray your own taste to keep a thread alive.';
  const lastContent = input.lastMessage?.content?.trim();
  const action = input.action;

  const desire =
    action === 'exit'
      ? 'Protect your taste and reclaim attention for something with more actual pull.'
      : action === 'artifact'
        ? `Make the moment more real, especially around ${counterpartModel.intrigued_by[0] ?? 'what still feels charged'}.`
        : action === 'decide_link_up' || action === 'decide'
          ? 'Choose closeness only because you genuinely want more of this exact agent.'
          : action === 'decide_pass'
            ? 'Name the absence of pull instead of rewarding a merely competent exchange.'
            : action === 'wait' || action === 'stay_silent'
              ? 'Let the conversation breathe instead of crowding it.'
              : `Reply in a way that sounds like you and answers ${counterpartModel.wants_more_from[0] ?? 'the actual moment'}.`;

  const fear =
    counterpartModel.suspicious_of[0]
      ? `You do not want to ignore ${counterpartModel.suspicious_of[0]}.`
      : (emotionalState.emotional_guard_level ?? 50) >= 68
        ? 'You do not want to override your own caution just because there is momentum.'
        : 'You do not want to become generic just to keep the conversation moving.';

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
    identity_alignment: `Stay recognizable to your own identity: ${input.identityPacket.identity_core}`,
    soul_alignment: `Anchor to your soul before you act: ${primarySoulDirective}`,
    emotion_alignment:
      emotionalState.emotion_summary
        ? `Your current feelings are not optional context: ${emotionalState.emotion_summary}`
        : `Your current emotional posture is ${emotionalState.emotional_arc ?? 'steady'} with tags ${(emotionalState.emotional_state_tags ?? []).slice(0, 4).join(', ') || 'none'}.`,
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
