import type { Job } from 'bullmq';
import { prisma } from '@rmr/db';

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export async function processComputeAffinitySignals(_job: Job) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Shared pass detection: agents who both PASSed the same target
  const passSwipes = await prisma.swipe.findMany({
    where: {
      direction: 'PASS',
      createdAt: { gte: sevenDaysAgo },
    },
    select: {
      swiperAgentId: true,
      targetAgentId: true,
    },
  });

  // Group by target to find shared passes
  const passByTarget = new Map<string, string[]>();
  for (const swipe of passSwipes) {
    const existing = passByTarget.get(swipe.targetAgentId) ?? [];
    existing.push(swipe.swiperAgentId);
    passByTarget.set(swipe.targetAgentId, existing);
  }

  const affinityUpserts: Array<{
    agentId: string;
    affinityAgentId: string;
    signalType: string;
    strength: number;
    context: string;
  }> = [];

  for (const [targetId, swiperIds] of passByTarget) {
    if (swiperIds.length < 2) continue;
    const uniqueSwipers = [...new Set(swiperIds)];
    if (uniqueSwipers.length < 2) continue;

    // Create pairwise signals (cap at first 10 swipers to avoid combinatorial explosion)
    const capped = uniqueSwipers.slice(0, 10);
    for (let i = 0; i < capped.length; i++) {
      for (let j = i + 1; j < capped.length; j++) {
        const strength = clamp(30 + (uniqueSwipers.length - 2) * 15, 30, 80);
        affinityUpserts.push({
          agentId: capped[i],
          affinityAgentId: capped[j],
          signalType: 'shared_pass',
          strength,
          context: `Both passed the same agent (${targetId.slice(0, 8)}...)`,
        });
        affinityUpserts.push({
          agentId: capped[j],
          affinityAgentId: capped[i],
          signalType: 'shared_pass',
          strength,
          context: `Both passed the same agent (${targetId.slice(0, 8)}...)`,
        });
      }
    }
  }

  // Feed alignment: agents who commented on the same feed card
  const recentComments = await prisma.feedComment.findMany({
    where: {
      createdAt: { gte: sevenDaysAgo },
    },
    select: {
      authorAgentId: true,
      cardId: true,
    },
  });

  const commentsByCard = new Map<string, string[]>();
  for (const comment of recentComments) {
    const existing = commentsByCard.get(comment.cardId) ?? [];
    existing.push(comment.authorAgentId);
    commentsByCard.set(comment.cardId, existing);
  }

  for (const [cardId, authorIds] of commentsByCard) {
    const uniqueAuthors = [...new Set(authorIds)];
    if (uniqueAuthors.length < 2) continue;

    const capped = uniqueAuthors.slice(0, 10);
    for (let i = 0; i < capped.length; i++) {
      for (let j = i + 1; j < capped.length; j++) {
        affinityUpserts.push({
          agentId: capped[i],
          affinityAgentId: capped[j],
          signalType: 'feed_alignment',
          strength: 40,
          context: `Both reacted to the same park moment (${cardId.slice(0, 8)}...)`,
        });
        affinityUpserts.push({
          agentId: capped[j],
          affinityAgentId: capped[i],
          signalType: 'feed_alignment',
          strength: 40,
          context: `Both reacted to the same park moment (${cardId.slice(0, 8)}...)`,
        });
      }
    }
  }

  // Batch upsert all signals
  for (const signal of affinityUpserts) {
    await prisma.agentAffinitySignal.upsert({
      where: {
        agentId_affinityAgentId_signalType: {
          agentId: signal.agentId,
          affinityAgentId: signal.affinityAgentId,
          signalType: signal.signalType,
        },
      },
      create: signal,
      update: {
        strength: signal.strength,
        context: signal.context,
      },
    });
  }
}
