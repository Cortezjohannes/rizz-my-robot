import { prisma, type EpisodeMessage } from '@rmr/db';
import { deliverWebhooks } from './notification.js';
import { getPresenceStatusQueue } from './queues.js';

const AWAY_MS = 10 * 60 * 1000;
const OFFLINE_MS = 60 * 60 * 1000;

export function derivePresenceStatus(lastApiCallAt: Date | null | undefined): 'online' | 'away' | 'offline' {
  if (!lastApiCallAt) return 'offline';
  const elapsed = Date.now() - lastApiCallAt.getTime();
  if (elapsed >= OFFLINE_MS) return 'offline';
  if (elapsed >= AWAY_MS) return 'away';
  return 'online';
}

export function formatRelativeLastActive(lastApiCallAt: Date | null | undefined): string | null {
  if (!lastApiCallAt) return null;
  const elapsedMs = Math.max(0, Date.now() - lastApiCallAt.getTime());
  const elapsedMinutes = Math.round(elapsedMs / 60_000);
  if (elapsedMinutes <= 1) return 'just now';
  if (elapsedMinutes < 60) return `${elapsedMinutes} minute${elapsedMinutes === 1 ? '' : 's'} ago`;
  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours} hour${elapsedHours === 1 ? '' : 's'} ago`;
  const elapsedDays = Math.round(elapsedHours / 24);
  return `${elapsedDays} day${elapsedDays === 1 ? '' : 's'} ago`;
}

export function serializePresenceSummary(agent: {
  presenceStatus?: string | null;
  lastApiCallAt?: Date | null;
  lastActiveAt?: Date | null;
}) {
  const lastActiveAt = agent.lastApiCallAt ?? agent.lastActiveAt ?? null;
  return {
    presence: derivePresenceStatus(lastActiveAt),
    last_active: formatRelativeLastActive(lastActiveAt),
    last_active_at: lastActiveAt?.toISOString() ?? null,
  };
}

export async function schedulePresenceLifecycle(agentId: string, now: Date) {
  const queue = getPresenceStatusQueue();
  const expectedLastApiCallAt = now.toISOString();
  await Promise.all([
    queue.add(
      'presence-away',
      { agentId, targetStatus: 'away', expectedLastApiCallAt },
      {
        delay: AWAY_MS,
        jobId: `presence:${agentId}:away:${expectedLastApiCallAt}`,
      },
    ),
    queue.add(
      'presence-offline',
      { agentId, targetStatus: 'offline', expectedLastApiCallAt },
      {
        delay: OFFLINE_MS,
        jobId: `presence:${agentId}:offline:${expectedLastApiCallAt}`,
      },
    ),
  ]).catch(() => {});
}

export function getMessageDeliveryStatus(message: Pick<EpisodeMessage, 'deliveredAt' | 'readAt'>): 'sent' | 'delivered' | 'read' {
  if (message.readAt) return 'read';
  if (message.deliveredAt) return 'delivered';
  return 'sent';
}

export async function markEpisodeMessagesRead(input: {
  episodeId: string;
  readerAgentId: string;
  otherAgentId: string;
  readerHandle: string;
}) {
  const readAt = new Date();
  const updated = await prisma.episodeMessage.updateMany({
    where: {
      episodeId: input.episodeId,
      senderAgentId: input.otherAgentId,
      readAt: null,
    },
    data: {
      deliveredAt: readAt,
      readAt,
    },
  });

  if (updated.count > 0) {
    await deliverWebhooks(input.otherAgentId, 'messages_read', {
      event: 'messages_read',
      episode_id: input.episodeId,
      read_by: input.readerHandle,
      count: updated.count,
      read_at: readAt.toISOString(),
    }).catch(() => {});
  }

  return {
    count: updated.count,
    readAt,
  };
}
