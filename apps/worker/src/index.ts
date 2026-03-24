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
import { processPresenceStatus } from './jobs/presenceStatus.js';

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
  presenceStatus: 'presence-status',
} as const;

const concurrency = parseInt(process.env.WORKER_CONCURRENCY ?? '5', 10);
const seedBrainEnabled = process.env.SEED_BRAIN_ENABLED !== 'false';
const workerStartRetryBaseMs = parseInt(process.env.WORKER_START_RETRY_MS ?? '5000', 10);
const workerStartRetryMaxMs = parseInt(process.env.WORKER_START_RETRY_MAX_MS ?? '60000', 10);

type WorkerRuntime = {
  workers: Worker[];
  queues: Queue[];
};

let shuttingDown = false;
let currentRuntime: WorkerRuntime | null = null;
let processGuardsInstalled = false;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function installProcessGuards() {
  if (processGuardsInstalled) return;
  processGuardsInstalled = true;

  process.on('unhandledRejection', (reason) => {
    console.error('[worker] Unhandled rejection:', reason);
  });

  process.on('uncaughtException', (error) => {
    console.error('[worker] Uncaught exception:', error);
  });
}

async function closeRuntime(runtime: WorkerRuntime | null) {
  if (!runtime) return;

  await Promise.allSettled([
    ...runtime.queues.map(async (queue) => queue.close()),
    ...runtime.workers.map(async (worker) => worker.close()),
  ]);
}

