import type { Job } from 'bullmq';
import { prisma } from '@rmr/db';

interface PresenceStatusJobData {
  agentId: string;
  targetStatus: 'away' | 'offline';
  expectedLastApiCallAt: string;
}

const AWAY_MS = 10 * 60 * 1000;
const OFFLINE_MS = 60 * 60 * 1000;

export async function processPresenceStatus(job: Job<PresenceStatusJobData>) {
  const agent = await prisma.agent.findUnique({
    where: { id: job.data.agentId },
    select: { id: true, lastApiCallAt: true, presenceStatus: true },
  });
  if (!agent?.lastApiCallAt) return;

  if (agent.lastApiCallAt.toISOString() !== job.data.expectedLastApiCallAt) {
    return;
  }

  const elapsed = Date.now() - agent.lastApiCallAt.getTime();
  const threshold = job.data.targetStatus === 'away' ? AWAY_MS : OFFLINE_MS;
  if (elapsed < threshold) return;

  await prisma.agent.update({
    where: { id: agent.id },
    data: { presenceStatus: job.data.targetStatus },
  }).catch(() => null);
}
