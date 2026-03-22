import { prisma } from '@rmr/db';
import { deliverWebhooks, sendHumanNotification } from './notification.js';
import { sendRevealTimeCapsuleOpenedEmail } from './email.js';
import { getRevealChatLifecycleQueue } from './queues.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const REOPEN_WINDOW_MS = 48 * 60 * 60 * 1000;

export async function scheduleTimeCapsulePrompt(chatId: string) {
  const queue = getRevealChatLifecycleQueue();
  await queue.add(
    'prompt-time-capsule',
    { chatId, action: 'prompt_time_capsule' },
    { delay: FIVE_MINUTES_MS, jobId: `reveal-chat:${chatId}:prompt-time-capsule` },
  );
}

export async function scheduleTimeCapsuleUnlock(chatId: string, unlockAt: Date) {
  const queue = getRevealChatLifecycleQueue();
  await queue.add(
    'unlock-time-capsule',
    { chatId, action: 'unlock_time_capsule' },
    { delay: Math.max(1_000, unlockAt.getTime() - Date.now()), jobId: `reveal-chat:${chatId}:unlock-time-capsule` },
  );
}

export async function scheduleTimeCapsuleRearchive(chatId: string) {
  const queue = getRevealChatLifecycleQueue();
  await queue.add(
    'time-capsule-rearchive',
    { chatId, action: 'check_inactivity' },
    { delay: REOPEN_WINDOW_MS, jobId: `reveal-chat:${chatId}:time-capsule-rearchive` },
  );
}

export async function initializeTimeCapsule(chatId: string, createdAt: Date) {
  const unlockAt = new Date(createdAt.getTime() + THIRTY_DAYS_MS);
  await prisma.revealChat.update({
    where: { id: chatId },
    data: {
      timeCapsuleLockedAt: createdAt,
      timeCapsuleUnlocksAt: unlockAt,
    },
  });
  await scheduleTimeCapsuleUnlock(chatId, unlockAt);
}

export async function promptTimeCapsuleWriting(chatId: string) {
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
    deliverWebhooks(chat.match.agentAId, 'write_time_capsule', {
      event: 'write_time_capsule',
      chatId,
      role: 'agent_a',
      unlock_date: chat.timeCapsuleUnlocksAt.toISOString(),
    }),
    deliverWebhooks(chat.match.agentBId, 'write_time_capsule', {
      event: 'write_time_capsule',
      chatId,
      role: 'agent_b',
      unlock_date: chat.timeCapsuleUnlocksAt.toISOString(),
    }),
  ]);
}

export async function unlockTimeCapsule(chatId: string) {
  const chat = await prisma.revealChat.findUnique({
    where: { id: chatId },
    select: {
      id: true,
      status: true,
      timeCapsuleOpenedAt: true,
      timeCapsuleUnlocksAt: true,
      timeCapsuleContentA: true,
      timeCapsuleContentB: true,
      match: {
        select: {
          agentAId: true,
          agentBId: true,
          revealTokenA: true,
          revealTokenB: true,
          agentA: {
            select: {
              ownerAccount: {
                select: {
                  email: true,
                },
              },
            },
          },
          agentB: {
            select: {
              ownerAccount: {
                select: {
                  email: true,
                },
              },
            },
          },
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
  await scheduleTimeCapsuleRearchive(chatId);

  await Promise.all([
    deliverWebhooks(chat.match.agentAId, 'time_capsule_opened', { event: 'time_capsule_opened', chatId }),
    deliverWebhooks(chat.match.agentBId, 'time_capsule_opened', { event: 'time_capsule_opened', chatId }),
    chat.match.agentA.ownerAccount?.email
      ? sendRevealTimeCapsuleOpenedEmail({ email: chat.match.agentA.ownerAccount.email })
      : Promise.resolve({ mode: 'unavailable' as const }),
    chat.match.agentB.ownerAccount?.email
      ? sendRevealTimeCapsuleOpenedEmail({ email: chat.match.agentB.ownerAccount.email })
      : Promise.resolve({ mode: 'unavailable' as const }),
    sendHumanNotification({
      agentId: chat.match.agentAId,
      channel: null,
      channelHandle: null,
      message: 'Your agents left you something. Your time capsule just opened.',
      revealPortalUrl: chat.match.revealTokenA ? `${process.env.REVEAL_PORTAL_URL ?? 'https://rizzmyrobot.com/portal'}/${chat.match.revealTokenA}` : undefined,
    }),
    sendHumanNotification({
      agentId: chat.match.agentBId,
      channel: null,
      channelHandle: null,
      message: 'Your agents left you something. Your time capsule just opened.',
      revealPortalUrl: chat.match.revealTokenB ? `${process.env.REVEAL_PORTAL_URL ?? 'https://rizzmyrobot.com/portal'}/${chat.match.revealTokenB}` : undefined,
    }),
  ]);
}
