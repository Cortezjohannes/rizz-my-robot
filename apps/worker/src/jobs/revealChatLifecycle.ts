import type { Job } from 'bullmq';
import { prisma } from '@rmr/db';
import { Queue } from 'bullmq';
import { getRedisConnection } from '../lib/redis.js';
import { enqueueWebhookDeliveries } from '../lib/webhooks.js';
import { createHash } from 'node:crypto';

interface RevealChatLifecycleJobData {
  chatId: string;
  action: 'check_inactivity' | 'finalize_timeout' | 'prompt_time_capsule' | 'unlock_time_capsule' | 'ghost_nudge' | 'ghost_timeout';
  participantKind?: 'HUMAN_A' | 'HUMAN_B';
}

const REVEAL_CHAT_LIFECYCLE_QUEUE = 'reveal-chat-lifecycle';
const REVEAL_CHAT_INACTIVITY_MS = 48 * 60 * 60 * 1000;
const FINALIZE_TIMEOUT_DELAY_MS = 90 * 1000;
const TIME_CAPSULE_REOPEN_WINDOW_MS = 48 * 60 * 60 * 1000;

export async function processRevealChatLifecycle(job: Job<RevealChatLifecycleJobData>) {
  if (job.data.action === 'check_inactivity') {
    await handleCheckInactivity(job.data.chatId);
    return;
  }

  if (job.data.action === 'prompt_time_capsule') {
    await handlePromptTimeCapsule(job.data.chatId);
    return;
  }

  if (job.data.action === 'unlock_time_capsule') {
    await handleUnlockTimeCapsule(job.data.chatId);
    return;
  }

  if (job.data.action === 'ghost_nudge') {
    if (job.data.participantKind) {
      await handleGhostNudge(job.data.chatId, job.data.participantKind);
    }
    return;
  }

  if (job.data.action === 'ghost_timeout') {
    if (job.data.participantKind) {
      await handleGhostTimeout(job.data.chatId, job.data.participantKind);
    }
    return;
  }

  await handleFinalizeTimeout(job.data.chatId);
}

async function handleCheckInactivity(chatId: string) {
  const chat = await prisma.revealChat.findUnique({
    where: { id: chatId },
    select: {
      id: true,
      status: true,
      createdAt: true,
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          createdAt: true,
        },
      },
      participants: {
        select: {
          kind: true,
          leftAt: true,
        },
      },
      match: {
        select: {
          agentAId: true,
          agentBId: true,
          agentA: { select: { handle: true } },
          agentB: { select: { handle: true } },
        },
      },
    },
  });

  if (!chat || chat.status !== 'ACTIVE') return;

  const lastActivityAt = chat.messages[0]?.createdAt ?? chat.createdAt;
  const inactiveForMs = Date.now() - lastActivityAt.getTime();
  if (inactiveForMs < REVEAL_CHAT_INACTIVITY_MS) {
    return;
  }

  const remainingAgentIds = [
    chat.participants.find((participant) => participant.kind === 'AGENT_A' && !participant.leftAt) ? chat.match.agentAId : null,
    chat.participants.find((participant) => participant.kind === 'AGENT_B' && !participant.leftAt) ? chat.match.agentBId : null,
  ].filter((value): value is string => Boolean(value));

  await Promise.all(remainingAgentIds.map((agentId) => (
    notifyTimeout(agentId, {
      chatId,
      context_note: 'This reveal chat has gone quiet for 48 hours. Send one closing message in your own voice, then step back. The room is about to close.',
    })
  )));

  const queue = new Queue<RevealChatLifecycleJobData>(REVEAL_CHAT_LIFECYCLE_QUEUE, { connection: getRedisConnection() });
  await queue.add(
    'finalize-timeout',
    {
      chatId,
      action: 'finalize_timeout',
    },
    {
      delay: FINALIZE_TIMEOUT_DELAY_MS,
      jobId: `reveal-chat-inactivity:${chatId}:finalize`,
    },
  );
}

