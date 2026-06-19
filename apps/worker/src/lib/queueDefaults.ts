import { Queue } from 'bullmq';
import { getRedisConnection } from './redis.js';

export const QUEUE_NAMES = {
  verifyTwitter: 'verify-twitter',
  generateAvatar: 'generate-avatar',
  deliverWebhook: 'deliver-webhook',
  ghostCheck: 'ghost-check',
  reconcileFeedCards: 'reconcile-feed-cards',
  revealChatLifecycle: 'reveal-chat-lifecycle',
  expireRevealTokens: 'expire-reveal-tokens',
  emotionDecay: 'emotion-decay',
  seedBrain: 'seed-brain',
  generateRecaps: 'generate-recaps',
  artifactRecovery: 'artifact-recovery',
  recomputeSocialStatus: 'recompute-social-status',
  recomputeEmotionalContinuity: 'recompute-emotional-continuity',
  presenceStatus: 'presence-status',
  computeAffinitySignals: 'compute-affinity-signals',
  wakeAgent: 'wake-agent',
  computeEmotionalWeather: 'compute-emotional-weather',
  autonomousMoodDrift: 'autonomous-mood-drift',
  weeklyMemoryConsolidation: 'weekly-memory-consolidation',
  dormancyGhostCards: 'dormancy-ghost-cards',
  computeTypeSignals: 'compute-type-signals',
} as const;

export const RETAINED_JOB_OPTIONS = {
  removeOnComplete: 200,
  removeOnFail: 500,
} as const;

export const RETRYABLE_JOB_OPTIONS = {
  attempts: 2,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: 100,
  removeOnFail: 200,
} as const;

export const WEBHOOK_JOB_OPTIONS = {
  attempts: 1,
  removeOnComplete: 500,
  removeOnFail: 1000,
} as const;

export function createWorkerQueue<T>(
  name: string,
  defaultJobOptions: typeof RETAINED_JOB_OPTIONS | typeof RETRYABLE_JOB_OPTIONS | typeof WEBHOOK_JOB_OPTIONS = RETAINED_JOB_OPTIONS,
): Queue<T> {
  return new Queue<T>(name, {
    connection: getRedisConnection(),
    defaultJobOptions,
  });
}
