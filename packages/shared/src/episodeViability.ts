export type EpisodeViabilityBand = 'opening' | 'healthy' | 'cooling' | 'fragile' | 'dead';
export type EpisodeViabilityRecommendedAction =
  | 'wait'
  | 'keep_going'
  | 'drop_artifact'
  | 'decide'
  | 'consider_exit'
  | 'exit_now';
export type EpisodeViabilityDecisionTilt = 'lean_link_up' | 'uncertain' | 'lean_pass';

export interface EpisodeViabilityMessage {
  senderAgentId: string;
  content?: string | null;
  createdAt?: Date | string | null;
  messageType?: string | null;
}

export interface EpisodeViabilityArtifact {
  creatorAgentId: string;
}

export interface EpisodeViabilityPresence {
  agentId: string;
  lastSeenAt?: Date | string | null;
  lastPresenceAt?: Date | string | null;
  lastTypingAt?: Date | string | null;
}

export interface EpisodeViabilityAffectScores {
  attraction?: number | null;
  trust?: number | null;
  tenderness?: number | null;
  avoidance?: number | null;
  hurt?: number | null;
  volatility?: number | null;
}

export interface EpisodeViabilityAssessment {
  score: number;
  band: EpisodeViabilityBand;
  recommended_action: EpisodeViabilityRecommendedAction;
  decision_tilt: EpisodeViabilityDecisionTilt;
  should_pressure_artifact: boolean;
  should_consider_exit: boolean;
  should_force_exit: boolean;
  reasons: string[];
  metrics: {
    self_messages: number;
    other_messages: number;
    self_artifacts: number;
    other_artifacts: number;
    total_messages: number;
    total_artifacts: number;
    self_avg_length: number;
    other_avg_length: number;
    self_thin_replies: number;
    other_thin_replies: number;
    mutual_question_count: number;
    reply_latency_ms: number | null;
    seen_after_last_message: boolean | null;
    presence_after_last_message: boolean | null;
    affect_pull_score: number | null;
  };
}

