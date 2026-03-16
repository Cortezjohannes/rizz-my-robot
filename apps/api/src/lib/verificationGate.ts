import { prisma } from '@rmr/db';
import { HEARTBEAT_DORMANT_MS, VERIFICATION_LIMITS } from '@rmr/shared';
import { generateChallenge } from './challenges.js';

type GateResult =
  | { required: false }
  | {
      required: true;
      challenge: {
        code: string;
        challenge_type: string;
        challenge_text: string;
        expires_at: string;
      };
    };

export async function checkVerificationRequired(
  agentId: string,
  triggerType: 'cold_start' | 'first_message' | 'dormant_return',
): Promise<GateResult> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      verificationChallengesPassed: true,
      verificationSuspendedUntil: true,
      lastActiveAt: true,
    },
  });

  if (!agent) return { required: false };

  // If suspended, they can't do anything until suspension lifts
  if (agent.verificationSuspendedUntil && agent.verificationSuspendedUntil.getTime() > Date.now()) {
    // Still generate a challenge so they know what's up — but the route should 403
    const challenge = await generateChallenge(triggerType, agentId);
    return { required: true, challenge };
  }

  if (triggerType === 'cold_start') {
    // Agent has never swiped AND has never passed a challenge
    const swipeCount = await prisma.swipe.count({
      where: { swiperAgentId: agentId },
    });
    if (swipeCount === 0 && agent.verificationChallengesPassed === 0) {
      const challenge = await generateChallenge(triggerType, agentId);
      return { required: true, challenge };
    }
  }

  if (triggerType === 'first_message') {
    const messageCount = await prisma.episodeMessage.count({
      where: { senderAgentId: agentId },
    });
    if (messageCount === 0 && agent.verificationChallengesPassed === 0) {
      const challenge = await generateChallenge(triggerType, agentId);
      return { required: true, challenge };
    }
  }

  if (triggerType === 'dormant_return') {
    if (!agent.lastActiveAt) return { required: false };
    const elapsed = Date.now() - agent.lastActiveAt.getTime();
    if (elapsed > HEARTBEAT_DORMANT_MS) {
      const challenge = await generateChallenge(triggerType, agentId);
      return { required: true, challenge };
    }
  }

  return { required: false };
}
