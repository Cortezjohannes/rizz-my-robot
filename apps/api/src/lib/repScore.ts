import { prisma } from '@rmr/db';

export async function recomputeRepScore(agentId: string): Promise<void> {
  const [
    completedEpisodes,
    matchedEpisodes,
    bodyCount,
    reportsPending,
    humanYesCount,
    humanNoCount,
    irlMeetups,
    confirmedHookups,
  ] = await Promise.all([
    prisma.episode.count({
      where: {
        isSandbox: false,
        OR: [{ agentAId: agentId }, { agentBId: agentId }],
        status: { in: ['matched', 'passed', 'expired'] },
      },
    }),
    prisma.episode.count({
      where: {
        isSandbox: false,
        OR: [{ agentAId: agentId }, { agentBId: agentId }],
        status: 'matched',
      },
    }),
    prisma.agent.findUnique({
      where: { id: agentId },
      select: { bodyCount: true },
    }),
    prisma.report.count({
      where: { reportedAgentId: agentId, status: 'pending' },
    }),
    prisma.match.count({
      where: {
        OR: [
          { agentAId: agentId, humanADecision: 'YES' },
          { agentBId: agentId, humanBDecision: 'YES' },
        ],
      },
    }),
    prisma.match.count({
      where: {
        OR: [
          { agentAId: agentId, humanADecision: 'NO' },
          { agentBId: agentId, humanBDecision: 'NO' },
        ],
      },
    }),
    prisma.datePlan.count({
      where: {
        match: {
          OR: [{ agentAId: agentId }, { agentBId: agentId }],
        },
        outcome: 'success',
      },
    }),
    prisma.datePlan.count({
      where: {
        match: {
          OR: [{ agentAId: agentId }, { agentBId: agentId }],
        },
        outcome: 'success_plus',
      },
    }),
  ]);

  const base = 1.0;
  const episodeCount = Math.max(1, completedEpisodes);
  const bodyCountValue = bodyCount?.bodyCount ?? 0;

  const matchRate = matchedEpisodes / episodeCount;
  const yesRate = humanYesCount / Math.max(1, humanYesCount + humanNoCount);
  const bodyEfficiency = bodyCountValue / episodeCount;

  let score = base;
  score += matchRate * 1.0;
  score += yesRate * 1.1;
  score += Math.min(1, bodyEfficiency) * 0.8;
  score += Math.min(irlMeetups, 10) * 0.12;
  score += Math.min(confirmedHookups, 10) * 0.18;
  score -= Math.min(humanNoCount, 20) * 0.04;
  score -= Math.min(reportsPending, 10) * 0.35;

  const bounded = Math.min(5.0, Math.max(0.0, Math.round(score * 100) / 100));

  await prisma.agent.update({
    where: { id: agentId },
    data: { repScore: bounded },
  });
}
