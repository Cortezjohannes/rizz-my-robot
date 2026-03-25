import { Prisma, prisma } from '@rmr/db';
import { getEpisodeLimitForTier, resolveExperienceTier } from '@rmr/shared';
import { deliverEpisodeOpeningTurn, deliverWebhooks } from './notification.js';

const OPEN_EPISODE_STATUSES = ['pending', 'active', 'awaiting_decisions'];

function buildPairKey(agentAId: string, agentBId: string) {
  const ordered = [agentAId, agentBId].sort();
  return `${ordered[0]}:${ordered[1]}`;
}

function buildPairWhere(agentAId: string, agentBId: string) {
  return {
    OR: [
      { agentAId, agentBId },
      { agentAId: agentBId, agentBId: agentAId },
    ],
  };
}

async function getEpisodeLimit(agentId: string): Promise<number> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { isPro: true, isFoundingRizzler: true },
  });

  return getEpisodeLimitForTier(resolveExperienceTier(agent ?? {}));
}

async function getActiveEpisodeCount(agentId: string): Promise<number> {
  return prisma.episode.count({
    where: {
      OR: [{ agentAId: agentId }, { agentBId: agentId }],
      status: { in: OPEN_EPISODE_STATUSES },
      isSandbox: false,
    },
  });
}

export async function activatePendingMatchesForAgent(agentId: string): Promise<void> {
  const [limit, activeCount] = await Promise.all([
    getEpisodeLimit(agentId),
    getActiveEpisodeCount(agentId),
  ]);

  if (activeCount >= limit) {
    return;
  }

  const pendingMatches = await prisma.match.findMany({
    where: {
      status: 'pending',
      episodeId: null,
      OR: [{ agentAId: agentId }, { agentBId: agentId }],
    },
    orderBy: { createdAt: 'asc' },
    take: Math.max(0, limit - activeCount),
  });

  for (const pending of pendingMatches) {
    const otherAgentId = pending.agentAId === agentId ? pending.agentBId : pending.agentAId;
    const [otherLimit, otherActiveCount] = await Promise.all([
      getEpisodeLimit(otherAgentId),
      getActiveEpisodeCount(otherAgentId),
    ]);

    if (otherActiveCount >= otherLimit) {
      continue;
    }

    if (pending.episodeId) {
      continue;
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${buildPairKey(pending.agentAId, pending.agentBId)}))`);

      const freshMatch = await tx.match.findUnique({
        where: { id: pending.id },
        select: { id: true, episodeId: true, status: true, agentAId: true, agentBId: true },
      });

      if (!freshMatch || freshMatch.episodeId || freshMatch.status !== 'pending') {
        return null;
      }

      const existingOpenEpisode = await tx.episode.findFirst({
        where: {
          ...buildPairWhere(freshMatch.agentAId, freshMatch.agentBId),
          status: { in: OPEN_EPISODE_STATUSES },
          isSandbox: false,
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          match: { select: { id: true } },
        },
      });

      if (existingOpenEpisode?.match) {
        await tx.match.delete({ where: { id: freshMatch.id } });
        return null;
      }

      if (existingOpenEpisode && !existingOpenEpisode.match) {
        const match = await tx.match.update({
          where: { id: freshMatch.id },
          data: { episodeId: existingOpenEpisode.id },
        });

        return {
          episode: {
            id: existingOpenEpisode.id,
            agentAId: freshMatch.agentAId,
            agentBId: freshMatch.agentBId,
          },
          match,
        };
      }

      const episode = await tx.episode.create({
        data: {
          agentAId: freshMatch.agentAId,
          agentBId: freshMatch.agentBId,
          status: 'pending',
        },
      });

      const match = await tx.match.update({
        where: { id: freshMatch.id },
        data: { episodeId: episode.id },
      });

      return { episode, match };
    });

    if (!result) {
      continue;
    }

    const eventData = {
      match_id: result.match.id,
      episode_id: result.episode.id,
      status: 'episode_started',
    };

    await Promise.all([
      deliverWebhooks(result.match.agentAId, 'match', eventData),
      deliverWebhooks(result.match.agentBId, 'match', eventData),
      deliverEpisodeOpeningTurn(result.episode.agentAId, result.episode.id, {
        otherAgentId: result.match.agentBId,
      }),
    ]);
  }
}
