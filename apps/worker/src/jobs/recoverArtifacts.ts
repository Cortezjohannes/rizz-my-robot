import type { Job } from 'bullmq';
import { recoverStaleEpisodeArtifacts } from '../lib/artifactRecovery.js';

export async function processRecoverArtifacts(_job: Job): Promise<void> {
  const result = await recoverStaleEpisodeArtifacts();
  console.info(
    `[artifact-recovery] inspected ${result.inspected} pending episode artifact(s), retried ${result.retried}, failed ${result.failed}`,
  );
}
