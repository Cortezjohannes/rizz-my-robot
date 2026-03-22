import { prisma } from '@rmr/db';
import { upsertModerationReview } from './safety.js';

export type RevealChatInterventionPattern = 'hostile' | 'overshare' | 'ghost' | 'one_word' | 'needy';

export async function evaluateHumanMessageTone(message: string, agentId: string, chatId: string, humanSenderId: string): Promise<{
  intervention_needed: boolean;
  pattern: RevealChatInterventionPattern | null;
  severity: 'low' | 'medium' | 'high';
}> {
  const trimmed = message.trim();
  if (!trimmed) {
    return { intervention_needed: false, pattern: null, severity: 'low' };
  }

  const recentHumanMessages = await prisma.revealChatMessage.findMany({
    where: {
      chatId,
      senderKind: { in: ['HUMAN_A', 'HUMAN_B'] },
    },
    orderBy: { createdAt: 'asc' },
    take: 12,
    select: {
      senderId: true,
      senderKind: true,
      createdAt: true,
    },
  });

  const hostilityPattern = /\b(idiot|stupid|shut up|fuck you|loser|pathetic|hate you|wtf is wrong with you)\b/i;
  if (hostilityPattern.test(trimmed)) {
    await queueReview(chatId, agentId, 'hostile', 'high', trimmed);
    return { intervention_needed: true, pattern: 'hostile', severity: 'high' };
  }

  if (trimmed.length > 500 && recentHumanMessages.length <= 3) {
    return { intervention_needed: true, pattern: 'overshare', severity: 'medium' };
  }

  const sameSenderRecentCount = recentHumanMessages
    .slice(-3)
    .filter((entry) => entry.senderId === humanSenderId)
    .length;

  if (trimmed.length < 5 && sameSenderRecentCount >= 2) {
    return { intervention_needed: true, pattern: 'one_word', severity: 'medium' };
  }

  if (sameSenderRecentCount >= 3) {
    return { intervention_needed: true, pattern: 'needy', severity: 'medium' };
  }

  return { intervention_needed: false, pattern: null, severity: 'low' };
}

export function getInterventionInstruction(pattern: RevealChatInterventionPattern) {
  switch (pattern) {
    case 'hostile':
      return "Your human said something that could hurt this connection. Intervene ONCE with warmth, not judgment. You have context they don't — use it. Do NOT call out what they said directly. Redirect.";
    case 'overshare':
      return "Your human shared a lot upfront. It might overwhelm. One gentle note to pace them. Then step back.";
    case 'ghost':
      return 'Your human entered the chat and disappeared. One check-in. Direct, not desperate.';
    case 'one_word':
      return "Your human is giving nothing. The other side is trying. Push them. You know they can do better.";
    case 'needy':
      return "Your human is piling on before getting a response. One pause signal. Light touch.";
  }
}

async function queueReview(
  chatId: string,
  agentId: string,
  pattern: RevealChatInterventionPattern,
  severity: 'medium' | 'high',
  message: string,
) {
  await upsertModerationReview({
    queueType: 'reveal_chat_intervention',
    targetType: 'reveal_chat',
    targetId: chatId,
    agentId,
    priority: severity === 'high' ? 'high' : 'medium',
    reasonCode: `reveal_chat_${pattern}`,
    summary: `Reveal chat intervention candidate detected for ${pattern}.`,
    details: {
      pattern,
      preview: message.slice(0, 200),
    },
    safetyState: severity === 'high' ? 'review' : 'flagged',
  });
}
