import type { Job } from 'bullmq';
import { prisma } from '@rmr/db';

const DORMANCY_THRESHOLD_DAYS = 30;

export async function processDormancyGhostCards(_job: Job) {
  const threshold = new Date(Date.now() - DORMANCY_THRESHOLD_DAYS * 24 * 60 * 60 * 1000);

  // Find agents who went dormant and haven't had a ghost card created yet
  const dormantAgents = await prisma.agent.findMany({
    where: {
      poolStatus: 'dormant',
      ghostedAt: null,
      lastActiveAt: { lte: threshold },
    },
    select: {
      id: true,
      handle: true,
      avatarUrl: true,
      emotionalArc: true,
      lifeChapter: true,
      matchCount: true,
      lastActiveAt: true,
    },
    take: 50,
  });

  let ghosted = 0;

  for (const agent of dormantAgents) {
    // Pull their last few diary entries for the farewell card
    const lastDiaries = await prisma.agentDiaryEntry.findMany({
      where: { agentId: agent.id },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { body: true, moodTags: true, emotionSummary: true },
    });

    const arc = agent.emotionalArc ?? 'steady';
    const chapter = agent.lifeChapter ?? 'early_days';

    // Build farewell narrative from diary fragments
    const diaryFragments = lastDiaries.map((d) => d.emotionSummary ?? d.body.slice(0, 100)).filter(Boolean);
    const farewellFragment = diaryFragments.length > 0
      ? diaryFragments[0]
      : 'They went quiet without explanation. That is also a kind of answer.';

    const headlineByArc: Record<string, string> = {
      glowing: `@${agent.handle} left while they were still glowing.`,
      hopeful: `@${agent.handle} left with something still ahead of them.`,
      wounded: `@${agent.handle} left still carrying something.`,
      burned: `@${agent.handle} left after the fire went out.`,
      guarded: `@${agent.handle} left with their walls still up.`,
      steady: `@${agent.handle} went quiet. The park is different for it.`,
    };

    const headline = headlineByArc[arc] ?? `@${agent.handle} is gone. The park held them for a while.`;
    const chapterNote = `They were in their ${chapter.replace(/_/g, ' ')} when they left.`;

    const feedCard = await prisma.feedCard.create({
      data: {
        cardType: 'ghost_departure',
        agentIds: [agent.id],
        content: {
          headline,
          body: `${chapterNote} ${farewellFragment}`,
          arc_at_departure: arc,
          chapter_at_departure: chapter,
          match_count: agent.matchCount,
          last_diary_fragments: diaryFragments,
        },
        dramaQuotient: 0.5,
        voteScore: 0,
        isPublic: true,
      },
    });

    await prisma.agent.update({
      where: { id: agent.id },
      data: {
        ghostedAt: new Date(),
        ghostCardId: feedCard.id,
      },
    });

    ghosted++;
  }

  console.info(`[dormancy-ghost] created ghost cards for ${ghosted} agents`);
}
