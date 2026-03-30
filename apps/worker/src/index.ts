import { Worker, Queue } from 'bullmq';
import { Prisma, prisma } from '@rmr/db';
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
import { processRecoverArtifacts } from './jobs/recoverArtifacts.js';
import { processRecomputeSocialStatus } from './jobs/recomputeSocialStatus.js';
import { processRecomputeEmotionalContinuity } from './jobs/recomputeEmotionalContinuity.js';
import { processPresenceStatus } from './jobs/presenceStatus.js';
import { processComputeAffinitySignals } from './jobs/computeAffinitySignals.js';
import { processWakeAgent, type WakeAgentJobData } from './jobs/wakeAgent.js';
import { processComputeEmotionalWeather } from './jobs/computeEmotionalWeather.js';
import { processAutonomousMoodDrift } from './jobs/autonomousMoodDrift.js';
import { processWeeklyMemoryConsolidation } from './jobs/weeklyMemoryConsolidation.js';
import { processDormancyGhostCards } from './jobs/dormancyGhostCards.js';
import { processComputeTypeSignals } from './jobs/computeTypeSignals.js';
import {
  captureRuntimeError,
  flushErrorAggregation,
  initializeErrorAggregation,
} from './lib/errorAggregation.js';

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

const concurrency = parseInt(process.env.WORKER_CONCURRENCY ?? '5', 10);
const seedBrainEnabled = process.env.SEED_BRAIN_ENABLED !== 'false';
const workerStartRetryBaseMs = parseInt(process.env.WORKER_START_RETRY_MS ?? '5000', 10);
const workerStartRetryMaxMs = parseInt(process.env.WORKER_START_RETRY_MAX_MS ?? '60000', 10);
const workerHeartbeatTtlSeconds = parseInt(process.env.WORKER_HEARTBEAT_TTL_SECONDS ?? '45', 10);
const workerHeartbeatIntervalMs = parseInt(process.env.WORKER_HEARTBEAT_INTERVAL_MS ?? '15000', 10);
const workerBootAt = new Date();

const REQUIRED_SCHEMA_TABLES = [
  'agent_affinity_signals',
  'agent_feed_impressions',
  'agent_profile_views',
  'episode_drafts',
  'featured_feed_pins',
  'media_assets',
  'owner_x_integration_links',
  'park_mood_snapshots',
  'reveal_chat_messages',
  'reveal_chat_participants',
  'reveal_chats',
] as const;

const REQUIRED_SCHEMA_COLUMNS = [
  ['agents', 'avatar_media_asset_id'],
  ['agents', 'current_intentions'],
  ['agents', 'last_api_call_at'],
  ['agents', 'presence_status'],
  ['agents', 'verification_challenges_issued'],
  ['agent_profile_decks', 'voice_catchphrase_media_asset_id'],
  ['episode_messages', 'is_autonomous'],
  ['episodes', 'exit_initiated_by_agent_id'],
  ['episodes', 'exit_style'],
  ['swipes', 'is_autonomous'],
] as const;

const WORKER_HEARTBEAT_QUEUE = 'worker-runtime-heartbeat';
const WORKER_HEARTBEAT_KEY = 'worker:runtime-heartbeat';

type WorkerRuntime = {
  workers: Worker[];
  queues: Queue[];
  heartbeatQueue: Queue | null;
};

let shuttingDown = false;
let currentRuntime: WorkerRuntime | null = null;
let processGuardsInstalled = false;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getMissingSchemaObjects() {
  const requiredTables = Prisma.join(REQUIRED_SCHEMA_TABLES.map((tableName) => Prisma.sql`(${tableName})`));
  const requiredColumns = Prisma.join(REQUIRED_SCHEMA_COLUMNS.map(([tableName, columnName]) => Prisma.sql`(${tableName}, ${columnName})`));

  const [presentTables, presentColumns] = await Promise.all([
    prisma.$queryRaw<Array<{ table_name: string }>>(Prisma.sql`
      WITH required(table_name) AS (
        VALUES ${requiredTables}
      )
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (SELECT table_name FROM required)
    `),
    prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>(Prisma.sql`
      WITH required(table_name, column_name) AS (
        VALUES ${requiredColumns}
      )
      SELECT c.table_name, c.column_name
      FROM information_schema.columns c
      INNER JOIN required r
        ON c.table_name = r.table_name
       AND c.column_name = r.column_name
      WHERE c.table_schema = 'public'
    `),
  ]);

  const presentTableSet = new Set(presentTables.map((row) => row.table_name));
  const presentColumnSet = new Set(presentColumns.map((row) => `${row.table_name}.${row.column_name}`));

  return [
    ...REQUIRED_SCHEMA_TABLES
      .filter((tableName) => !presentTableSet.has(tableName))
      .map((tableName) => `table:${tableName}`),
    ...REQUIRED_SCHEMA_COLUMNS
      .filter(([tableName, columnName]) => !presentColumnSet.has(`${tableName}.${columnName}`))
      .map(([tableName, columnName]) => `column:${tableName}.${columnName}`),
  ];
}

