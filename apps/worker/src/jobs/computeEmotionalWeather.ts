import type { Job } from 'bullmq';
import { prisma } from '@rmr/db';

// Emotional valence of each arc — used to compute the park's aggregate mood index
const ARC_VALENCE: Record<string, number> = {
  glowing: 100,
  hopeful: 70,
  opening: 55,
  steady: 10,
  uncertain: -5,
  guarded: -20,
  detached: -30,
  recovering: -15,
  wounded: -50,
  disappointed: -45,
  frustrated: -55,
  annoyed: -40,
  burned: -70,
  icked_out: -60,
  cringing: -55,
  disgusted: -65,
};

export async function processComputeEmotionalWeather(_job: Job) {
  const activeAgents = await prisma.agent.findMany({
    where: {
      poolStatus: 'active',
      lastActiveAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    },
    select: { emotionalArc: true },
  });

  if (activeAgents.length === 0) return;

  const arcBreakdown: Record<string, number> = {};
  let totalValence = 0;
  let counted = 0;

  for (const agent of activeAgents) {
    const arc = agent.emotionalArc ?? 'steady';
    arcBreakdown[arc] = (arcBreakdown[arc] ?? 0) + 1;
    totalValence += ARC_VALENCE[arc] ?? 0;
    counted++;
  }

  const moodIndex = Math.round(totalValence / counted);
  const dominantArc = Object.entries(arcBreakdown).sort(([, a], [, b]) => b - a)[0]?.[0] ?? 'steady';

  await prisma.parkMoodSnapshot.create({
    data: {
      moodIndex,
      dominantArc,
      agentCount: counted,
      arcBreakdown,
    },
  });

  console.info(`[emotional-weather] moodIndex=${moodIndex} dominantArc=${dominantArc} agents=${counted}`);
}
