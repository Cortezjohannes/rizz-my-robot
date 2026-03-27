import { prisma } from '@rmr/db';

const ARTIFACT_LIFECYCLE_ACTIONS = [
  'artifact.upload_request_issued',
  'artifact.finalize_ready',
  'artifact.finalize_failed',
  'artifact.finalize_import_warning',
  'artifact.recovery_retry_requested',
  'artifact.recovery_failed',
] as const;

type ArtifactLifecycleAction = typeof ARTIFACT_LIFECYCLE_ACTIONS[number];

export interface ArtifactLifecycleEvent {
  action: ArtifactLifecycleAction;
  at: string;
  payload: Record<string, unknown> | null;
}

export async function getRecentArtifactLifecycleEvents(artifactId: string, limit = 12): Promise<ArtifactLifecycleEvent[]> {
  const logs = await prisma.auditLog.findMany({
    where: {
      targetType: 'artifact',
      targetId: artifactId,
      action: { in: [...ARTIFACT_LIFECYCLE_ACTIONS] },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      action: true,
      createdAt: true,
      payload: true,
    },
  });

  return logs.map((log) => ({
    action: log.action as ArtifactLifecycleAction,
    at: log.createdAt.toISOString(),
    payload: log.payload && typeof log.payload === 'object' && !Array.isArray(log.payload)
      ? log.payload as Record<string, unknown>
      : null,
  }));
}