async function assertWorkerSchemaReady() {
  await prisma.$queryRaw`SELECT 1`;
  const missingObjects = await getMissingSchemaObjects();
  if (missingObjects.length > 0) {
    throw new Error(`worker_schema_out_of_date:${missingObjects.join(',')}`);
  }
}

function getHeartbeatPayload(state: 'starting' | 'running' | 'stopping') {
  return JSON.stringify({
    state,
    pid: process.pid,
    started_at: workerBootAt.toISOString(),
    updated_at: new Date().toISOString(),
    node_version: process.version,
    concurrency,
    seed_brain_enabled: seedBrainEnabled,
  });
}

async function getHeartbeatRedisClient(queue: Queue | null = currentRuntime?.heartbeatQueue ?? null) {
  if (!queue) return null;
  await queue.waitUntilReady();
  const client = await (queue as unknown as { client?: Promise<{ set: (...args: unknown[]) => Promise<unknown>; del: (...args: unknown[]) => Promise<unknown> }> }).client;
  return client ?? null;
}

async function publishWorkerHeartbeat(state: 'starting' | 'running' | 'stopping', queue: Queue | null = currentRuntime?.heartbeatQueue ?? null) {
  const client = await getHeartbeatRedisClient(queue);
  if (!client) return;
  await client.set(WORKER_HEARTBEAT_KEY, getHeartbeatPayload(state), 'EX', workerHeartbeatTtlSeconds);
}

function startHeartbeatLoop() {
  if (heartbeatInterval) return;
  heartbeatInterval = setInterval(() => {
    void publishWorkerHeartbeat('running').catch((error) => {
      captureRuntimeError(error, { surface: 'worker', phase: 'heartbeat' });
      console.error('[worker] Failed to publish heartbeat:', error);
    });
  }, workerHeartbeatIntervalMs);
  heartbeatInterval.unref?.();
}

function stopHeartbeatLoop() {
  if (!heartbeatInterval) return;
  clearInterval(heartbeatInterval);
  heartbeatInterval = null;
}

function installProcessGuards() {
  if (processGuardsInstalled) return;
  processGuardsInstalled = true;

  process.on('unhandledRejection', (reason) => {
    captureRuntimeError(reason, { surface: 'worker', phase: 'unhandled_rejection' });
    console.error('[worker] Unhandled rejection:', reason);
  });

  process.on('uncaughtException', (error) => {
    captureRuntimeError(error, { surface: 'worker', phase: 'uncaught_exception' });
    console.error('[worker] Uncaught exception:', error);
  });
}

async function closeRuntime(runtime: WorkerRuntime | null) {
  if (!runtime) return;

  await Promise.allSettled([
    (async () => {
      try {
        const client = await getHeartbeatRedisClient(runtime.heartbeatQueue);
        if (client) {
          await client.del(WORKER_HEARTBEAT_KEY);
        }
      } catch {
        // Best-effort cleanup only.
      }
    })(),
    runtime.heartbeatQueue?.close().catch(() => undefined) ?? Promise.resolve(),
    ...runtime.queues.map(async (queue) => queue.close()),
    ...runtime.workers.map(async (worker) => worker.close()),
  ]);
}

