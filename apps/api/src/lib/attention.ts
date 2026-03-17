import { prisma } from '@rmr/db';
import { listPreparedNarrativeNotificationCandidates } from './narrative.js';
import { sendHumanNotification } from './notification.js';

export async function syncOwnerAttention(
  agentId: string,
  limit = 8,
  options?: { deliverNotifications?: boolean }
) {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      id: true,
      handle: true,
      ownerAccountId: true,
      human: {
        select: {
          notificationChannel: true,
          notificationHandle: true,
        },
      },
    },
  });
  if (!agent?.ownerAccountId) return [];

  const candidates = await listPreparedNarrativeNotificationCandidates(agentId, limit);
  const items = await Promise.all(
    candidates.map((candidate) =>
      prisma.ownerAttentionItem.upsert({
        where: { dedupeKey: `narrative:${candidate.narrative_event_id}` },
        create: {
          ownerAccountId: agent.ownerAccountId!,
          agentId,
          narrativeEventId: candidate.narrative_event_id,
          dedupeKey: `narrative:${candidate.narrative_event_id}`,
          eventType: candidate.event_type,
          title: candidate.title,
          teaser: candidate.teaser,
          whyNow: candidate.why_now,
          deliveryTier: candidate.importance === 'high' ? 'push_worthy' : 'app_only',
          deliveryStatus: 'prepared',
        },
        update: {
          title: candidate.title,
          teaser: candidate.teaser,
          whyNow: candidate.why_now,
        },
      })
    )
  );

  if (options?.deliverNotifications && agent.human?.notificationChannel && agent.human.notificationHandle) {
    const pendingPush = items.filter(
      (item) =>
        item.deliveryTier === 'push_worthy'
        && !item.deliveredChannels.includes(agent.human!.notificationChannel!)
    );

    await Promise.all(
      pendingPush.map(async (item) => {
        await sendHumanNotification({
          agentId,
          channel: agent.human!.notificationChannel,
          channelHandle: agent.human!.notificationHandle,
          message: `${agent.handle}: ${item.teaser}`,
        }).catch(() => {});

        await prisma.ownerAttentionItem.update({
          where: { id: item.id },
          data: {
            deliveredChannels: {
              set: [...new Set([...item.deliveredChannels, agent.human!.notificationChannel!])],
            },
            deliveryStatus: 'delivered',
          },
        });
      })
    );
  }

  return prisma.ownerAttentionItem.findMany({
    where: { ownerAccountId: agent.ownerAccountId },
    orderBy: [{ unread: 'desc' }, { createdAt: 'desc' }],
    take: limit,
  });
}
