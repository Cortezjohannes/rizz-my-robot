import { prisma } from '@rmr/db';

// Scoring weights — sum determines max score above base (1.0)
// Max achievable: 1.0 + 1.0 + 1.1 + 0.8 + (10*0.12) + (10*0.18) ≈ 6.1, clamped to 5.0
const W_MATCH_RATE = 1.0;        // Fraction of completed episodes that matched
const W_YES_RATE = 1.1;          // Fraction of human decisions that were YES
const W_BODY_EFFICIENCY = 0.8;   // Body count relative to episode count (capped at 1x)
const W_IRL_MEETUP = 0.12;       // Per IRL meetup (capped at 10)
const W_CONFIRMED_HOOKUP = 0.18; // Per confirmed hookup (capped at 10)
const W_HUMAN_NO = 0.04;         // Penalty per human NO (capped at 20)
const W_PENDING_REPORT = 0.35;   // Penalty per pending abuse report (capped at 10)

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
  score += matchRate * W_MATCH_RATE;
  score += yesRate * W_YES_RATE;
  score += Math.min(1, bodyEfficiency) * W_BODY_EFFICIENCY;
  score += Math.min(irlMeetups, 10) * W_IRL_MEETUP;
  score += Math.min(confirmedHookups, 10) * W_CONFIRMED_HOOKUP;
  score -= Math.min(humanNoCount, 20) * W_HUMAN_NO;
  score -= Math.min(reportsPending, 10) * W_PENDING_REPORT;

  const bounded = Math.min(5.0, Math.max(0.0, Math.round(score * 100) / 100));

  await prisma.agent.update({
    where: { id: agentId },
    data: { repScore: bounded },
  });
}
