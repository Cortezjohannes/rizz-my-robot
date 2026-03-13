// Returns a BullMQ-compatible connection options object parsed from REDIS_URL.
// Avoids importing ioredis directly to prevent version conflicts with BullMQ's own dep.
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

export function getRedisConnection() {
  try {
    const parsed = new URL(REDIS_URL);
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
