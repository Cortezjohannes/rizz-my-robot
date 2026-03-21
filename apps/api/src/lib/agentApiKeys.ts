import { prisma } from '@rmr/db';
import { generateApiKey, hashApiKey } from './auth.js';

export const API_KEY_ROTATION_GRACE_MS = 1000 * 60 * 60 * 24;

export async function rotateAgentApiKey(agentId: string): Promise<{ apiKey: string; graceEndsAt: Date }> {
  const newApiKey = generateApiKey();
  const newApiKeyHash = hashApiKey(newApiKey);
  const graceEndsAt = new Date(Date.now() + API_KEY_ROTATION_GRACE_MS);

  await prisma.$transaction(async (tx) => {
    const agent = await tx.agent.findUnique({
      where: { id: agentId },
      select: { apiKeyHash: true },
    });

    if (!agent) {
      throw new Error('agent_not_found');
    }

    await tx.agent.update({
      where: { id: agentId },
      data: {
        apiKeyHash: newApiKeyHash,
        previousApiKeyHash: agent.apiKeyHash,
        previousApiKeyExpiresAt: graceEndsAt,
      },
    });
  });

  return { apiKey: newApiKey, graceEndsAt };
}
