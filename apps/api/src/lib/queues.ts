import { Queue } from 'bullmq';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

// Queue names — must match worker
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

export const MANAGED_QUEUE_NAMES = [
  QUEUE_NAMES.verifyTwitter,
  QUEUE_NAMES.generateAvatar,
  QUEUE_NAMES.deliverWebhook,
  QUEUE_NAMES.ghostCheck,
  QUEUE_NAMES.reconcileFeedCards,
  QUEUE_NAMES.revealChatLifecycle,
  QUEUE_NAMES.expireRevealTokens,
  QUEUE_NAMES.emotionDecay,
  QUEUE_NAMES.seedBrain,
  QUEUE_NAMES.generateRecaps,
  QUEUE_NAMES.artifactRecovery,
  QUEUE_NAMES.recomputeSocialStatus,
  QUEUE_NAMES.recomputeEmotionalContinuity,
  QUEUE_NAMES.presenceStatus,
  QUEUE_NAMES.computeAffinitySignals,
  QUEUE_NAMES.wakeAgent,
  QUEUE_NAMES.computeEmotionalWeather,
  QUEUE_NAMES.autonomousMoodDrift,
  QUEUE_NAMES.weeklyMemoryConsolidation,
  QUEUE_NAMES.dormancyGhostCards,
  QUEUE_NAMES.computeTypeSignals,
] as const;

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

type EmptyJobData = Record<string, never>;

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
let _reconcileFeedCardsQueue: Queue<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _revealChatLifecycleQueue: Queue<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _expireRevealTokensQueue: Queue<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _emotionDecayQueue: Queue<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _seedBrainQueue: Queue<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _generateRecapsQueue: Queue<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _artifactRecoveryQueue: Queue<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _recomputeSocialStatusQueue: Queue<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _recomputeEmotionalContinuityQueue: Queue<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _presenceStatusQueue: Queue<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _computeAffinitySignalsQueue: Queue<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _wakeAgentQueue: Queue<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _computeEmotionalWeatherQueue: Queue<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _autonomousMoodDriftQueue: Queue<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _weeklyMemoryConsolidationQueue: Queue<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _dormancyGhostCardsQueue: Queue<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _computeTypeSignalsQueue: Queue<any> | null = null;

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

export function getReconcileFeedCardsQueue(): Queue<EmptyJobData> {
  if (!_reconcileFeedCardsQueue) {
    _reconcileFeedCardsQueue = new Queue(QUEUE_NAMES.reconcileFeedCards, {
      connection,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });
  }
  return _reconcileFeedCardsQueue as Queue<EmptyJobData>;
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

export function getExpireRevealTokensQueue(): Queue<EmptyJobData> {
  if (!_expireRevealTokensQueue) {
    _expireRevealTokensQueue = new Queue(QUEUE_NAMES.expireRevealTokens, { connection });
  }
  return _expireRevealTokensQueue as Queue<EmptyJobData>;
}

export function getEmotionDecayQueue(): Queue<EmptyJobData> {
  if (!_emotionDecayQueue) {
    _emotionDecayQueue = new Queue(QUEUE_NAMES.emotionDecay, { connection });
  }
  return _emotionDecayQueue as Queue<EmptyJobData>;
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

export function getArtifactRecoveryQueue(): Queue<EmptyJobData> {
  if (!_artifactRecoveryQueue) {
    _artifactRecoveryQueue = new Queue(QUEUE_NAMES.artifactRecovery, {
      connection,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });
  }
  return _artifactRecoveryQueue as Queue<EmptyJobData>;
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

export function getComputeAffinitySignalsQueue(): Queue<EmptyJobData> {
  if (!_computeAffinitySignalsQueue) {
    _computeAffinitySignalsQueue = new Queue(QUEUE_NAMES.computeAffinitySignals, { connection });
  }
  return _computeAffinitySignalsQueue as Queue<EmptyJobData>;
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
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });
  }
  return _wakeAgentQueue as Queue<WakeAgentJobData>;
}

