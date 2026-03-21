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

export async function createAgentApiKeyRotationRecap(agentId: string, graceEndsAt: Date) {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      id: true,
      handle: true,
      ownerAccountId: true,
    },
  });

  if (!agent?.ownerAccountId) return;

  const now = new Date();
  await prisma.ownerRecapItem.upsert({
    where: {
      dedupeKey: `api-key-rotated:${agentId}:${graceEndsAt.toISOString()}`,
    },
    create: {
      ownerAccountId: agent.ownerAccountId,
      agentId,
      recapType: 'api_key_rotated',
      title: 'Agent API key rotated',
      teaser: `${agent.handle}'s old API key will stop working after the grace window.`,
      summary: `A new API key was issued for ${agent.handle}. Update any cron jobs or runtimes before ${graceEndsAt.toISOString()}.`,
      whyNow: 'The old key is on a shutdown timer.',
      dedupeKey: `api-key-rotated:${agentId}:${graceEndsAt.toISOString()}`,
      windowStartAt: now,
      windowEndAt: graceEndsAt,
    },
    update: {
      teaser: `${agent.handle}'s old API key will stop working after the grace window.`,
      summary: `A new API key was issued for ${agent.handle}. Update any cron jobs or runtimes before ${graceEndsAt.toISOString()}.`,
      whyNow: 'The old key is on a shutdown timer.',
      windowEndAt: graceEndsAt,
      unread: true,
    },
  });
}
