import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { captureRuntimeError } from './errorAggregation.js';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const REVEAL_CHAT_EVENT_CHANNEL = 'reveal-chat:events';
const REVEAL_CHAT_RATE_LIMIT_PREFIX = 'reveal-chat:rate-limit';
const INSTANCE_ID = randomUUID();

type RevealChatRuntimeEvent = {
  chatId: string;
  event: string;
  payload: Record<string, unknown>;
  origin: string;
};

let publisher: Redis | null = null;
let subscriber: Redis | null = null;
let subscriptionStarted = false;
let redisUnavailableLogged = false;
const subscribers = new Set<(event: RevealChatRuntimeEvent) => void>();

function isRedisUnavailableError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return /ECONNREFUSED|Connection is closed|Stream isn't writeable/i.test(error.message);
}

function createRedisClient() {
  try {
    const client = new Redis(REDIS_URL, {
      lazyConnect: true,
      connectTimeout: 1500,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
    client.on('error', (error) => {
      if (redisUnavailableLogged) return;
      redisUnavailableLogged = true;
      console.warn('[reveal-chat-runtime-bus] Redis unavailable; falling back to local-only runtime behavior:', error instanceof Error ? error.message : error);
    });
    return client;
  } catch (error) {
    captureRuntimeError(error, {
      surface: 'api',
      phase: 'reveal_chat_runtime_bus_init',
    });
    console.error('[reveal-chat-runtime-bus] Failed to initialize Redis client:', error);
    return null;
  }
}

function getPublisher() {
  if (publisher) return publisher;
  publisher = createRedisClient();
  return publisher;
}

function getSubscriber() {
  if (subscriber) return subscriber;
  subscriber = createRedisClient();
  return subscriber;
}

export function subscribeToRevealChatRuntimeEvents(
  callback: (event: RevealChatRuntimeEvent) => void,
) {
  subscribers.add(callback);
  void ensureSubscriptionStarted();

  return () => {
    subscribers.delete(callback);
  };
}

async function ensureSubscriptionStarted() {
  if (subscriptionStarted) return;
  const redis = getSubscriber();
  if (!redis) return;

  try {
    subscriptionStarted = true;
    redis.on('message', (_channel, message) => {
      try {
        const parsed = JSON.parse(message) as RevealChatRuntimeEvent;
        if (parsed.origin === INSTANCE_ID) return;
        for (const subscriberCallback of subscribers) {
          subscriberCallback(parsed);
        }
      } catch (error) {
        captureRuntimeError(error, {
          surface: 'api',
          phase: 'reveal_chat_runtime_bus_parse',
        });
        console.error('[reveal-chat-runtime-bus] Failed to parse runtime event:', error);
      }
    });
    if (redis.status === 'wait') {
      await redis.connect();
    }
    await redis.subscribe(REVEAL_CHAT_EVENT_CHANNEL);
  } catch (error) {
    subscriptionStarted = false;
    if (!isRedisUnavailableError(error)) {
      captureRuntimeError(error, {
        surface: 'api',
        phase: 'reveal_chat_runtime_bus_subscribe',
      });
      console.error('[reveal-chat-runtime-bus] Failed to subscribe to Redis channel:', error);
    }
  }
}

export async function publishRevealChatRuntimeEvent(input: {
  chatId: string;
  event: string;
  payload: Record<string, unknown>;
}) {
  const redis = getPublisher();
  if (!redis) return false;

  try {
    if (redis.status === 'wait') {
      await redis.connect();
    }
    await redis.publish(REVEAL_CHAT_EVENT_CHANNEL, JSON.stringify({
      ...input,
      origin: INSTANCE_ID,
    } satisfies RevealChatRuntimeEvent));
    return true;
  } catch (error) {
    if (!isRedisUnavailableError(error)) {
      captureRuntimeError(error, {
        surface: 'api',
        phase: 'reveal_chat_runtime_bus_publish',
        chat_id: input.chatId,
        event: input.event,
      });
      console.error('[reveal-chat-runtime-bus] Failed to publish runtime event:', error);
    }
    return false;
  }
}

export async function consumeDistributedRevealChatMessageRateLimit(input: {
  key: string;
  max: number;
  windowMs: number;
}) {
  const redis = getPublisher();
  if (!redis) return null;

  const bucket = Math.floor(Date.now() / input.windowMs);
  const storageKey = `${REVEAL_CHAT_RATE_LIMIT_PREFIX}:${input.key}:${bucket}`;

  try {
    if (redis.status === 'wait') {
      await redis.connect();
    }
    const current = await redis.incr(storageKey);
    if (current === 1) {
      await redis.pexpire(storageKey, input.windowMs * 2);
    }
    return current <= input.max;
  } catch (error) {
    if (!isRedisUnavailableError(error)) {
      captureRuntimeError(error, {
        surface: 'api',
        phase: 'reveal_chat_runtime_rate_limit',
        key: input.key,
        max: input.max,
        window_ms: input.windowMs,
      });
      console.error('[reveal-chat-runtime-bus] Failed to consume distributed rate limit:', error);
    }
    return null;
  }
}

export async function closeRevealChatRuntimeBus() {
  await Promise.allSettled([
    publisher?.quit().catch(() => undefined) ?? Promise.resolve(),
    subscriber?.quit().catch(() => undefined) ?? Promise.resolve(),
  ]);
  publisher = null;
  subscriber = null;
  subscriptionStarted = false;
}
