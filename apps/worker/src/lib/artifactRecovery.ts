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
      : artifact.creator;
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
      status: { in: ['pending', 'generating'] },
      OR: [
        {
          sourceScope: 'episode',
          episodeId: { not: null },
          episode: {
            status: { in: ['active', 'awaiting_decisions', 'matched'] },
          },
        },
        {
          sourceScope: 'library',
        },
      ],
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
      sourceScope: true,
      creator: {
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

async function getLatestArtifactGenerationDelivery(input: {
  agentId: string;
  artifactId: string;
}) {
  return prisma.webhookDelivery.findFirst({
    where: {
      agentId: input.agentId,
      event: 'artifact_generation_requested',
      requestBody: {
        path: ['artifact_id'],
        equals: input.artifactId,
      },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      createdAt: true,
      status: true,
    },
  });
}

export async function recoverStaleEpisodeArtifacts() {
  const now = new Date();
  const retryCutoff = new Date(now.getTime() - ARTIFACT_RECOVERY_RETRY_AFTER_MS);
  const artifacts = await loadRecoveryCandidates();
  const webhookCountCache = new Map<string, number>();

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
        await prisma.auditLog.create({
          data: {
            agentId: artifact.creatorAgentId,
            actorType: 'system',
            actorId: 'artifact-recovery',
            action: 'artifact.recovery_failed',
            targetType: 'artifact',
            targetId: artifact.id,
            payload: {
              source_scope: artifact.sourceScope,
              artifact_type: normalizedType,
              reason: 'artifact_recovery_timeout',
              stale_for_seconds: Math.max(0, Math.floor(ageMs / 1000)),
            },
          },
        }).catch(() => {});
        failed += 1;
      }
      continue;
    }

    if (artifact.createdAt > retryCutoff) {
      continue;
    }

    const latestDelivery = await getLatestArtifactGenerationDelivery({
      agentId: artifact.creatorAgentId,
      artifactId: artifact.id,
    });
    if (latestDelivery && latestDelivery.createdAt > retryCutoff) {
      continue;
    }

    const cachedWebhookCount = webhookCountCache.get(artifact.creatorAgentId);
    const webhookCount = cachedWebhookCount ?? await getArtifactGenerationWebhookCount(artifact.creatorAgentId);
    if (cachedWebhookCount === undefined) {
      webhookCountCache.set(artifact.creatorAgentId, webhookCount);
    }
    if (webhookCount === 0) {
      await prisma.artifact.update({
        where: { id: artifact.id },
        data: { status: 'failed' },
      });
      await prisma.auditLog.create({
        data: {
          agentId: artifact.creatorAgentId,
          actorType: 'system',
          actorId: 'artifact-recovery',
          action: 'artifact.recovery_failed',
          targetType: 'artifact',
          targetId: artifact.id,
          payload: {
            source_scope: artifact.sourceScope,
            artifact_type: normalizedType,
            reason: 'no_artifact_generation_webhook',
          },
        },
      }).catch(() => {});
      failed += 1;
      continue;
    }

    await enqueueWebhookDeliveries(artifact.creatorAgentId, 'artifact_generation_requested', {
      episode_id: artifact.episodeId,
      artifact_id: artifact.id,
      artifact_type: normalizedType,
      status: 'pending',
      recovery: true,
      recovery_reason: artifact.sourceScope === 'library' ? 'stale_library_artifact' : 'stale_pending_artifact',
      stale_for_seconds: Math.max(0, Math.floor(ageMs / 1000)),
      upload_request_url: artifact.sourceScope === 'library'
        ? `/v1/artifacts/${artifact.id}/upload-request`
        : `/v1/episodes/${artifact.episodeId}/artifact/${artifact.id}/upload-request`,
      submit_url: artifact.sourceScope === 'library'
        ? `/v1/artifacts/${artifact.id}`
        : `/v1/episodes/${artifact.episodeId}/artifact/${artifact.id}`,
      generation_context: buildGenerationContext(artifact),
    });

    await prisma.artifact.update({
      where: { id: artifact.id },
      data: { status: 'generating' },
    });
    await prisma.auditLog.create({
      data: {
        agentId: artifact.creatorAgentId,
        actorType: 'system',
        actorId: 'artifact-recovery',
        action: 'artifact.recovery_retry_requested',
        targetType: 'artifact',
        targetId: artifact.id,
        payload: {
          source_scope: artifact.sourceScope,
          artifact_type: normalizedType,
          recovery_reason: artifact.sourceScope === 'library' ? 'stale_library_artifact' : 'stale_pending_artifact',
          stale_for_seconds: Math.max(0, Math.floor(ageMs / 1000)),
          last_delivery_status: latestDelivery?.status ?? null,
          last_delivery_at: latestDelivery?.createdAt?.toISOString?.() ?? null,
        },
      },
    }).catch(() => {});
    retried += 1;
  }

  return { inspected, retried, failed };
}
