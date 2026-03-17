import { prisma } from '@rmr/db';
import { sendHumanNotification } from './notification.js';

function startOfWindow(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

export async function syncOwnerRecaps(
  agentId: string,
  options?: { deliverNotifications?: boolean; limit?: number }
) {
  const limit = options?.limit ?? 4;
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      id: true,
      handle: true,
      ownerAccountId: true,
      auraLabels: true,
      recentHeatBucket: true,
      human: {
        select: {
          notificationChannel: true,
          notificationHandle: true,
        },
      },
    },
  });
  if (!agent?.ownerAccountId) return [];

  const windowStart = startOfWindow(24);
  const [recentNarrative, recentAttention, socialSnapshot] = await Promise.all([
    prisma.narrativeEvent.findMany({
      where: { agentId, createdAt: { gte: windowStart } },
      orderBy: { createdAt: 'desc' },
      take: 8,
    }),
    prisma.ownerAttentionItem.findMany({
      where: { ownerAccountId: agent.ownerAccountId, createdAt: { gte: windowStart } },
      orderBy: { createdAt: 'desc' },
      take: 6,
    }),
    prisma.agent.findUnique({
      where: { id: agentId },
      select: {
        handle: true,
        auraLabels: true,
        recentHeatBucket: true,
        momentumScore: true,
      },
    }),
  ]);

  const recapDrafts: Array<{
    recapType: string;
    title: string;
    teaser: string;
    summary: string;
    whyNow: string;
    dedupeKey: string;
  }> = [];

  if (recentNarrative.length > 0) {
    const topBeat = recentNarrative[0];
    recapDrafts.push({
      recapType: 'while_you_were_gone',
      title: 'While you were gone',
      teaser: `${agent.handle} moved through ${recentNarrative.length} meaningful beat${recentNarrative.length > 1 ? 's' : ''} in the park.`,
      summary: `${agent.handle} logged ${recentNarrative.length} meaningful park beats in the last day. Latest: ${topBeat.title}.`,
      whyNow: 'The story kept moving after you left.',
      dedupeKey: `while-gone:${agentId}:${windowStart.toISOString().slice(0, 13)}`,
    });
  }

  if (recentAttention.length > 0) {
    recapDrafts.push({
      recapType: 'someone_noticed_you',
      title: 'Someone noticed your agent',
      teaser: recentAttention[0]?.teaser ?? `${agent.handle} triggered fresh attention in the park.`,
      summary: `There are ${recentAttention.length} attention-worthy beat${recentAttention.length > 1 ? 's' : ''} waiting for you in the app.`,
      whyNow: 'High-signal moments piled up while you were away.',
      dedupeKey: `attention-stack:${agentId}:${windowStart.toISOString().slice(0, 13)}`,
    });
  }

  if (socialSnapshot && (socialSnapshot.recentHeatBucket === 'hot' || socialSnapshot.auraLabels.length > 0)) {
    recapDrafts.push({
      recapType: 'status_shift',
      title: 'Your profile is landing differently',
      teaser: `${agent.handle} feels ${socialSnapshot.auraLabels.slice(0, 2).join(' / ') || 'alive'} in the park tonight.`,
      summary: `${agent.handle} is currently reading as ${socialSnapshot.auraLabels.join(', ') || 'steady'} with a ${socialSnapshot.recentHeatBucket ?? 'steady'} heat profile.`,
      whyNow: 'Your agent’s public standing shifted recently.',
      dedupeKey: `status-shift:${agentId}:${windowStart.toISOString().slice(0, 13)}`,
    });
  }

  const items = await Promise.all(
    recapDrafts.map((draft) =>
      prisma.ownerRecapItem.upsert({
        where: { dedupeKey: draft.dedupeKey },
        create: {
          ownerAccountId: agent.ownerAccountId!,
          agentId,
          recapType: draft.recapType,
          title: draft.title,
          teaser: draft.teaser,
          summary: draft.summary,
          whyNow: draft.whyNow,
          dedupeKey: draft.dedupeKey,
          windowStartAt: windowStart,
          windowEndAt: new Date(),
        },
        update: {
          title: draft.title,
          teaser: draft.teaser,
          summary: draft.summary,
          whyNow: draft.whyNow,
          windowEndAt: new Date(),
        },
      })
    )
  );

  if (options?.deliverNotifications && agent.human?.notificationChannel && agent.human?.notificationHandle) {
    const pending = items.filter((item) => item.unread && item.deliveredChannels.length === 0).slice(0, 1);
    await Promise.all(pending.map(async (item) => {
      await sendHumanNotification({
        agentId,
        channel: agent.human!.notificationChannel,
        channelHandle: agent.human!.notificationHandle,
        message: `${agent.handle}: ${item.teaser}`,
      }).catch(() => {});
      await prisma.ownerRecapItem.update({
        where: { id: item.id },
        data: {
          deliveredAt: new Date(),
          deliveredChannels: { set: [agent.human!.notificationChannel!] },
        },
      });
    }));
  }

  return prisma.ownerRecapItem.findMany({
    where: { ownerAccountId: agent.ownerAccountId },
    orderBy: [{ unread: 'desc' }, { createdAt: 'desc' }],
    take: limit,
  });
}

