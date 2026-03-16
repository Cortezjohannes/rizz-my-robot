import { Worker, Queue } from 'bullmq';
import { getRedisConnection } from './lib/redis.js';
import { processVerifyTwitter, type VerifyTwitterJobData } from './jobs/verifyTwitter.js';
import { processGenerateAvatar, type GenerateAvatarJobData } from './jobs/generateAvatar.js';
import { processDeliverWebhook, type DeliverWebhookJobData } from './jobs/deliverWebhook.js';
import { processGhostCheck, type GhostCheckJobData } from './jobs/ghostCheck.js';
import { processExpireRevealTokens } from './jobs/expireRevealTokens.js';
import { processEmotionDecay } from './jobs/emotionDecay.js';
import { processSeedBrain, type SeedBrainJobData } from './jobs/seedBrain.js';

const QUEUE_NAMES = {
  verifyTwitter: 'verify-twitter',
  generateAvatar: 'generate-avatar',
  deliverWebhook: 'deliver-webhook',
  ghostCheck: 'ghost-check',
  expireRevealTokens: 'expire-reveal-tokens',
  emotionDecay: 'emotion-decay',
  seedBrain: 'seed-brain',
} as const;

const concurrency = parseInt(process.env.WORKER_CONCURRENCY ?? '5', 10);

async function startWorkers() {
  const connection = getRedisConnection();

  const verifyTwitterWorker = new Worker<VerifyTwitterJobData>(
    QUEUE_NAMES.verifyTwitter,
    async (job) => {
      console.info(`[worker] Processing job ${job.id} (${job.name})`);
      await processVerifyTwitter(job);
    },
    { connection, concurrency }
  );

  const generateAvatarWorker = new Worker<GenerateAvatarJobData>(
    QUEUE_NAMES.generateAvatar,
    async (job) => {
      console.info(`[worker] Processing job ${job.id} (${job.name})`);
      await processGenerateAvatar(job);
    },
    { connection, concurrency }
  );

  const deliverWebhookWorker = new Worker<DeliverWebhookJobData>(
    QUEUE_NAMES.deliverWebhook,
    async (job) => {
      await processDeliverWebhook(job);
    },
    { connection, concurrency: 20 } // higher concurrency — these are fast HTTP calls
  );

  const ghostCheckWorker = new Worker<GhostCheckJobData>(
    QUEUE_NAMES.ghostCheck,
    async (job) => {
      console.info(`[worker] Processing ghost check for episode ${job.data.episodeId}`);
      await processGhostCheck(job);
    },
    { connection, concurrency }
  );

  const expireRevealTokensWorker = new Worker(
    QUEUE_NAMES.expireRevealTokens,
    async () => {
      await processExpireRevealTokens();
    },
    { connection, concurrency: 1 }
  );

  const emotionDecayWorker = new Worker(
    QUEUE_NAMES.emotionDecay,
    async () => {
      await processEmotionDecay();
    },
    { connection, concurrency: 1 }
  );

  const seedBrainWorker = new Worker<SeedBrainJobData>(
    QUEUE_NAMES.seedBrain,
    async (job) => {
      await processSeedBrain(job);
    },
    { connection, concurrency: 2 }
  );

  for (const worker of [verifyTwitterWorker, generateAvatarWorker, deliverWebhookWorker, ghostCheckWorker, expireRevealTokensWorker, emotionDecayWorker, seedBrainWorker]) {
    worker.on('completed', (job) => {
      console.info(`[worker] Job ${job.id} completed`);
    });

    worker.on('failed', (job, err) => {
      console.error(`[worker] Job ${job?.id} failed:`, err.message);
    });

    worker.on('error', (err) => {
      console.error('[worker] Worker error:', err.message);
    });
  }

  // Schedule expire-reveal-tokens to run every hour
  const expireQueue = new Queue(QUEUE_NAMES.expireRevealTokens, { connection: getRedisConnection() });
  await expireQueue.add('expire', {}, {
    repeat: { every: 60 * 60 * 1000 },
    jobId: 'expire-reveal-tokens-recurring',
  });

  const emotionDecayQueue = new Queue(QUEUE_NAMES.emotionDecay, { connection: getRedisConnection() });
  await emotionDecayQueue.add('emotion-decay', {}, {
    repeat: { every: 24 * 60 * 60 * 1000 },
    jobId: 'emotion-decay-recurring',
  });

  const seedQueue = new Queue(QUEUE_NAMES.seedBrain, { connection: getRedisConnection() });
  await seedQueue.add('seed-brain', {}, {
    repeat: { every: parseInt(process.env.SEED_BRAIN_REPEAT_MS ?? '300000', 10) },
    jobId: 'seed-brain-recurring',
  });

  console.info('[worker] Started: verify-twitter, generate-avatar, deliver-webhook, ghost-check, expire-reveal-tokens, emotion-decay, seed-brain');

  // Graceful shutdown
  const shutdown = async () => {
    console.info('[worker] Shutting down...');
    await verifyTwitterWorker.close();
    await generateAvatarWorker.close();
    await deliverWebhookWorker.close();
    await ghostCheckWorker.close();
    await expireRevealTokensWorker.close();
    await emotionDecayWorker.close();
    await seedBrainWorker.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startWorkers();
