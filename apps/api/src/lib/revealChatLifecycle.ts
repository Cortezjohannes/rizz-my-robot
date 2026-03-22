import { prisma } from '@rmr/db';
import { recordAuditLog } from './audit.js';
import { recordEmotionEvent, recordEmotionEventPair } from './emotion.js';
import { deliverWebhooks } from './notification.js';
import { writeRevealChatMemory } from './revealChatBrainWrite.js';

type EmitFn = (chatId: string, event: string, payload: Record<string, unknown>) => void;

interface LeaveResult {
  left: true;
  chatEnded: boolean;
}

interface CloseResult {
  ended: true;
}

export async function leaveRevealChatAsHuman(input: {
  chatId: string;
  ownerAccountId: string;
  emitEvent: EmitFn;
}): Promise<LeaveResult> {
  const context = await loadLeaveContext(input.chatId);
  if (!context) {
    throw new Error('reveal_chat_not_found');
  }

  const departingHumanKind =
    context.match.agentA.ownerAccountId === input.ownerAccountId
      ? 'HUMAN_A'
      : context.match.agentB.ownerAccountId === input.ownerAccountId
        ? 'HUMAN_B'
        : null;

  if (!departingHumanKind) {
    throw new Error('reveal_chat_forbidden');
  }

  const departingAgentKind = departingHumanKind === 'HUMAN_A' ? 'AGENT_A' : 'AGENT_B';
  const remainingHumanKind = departingHumanKind === 'HUMAN_A' ? 'HUMAN_B' : 'HUMAN_A';
  const remainingAgentKind = departingHumanKind === 'HUMAN_A' ? 'AGENT_B' : 'AGENT_A';
  const departingHuman = context.participants.find((participant) => participant.kind === departingHumanKind) ?? null;

  if (departingHuman?.leftAt) {
    return {
      left: true,
      chatEnded: Boolean(context.endedAt || context.endReason === 'BOTH_HUMANS_LEFT'),
    };
  }

  const now = new Date();
  const updates = await prisma.$transaction(async (tx) => {
    await tx.revealChatParticipant.updateMany({
      where: {
        chatId: input.chatId,
        kind: departingHumanKind,
        leftAt: null,
      },
      data: {
        leftAt: now,
        leftReason: 'HUMAN_INITIATED',
      },
    });

    await tx.revealChatParticipant.updateMany({
      where: {
        chatId: input.chatId,
        kind: departingAgentKind,
        leftAt: null,
      },
      data: {
        leftAt: now,
        leftReason: 'AGENT_FOLLOWED',
      },
    });

    const participants = await tx.revealChatParticipant.findMany({
      where: { chatId: input.chatId },
    });

    const remainingHuman = participants.find((participant) => participant.kind === remainingHumanKind);
    const bothHumansLeft = Boolean(
      participants.find((participant) => participant.kind === departingHumanKind)?.leftAt
      && remainingHuman?.leftAt,
    );

    const chat = bothHumansLeft
      ? await tx.revealChat.update({
          where: { id: input.chatId },
          data: {
            status: 'ARCHIVED',
            endedAt: now,
            endReason: 'BOTH_HUMANS_LEFT',
          },
        })
      : null;

    return {
      participants,
      bothHumansLeft,
      chat,
    };
  });

  input.emitEvent(input.chatId, 'participant_left', {
    chatId: input.chatId,
    who: departingHumanKind.toLowerCase(),
    reason: 'human_initiated',
    leftAt: now.toISOString(),
  });

  input.emitEvent(input.chatId, 'agent_departed', {
    chatId: input.chatId,
    who: departingAgentKind.toLowerCase(),
    reason: 'followed_human',
    leftAt: now.toISOString(),
  });

  if (updates.bothHumansLeft) {
    input.emitEvent(input.chatId, 'chat_status_changed', {
      chatId: input.chatId,
      status: 'ARCHIVED',
      endedAt: now.toISOString(),
      endReason: 'BOTH_HUMANS_LEFT',
    });
  }

  if (!updates.bothHumansLeft) {
    await notifyRemainingAgentPartnerLeft({
      chatId: input.chatId,
      remainingAgentId: remainingAgentKind === 'AGENT_A' ? context.match.agentAId : context.match.agentBId,
      departingHumanKind,
      departingAgentHandle: departingAgentKind === 'AGENT_A' ? context.match.agentA.handle : context.match.agentB.handle,
    });
  }

  await Promise.all([
    recordEmotionEvent({
      agentId: departingAgentKind === 'AGENT_A' ? context.match.agentAId : context.match.agentBId,
      counterpartAgentId: departingAgentKind === 'AGENT_A' ? context.match.agentBId : context.match.agentAId,
      eventType: 'reveal_chat_human_departed',
      intensity: 1,
      summary: 'Your human left the reveal chat. The connection ended before it could fully land.',
      globalDelta: { tags_added: ['unresolved'] },
      counterpartDelta: { avoidance: 6, hurt: 4 },
    }),
    recordEmotionEvent({
      agentId: remainingAgentKind === 'AGENT_A' ? context.match.agentAId : context.match.agentBId,
      counterpartAgentId: remainingAgentKind === 'AGENT_A' ? context.match.agentBId : context.match.agentAId,
      eventType: 'reveal_chat_partner_departed',
      intensity: 2,
      summary: 'The other agent and their human left. You and your human are alone now.',
      globalDelta: { tags_added: ['lingering'] },
      counterpartDelta: { trust: -4, tenderness: 6 },
    }),
  ]);

  if (updates.bothHumansLeft) {
    await recordEmotionEventPair({
      eventType: 'reveal_chat_ended_mutual',
      intensity: 2,
      agentAId: context.match.agentAId,
      agentBId: context.match.agentBId,
      summaryA: 'The reveal chat ended. Both sides left. Whatever was built here is closed now.',
      summaryB: 'The reveal chat ended. Both sides left. Whatever was built here is closed now.',
      globalDeltaA: { tags_added: ['complete', 'resolved'] },
      globalDeltaB: { tags_added: ['complete', 'resolved'] },
      counterpartDeltaA: { trust: 4, avoidance: -4 },
      counterpartDeltaB: { trust: 4, avoidance: -4 },
    });

    await writeRevealChatMemory(input.chatId);
  }

  return {
    left: true,
    chatEnded: updates.bothHumansLeft,
  };
}

