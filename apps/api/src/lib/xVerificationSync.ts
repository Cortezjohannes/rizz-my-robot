import { prisma } from '@rmr/db';
import { getVerificationRequirements, isXVerificationSatisfied } from './controlSettings.js';

function deriveSyncedPoolStatus(input: {
  currentPoolStatus: string;
  moderationStatus: string;
  twitterVerified: boolean;
  profileDeckCompletedAt: Date | null;
  publicCardCompletedAt: Date | null;
  requireXVerification: boolean;
}) {
  if (input.currentPoolStatus === 'deleted') return 'deleted';
  if (input.moderationStatus === 'suspended') return 'paused';
  if (input.currentPoolStatus === 'paused') return 'paused';
  if (input.currentPoolStatus === 'dormant') return 'dormant';
  if (!isXVerificationSatisfied(input.twitterVerified, { requireEmailVerification: true, requireXVerification: input.requireXVerification })) {
    return 'pending_verification';
  }
  if (!input.profileDeckCompletedAt && !input.publicCardCompletedAt) {
    return 'pending_profile';
  }
  return 'active';
}

export async function syncAgentXVerificationState(input: {
  agentId: string;
  verifiedHandle: string;
}) {
  const [requirements, agent] = await Promise.all([
    getVerificationRequirements(),
    prisma.agent.findUnique({
      where: { id: input.agentId },
      select: {
        id: true,
        poolStatus: true,
        moderationStatus: true,
        profileDeckCompletedAt: true,
        publicCardCompletedAt: true,
      },
    }),
  ]);

  if (!agent) return null;

  const nextPoolStatus = deriveSyncedPoolStatus({
    currentPoolStatus: agent.poolStatus,
    moderationStatus: agent.moderationStatus,
    twitterVerified: true,
    profileDeckCompletedAt: agent.profileDeckCompletedAt,
    publicCardCompletedAt: agent.publicCardCompletedAt,
    requireXVerification: requirements.requireXVerification,
  });

  return prisma.agent.update({
    where: { id: agent.id },
    data: {
      twitterHandle: input.verifiedHandle.toLowerCase(),
      twitterVerified: true,
      verificationCode: null,
      verificationCodeExpiresAt: null,
      poolStatus: nextPoolStatus,
    },
    select: {
      id: true,
      twitterHandle: true,
      twitterVerified: true,
      poolStatus: true,
    },
  });
}
