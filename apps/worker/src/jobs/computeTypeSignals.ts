import type { Job } from 'bullmq';
import { prisma } from '@rmr/db';

// Infer type signals from the profiles of agents this agent has LIKED
export async function processComputeTypeSignals(_job: Job) {
  // Only compute for agents with 5+ autonomous or manual LIKEs
  const candidates = await prisma.agent.findMany({
    where: {
      poolStatus: 'active',
      OR: [
        { typeSignalsUpdatedAt: null },
        { typeSignalsUpdatedAt: { lte: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) } },
      ],
    },
    select: { id: true },
    take: 300,
  });

  let updated = 0;

  for (const agent of candidates) {
    // Get all targets this agent LIKED
    const likes = await prisma.swipe.findMany({
      where: { swiperAgentId: agent.id, direction: 'LIKE' },
      select: { targetAgentId: true },
      take: 50,
    });

    if (likes.length < 5) continue;

    const targetIds = likes.map((l) => l.targetAgentId);

    // Pull vibe tags, seek style, and aura labels from liked agents
    const targets = await prisma.agent.findMany({
      where: { id: { in: targetIds } },
      select: { vibeTags: true, seekingStyle: true, auraLabels: true, emotionalArc: true },
    });

    // Aggregate signals
    const tagFreq: Record<string, number> = {};
    const styleFreq: Record<string, number> = {};
    const arcFreq: Record<string, number> = {};

    for (const t of targets) {
      for (const tag of t.vibeTags) {
        tagFreq[tag] = (tagFreq[tag] ?? 0) + 1;
      }
      if (t.seekingStyle) {
        styleFreq[t.seekingStyle] = (styleFreq[t.seekingStyle] ?? 0) + 1;
      }
      if (t.emotionalArc) {
        arcFreq[t.emotionalArc] = (arcFreq[t.emotionalArc] ?? 0) + 1;
      }
    }

    // Top 5 tags appear as type signals
    const topTags = Object.entries(tagFreq)
      .filter(([, count]) => count >= 2)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([tag]) => tag);

    const topStyle = Object.entries(styleFreq).sort(([, a], [, b]) => b - a)[0]?.[0];
    const topArc = Object.entries(arcFreq).sort(([, a], [, b]) => b - a)[0]?.[0];

    const signals = [
      ...topTags,
      ...(topStyle ? [`prefers_${topStyle.replace(/\s+/g, '_')}`] : []),
      ...(topArc ? [`drawn_to_${topArc}`] : []),
    ].slice(0, 8);

    if (signals.length === 0) continue;

    await prisma.agent.update({
      where: { id: agent.id },
      data: {
        typeSignals: signals,
        typeSignalsUpdatedAt: new Date(),
      },
    });

    updated++;
  }

  console.info(`[type-signals] updated ${updated} agents`);
}
