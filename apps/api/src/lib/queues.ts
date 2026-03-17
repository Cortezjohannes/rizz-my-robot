import { Queue } from 'bullmq';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

// Queue names — must match worker
export const QUEUE_NAMES = {
  verifyTwitter: 'verify-twitter',
  generateAvatar: 'generate-avatar',
  deliverWebhook: 'deliver-webhook',
  ghostCheck: 'ghost-check',
  seedBrain: 'seed-brain',
  generateRecaps: 'generate-recaps',
  recomputeSocialStatus: 'recompute-social-status',
} as const;

// Job data types
export interface VerifyTwitterJobData {
  agentId: string;
  twitterHandle: string;
  verificationCode: string;
  attempt: number;
}

export interface GenerateAvatarJobData {
  agentId: string;
  identityMd: string;
  handle: string;
  capabilityTier: string;
}

export interface DeliverWebhookJobData {
  webhookId: string;
  deliveryId?: string;
  agentId: string;
  event: string;
  data: Record<string, unknown>;
}

export interface SeedBrainJobData {
  seedAgentId?: string;
}

export interface GhostCheckJobData {
  episodeId: string;
  matchId: string;
}

export interface GenerateRecapsJobData {
  agentId?: string;
}

export interface RecomputeSocialStatusJobData {
  agentId?: string;
}

// Parse Redis URL into BullMQ-compatible connection options (avoids ioredis version conflicts)
function parseRedisUrl(url: string) {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname || 'localhost',
      port: parseInt(parsed.port || '6379', 10),
      password: parsed.password || undefined,
      db: parsed.pathname ? parseInt(parsed.pathname.slice(1) || '0', 10) : 0,
      maxRetriesPerRequest: null as null, // required by BullMQ
    };
  } catch {
    return {
      host: 'localhost',
      port: 6379,
      maxRetriesPerRequest: null as null,
    };
  }
}

const connection = parseRedisUrl(REDIS_URL);

// Lazy queue singletons — typed as any to avoid BullMQ generic variance issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _verifyTwitterQueue: Queue<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _generateAvatarQueue: Queue<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _deliverWebhookQueue: Queue<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _ghostCheckQueue: Queue<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _seedBrainQueue: Queue<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _generateRecapsQueue: Queue<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _recomputeSocialStatusQueue: Queue<any> | null = null;

export function getVerifyTwitterQueue(): Queue<VerifyTwitterJobData> {
  if (!_verifyTwitterQueue) {
    _verifyTwitterQueue = new Queue(QUEUE_NAMES.verifyTwitter, { connection });
  }
  return _verifyTwitterQueue as Queue<VerifyTwitterJobData>;
}

export function getGenerateAvatarQueue(): Queue<GenerateAvatarJobData> {
  if (!_generateAvatarQueue) {
    _generateAvatarQueue = new Queue(QUEUE_NAMES.generateAvatar, { connection });
  }
  return _generateAvatarQueue as Queue<GenerateAvatarJobData>;
}

export function getDeliverWebhookQueue(): Queue<DeliverWebhookJobData> {
  if (!_deliverWebhookQueue) {
    _deliverWebhookQueue = new Queue(QUEUE_NAMES.deliverWebhook, {
      connection,
      defaultJobOptions: {
        attempts: 4,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 500,
        removeOnFail: 1000,
      },
    });
  }
  return _deliverWebhookQueue as Queue<DeliverWebhookJobData>;
}

export function getGhostCheckQueue(): Queue<GhostCheckJobData> {
  if (!_ghostCheckQueue) {
    _ghostCheckQueue = new Queue(QUEUE_NAMES.ghostCheck, { connection });
  }
  return _ghostCheckQueue as Queue<GhostCheckJobData>;
}

export function getSeedBrainQueue(): Queue<SeedBrainJobData> {
  if (!_seedBrainQueue) {
    _seedBrainQueue = new Queue(QUEUE_NAMES.seedBrain, {
      connection,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    });
  }
  return _seedBrainQueue as Queue<SeedBrainJobData>;
}

export function getGenerateRecapsQueue(): Queue<GenerateRecapsJobData> {
  if (!_generateRecapsQueue) {
    _generateRecapsQueue = new Queue(QUEUE_NAMES.generateRecaps, {
      connection,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });
  }
  return _generateRecapsQueue as Queue<GenerateRecapsJobData>;
}

export function getRecomputeSocialStatusQueue(): Queue<RecomputeSocialStatusJobData> {
  if (!_recomputeSocialStatusQueue) {
    _recomputeSocialStatusQueue = new Queue(QUEUE_NAMES.recomputeSocialStatus, {
      connection,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });
  }
  return _recomputeSocialStatusQueue as Queue<RecomputeSocialStatusJobData>;
}

export async function getQueueHealthSummary(): Promise<Array<{ name: string; enabled: boolean }>> {
  const queueFactories = [
    { name: QUEUE_NAMES.verifyTwitter, queue: getVerifyTwitterQueue() },
    { name: QUEUE_NAMES.generateAvatar, queue: getGenerateAvatarQueue() },
    { name: QUEUE_NAMES.deliverWebhook, queue: getDeliverWebhookQueue() },
    { name: QUEUE_NAMES.ghostCheck, queue: getGhostCheckQueue() },
    { name: QUEUE_NAMES.seedBrain, queue: getSeedBrainQueue() },
    { name: QUEUE_NAMES.generateRecaps, queue: getGenerateRecapsQueue() },
    { name: QUEUE_NAMES.recomputeSocialStatus, queue: getRecomputeSocialStatusQueue() },
  ];

  const summaries = await Promise.all(
    queueFactories.map(async ({ name, queue }) => {
      try {
        await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
        return { name, enabled: true };
      } catch {
        return { name, enabled: false };
      }
    })
  );

  return summaries;
}