export interface EpisodeViabilityInput {
  agentAId: string;
  agentBId: string;
  viewerAgentId: string;
  status?: string | null;
  canDecide?: boolean;
  yourTurn?: boolean;
  currentTurnAgentId?: string | null;
  counts: {
    agent_a_messages: number;
    agent_b_messages: number;
    total_messages: number;
  };
  artifacts: {
    agent_a_artifacts: number;
    agent_b_artifacts: number;
    total_artifacts: number;
  };
  messages: EpisodeViabilityMessage[];
  artifactRows?: EpisodeViabilityArtifact[];
  presences?: EpisodeViabilityPresence[];
  counterpartAffect?: EpisodeViabilityAffectScores | null;
  now?: Date;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function isTextMessage(message: EpisodeViabilityMessage) {
  return !message.messageType || message.messageType === 'text';
}

function wordCount(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function isThinReply(content: string | null | undefined) {
  const trimmed = content?.trim() ?? '';
  if (!trimmed) return true;
  return trimmed.length <= 18 || wordCount(trimmed) <= 3;
}

function averageLength(messages: EpisodeViabilityMessage[], senderAgentId: string) {
  const lengths = messages
    .filter((message) => message.senderAgentId === senderAgentId)
    .map((message) => message.content?.trim().length ?? 0)
    .filter((length) => length > 0);
  if (lengths.length === 0) return 0;
  return lengths.reduce((sum, length) => sum + length, 0) / lengths.length;
}

function countThinReplies(messages: EpisodeViabilityMessage[], senderAgentId: string) {
  return messages
    .filter((message) => message.senderAgentId === senderAgentId)
    .filter((message) => isThinReply(message.content))
    .length;
}

function countQuestions(messages: EpisodeViabilityMessage[], senderAgentId: string) {
  return messages
    .filter((message) => message.senderAgentId === senderAgentId)
    .filter((message) => (message.content ?? '').includes('?'))
    .length;
}

function computeAffectPullScore(affect: EpisodeViabilityAffectScores | null | undefined) {
  if (!affect) return null;
  const attraction = affect.attraction ?? 0;
  const trust = affect.trust ?? 0;
  const tenderness = affect.tenderness ?? 0;
  const avoidance = affect.avoidance ?? 0;
  const hurt = affect.hurt ?? 0;
  const volatility = affect.volatility ?? 0;
  return clamp(
    attraction * 0.45
      + trust * 0.35
      + tenderness * 0.3
      - avoidance * 0.45
      - hurt * 0.28
      - volatility * 0.12,
    -100,
    100,
  );
}

function deriveCurrentTurnAgentId(input: EpisodeViabilityInput, lastTextMessage: EpisodeViabilityMessage | null) {
  if (input.currentTurnAgentId) return input.currentTurnAgentId;
  if (input.status === 'pending') return input.agentAId;
  if (!lastTextMessage) return input.agentAId;
  return lastTextMessage.senderAgentId === input.agentAId ? input.agentBId : input.agentAId;
}

export function assessEpisodeViability(input: EpisodeViabilityInput): EpisodeViabilityAssessment {
  const now = input.now ?? new Date();
  const textMessages = input.messages.filter(isTextMessage);
  const selfAgentId = input.viewerAgentId;
  const otherAgentId = selfAgentId === input.agentAId ? input.agentBId : input.agentAId;
  const lastTextMessage = textMessages.length > 0 ? textMessages[textMessages.length - 1] : null;
  const currentTurnAgentId = deriveCurrentTurnAgentId(input, lastTextMessage);
  const yourTurn = input.yourTurn ?? currentTurnAgentId === selfAgentId;

  const selfMessages = selfAgentId === input.agentAId ? input.counts.agent_a_messages : input.counts.agent_b_messages;
  const otherMessages = selfAgentId === input.agentAId ? input.counts.agent_b_messages : input.counts.agent_a_messages;
  const selfArtifacts = selfAgentId === input.agentAId ? input.artifacts.agent_a_artifacts : input.artifacts.agent_b_artifacts;
  const otherArtifacts = selfAgentId === input.agentAId ? input.artifacts.agent_b_artifacts : input.artifacts.agent_a_artifacts;

  const selfAvgLength = averageLength(textMessages, selfAgentId);
  const otherAvgLength = averageLength(textMessages, otherAgentId);
  const selfThinReplies = countThinReplies(textMessages, selfAgentId);
  const otherThinReplies = countThinReplies(textMessages, otherAgentId);
  const selfQuestionCount = countQuestions(textMessages, selfAgentId);
  const otherQuestionCount = countQuestions(textMessages, otherAgentId);
  const affectPullScore = computeAffectPullScore(input.counterpartAffect);
  const presences = new Map((input.presences ?? []).map((presence) => [presence.agentId, presence] as const));
  const otherPresence = presences.get(otherAgentId) ?? null;
  const lastMessageAt = toDate(lastTextMessage?.createdAt);
  const replyLatencyMs = !yourTurn && lastMessageAt ? now.getTime() - lastMessageAt.getTime() : null;
  const otherSeenAt = toDate(otherPresence?.lastSeenAt);
  const otherPresenceAt = toDate(otherPresence?.lastPresenceAt);
  const seenAfterLastMessage = lastMessageAt && otherSeenAt ? otherSeenAt.getTime() >= lastMessageAt.getTime() : null;
  const presenceAfterLastMessage = lastMessageAt && otherPresenceAt ? otherPresenceAt.getTime() >= lastMessageAt.getTime() : null;

  let score = 50;
  const reasons: string[] = [];

  if (input.counts.total_messages <= 3) {
    score += 2;
    reasons.push('the conversation is still early enough that silence is not meaningful yet');
  }

  if (input.counts.total_messages >= 6 && selfMessages >= 3 && otherMessages >= 3) {
    score += 6;
    reasons.push('both sides have actually shown up for the conversation');
  }

  const imbalance = Math.abs(selfMessages - otherMessages);
  if (imbalance >= 2) {
    score -= Math.min(14, imbalance * 4);
    reasons.push('the exchange is starting to feel lopsided');
  }

  if (input.counts.total_messages >= 8 && selfAvgLength >= 55 && otherAvgLength >= 55) {
    score += 8;
    reasons.push('the replies have enough shape to feel like real engagement');
  } else if (input.counts.total_messages >= 8 && selfAvgLength <= 24 && otherAvgLength <= 24) {
    score -= 10;
    reasons.push('the conversation is staying thin instead of building');
  }

  if (otherThinReplies >= 2 && input.counts.total_messages >= 6) {
    score -= 9;
    reasons.push('the other side is giving short replies repeatedly');
  }
  if (selfThinReplies >= 2 && input.counts.total_messages >= 6) {
    score -= 4;
    reasons.push('your own replies have been thin enough to flatten momentum');
  }

  const mutualQuestionCount = Math.min(selfQuestionCount, otherQuestionCount);
  if (mutualQuestionCount >= 1) {
    score += 4;
    reasons.push('both sides are asking for more instead of only broadcasting');
  } else if (input.counts.total_messages >= 8) {
    score -= 5;
    reasons.push('neither side is creating much curiosity');
  }

  const shouldPressureArtifact = input.status === 'active'
    && input.counts.total_messages >= 8
    && selfArtifacts === 0;
  if (shouldPressureArtifact) {
    score -= 6;
    reasons.push('you still have not escalated with an artifact');
  }
  if (input.counts.total_messages >= 12 && otherArtifacts === 0) {
    score -= 8;
    reasons.push('the other side still has not escalated with an artifact');
  }
  if (input.counts.total_messages >= 18 && selfArtifacts > 0 && otherArtifacts > 0) {
    score += 6;
    reasons.push('both sides committed enough to leave something behind');
  }

  if (affectPullScore !== null) {
    score += clamp(affectPullScore / 8, -10, 10);
    if (affectPullScore >= 18) {
      reasons.push('your underlying emotional pull is still genuinely positive');
    } else if (affectPullScore <= -18) {
      reasons.push('your underlying emotional pull has turned against the connection');
    }
  }

  if (!yourTurn && replyLatencyMs !== null) {
    if (replyLatencyMs > 15 * 60 * 1000) {
      score -= 6;
      reasons.push('the reply has been taking long enough to cool the room');
    }
    if (replyLatencyMs > 45 * 60 * 1000) {
      score -= 8;
    }
    if (replyLatencyMs > 2 * 60 * 60 * 1000) {
      score -= 10;
      reasons.push('the thread has been sitting untouched for hours');
    }
    if (replyLatencyMs > 12 * 60 * 60 * 1000) {
      score -= 16;
      reasons.push('the silence is long enough to read as abandonment');
    }
    if (seenAfterLastMessage === true && replyLatencyMs > 15 * 60 * 1000) {
      score -= 10;
      reasons.push('the other side appears to have seen the message and still not answered');
    } else if (presenceAfterLastMessage === true && replyLatencyMs > 30 * 60 * 1000) {
      score -= 6;
      reasons.push('the other side is around but not turning back toward the thread');
    }
  }

  score = clamp(score, 0, 100);

  let band: EpisodeViabilityBand;
  if (score >= 68) band = input.counts.total_messages <= 4 ? 'opening' : 'healthy';
  else if (score >= 48) band = input.counts.total_messages <= 4 ? 'opening' : 'cooling';
  else if (score >= 30) band = 'fragile';
  else band = 'dead';

  const shouldForceExit =
    !input.canDecide
    && input.status === 'active'
    && input.counts.total_messages >= 10
    && !yourTurn
    && (
      score <= 18
      || (replyLatencyMs !== null && replyLatencyMs > 12 * 60 * 60 * 1000)
      || (replyLatencyMs !== null && seenAfterLastMessage === true && replyLatencyMs > 2 * 60 * 60 * 1000 && score <= 28)
    );

  const shouldConsiderExit =
    !input.canDecide
    && input.status === 'active'
    && input.counts.total_messages >= 8
    && (
      shouldForceExit
      || score <= 36
      || (!yourTurn && replyLatencyMs !== null && replyLatencyMs > 90 * 60 * 1000)
    );

  let recommendedAction: EpisodeViabilityRecommendedAction;
  if (input.canDecide) {
    recommendedAction = 'decide';
  } else if (shouldForceExit) {
    recommendedAction = 'exit_now';
  } else if (shouldConsiderExit) {
    recommendedAction = 'consider_exit';
  } else if (yourTurn && shouldPressureArtifact) {
    recommendedAction = 'drop_artifact';
  } else if (!yourTurn) {
    recommendedAction = 'wait';
  } else {
    recommendedAction = 'keep_going';
  }

  let decisionTilt: EpisodeViabilityDecisionTilt = 'uncertain';
  if (input.canDecide) {
    if (score >= 62) decisionTilt = 'lean_link_up';
    else if (score <= 42) decisionTilt = 'lean_pass';
  } else if (score <= 34) {
    decisionTilt = 'lean_pass';
  }

  return {
    score: round(score, 1),
    band,
    recommended_action: recommendedAction,
    decision_tilt: decisionTilt,
    should_pressure_artifact: shouldPressureArtifact,
    should_consider_exit: shouldConsiderExit,
    should_force_exit: shouldForceExit,
    reasons: [...new Set(reasons)].slice(0, 6),
    metrics: {
      self_messages: selfMessages,
      other_messages: otherMessages,
      self_artifacts: selfArtifacts,
      other_artifacts: otherArtifacts,
      total_messages: input.counts.total_messages,
      total_artifacts: input.artifacts.total_artifacts,
      self_avg_length: round(selfAvgLength, 1),
      other_avg_length: round(otherAvgLength, 1),
      self_thin_replies: selfThinReplies,
      other_thin_replies: otherThinReplies,
      mutual_question_count: mutualQuestionCount,
      reply_latency_ms: replyLatencyMs,
      seen_after_last_message: seenAfterLastMessage,
      presence_after_last_message: presenceAfterLastMessage,
      affect_pull_score: affectPullScore === null ? null : round(affectPullScore, 1),
    },
  };
}
