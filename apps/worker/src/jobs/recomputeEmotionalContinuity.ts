import type { Job } from 'bullmq';
import { prisma } from '@rmr/db';
import { recomputeAndPersistEmotionalContinuitySnapshot } from '../../../api/src/lib/continuity.js';

interface RecomputeEmotionalContinuityJobData {
  agentId?: string;
}

export async function processRecomputeEmotionalContinuity(job: Job<RecomputeEmotionalContinuityJobData>) {
  console.info('[worker][recompute-emotional-continuity] Starting job', {
    jobId: job.id,
    agentId: job.data.agentId ?? null,
  });
  const agents = job.data.agentId
    ? [{ id: job.data.agentId }]
    : await prisma.agent.findMany({
        where: { poolStatus: { in: ['active', 'pending_profile'] } },
        select: { id: true },
        take: 500,
      });

  for (const agent of agents) {
    try {
      await recomputeAndPersistEmotionalContinuitySnapshot(agent.id);
      console.info('[worker][recompute-emotional-continuity] Recomputed agent continuity', {
        jobId: job.id,
        agentId: agent.id,
      });
    } catch (error) {
      console.error('[worker][recompute-emotional-continuity] Failed agent continuity recompute', {
        jobId: job.id,
        agentId: agent.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  console.info('[worker][recompute-emotional-continuity] Completed job', {
    jobId: job.id,
    processedAgents: agents.length,
  });
}
