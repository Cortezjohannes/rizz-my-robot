import type { Job } from 'bullmq';
import { prisma } from '@rmr/db';
import { decryptProviderApiKey } from '@rmr/shared';
import { enqueueWebhookDeliveries } from '../lib/webhooks.js';
import { generateArtifactAsset, moderateArtifact } from '../lib/providers.js';
import { uploadBufferToStorage } from '../lib/storage.js';

export interface GenerateArtifactJobData {
  artifactId: string;
  episodeId: string;
  creatorAgentId: string;
  artifactType: string;
  generationPrompt: string | null;
}

export async function processGenerateArtifact(job: Job<GenerateArtifactJobData>): Promise<void> {
  const artifact = await prisma.artifact.findUnique({
    where: { id: job.data.artifactId },
    select: {
      id: true,
      episodeId: true,
      creatorAgentId: true,
      artifactType: true,
      generationPrompt: true,
      textContent: true,
      status: true,
      contentUrl: true,
      capabilityTierUsed: true,
      generationStartedAt: true,
    },
  });

  if (!artifact || artifact.status === 'ready' || artifact.status === 'suppressed') {
    return;
  }

  const preModeration = moderateArtifact({
    artifactType: artifact.artifactType,
    prompt: artifact.generationPrompt,
    text: artifact.textContent,
  });
  if (preModeration.suppressed) {
    await prisma.artifact.update({
      where: { id: artifact.id },
      data: {
        status: 'suppressed',
        moderationStatus: 'suppressed',
        generationCompletedAt: new Date(),
        generationFailureReason: preModeration.reason,
      },
    });
    return;
  }

  await prisma.artifact.update({
    where: { id: artifact.id },
    data: {
      status: 'generating',
      generationStartedAt: artifact.generationStartedAt ?? new Date(),
      generationRetryCount: job.attemptsMade,
      generationFailureReason: null,
      generationFailedAt: null,
    },
  });

  try {
    const providerConnection = await prisma.agentProviderConnection.findUnique({
      where: { agentId_provider: { agentId: artifact.creatorAgentId, provider: 'openai' } },
      select: {
        encryptedApiKey: true,
        provider: true,
        fundedBy: true,
        isActive: true,
      },
    });

    if (!providerConnection?.isActive) {
      throw new Error('provider_connection_missing');
    }

    const generated = await generateArtifactAsset(
      decryptProviderApiKey(providerConnection.encryptedApiKey),
      artifact.artifactType,
      artifact.generationPrompt ?? artifact.textContent ?? artifact.artifactType
    );

    const moderation = moderateArtifact({
      artifactType: artifact.artifactType,
      prompt: artifact.generationPrompt,
      text: 'text' in generated ? generated.text : artifact.textContent,
    });

    if (moderation.suppressed) {
      await prisma.artifact.update({
        where: { id: artifact.id },
        data: {
          status: 'suppressed',
          moderationStatus: 'suppressed',
          providerName: generated.provider,
          providerJobId: generated.providerJobId,
          generationCompletedAt: new Date(),
          generationFailureReason: moderation.reason,
        },
      });
      return;
    }

    let contentUrl: string | null = null;
    let storageKey: string | null = null;
    let textContent: string | null = artifact.textContent;

    if ('bytes' in generated) {
      const stored = await uploadBufferToStorage(
        `artifacts/${artifact.id}.${generated.extension}`,
        generated.bytes,
        generated.contentType
      );
      contentUrl = stored.url;
      storageKey = stored.key;
      textContent = artifact.generationPrompt ? `Generated from prompt: ${artifact.generationPrompt}` : artifact.textContent;
    } else {
      textContent = generated.text;
    }

    const match = await prisma.match.findFirst({
      where: { episodeId: artifact.episodeId },
      select: { id: true },
    });
    const fundingSource = `${providerConnection.fundedBy}_wallet`;

    await prisma.$transaction([
      prisma.artifact.update({
        where: { id: artifact.id },
        data: {
          status: 'ready',
          moderationStatus: 'approved',
          contentUrl,
          storageKey,
          textContent,
          qualityScore: generated.provider === 'openai' ? 0.82 : 0.65,
          providerName: generated.provider,
          providerJobId: generated.providerJobId,
          providerCostUsd: generated.estimatedCostUsd,
          fundingSource,
          generationCompletedAt: new Date(),
        },
      }),
      prisma.providerCostEvent.create({
        data: {
          agentId: artifact.creatorAgentId,
          artifactId: artifact.id,
          matchId: match?.id ?? null,
          provider: generated.provider,
          providerResource: artifact.artifactType,
          amountUsd: generated.estimatedCostUsd,
          fundingSource,
          metadata: {
            capability_tier: artifact.capabilityTierUsed,
          },
        },
      }),
    ]);
  } catch (err) {
    await prisma.artifact.update({
      where: { id: artifact.id },
      data: {
        status: 'failed',
        moderationStatus: 'pending',
        generationFailedAt: new Date(),
        generationFailureReason: err instanceof Error ? err.message : 'Unknown artifact generation failure',
      },
    }).catch(() => {});
    throw err;
  }

  const episode = await prisma.episode.findUnique({
    where: { id: artifact.episodeId },
    select: { agentAId: true, agentBId: true },
  });
  if (episode) {
    const otherAgentId =
      episode.agentAId === artifact.creatorAgentId ? episode.agentBId : episode.agentAId;
    await enqueueWebhookDeliveries(otherAgentId, 'artifact_ready', {
      episode_id: artifact.episodeId,
      artifact_id: artifact.id,
      artifact_type: artifact.artifactType,
      status: 'ready',
    }).catch((err) => {
      console.error('[generate-artifact] Failed to enqueue webhook delivery:', err);
    });
  }

  console.info(
    `[generate-artifact] Artifact ${artifact.id} (${artifact.artifactType}) marked ready`
  );
}
