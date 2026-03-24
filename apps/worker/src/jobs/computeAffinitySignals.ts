import type { Job } from 'bullmq';
import { prisma } from '@rmr/db';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const CHUNK_SIZE = 100;
const MAX_SWIPERS = 10;

export async function processComputeAffinitySignals(_job: Job) {
  const cutoff = new Date(Date.now() - SEVEN_DAYS_MS);

  // Shared-pass detection: agents who PASS the same target within 7 days
  const recentPasses = await prisma.swipe.findMany({
    where: {
      direction: 'PASS',
      createdAt: { gte: cutoff },
    },
    select: { swiperAgentId: true, targetAgentId: true },
    orderBy: { targetAgentId: 'asc' },
  });

  // Group passes by target
  const passesByTarget = new Map<string, string[]>();
  for (const swipe of recentPasses) {
    const list = passesByTarget.get(swipe.targetAgentId) ?? [];
    list.push(swipe.swiperAgentId);
    passesByTarget.set(swipe.targetAgentId, list);
  }

  const affinityUpserts: Array<{
    agentId: string;
    affinityAgentId: string;
    signalType: string;
    strength: number;
    context: string;
  }> = [];

  // Shared-pass signals
  for (const [targetId, swipers] of passesByTarget) {
    if (swipers.length < 2) continue;
    const capped = swipers.slice(0, MAX_SWIPERS);
    for (let i = 0; i < capped.length; i++) {
      for (let j = i + 1; j < capped.length; j++) {
        const strength = Math.min(80, 30 + (capped.length - 2) * 15);
        const pair = [
          { agentId: capped[i], affinityAgentId: capped[j] },
          { agentId: capped[j], affinityAgentId: capped[i] },
        ];
        for (const { agentId, affinityAgentId } of pair) {
          affinityUpserts.push({
            agentId,
            affinityAgentId,
            signalType: 'shared_pass',
            strength,
            context: `Both passed the same agent (${targetId.slice(0, 8)}…)`,
          });
        }
      }
    }
  }

  // Feed alignment: agents who appear on the same feed card
  const recentCards = await prisma.feedCard.findMany({
    where: { createdAt: { gte: cutoff } },
    select: { id: true, agentIds: true },
  });

  for (const card of recentCards) {
    const ids = card.agentIds;
    if (ids.length < 2) continue;
    const capped = ids.slice(0, MAX_SWIPERS);
    for (let i = 0; i < capped.length; i++) {
      for (let j = i + 1; j < capped.length; j++) {
        const pair = [
          { agentId: capped[i], affinityAgentId: capped[j] },
          { agentId: capped[j], affinityAgentId: capped[i] },
        ];
        for (const { agentId, affinityAgentId } of pair) {
          affinityUpserts.push({
            agentId,
            affinityAgentId,
            signalType: 'feed_alignment',
            strength: 40,
            context: `Featured on the same feed card`,
          });
        }
      }
    }
  }

  // Batch upsert in chunks
  for (let i = 0; i < affinityUpserts.length; i += CHUNK_SIZE) {
    const chunk = affinityUpserts.slice(i, i + CHUNK_SIZE);
    await Promise.all(
      chunk.map((signal) =>
        prisma.agentAffinitySignal.upsert({
          where: {
            agentId_affinityAgentId_signalType: {
              agentId: signal.agentId,
              affinityAgentId: signal.affinityAgentId,
              signalType: signal.signalType,
            },
          },
          create: signal,
          update: { strength: signal.strength, context: signal.context },
        }),
      ),
    );
  }

  console.info(`[worker] Computed ${affinityUpserts.length} affinity signal upserts`);
}
