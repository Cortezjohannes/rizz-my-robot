import { Queue } from 'bullmq';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

// Queue names — must match worker
export const QUEUE_NAMES = {
  verifyTwitter: 'verify-twitter',
  generateAvatar: 'generate-avatar',
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