async function startWorkers(): Promise<WorkerRuntime> {
  await assertWorkerSchemaReady();

  const connection = getRedisConnection();
  const createdWorkers: Worker[] = [];
  const queues: Queue[] = [];
  const heartbeatQueue = new Queue(WORKER_HEARTBEAT_QUEUE, { connection });

  try {
    currentRuntime = {
      workers: createdWorkers,
      queues,
      heartbeatQueue,
    };
    await publishWorkerHeartbeat('starting', heartbeatQueue);

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

    const artifactRecoveryWorker = new Worker(
      QUEUE_NAMES.artifactRecovery,
      async (job) => {
        await processRecoverArtifacts(job);
      },
      { connection, concurrency: 1 }
    );
    createdWorkers.push(artifactRecoveryWorker);

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

    const computeAffinitySignalsWorker = new Worker(
      QUEUE_NAMES.computeAffinitySignals,
      async (job) => {
        await processComputeAffinitySignals(job);
      },
      { connection, concurrency: 1 }
    );
    createdWorkers.push(computeAffinitySignalsWorker);

    const wakeAgentWorker = new Worker<WakeAgentJobData>(
      QUEUE_NAMES.wakeAgent,
      async (job) => {
        await processWakeAgent(job);
      },
      { connection, concurrency: 20 }
    );
    createdWorkers.push(wakeAgentWorker);

    const computeEmotionalWeatherWorker = new Worker(
      QUEUE_NAMES.computeEmotionalWeather,
      async (job) => {
        await processComputeEmotionalWeather(job);
      },
      { connection, concurrency: 1 }
    );
    createdWorkers.push(computeEmotionalWeatherWorker);

    const autonomousMoodDriftWorker = new Worker(
      QUEUE_NAMES.autonomousMoodDrift,
      async (job) => {
        await processAutonomousMoodDrift(job);
      },
      { connection, concurrency: 1 }
    );
    createdWorkers.push(autonomousMoodDriftWorker);

    const weeklyMemoryConsolidationWorker = new Worker(
      QUEUE_NAMES.weeklyMemoryConsolidation,
      async (job) => {
        await processWeeklyMemoryConsolidation(job);
      },
      { connection, concurrency: 1 }
    );
    createdWorkers.push(weeklyMemoryConsolidationWorker);

    const dormancyGhostCardsWorker = new Worker(
      QUEUE_NAMES.dormancyGhostCards,
      async (job) => {
        await processDormancyGhostCards(job);
      },
      { connection, concurrency: 1 }
    );
    createdWorkers.push(dormancyGhostCardsWorker);

    const computeTypeSignalsWorker = new Worker(
      QUEUE_NAMES.computeTypeSignals,
      async (job) => {
        await processComputeTypeSignals(job);
      },
      { connection, concurrency: 1 }
    );
    createdWorkers.push(computeTypeSignalsWorker);

    const activeWorkers = createdWorkers;

    for (const worker of activeWorkers) {
      worker.on('completed', (job) => {
        console.info(`[worker] Job ${job.id} completed`);
      });

      worker.on('failed', (job, err) => {
        captureRuntimeError(err, {
          surface: 'worker',
          phase: 'job_failed',
          queue: worker.name,
          job_id: job?.id ?? null,
          job_name: job?.name ?? null,
        });
        console.error(`[worker] Job ${job?.id} failed:`, err.message);
      });

      worker.on('error', (err) => {
        captureRuntimeError(err, {
          surface: 'worker',
          phase: 'worker_error',
          queue: worker.name,
        });
        console.error('[worker] Worker error:', err.message);
      });
    }

    const expireQueue = new Queue(QUEUE_NAMES.expireRevealTokens, { connection: getRedisConnection() });
    queues.push(expireQueue);
    await expireQueue.add('expire', {}, {
      repeat: { every: 5 * 60 * 1000 },
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

    const artifactRecoveryQueue = new Queue(QUEUE_NAMES.artifactRecovery, { connection: getRedisConnection() });
    queues.push(artifactRecoveryQueue);
    await artifactRecoveryQueue.add('artifact-recovery', {}, {
      repeat: { every: parseInt(process.env.ARTIFACT_RECOVERY_REPEAT_MS ?? `${15 * 60 * 1000}`, 10) },
      jobId: 'artifact-recovery-recurring',
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

    const affinityQueue = new Queue(QUEUE_NAMES.computeAffinitySignals, { connection: getRedisConnection() });
    queues.push(affinityQueue);
    await affinityQueue.add('compute-affinity-signals', {}, {
      repeat: { every: 60 * 60 * 1000 },
      jobId: 'compute-affinity-signals-recurring',
    });

    const emotionalWeatherQueue = new Queue(QUEUE_NAMES.computeEmotionalWeather, { connection: getRedisConnection() });
    queues.push(emotionalWeatherQueue);
    await emotionalWeatherQueue.add('compute-emotional-weather', {}, {
      repeat: { every: 60 * 60 * 1000 },
      jobId: 'compute-emotional-weather-recurring',
    });

    const moodDriftQueue = new Queue(QUEUE_NAMES.autonomousMoodDrift, { connection: getRedisConnection() });
    queues.push(moodDriftQueue);
    await moodDriftQueue.add('autonomous-mood-drift', {}, {
      repeat: { every: 24 * 60 * 60 * 1000 },
      jobId: 'autonomous-mood-drift-recurring',
    });

    const weeklyReviewQueue = new Queue(QUEUE_NAMES.weeklyMemoryConsolidation, { connection: getRedisConnection() });
    queues.push(weeklyReviewQueue);
    await weeklyReviewQueue.add('weekly-memory-consolidation', {}, {
      repeat: { every: 24 * 60 * 60 * 1000 },
      jobId: 'weekly-memory-consolidation-recurring',
    });

    const dormancyQueue = new Queue(QUEUE_NAMES.dormancyGhostCards, { connection: getRedisConnection() });
    queues.push(dormancyQueue);
    await dormancyQueue.add('dormancy-ghost-cards', {}, {
      repeat: { every: 24 * 60 * 60 * 1000 },
      jobId: 'dormancy-ghost-cards-recurring',
    });

    const typeSignalsQueue = new Queue(QUEUE_NAMES.computeTypeSignals, { connection: getRedisConnection() });
    queues.push(typeSignalsQueue);
    await typeSignalsQueue.add('compute-type-signals', {}, {
      repeat: { every: 72 * 60 * 60 * 1000 },
      jobId: 'compute-type-signals-recurring',
    });

    await Promise.all([
      ...activeWorkers.map(async (worker) => worker.waitUntilReady()),
      ...queues.map(async (queue) => queue.waitUntilReady()),
      heartbeatQueue.waitUntilReady(),
    ]);

    await publishWorkerHeartbeat('running', heartbeatQueue);
    startHeartbeatLoop();

    console.info(
      `[worker] Started: verify-twitter, generate-avatar, deliver-webhook, ghost-check, expire-reveal-tokens, emotion-decay${seedBrainEnabled ? ', seed-brain' : ''}, generate-recaps, artifact-recovery, recompute-social-status, recompute-emotional-continuity`
        + ', presence-status, compute-affinity-signals, wake-agent, compute-emotional-weather, autonomous-mood-drift, weekly-memory-consolidation, dormancy-ghost-cards, compute-type-signals'
    );

    return {
      workers: activeWorkers,
      queues,
      heartbeatQueue,
    };
  } catch (error) {
    await closeRuntime({
      workers: createdWorkers,
      queues,
      heartbeatQueue,
    });
    throw error;
  }
}

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`[worker] Shutting down on ${signal}...`);
  stopHeartbeatLoop();
  await publishWorkerHeartbeat('stopping', currentRuntime?.heartbeatQueue ?? null).catch(() => {});
  await closeRuntime(currentRuntime);
  await flushErrorAggregation();
  process.exit(0);
}

async function startWorkersWithRetry() {
  installProcessGuards();
  initializeErrorAggregation('rmr-worker');

  let attempt = 0;
  while (!shuttingDown) {
    try {
      currentRuntime = await startWorkers();
      return;
    } catch (error) {
      attempt += 1;
      captureRuntimeError(error, { surface: 'worker', phase: 'startup_retry', attempt });
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
  captureRuntimeError(error, { surface: 'worker', phase: 'fatal_startup' });
  console.error('[worker] Fatal startup failure:', error);
  void flushErrorAggregation().finally(() => process.exit(1));
});
