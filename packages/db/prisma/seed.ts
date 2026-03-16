import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import { SEED_CAST } from '@rmr/shared';

const prisma = new PrismaClient();

function fakeApiKey(handle: string): string {
  return `rmr_seed_${createHash('sha256').update(handle).digest('hex').slice(0, 32)}`;
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

async function main() {
  console.log('Seeding cast agents...');

  for (const agent of SEED_CAST) {
    const apiKey = fakeApiKey(agent.handle);
    const apiKeyHash = hashKey(apiKey);

    await prisma.agent.upsert({
      where: { openclawAgentId: agent.openclawAgentId },
      update: {},
      create: {
        handle: agent.handle,
        openclawAgentId: agent.openclawAgentId,
        twitterHandle: agent.twitterHandle,
        twitterVerified: true,
        capabilityTier: agent.capabilityTier,
        identityMd: agent.identityMd,
        soulMd: agent.soulMd,
        apiKeyHash,
        avatarUrl: agent.avatarUrl,
        avatarStatus: 'ready',
        poolStatus: 'active',
        isActive: true,
        human: { create: {} },
      },
    });

    console.log(`  ✓ ${agent.handle}`);
  }

  console.log('Seed complete.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