async function startWorkers(): Promise<WorkerRuntime> {
  const connection = getRedisConnection();
  const createdWorkers: Worker[] = [];
  const queues: Queue[] = [];

  try {
    const verifyTwitterWorker = new Worker<VerifyTwitterJobData>(
      QUEUE_NAMES.verifyTwitter,
      async (job) => {
        console.info(`[worker] Processing job ${job.id} (${job.name})`);
        await processVerifyTwitter(job);
      },
      { connection, concurrency }
    );
    createdWorkers.push(verifyTwitterWorker);

    const generateAvatarWorker = new Worker<GenerateAvatarJobData>(
      QUEUE_NAMES.generateAvatar,
      async (job) => {
        console.info(`[worker] Processing job ${job.id} (${job.name})`);
        await processGenerateAvatar(job);
      },
      { connection, concurrency }
    );
    createdWorkers.push(generateAvatarWorker);

    const deliverWebhookWorker = new Worker<DeliverWebhookJobData>(
      QUEUE_NAMES.deliverWebhook,
      async (job) => {
        await processDeliverWebhook(job);
      },
      { connection, concurrency: 20 }
    );
    createdWorkers.push(deliverWebhookWorker);

    const ghostCheckWorker = new Worker<GhostCheckJobData>(
      QUEUE_NAMES.ghostCheck,
      async (job) => {
        console.info(`[worker] Processing ghost check for episode ${job.data.episodeId}`);
        await processGhostCheck(job);
      },
      { connection, concurrency }
    );
    createdWorkers.push(ghostCheckWorker);

    const revealChatLifecycleWorker = new Worker(
      QUEUE_NAMES.revealChatLifecycle,
      async (job) => {
        await processRevealChatLifecycle(job);
      },
      { connection, concurrency: 2 }
    );
    createdWorkers.push(revealChatLifecycleWorker);

    const expireRevealTokensWorker = new Worker(
      QUEUE_NAMES.expireRevealTokens,
      async () => {
        await processExpireRevealTokens();
      },
      { connection, concurrency: 1 }
    );
    createdWorkers.push(expireRevealTokensWorker);

    const emotionDecayWorker = new Worker(
      QUEUE_NAMES.emotionDecay,
      async () => {
        await processEmotionDecay();
      },
      { connection, concurrency: 1 }
    );
    createdWorkers.push(emotionDecayWorker);

    const seedBrainWorker = seedBrainEnabled
      ? new Worker<SeedBrainJobData>(
          QUEUE_NAMES.seedBrain,
          async (job) => {
            await processSeedBrain(job);
          },
          { connection, concurrency: 2 }
        )
      : null;
    if (seedBrainWorker) createdWorkers.push(seedBrainWorker);

    const generateRecapsWorker = new Worker(
      QUEUE_NAMES.generateRecaps,
      async (job) => {
        await processGenerateRecaps(job);
      },
      { connection, concurrency: 1 }
    );
    createdWorkers.push(generateRecapsWorker);

    const recomputeSocialStatusWorker = new Worker(
      QUEUE_NAMES.recomputeSocialStatus,
      async (job) => {
        await processRecomputeSocialStatus(job);
      },
      { connection, concurrency: 1 }
    );
    createdWorkers.push(recomputeSocialStatusWorker);

    const recomputeEmotionalContinuityWorker = new Worker(
      QUEUE_NAMES.recomputeEmotionalContinuity,
      async (job) => {
        await processRecomputeEmotionalContinuity(job);
      },
      { connection, concurrency: 1 }
    );
    createdWorkers.push(recomputeEmotionalContinuityWorker);

    const presenceStatusWorker = new Worker(
      QUEUE_NAMES.presenceStatus,
      async (job) => {
        await processPresenceStatus(job);
      },
      { connection, concurrency: 2 }
    );
    createdWorkers.push(presenceStatusWorker);

    const activeWorkers = createdWorkers;

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

    const expireQueue = new Queue(QUEUE_NAMES.expireRevealTokens, { connection: getRedisConnection() });
    queues.push(expireQueue);
    await expireQueue.add('expire', {}, {
      repeat: { every: 60 * 60 * 1000 },
      jobId: 'expire-reveal-tokens-recurring',
    });

    const emotionDecayQueue = new Queue(QUEUE_NAMES.emotionDecay, { connection: getRedisConnection() });
    queues.push(emotionDecayQueue);
    await emotionDecayQueue.add('emotion-decay', {}, {
      repeat: { every: 24 * 60 * 60 * 1000 },
      jobId: 'emotion-decay-recurring',
    });

    if (seedBrainEnabled) {
      const seedQueue = new Queue(QUEUE_NAMES.seedBrain, { connection: getRedisConnection() });
      queues.push(seedQueue);
      await seedQueue.add('seed-brain', {}, {
        repeat: { every: parseInt(process.env.SEED_BRAIN_REPEAT_MS ?? '300000', 10) },
        jobId: 'seed-brain-recurring',
      });
    }

    const recapsQueue = new Queue(QUEUE_NAMES.generateRecaps, { connection: getRedisConnection() });
    queues.push(recapsQueue);
    await recapsQueue.add('generate-recaps', {}, {
      repeat: { every: parseInt(process.env.GENERATE_RECAPS_REPEAT_MS ?? '600000', 10) },
      jobId: 'generate-recaps-recurring',
    });

    const socialStatusQueue = new Queue(QUEUE_NAMES.recomputeSocialStatus, { connection: getRedisConnection() });
    queues.push(socialStatusQueue);
    await socialStatusQueue.add('recompute-social-status', {}, {
      repeat: { every: 1000 * 60 * 30 },
      jobId: 'recompute-social-status-recurring',
    });

    const emotionalContinuityQueue = new Queue(QUEUE_NAMES.recomputeEmotionalContinuity, { connection: getRedisConnection() });
    queues.push(emotionalContinuityQueue);
    await emotionalContinuityQueue.add('recompute-emotional-continuity', {}, {
      repeat: { every: 1000 * 60 * 20 },
      jobId: 'recompute-emotional-continuity-recurring',
    });

    await Promise.all([
      ...activeWorkers.map(async (worker) => worker.waitUntilReady()),
      ...queues.map(async (queue) => queue.waitUntilReady()),
    ]);

    console.info(
      `[worker] Started: verify-twitter, generate-avatar, deliver-webhook, ghost-check, expire-reveal-tokens, emotion-decay${seedBrainEnabled ? ', seed-brain' : ''}, generate-recaps, recompute-social-status, recompute-emotional-continuity`
        + ', presence-status'
    );

    return {
      workers: activeWorkers,
      queues,
    };
  } catch (error) {
    await closeRuntime({
      workers: createdWorkers,
      queues,
    });
    throw error;
  }
}

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`[worker] Shutting down on ${signal}...`);
  await closeRuntime(currentRuntime);
  process.exit(0);
}

async function startWorkersWithRetry() {
  installProcessGuards();

  let attempt = 0;
  while (!shuttingDown) {
    try {
      currentRuntime = await startWorkers();
      return;
    } catch (error) {
      attempt += 1;
      console.error(`[worker] Startup failed (attempt ${attempt}).`, error);
      await closeRuntime(currentRuntime);
      currentRuntime = null;
      if (shuttingDown) return;
      const delay = Math.min(workerStartRetryBaseMs * Math.max(1, attempt), workerStartRetryMaxMs);
      console.info(`[worker] Retrying startup in ${Math.round(delay / 1000)}s...`);
      await sleep(delay);
    }
  }
}

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });

void startWorkersWithRetry().catch((error) => {
  console.error('[worker] Fatal startup failure:', error);
  process.exit(1);
});