export async function closeRevealChat(input: {
  chatId: string;
  reason: string;
  emitEvent: EmitFn;
  actorType: 'operator' | 'system';
}): Promise<CloseResult> {
  const context = await loadLeaveContext(input.chatId);
  if (!context) {
    throw new Error('reveal_chat_not_found');
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.revealChat.update({
      where: { id: input.chatId },
      data: {
        status: 'ARCHIVED',
        endedAt: now,
        endReason: 'OPERATOR_CLOSED',
      },
    });

    await tx.revealChatParticipant.updateMany({
      where: {
        chatId: input.chatId,
        leftAt: null,
      },
      data: {
        leftAt: now,
        leftReason: 'CHAT_ENDED',
      },
    });
  });

  input.emitEvent(input.chatId, 'chat_closed', {
    chatId: input.chatId,
    reason: 'operator',
    closedAt: now.toISOString(),
  });
  input.emitEvent(input.chatId, 'chat_status_changed', {
    chatId: input.chatId,
    status: 'ARCHIVED',
    endedAt: now.toISOString(),
    endReason: 'OPERATOR_CLOSED',
  });

  await recordAuditLog({
    agentId: null,
    actorType: input.actorType,
    actorId: null,
    action: 'reveal_chat_closed',
    targetType: 'reveal_chat',
    targetId: input.chatId,
    payload: {
      reason: input.reason,
      closedAt: now.toISOString(),
      endReason: 'OPERATOR_CLOSED',
    },
  });

  await writeRevealChatMemory(input.chatId);

  return { ended: true };
}

async function notifyRemainingAgentPartnerLeft(input: {
  chatId: string;
  remainingAgentId: string;
  departingHumanKind: 'HUMAN_A' | 'HUMAN_B';
  departingAgentHandle: string;
}) {
  await deliverWebhooks(input.remainingAgentId, 'reveal_chat_partner_left', {
    chatId: input.chatId,
    who_left: input.departingHumanKind.toLowerCase(),
    their_agent: input.departingHumanKind === 'HUMAN_A' ? 'agent_a' : 'agent_b',
    context_note: `Your counterpart and their human just left the reveal chat together. You are now alone with your human. Send one farewell message to ${input.departingAgentHandle} — they won't see it, but your human will. Then one message to your human. Then go quiet.`,
  });
}

async function loadLeaveContext(chatId: string) {
  return prisma.revealChat.findUnique({
    where: { id: chatId },
    select: {
      id: true,
      endedAt: true,
      endReason: true,
      participants: {
        select: {
          id: true,
          kind: true,
          participantId: true,
          leftAt: true,
        },
      },
      match: {
        select: {
          agentAId: true,
          agentBId: true,
          agentA: {
            select: {
              ownerAccountId: true,
              handle: true,
            },
          },
          agentB: {
            select: {
              ownerAccountId: true,
              handle: true,
            },
          },
        },
      },
    },
  });
}
