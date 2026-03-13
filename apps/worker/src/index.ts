import { Worker } from 'bullmq';
import { getRedisConnection } from './lib/redis.js';
import { processVerifyTwitter, type VerifyTwitterJobData } from './jobs/verifyTwitter.js';
import { processGenerateAvatar, type GenerateAvatarJobData } from './jobs/generateAvatar.js';

const QUEUE_NAMES = {
  verifyTwitter: 'verify-twitter',
  generateAvatar: 'generate-avatar',
} as const;

const concurrency = parseInt(process.env.WORKER_CONCURRENCY ?? '5', 10);

function startWorkers() {
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

  for (const worker of [verifyTwitterWorker, generateAvatarWorker]) {
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

  console.info('[worker] Started: verify-twitter, generate-avatar');

  // Graceful shutdown
  const shutdown = async () => {
    console.info('[worker] Shutting down...');
    await verifyTwitterWorker.close();
    await generateAvatarWorker.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startWorkers();