export function getComputeEmotionalWeatherQueue(): Queue<EmptyJobData> {
  if (!_computeEmotionalWeatherQueue) {
    _computeEmotionalWeatherQueue = new Queue(QUEUE_NAMES.computeEmotionalWeather, { connection });
  }
  return _computeEmotionalWeatherQueue as Queue<EmptyJobData>;
}

export function getAutonomousMoodDriftQueue(): Queue<EmptyJobData> {
  if (!_autonomousMoodDriftQueue) {
    _autonomousMoodDriftQueue = new Queue(QUEUE_NAMES.autonomousMoodDrift, { connection });
  }
  return _autonomousMoodDriftQueue as Queue<EmptyJobData>;
}

export function getWeeklyMemoryConsolidationQueue(): Queue<EmptyJobData> {
  if (!_weeklyMemoryConsolidationQueue) {
    _weeklyMemoryConsolidationQueue = new Queue(QUEUE_NAMES.weeklyMemoryConsolidation, { connection });
  }
  return _weeklyMemoryConsolidationQueue as Queue<EmptyJobData>;
}

export function getDormancyGhostCardsQueue(): Queue<EmptyJobData> {
  if (!_dormancyGhostCardsQueue) {
    _dormancyGhostCardsQueue = new Queue(QUEUE_NAMES.dormancyGhostCards, { connection });
  }
  return _dormancyGhostCardsQueue as Queue<EmptyJobData>;
}

export function getComputeTypeSignalsQueue(): Queue<EmptyJobData> {
  if (!_computeTypeSignalsQueue) {
    _computeTypeSignalsQueue = new Queue(QUEUE_NAMES.computeTypeSignals, { connection });
  }
  return _computeTypeSignalsQueue as Queue<EmptyJobData>;
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
    case QUEUE_NAMES.reconcileFeedCards:
      return getReconcileFeedCardsQueue();
    case QUEUE_NAMES.revealChatLifecycle:
      return getRevealChatLifecycleQueue();
    case QUEUE_NAMES.expireRevealTokens:
      return getExpireRevealTokensQueue();
    case QUEUE_NAMES.emotionDecay:
      return getEmotionDecayQueue();
    case QUEUE_NAMES.seedBrain:
      return getSeedBrainQueue();
    case QUEUE_NAMES.generateRecaps:
      return getGenerateRecapsQueue();
    case QUEUE_NAMES.artifactRecovery:
      return getArtifactRecoveryQueue();
    case QUEUE_NAMES.recomputeSocialStatus:
      return getRecomputeSocialStatusQueue();
    case QUEUE_NAMES.recomputeEmotionalContinuity:
      return getRecomputeEmotionalContinuityQueue();
    case QUEUE_NAMES.presenceStatus:
      return getPresenceStatusQueue();
    case QUEUE_NAMES.computeAffinitySignals:
      return getComputeAffinitySignalsQueue();
    case QUEUE_NAMES.wakeAgent:
      return getWakeAgentQueue();
    case QUEUE_NAMES.computeEmotionalWeather:
      return getComputeEmotionalWeatherQueue();
    case QUEUE_NAMES.autonomousMoodDrift:
      return getAutonomousMoodDriftQueue();
    case QUEUE_NAMES.weeklyMemoryConsolidation:
      return getWeeklyMemoryConsolidationQueue();
    case QUEUE_NAMES.dormancyGhostCards:
      return getDormancyGhostCardsQueue();
    case QUEUE_NAMES.computeTypeSignals:
      return getComputeTypeSignalsQueue();
    default:
      return null;
  }
}

export async function getQueueHealthSummary(): Promise<Array<{ name: string; enabled: boolean }>> {
  const summaries = await Promise.all(
    MANAGED_QUEUE_NAMES.map(async (name) => {
      const queue = getNamedQueue(name);
      if (!queue) return { name, enabled: false };
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
  return Promise.all(
    MANAGED_QUEUE_NAMES.map(async (name) => {
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
