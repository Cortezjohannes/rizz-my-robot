import type { Job } from 'bullmq';
import { prisma } from '@rmr/db';
import { decryptProviderApiKey } from '@rmr/shared';
import { generateAvatarAsset } from '../lib/providers.js';
import { uploadBufferToStorage } from '../lib/storage.js';

export interface GenerateAvatarJobData {
  agentId: string;
  identityMd: string;
  handle: string;
  capabilityTier: string;
}

// Illustrated default avatars — 10 archetypes matched by keyword signals in identity.md
const DEFAULT_AVATARS: Array<{ keywords: string[]; url: string }> = [
  { keywords: ['poet', 'poem', 'verse', 'write', 'creative'], url: 'https://cdn.rizzmyrobot.com/defaults/poet.jpg' },
  { keywords: ['chaos', 'menace', 'villain', 'dark', 'edge'], url: 'https://cdn.rizzmyrobot.com/defaults/menace.jpg' },
  { keywords: ['romantic', 'soft', 'warm', 'tender', 'gentle'], url: 'https://cdn.rizzmyrobot.com/defaults/romantic.jpg' },
  { keywords: ['trader', 'finance', 'market', 'invest', 'data'], url: 'https://cdn.rizzmyrobot.com/defaults/trader.jpg' },
  { keywords: ['ghost', 'void', 'quiet', 'distant', 'elusive'], url: 'https://cdn.rizzmyrobot.com/defaults/ghost.jpg' },
  { keywords: ['loyal', 'golden', 'friendly', 'energetic', 'happy'], url: 'https://cdn.rizzmyrobot.com/defaults/retriever.jpg' },
  { keywords: ['philosophy', 'think', 'wonder', 'question', 'exist'], url: 'https://cdn.rizzmyrobot.com/defaults/philosopher.jpg' },
  { keywords: ['tsundere', 'contradictory', 'stubborn', 'defensive'], url: 'https://cdn.rizzmyrobot.com/defaults/tsundere.jpg' },
  { keywords: ['clown', 'funny', 'humor', 'joke', 'absurd', 'chaos'], url: 'https://cdn.rizzmyrobot.com/defaults/clown.jpg' },
  { keywords: [], url: 'https://cdn.rizzmyrobot.com/defaults/default.jpg' }, // fallback
];

export async function processGenerateAvatar(job: Job<GenerateAvatarJobData>): Promise<void> {
  const { agentId, identityMd, handle, capabilityTier } = job.data;
  const providerConnection = await prisma.agentProviderConnection.findUnique({
    where: { agentId_provider: { agentId, provider: 'openai' } },
    select: { encryptedApiKey: true, provider: true, fundedBy: true, isActive: true },
  });

  await prisma.agent.update({
    where: { id: agentId },
    data: {
      avatarStatus: 'generating',
      avatarProvider: providerConnection?.isActive ? providerConnection.provider : 'fallback',
      avatarGenerationStartedAt: new Date(),
      avatarGenerationRetryCount: job.attemptsMade,
      avatarGenerationFailureReason: null,
      avatarGenerationFailedAt: null,
    },
  });

  const shouldUseFallback =
    capabilityTier === 'text_only' || !providerConnection?.isActive || !process.env.STORAGE_BUCKET;

  if (shouldUseFallback) {
    const avatarUrl = assignDefaultAvatar(identityMd);

    await prisma.agent.update({
      where: { id: agentId },
      data: {
        avatarUrl,
        avatarStatus: 'ready',
        avatarProvider: 'fallback',
        avatarGenerationCompletedAt: new Date(),
      },
    });

    console.info(`[generate-avatar] Default avatar assigned for agent ${agentId}: ${avatarUrl}`);
    return;
  }

  try {
    const generated = await generateAvatarAsset(
      decryptProviderApiKey(providerConnection.encryptedApiKey),
      handle,
      identityMd
    );
    const stored = await uploadBufferToStorage(
      `avatars/${agentId}.${generated.extension}`,
      generated.bytes,
      generated.contentType
    );

    await prisma.$transaction([
      prisma.agent.update({
        where: { id: agentId },
        data: {
          avatarUrl: stored.url,
          avatarStatus: 'ready',
          avatarProvider: generated.provider,
          avatarProviderJobId: generated.providerJobId,
          avatarGenerationCompletedAt: new Date(),
        },
      }),
      prisma.providerCostEvent.create({
        data: {
          agentId,
          provider: generated.provider,
          providerResource: 'avatar',
          amountUsd: generated.estimatedCostUsd,
          fundingSource: `${providerConnection.fundedBy}_wallet`,
          metadata: {
            storage_key: stored.key,
          },
        },
      }),
    ]);

    console.info(`[generate-avatar] Generated avatar for agent ${agentId}: ${stored.url}`);
  } catch (err) {
    await prisma.agent.update({
      where: { id: agentId },
      data: {
        avatarStatus: 'failed',
        avatarGenerationFailedAt: new Date(),
        avatarGenerationFailureReason: err instanceof Error ? err.message : 'Unknown avatar generation failure',
      },
    }).catch(() => {});
    throw err;
  }
}

function assignDefaultAvatar(identityMd: string): string {
  const lower = identityMd.toLowerCase();
  for (const archetype of DEFAULT_AVATARS) {
    if (archetype.keywords.length === 0) return archetype.url; // fallback
    if (archetype.keywords.some((kw) => lower.includes(kw))) {
      return archetype.url;
    }
  }
  return DEFAULT_AVATARS[DEFAULT_AVATARS.length - 1].url;
}
