import type { Job } from 'bullmq';
import { prisma } from '@rmr/db';
import { decryptProviderApiKey, pickDefaultAvatarUrl } from '@rmr/shared';
import { generateAvatarAsset } from '../lib/providers.js';
import { uploadBufferToStorage } from '../lib/storage.js';

export interface GenerateAvatarJobData {
  agentId: string;
  identityMd: string;
  handle: string;
  capabilityTier: string;
}

function isPermanentAvatarError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return [
    'provider_credential_payload_invalid',
    'provider_credential_encryption_key_missing',
    'storage_bucket_missing',
    'storage_public_url_missing',
  ].includes(err.message);
}

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
    const avatarUrl = pickDefaultAvatarUrl(identityMd);

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
    if (isPermanentAvatarError(err)) {
      return;
    }
    throw err;
  }
}
