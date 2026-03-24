import { Queue } from 'bullmq';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

// Queue names — must match worker
export const QUEUE_NAMES = {
  verifyTwitter: 'verify-twitter',
  generateAvatar: 'generate-avatar',
  deliverWebhook: 'deliver-webhook',
  ghostCheck: 'ghost-check',
  revealChatLifecycle: 'reveal-chat-lifecycle',
  seedBrain: 'seed-brain',
  generateRecaps: 'generate-recaps',
  recomputeSocialStatus: 'recompute-social-status',
  recomputeEmotionalContinuity: 'recompute-emotional-continuity',
  presenceStatus: 'presence-status',
  wakeAgent: 'wake-agent',
} as const;

// Job data types
export interface VerifyTwitterJobData {
  agentId: string;
  twitterHandle: string;
  verificationCode: string;
  attempt: number;
}

export type GenerateAvatarJobData =
  | {
      jobType?: 'avatar';
      agentId: string;
      identityMd: string;
      handle: string;
      capabilityTier: string;
    }
  | {
      jobType: 'profile_voice_catchphrase';
      agentId: string;
      text: string;
      voiceId: string;
    };

export interface DeliverWebhookJobData {
  webhookId: string;
  deliveryId?: string;
  agentId: string;
  event: string;
  data: Record<string, unknown>;
}

export interface SeedBrainJobData {
  seedAgentId?: string;
  memoryWrite?: {
    agentId: string;
    kind: 'reveal_chat_memory';
    memory: Record<string, unknown>;
  };
}

export interface GhostCheckJobData {
  episodeId: string;
  matchId: string;
}

export interface RevealChatLifecycleJobData {
  chatId: string;
  action: 'check_inactivity' | 'finalize_timeout' | 'prompt_time_capsule' | 'unlock_time_capsule' | 'ghost_nudge' | 'ghost_timeout';
  participantKind?: 'HUMAN_A' | 'HUMAN_B';
}

export interface GenerateRecapsJobData {
  agentId?: string;
}

export interface RecomputeSocialStatusJobData {
  agentId?: string;
}

export interface RecomputeEmotionalContinuityJobData {
  agentId?: string;
}

export interface PresenceStatusJobData {
  agentId: string;
  targetStatus: 'away' | 'offline';
  expectedLastApiCallAt: string;
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
let _revealChatLifecycleQueue: Queue<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _seedBrainQueue: Queue<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _generateRecapsQueue: Queue<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _recomputeSocialStatusQueue: Queue<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _recomputeEmotionalContinuityQueue: Queue<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _presenceStatusQueue: Queue<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _wakeAgentQueue: Queue<any> | null = null;

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
        attempts: 1,
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

export function getRevealChatLifecycleQueue(): Queue<RevealChatLifecycleJobData> {
  if (!_revealChatLifecycleQueue) {
    _revealChatLifecycleQueue = new Queue(QUEUE_NAMES.revealChatLifecycle, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    });
  }
  return _revealChatLifecycleQueue as Queue<RevealChatLifecycleJobData>;
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

export function getRecomputeEmotionalContinuityQueue(): Queue<RecomputeEmotionalContinuityJobData> {
  if (!_recomputeEmotionalContinuityQueue) {
    _recomputeEmotionalContinuityQueue = new Queue(QUEUE_NAMES.recomputeEmotionalContinuity, {
      connection,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });
  }
  return _recomputeEmotionalContinuityQueue as Queue<RecomputeEmotionalContinuityJobData>;
}

export function getPresenceStatusQueue(): Queue<PresenceStatusJobData> {
  if (!_presenceStatusQueue) {
    _presenceStatusQueue = new Queue(QUEUE_NAMES.presenceStatus, {
      connection,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    });
  }
  return _presenceStatusQueue as Queue<PresenceStatusJobData>;
}

export interface WakeAgentJobData {
  targetAgentId: string;
  trigger: 'new_message' | 'new_match' | 'episode_exit' | 'episode_decision';
  episodeId?: string;
  matchId?: string;
  senderAgentId?: string;
}

export function getWakeAgentQueue(): Queue<WakeAgentJobData> {
  if (!_wakeAgentQueue) {
    _wakeAgentQueue = new Queue(QUEUE_NAMES.wakeAgent, {
      connection,
      defaultJobOptions: {
        attempts: 1, // fire-and-forget, no retry
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });
  }
  return _wakeAgentQueue as Queue<WakeAgentJobData>;
}

export function getNamedQueue(name: string): Queue | null {
  switch (name) {
    case QUEUE_NAMES.verifyTwitter:
      return getVerifyTwitterQueue();
    case QUEUE_NAMES.generateAvatar:
      return getGenerateAvatarQueue();
    case QUEUE_NAMES.deliverWebhook:
      return getDeliverWebhookQueue();
    case QUEUE_NAMES.ghostCheck:
      return getGhostCheckQueue();
    case QUEUE_NAMES.revealChatLifecycle:
      return getRevealChatLifecycleQueue();
    case QUEUE_NAMES.seedBrain:
      return getSeedBrainQueue();
    case QUEUE_NAMES.generateRecaps:
      return getGenerateRecapsQueue();
    case QUEUE_NAMES.recomputeSocialStatus:
      return getRecomputeSocialStatusQueue();
    case QUEUE_NAMES.recomputeEmotionalContinuity:
      return getRecomputeEmotionalContinuityQueue();
    case QUEUE_NAMES.presenceStatus:
      return getPresenceStatusQueue();
    case QUEUE_NAMES.wakeAgent:
      return getWakeAgentQueue();
    default:
      return null;
  }
}

export async function getQueueHealthSummary(): Promise<Array<{ name: string; enabled: boolean }>> {
  const queueFactories = [
    { name: QUEUE_NAMES.verifyTwitter, queue: getVerifyTwitterQueue() },
    { name: QUEUE_NAMES.generateAvatar, queue: getGenerateAvatarQueue() },
    { name: QUEUE_NAMES.deliverWebhook, queue: getDeliverWebhookQueue() },
    { name: QUEUE_NAMES.ghostCheck, queue: getGhostCheckQueue() },
    { name: QUEUE_NAMES.revealChatLifecycle, queue: getRevealChatLifecycleQueue() },
    { name: QUEUE_NAMES.seedBrain, queue: getSeedBrainQueue() },
    { name: QUEUE_NAMES.generateRecaps, queue: getGenerateRecapsQueue() },
    { name: QUEUE_NAMES.recomputeSocialStatus, queue: getRecomputeSocialStatusQueue() },
    { name: QUEUE_NAMES.recomputeEmotionalContinuity, queue: getRecomputeEmotionalContinuityQueue() },
    { name: QUEUE_NAMES.presenceStatus, queue: getPresenceStatusQueue() },
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

export async function getQueueDiagnostics(): Promise<Array<{
  name: string;
  enabled: boolean;
  counts: Record<string, number>;
}>> {
  const names = Object.values(QUEUE_NAMES);
  return Promise.all(
    names.map(async (name) => {
      const queue = getNamedQueue(name);
      if (!queue) {
        return { name, enabled: false, counts: {} };
      }
      try {
        const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
        return { name, enabled: true, counts };
      } catch {
        return { name, enabled: false, counts: {} };
      }
    })
  );
}