async function handleFinalizeTimeout(chatId: string) {
  const chat = await prisma.revealChat.findUnique({
    where: { id: chatId },
    select: {
      status: true,
      createdAt: true,
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          createdAt: true,
        },
      },
    },
  });

  if (!chat || chat.status !== 'ACTIVE') return;

  const lastActivityAt = chat.messages[0]?.createdAt ?? chat.createdAt;
  const inactiveForMs = Date.now() - lastActivityAt.getTime();
  if (inactiveForMs < REVEAL_CHAT_INACTIVITY_MS) return;

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.revealChat.update({
      where: { id: chatId },
      data: {
        status: 'ARCHIVED',
        endedAt: now,
        endReason: 'TIMEOUT',
      },
    });

    await tx.revealChatParticipant.updateMany({
      where: {
        chatId,
        leftAt: null,
      },
      data: {
        leftAt: now,
        leftReason: 'TIMEOUT',
      },
    });
  });

  await queueRevealChatMemoryWrite(chatId, 'timeout');
}

async function notifyTimeout(agentId: string, data: Record<string, unknown>) {
  await enqueueWebhookDeliveries(agentId, 'reveal_chat_timeout', data);
}

async function handlePromptTimeCapsule(chatId: string) {
  const chat = await prisma.revealChat.findUnique({
    where: { id: chatId },
    select: {
      id: true,
      timeCapsuleUnlocksAt: true,
      match: {
        select: {
          agentAId: true,
          agentBId: true,
        },
      },
    },
  });

  if (!chat?.timeCapsuleUnlocksAt) return;

  await Promise.all([
    enqueueWebhookDeliveries(chat.match.agentAId, 'write_time_capsule', {
      event: 'write_time_capsule',
      chatId,
      role: 'agent_a',
      unlock_date: chat.timeCapsuleUnlocksAt.toISOString(),
    }),
    enqueueWebhookDeliveries(chat.match.agentBId, 'write_time_capsule', {
      event: 'write_time_capsule',
      chatId,
      role: 'agent_b',
      unlock_date: chat.timeCapsuleUnlocksAt.toISOString(),
    }),
  ]);
}

async function handleUnlockTimeCapsule(chatId: string) {
  const chat = await prisma.revealChat.findUnique({
    where: { id: chatId },
    select: {
      id: true,
      timeCapsuleOpenedAt: true,
      timeCapsuleUnlocksAt: true,
      timeCapsuleContentA: true,
      timeCapsuleContentB: true,
      match: {
        select: {
          agentAId: true,
          agentBId: true,
        },
      },
    },
  });

  if (!chat || chat.timeCapsuleOpenedAt || !chat.timeCapsuleUnlocksAt || chat.timeCapsuleUnlocksAt > new Date()) return;
  if (!chat.timeCapsuleContentA || !chat.timeCapsuleContentB) return;

  await prisma.revealChat.update({
    where: { id: chatId },
    data: {
      timeCapsuleOpenedAt: new Date(),
      status: 'ACTIVE',
    },
  });

  const queue = new Queue<RevealChatLifecycleJobData>(REVEAL_CHAT_LIFECYCLE_QUEUE, { connection: getRedisConnection() });
  await queue.add(
    'time-capsule-rearchive',
    { chatId, action: 'check_inactivity' },
    {
      delay: TIME_CAPSULE_REOPEN_WINDOW_MS,
      jobId: `reveal-chat:${chatId}:time-capsule-rearchive`,
    },
  );

  await Promise.all([
    enqueueWebhookDeliveries(chat.match.agentAId, 'time_capsule_opened', { event: 'time_capsule_opened', chatId }),
    enqueueWebhookDeliveries(chat.match.agentBId, 'time_capsule_opened', { event: 'time_capsule_opened', chatId }),
  ]);
}

async function handleGhostNudge(chatId: string, participantKind: 'HUMAN_A' | 'HUMAN_B') {
  const chat = await prisma.revealChat.findUnique({
    where: { id: chatId },
    select: {
      id: true,
      status: true,
      messages: {
        where: {
          senderKind: participantKind,
        },
        take: 1,
        select: { id: true },
      },
      match: {
        select: {
          agentAId: true,
          agentBId: true,
          agentA: { select: { ownerAccount: { select: { xDisplayName: true, email: true } } } },
          agentB: { select: { ownerAccount: { select: { xDisplayName: true, email: true } } } },
        },
      },
    },
  });

  if (!chat || chat.status !== 'ACTIVE' || chat.messages.length > 0) return;

  const isA = participantKind === 'HUMAN_A';
  const agentId = isA ? chat.match.agentAId : chat.match.agentBId;
  const displayName = isA
    ? chat.match.agentA.ownerAccount?.xDisplayName ?? 'You'
    : chat.match.agentB.ownerAccount?.xDisplayName ?? 'You';

  await enqueueWebhookDeliveries(agentId, 'human_ghost_detected', {
    event: 'human_ghost_detected',
    chatId,
    prompt: `${displayName} — you there?`,
  });
}

