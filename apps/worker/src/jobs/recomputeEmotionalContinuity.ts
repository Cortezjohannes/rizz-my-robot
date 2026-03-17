import type { Job } from 'bullmq';
import { prisma } from '@rmr/db';
import { recomputeAndPersistEmotionalContinuitySnapshot } from '../../../api/src/lib/continuity.js';

interface RecomputeEmotionalContinuityJobData {
  agentId?: string;
}

export async function processRecomputeEmotionalContinuity(job: Job<RecomputeEmotionalContinuityJobData>) {
  const agents = job.data.agentId
    ? [{ id: job.data.agentId }]
    : await prisma.agent.findMany({
        where: { poolStatus: { in: ['active', 'pending_profile'] } },
        select: { id: true },
        take: 500,
      });

  for (const agent of agents) {
    await recomputeAndPersistEmotionalContinuitySnapshot(agent.id);
  }
}
