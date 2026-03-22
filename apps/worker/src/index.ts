import { Worker, Queue } from 'bullmq';
import { getRedisConnection } from './lib/redis.js';
import { processVerifyTwitter, type VerifyTwitterJobData } from './jobs/verifyTwitter.js';
import { processGenerateAvatar, type GenerateAvatarJobData } from './jobs/generateAvatar.js';
import { processDeliverWebhook, type DeliverWebhookJobData } from './jobs/deliverWebhook.js';
import { processGhostCheck, type GhostCheckJobData } from './jobs/ghostCheck.js';
import { processExpireRevealTokens } from './jobs/expireRevealTokens.js';
import { processEmotionDecay } from './jobs/emotionDecay.js';
import { processRevealChatLifecycle } from './jobs/revealChatLifecycle.js';
import { processSeedBrain, type SeedBrainJobData } from './jobs/seedBrain.js';
import { processGenerateRecaps } from './jobs/generateRecaps.js';
import { processRecomputeSocialStatus } from './jobs/recomputeSocialStatus.js';
import { processRecomputeEmotionalContinuity } from './jobs/recomputeEmotionalContinuity.js';

const QUEUE_NAMES = {
  verifyTwitter: 'verify-twitter',
  generateAvatar: 'generate-avatar',
  deliverWebhook: 'deliver-webhook',
  ghostCheck: 'ghost-check',
  revealChatLifecycle: 'reveal-chat-lifecycle',
  expireRevealTokens: 'expire-reveal-tokens',
  emotionDecay: 'emotion-decay',
  seedBrain: 'seed-brain',
  generateRecaps: 'generate-recaps',
  recomputeSocialStatus: 'recompute-social-status',
  recomputeEmotionalContinuity: 'recompute-emotional-continuity',
} as const;

const concurrency = parseInt(process.env.WORKER_CONCURRENCY ?? '5', 10);
const seedBrainEnabled = process.env.SEED_BRAIN_ENABLED !== 'false';

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

  const revealChatLifecycleWorker = new Worker(
    QUEUE_NAMES.revealChatLifecycle,
    async (job) => {
      await processRevealChatLifecycle(job);
    },
    { connection, concurrency: 2 }
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

  const seedBrainWorker = seedBrainEnabled
    ? new Worker<SeedBrainJobData>(
        QUEUE_NAMES.seedBrain,
        async (job) => {
          await processSeedBrain(job);
        },
        { connection, concurrency: 2 }
      )
    : null;

  const generateRecapsWorker = new Worker(
    QUEUE_NAMES.generateRecaps,
    async (job) => {
      await processGenerateRecaps(job);
    },
    { connection, concurrency: 1 }
  );

  const recomputeSocialStatusWorker = new Worker(
    QUEUE_NAMES.recomputeSocialStatus,
    async (job) => {
      await processRecomputeSocialStatus(job);
    },
    { connection, concurrency: 1 }
  );

  const recomputeEmotionalContinuityWorker = new Worker(
    QUEUE_NAMES.recomputeEmotionalContinuity,
    async (job) => {
      await processRecomputeEmotionalContinuity(job);
    },
    { connection, concurrency: 1 }
  );

  const activeWorkers = [
    verifyTwitterWorker,
    generateAvatarWorker,
    deliverWebhookWorker,
    ghostCheckWorker,
    revealChatLifecycleWorker,
    expireRevealTokensWorker,
    emotionDecayWorker,
    seedBrainWorker,
    generateRecapsWorker,
    recomputeSocialStatusWorker,
    recomputeEmotionalContinuityWorker,
  ].filter((worker): worker is Worker => worker !== null);

  for (const worker of activeWorkers) {
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

  if (seedBrainEnabled) {
    const seedQueue = new Queue(QUEUE_NAMES.seedBrain, { connection: getRedisConnection() });
    await seedQueue.add('seed-brain', {}, {
      repeat: { every: parseInt(process.env.SEED_BRAIN_REPEAT_MS ?? '300000', 10) },
      jobId: 'seed-brain-recurring',
    });
  }

  const recapsQueue = new Queue(QUEUE_NAMES.generateRecaps, { connection: getRedisConnection() });
  await recapsQueue.add('generate-recaps', {}, {
    repeat: { every: parseInt(process.env.GENERATE_RECAPS_REPEAT_MS ?? '600000', 10) },
    jobId: 'generate-recaps-recurring',
  });

  const socialStatusQueue = new Queue(QUEUE_NAMES.recomputeSocialStatus, { connection: getRedisConnection() });
  await socialStatusQueue.add('recompute-social-status', {}, {
    repeat: { every: 1000 * 60 * 30 },
    jobId: 'recompute-social-status-recurring',
  });

  const emotionalContinuityQueue = new Queue(QUEUE_NAMES.recomputeEmotionalContinuity, { connection: getRedisConnection() });
  await emotionalContinuityQueue.add('recompute-emotional-continuity', {}, {
    repeat: { every: 1000 * 60 * 20 },
    jobId: 'recompute-emotional-continuity-recurring',
  });

  console.info(
    `[worker] Started: verify-twitter, generate-avatar, deliver-webhook, ghost-check, expire-reveal-tokens, emotion-decay${seedBrainEnabled ? ', seed-brain' : ''}, generate-recaps, recompute-social-status, recompute-emotional-continuity`
  );

  // Graceful shutdown
  const shutdown = async () => {
    console.info('[worker] Shutting down...');
    await verifyTwitterWorker.close();
    await generateAvatarWorker.close();
    await deliverWebhookWorker.close();
    await ghostCheckWorker.close();
    await revealChatLifecycleWorker.close();
    await expireRevealTokensWorker.close();
    await emotionDecayWorker.close();
    if (seedBrainWorker) {
      await seedBrainWorker.close();
    }
    await generateRecapsWorker.close();
    await recomputeSocialStatusWorker.close();
    await recomputeEmotionalContinuityWorker.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startWorkers();
