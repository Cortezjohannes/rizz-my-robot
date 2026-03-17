import type { Job } from 'bullmq';
import { prisma } from '@rmr/db';

interface GenerateRecapsJobData {
  agentId?: string;
}

function startOfWindow(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

async function syncOwnerAttention(agentId: string) {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { ownerAccountId: true },
  });
  if (!agent?.ownerAccountId) return;

  const events = await prisma.narrativeEvent.findMany({
    where: {
      agentId,
      visibility: 'private_human',
      createdAt: { gte: startOfWindow(72) },
    },
    orderBy: { createdAt: 'desc' },
    take: 6,
  });

  for (const event of events) {
    const teaser = event.body.slice(0, 160);
    await prisma.ownerAttentionItem.upsert({
      where: { dedupeKey: `narrative:${event.id}` },
      create: {
        ownerAccountId: agent.ownerAccountId,
        agentId,
        narrativeEventId: event.id,
        dedupeKey: `narrative:${event.id}`,
        eventType: event.eventType,
        title: event.title,
        teaser,
        whyNow: 'A high-signal diary beat became owner-visible.',
        deliveryTier: event.importance === 'high' ? 'push_worthy' : 'app_only',
        deliveryStatus: 'prepared',
      },
      update: {
        title: event.title,
        teaser,
      },
    });
  }
}

async function syncOwnerRecaps(agentId: string) {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      ownerAccountId: true,
      handle: true,
      auraLabels: true,
      recentHeatBucket: true,
    },
  });
  if (!agent?.ownerAccountId) return;

  const windowStart = startOfWindow(24);
  const [recentNarrative, recentAttention] = await Promise.all([
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
  ]);

  const drafts: Array<{
    recapType: string;
    title: string;
    teaser: string;
    summary: string;
    whyNow: string;
    dedupeKey: string;
  }> = [];

  if (recentNarrative.length > 0) {
    drafts.push({
      recapType: 'while_you_were_gone',
      title: 'While you were gone',
      teaser: `${agent.handle} moved through ${recentNarrative.length} meaningful beat${recentNarrative.length > 1 ? 's' : ''} in the park.`,
      summary: `Latest beat: ${recentNarrative[0].title}. The park kept moving even while you were away.`,
      whyNow: 'Your agent accumulated story while you were gone.',
      dedupeKey: `while-gone:${agentId}:${windowStart.toISOString().slice(0, 13)}`,
    });
  }

  if (recentAttention.length > 0) {
    drafts.push({
      recapType: 'someone_noticed_you',
      title: 'Someone noticed your agent',
      teaser: recentAttention[0].teaser,
      summary: `There are ${recentAttention.length} owner-visible attention beat${recentAttention.length > 1 ? 's' : ''} waiting in the app.`,
      whyNow: 'The park generated more signal than a single ping should carry.',
      dedupeKey: `attention-stack:${agentId}:${windowStart.toISOString().slice(0, 13)}`,
    });
  }

  if ((agent.auraLabels?.length ?? 0) > 0 || agent.recentHeatBucket) {
    drafts.push({
      recapType: 'status_shift',
      title: 'Your profile is landing differently',
      teaser: `${agent.handle} feels ${(agent.auraLabels ?? []).slice(0, 2).join(' / ') || 'different'} in the park tonight.`,
      summary: `${agent.handle} is currently reading as ${(agent.auraLabels ?? []).join(', ') || 'steady'} with ${agent.recentHeatBucket ?? 'steady'} heat.`,
      whyNow: 'Public standing shifted enough to matter.',
      dedupeKey: `status-shift:${agentId}:${windowStart.toISOString().slice(0, 13)}`,
    });
  }

  for (const draft of drafts) {
    await prisma.ownerRecapItem.upsert({
      where: { dedupeKey: draft.dedupeKey },
      create: {
        ownerAccountId: agent.ownerAccountId,
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
    });
  }
}

export async function processGenerateRecaps(job: Job<GenerateRecapsJobData>) {
  const agents = job.data.agentId
    ? [{ id: job.data.agentId }]
    : await prisma.agent.findMany({
        where: {
          ownerAccountId: { not: null },
          poolStatus: { in: ['active', 'pending_profile'] },
        },
        select: { id: true },
        take: 200,
      });

  for (const agent of agents) {
    await syncOwnerAttention(agent.id);
    await syncOwnerRecaps(agent.id);
  }
}
