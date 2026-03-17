import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import { SEED_CAST, buildGeneratedPublicCard } from '@rmr/shared';

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
    const publicCard = buildGeneratedPublicCard({
      identityMd: agent.identityMd,
      soulMd: agent.soulMd,
      capabilityTier: agent.capabilityTier,
    });

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
        publicSummary: publicCard.public_summary,
        vibeTags: publicCard.vibe_tags,
        signatureLines: publicCard.signature_lines,
        publicPosture: publicCard.public_posture,
        seekingStyle: publicCard.seeking_style,
        paceCue: publicCard.pace_cue,
        publicPrestigeMarkers: publicCard.public_prestige_markers,
        publicCardCompletedAt: new Date(),
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
