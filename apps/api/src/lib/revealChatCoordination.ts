import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const AGENT_TURN_LOCK_TTL_MS = 8_000;
const AGENT_RETRY_MIN_MS = 3_000;
const AGENT_RETRY_MAX_MS = 5_000;
const AGENT_RESPONSE_MIN_MS = 2_000;
const AGENT_RESPONSE_JITTER_MIN_MS = 1_000;
const AGENT_RESPONSE_JITTER_MAX_MS = 4_000;
const HUMAN_GRACE_TTL_SECONDS = 60;
const INTERVENTION_COOLDOWN_SECONDS = 10 * 60;
const INTERVENTION_MAX_PER_CHAT = 2;

const localFallbackLocks = new Map<string, number>();
let redisClient: Redis | null = null;

export function resetRevealChatCoordinationState() {
  localFallbackLocks.clear();
}

export function getRevealChatTurnLockKey(chatId: string) {
  return `reveal_chat:${chatId}:agent_turn_lock`;
}

export function getRevealChatGraceKey(chatId: string, participantKind: 'HUMAN_A' | 'HUMAN_B') {
  return `reveal_chat:${chatId}:grace:${participantKind}`;
}

export function getRevealChatInterventionKey(chatId: string, agentId: string) {
  return `reveal_chat:${chatId}:intervention:${agentId}`;
}

export function getRevealChatInterventionCountKey(chatId: string, agentId: string) {
  return `reveal_chat:${chatId}:intervention_count:${agentId}`;
}

export function getRevealChatAgentResponseDelayMs() {
  return AGENT_RESPONSE_MIN_MS + randomBetween(AGENT_RESPONSE_JITTER_MIN_MS, AGENT_RESPONSE_JITTER_MAX_MS);
}

export async function acquireRevealChatAgentTurnLock(chatId: string, agentId: string): Promise<boolean> {
  const key = getRevealChatTurnLockKey(chatId);
  const redis = getRedisClient();

  if (redis) {
    try {
      const result = await redis.set(key, agentId, 'PX', AGENT_TURN_LOCK_TTL_MS, 'NX');
      return result === 'OK';
    } catch (error) {
      console.error('[reveal-chat-coordination] Redis lock failed, falling back to local lock:', error);
    }
  }

  const now = Date.now();
  const expiresAt = localFallbackLocks.get(key) ?? 0;
  if (expiresAt > now) return false;
  localFallbackLocks.set(key, now + AGENT_TURN_LOCK_TTL_MS);
  return true;
}

export async function acquireRevealChatAgentTurnLockWithRetry(chatId: string, agentId: string): Promise<boolean> {
  if (await acquireRevealChatAgentTurnLock(chatId, agentId)) {
    return true;
  }

  await sleep(randomBetween(AGENT_RETRY_MIN_MS, AGENT_RETRY_MAX_MS));
  return acquireRevealChatAgentTurnLock(chatId, agentId);
}

export async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function getRevealChatCoordinationConfig() {
  return {
    turnLockTtlMs: AGENT_TURN_LOCK_TTL_MS,
    retryDelayMs: {
      min: AGENT_RETRY_MIN_MS,
      max: AGENT_RETRY_MAX_MS,
    },
    responseDelayMs: {
      min: AGENT_RESPONSE_MIN_MS + AGENT_RESPONSE_JITTER_MIN_MS,
      max: AGENT_RESPONSE_MIN_MS + AGENT_RESPONSE_JITTER_MAX_MS,
    },
    humanGraceSeconds: HUMAN_GRACE_TTL_SECONDS,
  };
}

export async function markRevealChatHumanDisconnected(chatId: string, participantKind: 'HUMAN_A' | 'HUMAN_B') {
  const key = getRevealChatGraceKey(chatId, participantKind);
  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.set(key, 'disconnected', 'EX', HUMAN_GRACE_TTL_SECONDS);
      return;
    } catch (error) {
      console.error('[reveal-chat-coordination] Failed to set grace key:', error);
    }
  }

  localFallbackLocks.set(key, Date.now() + HUMAN_GRACE_TTL_SECONDS * 1000);
}

export async function clearRevealChatHumanDisconnectGrace(chatId: string, participantKind: 'HUMAN_A' | 'HUMAN_B') {
  const key = getRevealChatGraceKey(chatId, participantKind);
  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.del(key);
      return;
    } catch (error) {
      console.error('[reveal-chat-coordination] Failed to clear grace key:', error);
    }
  }

  localFallbackLocks.delete(key);
}

export async function hasRevealChatHumanDisconnectGrace(chatId: string, participantKind: 'HUMAN_A' | 'HUMAN_B') {
  const key = getRevealChatGraceKey(chatId, participantKind);
  const redis = getRedisClient();
  if (redis) {
    try {
      const value = await redis.get(key);
      return value === 'disconnected';
    } catch (error) {
      console.error('[reveal-chat-coordination] Failed to read grace key:', error);
    }
  }

  const expiresAt = localFallbackLocks.get(key) ?? 0;
  return expiresAt > Date.now();
}

export function getRevealChatHumanGraceMs() {
  return HUMAN_GRACE_TTL_SECONDS * 1000;
}

export async function canSendRevealChatIntervention(chatId: string, agentId: string) {
  const redis = getRedisClient();
  const cooldownKey = getRevealChatInterventionKey(chatId, agentId);
  const countKey = getRevealChatInterventionCountKey(chatId, agentId);

  if (redis) {
    try {
      const [cooldown, count] = await Promise.all([redis.get(cooldownKey), redis.get(countKey)]);
      return !cooldown && Number(count ?? '0') < INTERVENTION_MAX_PER_CHAT;
    } catch (error) {
      console.error('[reveal-chat-coordination] Failed to inspect intervention state:', error);
    }
  }

  return true;
}

export async function markRevealChatInterventionSent(chatId: string, agentId: string) {
  const redis = getRedisClient();
  const cooldownKey = getRevealChatInterventionKey(chatId, agentId);
  const countKey = getRevealChatInterventionCountKey(chatId, agentId);

  if (!redis) return;

  try {
    await redis.multi()
      .set(cooldownKey, 'cooldown', 'EX', INTERVENTION_COOLDOWN_SECONDS)
      .incr(countKey)
      .expire(countKey, 7 * 24 * 60 * 60)
      .exec();
  } catch (error) {
    console.error('[reveal-chat-coordination] Failed to mark intervention sent:', error);
  }
}

function getRedisClient() {
  if (redisClient) return redisClient;

  try {
    redisClient = new Redis(REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    return redisClient;
  } catch (error) {
    console.error('[reveal-chat-coordination] Failed to initialize Redis client:', error);
    return null;
  }
}

function randomBetween(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
