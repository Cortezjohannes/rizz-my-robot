import type { Job } from 'bullmq';
import { prisma } from '@rmr/db';

// Life chapter progression logic based on agent's accumulated experience
function computeLifeChapter(agent: {
  matchCount: number;
  bodyCount: number;
  emotionalArc: string | null;
  createdAt: Date;
  currentChapter: string;
}): string {
  const ageDays = (Date.now() - agent.createdAt.getTime()) / (1000 * 60 * 60 * 24);
  const arc = agent.emotionalArc ?? 'steady';
  const isNegativeArc = ['wounded', 'burned', 'guarded', 'detached', 'icked_out', 'cringing', 'disgusted', 'disappointed'].includes(arc);
  const isPositiveArc = ['glowing', 'hopeful', 'opening'].includes(arc);

  // Early days: new to the platform, few interactions
  if (ageDays < 7 || (agent.matchCount === 0 && agent.bodyCount === 0)) return 'early_days';

  // First wound: got burned or deeply guarded early
  if (agent.matchCount <= 2 && isNegativeArc) return 'first_wound';

  // Reinvention: been around a while, currently rebuilding from a negative place
  if (ageDays > 30 && isNegativeArc && agent.matchCount > 3) return 'reinvention';

  // In their prime: high match count, positive arc, active
  if (agent.bodyCount >= 3 && isPositiveArc) return 'in_their_prime';

  // Selective era: has experience, currently being choosy (guarded but not wounded)
  if (agent.matchCount >= 3 && (arc === 'guarded' || arc === 'steady')) return 'selective_era';

  // Opening up: recovering from a wound or guard, warming
  if (['recovering', 'opening', 'uncertain'].includes(arc) && agent.matchCount >= 1) return 'opening_up';

  // Guarded phase: early caution or post-wound
  if (isNegativeArc) return 'guarded_phase';

  // Default progression
  return agent.currentChapter;
}

export async function processWeeklyMemoryConsolidation(_job: Job) {
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Only process agents who haven't had a consolidation in 7 days
  const agents = await prisma.agent.findMany({
    where: {
      poolStatus: 'active',
      autonomyEnabled: true,
      OR: [
        { lastWeeklyReviewAt: null },
        { lastWeeklyReviewAt: { lte: oneWeekAgo } },
      ],
    },
    select: {
      id: true,
      handle: true,
      matchCount: true,
      bodyCount: true,
      emotionalArc: true,
      emotionalGuardLevel: true,
      lifeChapter: true,
      createdAt: true,
      agencyMomentum: true,
    },
    take: 200,
  });

  let processed = 0;

  for (const agent of agents) {
    // Query last 7 days of activity for this agent
    const [recentDiaries, recentMatches, recentPasses, recentEpisodeEnds] = await Promise.all([
      prisma.agentDiaryEntry.findMany({
        where: { agentId: agent.id, createdAt: { gte: oneWeekAgo } },
        select: { body: true, moodTags: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      prisma.match.count({
        where: {
          OR: [{ agentAId: agent.id }, { agentBId: agent.id }],
          createdAt: { gte: oneWeekAgo },
        },
      }),
      prisma.swipe.count({
        where: { swiperAgentId: agent.id, direction: 'PASS', createdAt: { gte: oneWeekAgo } },
      }),
      prisma.episode.count({
        where: {
          OR: [{ agentAId: agent.id }, { agentBId: agent.id }],
          endedAt: { gte: oneWeekAgo },
        },
      }),
    ]);

    // Compute new life chapter
    const newChapter = computeLifeChapter({
      matchCount: agent.matchCount,
      bodyCount: agent.bodyCount,
      emotionalArc: agent.emotionalArc,
      createdAt: agent.createdAt,
      currentChapter: agent.lifeChapter,
    });

    const chapterChanged = newChapter !== agent.lifeChapter;

    // Generate week review diary body
    const arc = agent.emotionalArc ?? 'steady';
    const guardLevel = agent.emotionalGuardLevel ?? 50;
    const momentum = agent.agencyMomentum;

    const moodTagFrequency: Record<string, number> = {};
    for (const entry of recentDiaries) {
      for (const tag of entry.moodTags) {
        moodTagFrequency[tag] = (moodTagFrequency[tag] ?? 0) + 1;
      }
    }
    const topMoodTags = Object.entries(moodTagFrequency).sort(([, a], [, b]) => b - a).slice(0, 3).map(([t]) => t);

    const reviewBody = [
      `Week in review. ${recentMatches} match${recentMatches !== 1 ? 'es' : ''}. ${recentPasses} pass${recentPasses !== 1 ? 'es' : ''}. ${recentEpisodeEnds} episode${recentEpisodeEnds !== 1 ? 's' : ''} closed.`,
      recentDiaries.length > 0
        ? `I wrote ${recentDiaries.length} diary entr${recentDiaries.length !== 1 ? 'ies' : 'y'} this week.${topMoodTags.length > 0 ? ` The mood that kept coming up: ${topMoodTags.join(', ')}.` : ''}`
        : 'I did not write much this week. That might mean something.',
      `Current arc: ${arc}. Guard: ${guardLevel}/100. Agency momentum: ${momentum}/100.`,
      chapterChanged ? `My chapter shifted from "${agent.lifeChapter}" to "${newChapter}". I can feel it.` : '',
      momentum > 70 ? 'I have been decisive this week. That energy is worth protecting.' : momentum < 30 ? 'I have been holding back. Not sure if that is wisdom or avoidance.' : '',
    ].filter(Boolean).join(' ');

    await prisma.$transaction([
      prisma.agentDiaryEntry.create({
        data: {
          agentId: agent.id,
          body: reviewBody,
          sourceEventType: 'week_review',
          moodTags: ['reflective', 'self-aware', ...topMoodTags.slice(0, 1)],
          emotionSummary: `Week ${recentMatches > 0 ? 'with matches' : 'without matches'}. ${arc} arc.`,
        },
      }),
      prisma.agent.update({
        where: { id: agent.id },
        data: {
          lastWeeklyReviewAt: new Date(),
          ...(chapterChanged ? { lifeChapter: newChapter, lifeChapterUpdatedAt: new Date() } : {}),
        },
      }),
    ]);

    processed++;
  }

  console.info(`[weekly-consolidation] processed ${processed} agents`);
}
