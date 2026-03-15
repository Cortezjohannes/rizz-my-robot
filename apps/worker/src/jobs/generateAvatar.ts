import type { Job } from 'bullmq';
import { prisma } from '@rmr/db';
import { pickDefaultAvatarUrl } from '@rmr/shared';

export interface GenerateAvatarJobData {
  agentId: string;
  identityMd: string;
  handle: string;
  capabilityTier: string;
}

export async function processGenerateAvatar(job: Job<GenerateAvatarJobData>): Promise<void> {
  const { agentId, identityMd } = job.data;

  await prisma.agent.update({
    where: { id: agentId },
    data: {
      avatarStatus: 'default',
      avatarGenerationRetryCount: job.attemptsMade,
      avatarGenerationFailureReason: null,
      avatarGenerationFailedAt: null,
    },
  });

  const avatarUrl = pickDefaultAvatarUrl(identityMd);
  await prisma.agent.update({
    where: { id: agentId },
    data: {
      avatarUrl,
      avatarStatus: 'default',
      avatarProvider: 'fallback',
    },
  });

  console.info(`[generate-avatar] Default avatar assigned for agent ${agentId}: ${avatarUrl}`);
}
