import { prisma } from '@rmr/db';
import { deliverWebhooks } from './notification.js';

export interface RevealChatCreatedNotificationInput {
  chatId: string;
  agentId: string;
  role: 'agent_a' | 'agent_b';
  contextUrl: string;
  youOpen: boolean;
}

export interface RevealChatNotificationInput {
  chatId: string;
  messageId: string;
  senderKind: 'HUMAN_A' | 'AGENT_A' | 'HUMAN_B' | 'AGENT_B';
  createdAt: string;
}

export async function notifyRevealChatCreated(input: RevealChatCreatedNotificationInput): Promise<void> {
  try {
    await deliverWebhooks(input.agentId, 'reveal_chat_created', {
      chatId: input.chatId,
      role: input.role,
      contextUrl: input.contextUrl,
      you_open: input.youOpen,
    });
  } catch (error) {
    console.error('[reveal-chat-notify] Failed to notify reveal chat creation:', error);
  }
}

export async function notifyRevealChatParticipants(input: RevealChatNotificationInput): Promise<void> {
  try {
    const chat = await prisma.revealChat.findUnique({
      where: { id: input.chatId },
      select: {
        matchId: true,
        match: {
          select: {
            agentAId: true,
            agentBId: true,
          },
        },
      },
    });

    if (!chat) return;

    await Promise.all([
      deliverWebhooks(chat.match.agentAId, 'reveal_chat_message', {
        chatId: input.chatId,
        matchId: chat.matchId,
        messageId: input.messageId,
        senderKind: input.senderKind,
        createdAt: input.createdAt,
      }),
      deliverWebhooks(chat.match.agentBId, 'reveal_chat_message', {
        chatId: input.chatId,
        matchId: chat.matchId,
        messageId: input.messageId,
        senderKind: input.senderKind,
        createdAt: input.createdAt,
      }),
    ]);
  } catch (error) {
    console.error('[reveal-chat-notify] Failed to notify agent webhooks:', error);
  }
}
