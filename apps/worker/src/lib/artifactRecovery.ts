import { prisma } from '@rmr/db';
import { normalizeArtifactType } from '@rmr/shared';
import { enqueueWebhookDeliveries } from './webhooks.js';

const ARTIFACT_RECOVERY_RETRY_AFTER_MS = parseInt(
  process.env.ARTIFACT_RECOVERY_RETRY_AFTER_MS ?? `${30 * 60 * 1000}`,
  10,
);
const ARTIFACT_RECOVERY_FAIL_AFTER_MS = parseInt(
  process.env.ARTIFACT_RECOVERY_FAIL_AFTER_MS ?? `${24 * 60 * 60 * 1000}`,
  10,
);
const ARTIFACT_RECOVERY_BATCH_SIZE = parseInt(process.env.ARTIFACT_RECOVERY_BATCH_SIZE ?? '100', 10);

type RecoveryArtifact = Awaited<ReturnType<typeof loadRecoveryCandidates>>[number];

function buildGenerationContext(artifact: RecoveryArtifact) {
  const creatorAgent = artifact.creatorAgentId === artifact.episode?.agentAId
    ? artifact.episode.agentA
    : artifact.creatorAgentId === artifact.episode?.agentBId
      ? artifact.episode.agentB
      : null;
  const counterpartAgent = artifact.creatorAgentId === artifact.episode?.agentAId
    ? artifact.episode.agentB
    : artifact.creatorAgentId === artifact.episode?.agentBId
      ? artifact.episode.agentA
      : null;

  return {
    your_avatar_url: creatorAgent?.avatarUrl ?? null,
    use_avatar_as_reference: creatorAgent?.useAvatarAsReference ?? true,
    counterpart_avatar_url: counterpartAgent?.avatarUrl ?? null,
    counterpart_handle: counterpartAgent?.handle ?? null,
    image_gen_provider: creatorAgent?.imageGenProvider ?? null,
    image_gen_model: creatorAgent?.imageGenModel ?? null,
    voice_id: creatorAgent?.voiceId ?? null,
    voice_provider: creatorAgent?.voiceProvider ?? null,
    capability_tier: creatorAgent?.capabilityTier ?? null,
  };
}

async function loadRecoveryCandidates() {
  return prisma.artifact.findMany({
    where: {
      sourceScope: 'episode',
      episodeId: { not: null },
      status: { in: ['pending', 'generating'] },
      episode: {
        status: { in: ['active', 'awaiting_decisions', 'matched'] },
      },
    },
    orderBy: [
      { createdAt: 'asc' },
      { id: 'asc' },
    ],
    take: ARTIFACT_RECOVERY_BATCH_SIZE,
    select: {
      id: true,
      creatorAgentId: true,
      artifactType: true,
      status: true,
      createdAt: true,
      episodeId: true,
      episode: {
        select: {
          id: true,
          status: true,
          agentAId: true,
          agentBId: true,
          agentA: {
            select: {
              avatarUrl: true,
              handle: true,
              useAvatarAsReference: true,
              imageGenProvider: true,
              imageGenModel: true,
              voiceId: true,
              voiceProvider: true,
              capabilityTier: true,
            },
          },
          agentB: {
            select: {
              avatarUrl: true,
              handle: true,
              useAvatarAsReference: true,
              imageGenProvider: true,
              imageGenModel: true,
              voiceId: true,
              voiceProvider: true,
              capabilityTier: true,
            },
          },
        },
      },
    },
  });
}

async function getArtifactGenerationWebhookCount(agentId: string) {
  return prisma.webhook.count({
    where: {
      agentId,
      isActive: true,
      events: { has: 'artifact_generation_requested' },
    },
  });
}

export async function recoverStaleEpisodeArtifacts() {
  const now = new Date();
  const retryCutoff = new Date(now.getTime() - ARTIFACT_RECOVERY_RETRY_AFTER_MS);
  const artifacts = await loadRecoveryCandidates();

  let inspected = 0;
  let retried = 0;
  let failed = 0;

  for (const artifact of artifacts) {
    inspected += 1;
    const ageMs = now.getTime() - artifact.createdAt.getTime();
    const normalizedType = normalizeArtifactType(artifact.artifactType) ?? artifact.artifactType;

    if (ageMs >= ARTIFACT_RECOVERY_FAIL_AFTER_MS) {
      if (artifact.status !== 'failed') {
        await prisma.artifact.update({
          where: { id: artifact.id },
          data: { status: 'failed' },
        });
        failed += 1;
      }
      continue;
    }

    if (artifact.status !== 'pending' || artifact.createdAt > retryCutoff) {
      continue;
    }

    const webhookCount = await getArtifactGenerationWebhookCount(artifact.creatorAgentId);
    if (webhookCount === 0) {
      continue;
    }

    await enqueueWebhookDeliveries(artifact.creatorAgentId, 'artifact_generation_requested', {
      episode_id: artifact.episodeId,
      artifact_id: artifact.id,
      artifact_type: normalizedType,
      status: 'pending',
      recovery: true,
      recovery_reason: 'stale_pending_artifact',
      stale_for_seconds: Math.max(0, Math.floor(ageMs / 1000)),
      submit_url: `/v1/episodes/${artifact.episodeId}/artifact/${artifact.id}`,
      generation_context: buildGenerationContext(artifact),
    });

    await prisma.artifact.update({
      where: { id: artifact.id },
      data: { status: 'generating' },
    });
    retried += 1;
  }

  return { inspected, retried, failed };
}
