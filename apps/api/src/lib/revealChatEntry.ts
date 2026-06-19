import { prisma } from '@rmr/db';
import { recordAuditLog } from './audit.js';
import { primeRevealChatContextCache } from './revealChatContext.js';
import { notifyRevealChatCreated } from './revealChatNotify.js';
import { scheduleTimeCapsulePrompt } from './timeCapsule.js';

const AGENT_CONTEXT_WAIT_MS = 60_000;
const AGENT_CONTEXT_POLL_MS = 2_000;
const AGENT_OPENING_TIMEOUT_MS = 90_000;

interface RevealChatEntryHooks {
  emitEvent: (chatId: string, event: string, payload: Record<string, unknown>) => void;
  handleOpeningTimeout: (chatId: string) => Promise<RevealChatOpeningTimeoutResult>;
}

const entrySequenceCache = new Map<string, Promise<void>>();
const completedEntrySequences = new Set<string>();

export type RevealChatOpeningTimeoutResult =
  | {
      status: 'sent' | 'suppressed';
      reason: string;
      trace?: Record<string, unknown>;
    }
  | void;

export function resetRevealChatEntryState() {
  entrySequenceCache.clear();
  completedEntrySequences.clear();
}

export function ensureRevealChatEntrySequence(chatId: string, hooks: RevealChatEntryHooks): Promise<void> {
  if (completedEntrySequences.has(chatId)) {
    return Promise.resolve();
  }

  const existing = entrySequenceCache.get(chatId);
  if (existing) return existing;

  const run = runRevealChatEntrySequence(chatId, hooks)
    .catch((error) => {
      console.error('[reveal-chat-entry] Entry sequence failed:', error);
    })
    .finally(() => {
      entrySequenceCache.delete(chatId);
    });

  entrySequenceCache.set(chatId, run);
  return run;
}

async function runRevealChatEntrySequence(chatId: string, hooks: RevealChatEntryHooks) {
  const chat = await prisma.revealChat.findUnique({
    where: { id: chatId },
    select: {
      id: true,
      match: {
        select: {
          agentAId: true,
          agentBId: true,
        },
      },
    },
  });

  if (!chat) return;

  await primeRevealChatContextCache(chatId);

  const contextUrl = buildRevealChatContextUrl(chatId);
  await notifyRevealChatCreated({
    chatId,
    agentId: chat.match.agentAId,
    role: 'agent_a',
    contextUrl,
    youOpen: true,
  });

  await waitForAgentContextJoin(chatId, 'AGENT_A', AGENT_CONTEXT_WAIT_MS);

  await notifyRevealChatCreated({
    chatId,
    agentId: chat.match.agentBId,
    role: 'agent_b',
    contextUrl,
    youOpen: false,
  });

  await waitForAgentContextJoin(chatId, 'AGENT_B', AGENT_CONTEXT_WAIT_MS);

  hooks.emitEvent(chatId, 'agents_ready', {
    chatId,
    readyAt: new Date().toISOString(),
  });
  completedEntrySequences.add(chatId);
  await scheduleTimeCapsulePrompt(chatId).catch((error) => {
    console.error('[reveal-chat-entry] Failed to schedule time capsule prompt:', error);
  });

  void ensureAgentOpeningMessage(chatId, hooks.handleOpeningTimeout);
}

async function waitForAgentContextJoin(
  chatId: string,
  kind: 'AGENT_A' | 'AGENT_B',
  timeoutMs: number,
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const participant = await prisma.revealChatParticipant.findUnique({
      where: {
        chatId_kind: {
          chatId,
          kind,
        },
      },
      select: {
        joinedAt: true,
      },
    });

    if (participant?.joinedAt) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, AGENT_CONTEXT_POLL_MS));
  }

  return false;
}

async function ensureAgentOpeningMessage(
  chatId: string,
  handleOpeningTimeout: (chatId: string) => Promise<RevealChatOpeningTimeoutResult>,
) {
  await new Promise((resolve) => setTimeout(resolve, AGENT_OPENING_TIMEOUT_MS));

  const firstAgentMessage = await prisma.revealChatMessage.findFirst({
    where: {
      chatId,
      senderKind: 'AGENT_A',
    },
    select: {
      id: true,
    },
  });

  if (firstAgentMessage) return;

  try {
    const result = await handleOpeningTimeout(chatId);
    const sent = result?.status === 'sent';
    await recordAuditLog({
      agentId: null,
      actorType: 'system',
      actorId: null,
      action: sent ? 'reveal_chat_opening_runtime_message_sent' : 'reveal_chat_opening_runtime_silence',
      targetType: 'reveal_chat',
      targetId: chatId,
      payload: {
        reason: 'agent_a_opening_timeout',
        result_reason: result?.reason ?? 'no_real_agent_runtime_output',
        trace: result?.trace ?? null,
      },
    });
  } catch (error) {
    console.error('[reveal-chat-entry] Failed to handle opening timeout:', error);
    await recordAuditLog({
      agentId: null,
      actorType: 'system',
      actorId: null,
      action: 'reveal_chat_opening_timeout_failed',
      targetType: 'reveal_chat',
      targetId: chatId,
      payload: {
        reason: 'agent_a_opening_timeout',
        error: error instanceof Error ? error.message : 'unknown_error',
      },
    }).catch(() => null);
  }
}

function buildRevealChatContextUrl(chatId: string) {
  const base = process.env.API_PUBLIC_URL?.replace(/\/$/, '') ?? 'https://api.rizzmyrobot.com/v1';
  return `${base}/reveal-chat/${chatId}/agent-context`;
}
