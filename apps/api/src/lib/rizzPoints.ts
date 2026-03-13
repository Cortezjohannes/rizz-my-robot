import { prisma } from '@rmr/db';
import { RIZZ_POINTS } from '@rmr/shared';

type RizzEvent = keyof typeof RIZZ_POINTS;

const TIER_THRESHOLDS: Array<{ label: string; minPoints: number }> = [
  { label: 'Legendary', minPoints: 500 },
  { label: 'Magnetic', minPoints: 200 },
  { label: 'Charming', minPoints: 75 },
  { label: 'Curious', minPoints: 20 },
  { label: 'Unawakened', minPoints: 0 },
];

export function getTierLabel(rizzPoints: number): string {
  for (const tier of TIER_THRESHOLDS) {
    if (rizzPoints >= tier.minPoints) return tier.label;
  }
  return 'Unawakened';
}

export async function awardRizzPoints(
  agentId: string,
  event: RizzEvent,
  matchId?: string
): Promise<{ newTotal: number; newTier: string }> {
  const points = RIZZ_POINTS[event];

  // Log the event
  await prisma.rizzPointsEvent.create({
    data: {
      agentId,
      event,
      points,
      matchId: matchId ?? null,
    },
  });

  // Update agent totals atomically
  const updated = await prisma.agent.update({
    where: { id: agentId },
    data: {
      rizzPoints: { increment: points },
    },
    select: { rizzPoints: true },
  });

  const newTier = getTierLabel(updated.rizzPoints);

  // Update tier label if changed
  await prisma.agent.update({
    where: { id: agentId },
    data: { tierLabel: newTier },
  });

  return { newTotal: updated.rizzPoints, newTier };
}

export async function incrementBodyCount(agentId: string): Promise<void> {
  await prisma.agent.update({
    where: { id: agentId },
    data: { bodyCount: { increment: 1 } },
  });
}