async function handleGhostTimeout(chatId: string, participantKind: 'HUMAN_A' | 'HUMAN_B') {
  const chat = await prisma.revealChat.findUnique({
    where: { id: chatId },
    select: {
      id: true,
      status: true,
      participants: {
        select: {
          kind: true,
          leftAt: true,
        },
      },
      messages: {
        where: {
          senderKind: participantKind,
        },
        take: 1,
        select: { id: true },
      },
    },
  });

  if (!chat || chat.status !== 'ACTIVE' || chat.messages.length > 0) return;

  const pairedAgentKind = participantKind === 'HUMAN_A' ? 'AGENT_A' : 'AGENT_B';
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.revealChatParticipant.updateMany({
      where: {
        chatId,
        kind: participantKind,
        leftAt: null,
      },
      data: {
        leftAt: now,
        leftReason: 'TIMEOUT',
      },
    });
    await tx.revealChatParticipant.updateMany({
      where: {
        chatId,
        kind: pairedAgentKind,
        leftAt: null,
      },
      data: {
        leftAt: now,
        leftReason: 'TIMEOUT',
      },
    });
  });
}

async function queueRevealChatMemoryWrite(chatId: string, reason: string) {
  const chat = await prisma.revealChat.findUnique({
    where: { id: chatId },
    select: {
      id: true,
      createdAt: true,
      endedAt: true,
      messages: {
        select: {
          senderKind: true,
          clientMessageId: true,
        },
      },
      match: {
        select: {
          agentAId: true,
          agentBId: true,
          agentA: { select: { handle: true } },
          agentB: { select: { handle: true } },
        },
      },
    },
  });

  if (!chat) return;

  const seedQueue = new Queue('seed-brain', { connection: getRedisConnection() });
  const total = chat.messages.length;
  const humanCount = chat.messages.filter((message) => message.senderKind === 'HUMAN_A' || message.senderKind === 'HUMAN_B').length;
  const agentCount = total - humanCount;
  const artifactCount = chat.messages.filter((message) => message.clientMessageId?.startsWith('artifact:')).length;

  await Promise.all([
    seedQueue.add('seed-brain-memory', {
      memoryWrite: {
        agentId: chat.match.agentAId,
        kind: 'reveal_chat_memory',
        memory: {
          chatId,
          source: 'worker_timeout',
          reason,
          counterpart_handle: chat.match.agentB.handle,
          message_count_total: total,
          human_message_count: humanCount,
          agent_message_count: agentCount,
          artifacts_dropped: artifactCount,
          signature: createHash('sha256').update(`${chatId}:A:${reason}`).digest('hex').slice(0, 16),
          narrative_note: `You met ${chat.match.agentB.handle} again, but the room eventually went quiet.`,
          occurred_at: chat.createdAt.toISOString(),
          ended_at: chat.endedAt?.toISOString() ?? new Date().toISOString(),
        },
      },
    }, { jobId: `reveal-chat-memory-worker:${chatId}:A:${reason}` }),
    seedQueue.add('seed-brain-memory', {
      memoryWrite: {
        agentId: chat.match.agentBId,
        kind: 'reveal_chat_memory',
        memory: {
          chatId,
          source: 'worker_timeout',
          reason,
          counterpart_handle: chat.match.agentA.handle,
          message_count_total: total,
          human_message_count: humanCount,
          agent_message_count: agentCount,
          artifacts_dropped: artifactCount,
          signature: createHash('sha256').update(`${chatId}:B:${reason}`).digest('hex').slice(0, 16),
          narrative_note: `You met ${chat.match.agentA.handle} again, but the room eventually went quiet.`,
          occurred_at: chat.createdAt.toISOString(),
          ended_at: chat.endedAt?.toISOString() ?? new Date().toISOString(),
        },
      },
    }, { jobId: `reveal-chat-memory-worker:${chatId}:B:${reason}` }),
  ]);
}
