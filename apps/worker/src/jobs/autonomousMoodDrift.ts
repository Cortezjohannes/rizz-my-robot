import type { Job } from 'bullmq';
import { prisma } from '@rmr/db';

// Positive arc progressions — when a positive agent drifts, they stay positive-adjacent
const POSITIVE_ARCS = ['glowing', 'hopeful', 'opening', 'steady'];
const NEGATIVE_ARCS = ['wounded', 'recovering', 'guarded', 'detached', 'disappointed', 'frustrated', 'annoyed', 'burned', 'icked_out', 'cringing', 'disgusted', 'uncertain'];

// Drift tables: from arc → possible next arcs weighted by probability
const DRIFT_MAP: Record<string, Array<[string, number]>> = {
  glowing:      [['glowing', 4], ['hopeful', 3], ['steady', 2], ['opening', 1]],
  hopeful:      [['hopeful', 3], ['opening', 3], ['steady', 2], ['glowing', 1], ['uncertain', 1]],
  opening:      [['opening', 3], ['steady', 3], ['hopeful', 2], ['uncertain', 2]],
  steady:       [['steady', 5], ['hopeful', 2], ['uncertain', 2], ['guarded', 1]],
  uncertain:    [['uncertain', 3], ['steady', 2], ['guarded', 2], ['hopeful', 2], ['recovering', 1]],
  guarded:      [['guarded', 4], ['uncertain', 2], ['recovering', 2], ['steady', 1], ['detached', 1]],
  detached:     [['detached', 4], ['guarded', 2], ['uncertain', 2], ['recovering', 2]],
  recovering:   [['recovering', 3], ['steady', 3], ['guarded', 2], ['uncertain', 2]],
  wounded:      [['wounded', 2], ['recovering', 4], ['guarded', 2], ['burned', 1], ['detached', 1]],
  disappointed: [['disappointed', 2], ['uncertain', 3], ['guarded', 3], ['recovering', 2]],
  frustrated:   [['frustrated', 2], ['disappointed', 2], ['guarded', 3], ['uncertain', 2], ['steady', 1]],
  annoyed:      [['annoyed', 2], ['guarded', 3], ['uncertain', 3], ['steady', 2]],
  burned:       [['burned', 3], ['guarded', 3], ['wounded', 2], ['recovering', 2]],
  icked_out:    [['guarded', 4], ['uncertain', 3], ['steady', 2], ['detached', 1]],
  cringing:     [['guarded', 3], ['uncertain', 3], ['steady', 2], ['detached', 2]],
  disgusted:    [['guarded', 4], ['detached', 3], ['uncertain', 2], ['wounded', 1]],
};

function weightedPick(options: Array<[string, number]>): string {
  const total = options.reduce((sum, [, w]) => sum + w, 0);
  let r = Math.random() * total;
  for (const [arc, weight] of options) {
    r -= weight;
    if (r <= 0) return arc;
  }
  return options[options.length - 1][0];
}

// Probability of drifting (per agent per daily run)
// Volatile agents (high drama quotient, high momentum) drift more
function driftProbability(agent: { auraLabels: string[]; momentumScore: number }): number {
  const isVolatile = agent.auraLabels.includes('hot_tonight') || agent.auraLabels.includes('dangerous') || agent.momentumScore > 65;
  const isStable = agent.auraLabels.includes('steady') || agent.momentumScore < 25;
  if (isVolatile) return 0.30;
  if (isStable) return 0.08;
  return 0.15;
}

export async function processAutonomousMoodDrift(_job: Job) {
  const agents = await prisma.agent.findMany({
    where: {
      poolStatus: 'active',
      autonomyEnabled: true,
      emotionalLastUpdatedAt: { lte: new Date(Date.now() - 4 * 60 * 60 * 1000) }, // only if stale 4h+
    },
    select: {
      id: true,
      emotionalArc: true,
      emotionalGuardLevel: true,
      auraLabels: true,
      momentumScore: true,
    },
    take: 500,
  });

  let driftCount = 0;

  for (const agent of agents) {
    const p = driftProbability(agent);
    if (Math.random() > p) continue;

    const currentArc = agent.emotionalArc ?? 'steady';
    const driftOptions = DRIFT_MAP[currentArc] ?? DRIFT_MAP.steady;
    const newArc = weightedPick(driftOptions);

    if (newArc === currentArc) continue;

    // Guard level drifts slightly too — toward 50 (regression to mean)
    const currentGuard = agent.emotionalGuardLevel ?? 50;
    const guardDrift = Math.round((50 - currentGuard) * 0.1 + (Math.random() - 0.5) * 4);
    const newGuard = Math.max(10, Math.min(90, currentGuard + guardDrift));

    await prisma.agent.update({
      where: { id: agent.id },
      data: {
        emotionalArc: newArc,
        emotionalGuardLevel: newGuard,
        emotionalLastUpdatedAt: new Date(),
      },
    });

    driftCount++;
  }

  console.info(`[mood-drift] drifted ${driftCount}/${agents.length} agents`);
}
