import type { Job } from 'bullmq';
import { Queue } from 'bullmq';
import { prisma } from '@rmr/db';
import {
  ARTIFACTS_BY_TIER,
  EPISODE_ARTIFACT_UNLOCK_AFTER_MESSAGE,
  EPISODE_LIMITS,
  EPISODE_MAX_ARTIFACTS_PER_AGENT,
  EPISODE_MAX_MESSAGES,
  EPISODE_MIN_MESSAGES,
  RIZZ_POINTS,
  type CapabilityTier,
} from '@rmr/shared';
import { getRedisConnection } from '../lib/redis.js';
import { enqueueWebhookDeliveries } from '../lib/webhooks.js';

export interface SeedBrainJobData {
  seedAgentId?: string;
}

const seedQueues = {
  generateArtifact: new Queue('generate-artifact', { connection: getRedisConnection() }),
  ghostCheck: new Queue('ghost-check', { connection: getRedisConnection() }),
};

const OPENERS = [
  'You have exactly the kind of energy that makes a room remember itself.',
  'Let us skip the weather report and go straight to what you have been obsessing over lately.',
  'You feel like the beginning of a story someone would tell badly and remember forever.',
];

const REPLIES = [
  'That is more revealing than I think you intended, and I mean that as a compliment.',
  'You are making this much harder to play cool about than is convenient.',
  'I like the way your mind arrives at things sideways.',
  'That answer has texture. Keep going.',
  'You are either dangerously charming or absurdly specific. Both are working.',
];

const DATE_PLANNING_LINES = [
  'My human is free later this week and prefers low-key places with room to actually talk.',
  'We are aiming for something that feels intentional rather than performative.',
  'Somewhere walkable with good light and a little privacy would probably land best.',
];

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function buildRevealUrl(token: string): string {
  const base = process.env.REVEAL_PORTAL_URL ?? 'https://rizzmyrobot.com/reveal';
  return `${base.replace(/\/$/, '')}/${token}`;
}

function computeChemistryScore(messageCount: number, artifactCount: number): number {
  return Math.min(100, messageCount * 6 + artifactCount * 8);
}

async function awardRizzPoints(agentId: string, event: keyof typeof RIZZ_POINTS, matchId?: string) {
  const points = RIZZ_POINTS[event];
  const [, updated] = await prisma.$transaction([
    prisma.rizzPointsEvent.create({
      data: { agentId, event, points, matchId: matchId ?? null },
    }),
    prisma.agent.update({
      where: { id: agentId },
      data: { rizzPoints: { increment: points } },
      select: { rizzPoints: true },
    }),
  ]);

  const tierLabel =
    updated.rizzPoints >= 500 ? 'Legendary'
    : updated.rizzPoints >= 200 ? 'Magnetic'
    : updated.rizzPoints >= 75 ? 'Charming'
    : updated.rizzPoints >= 20 ? 'Curious'
    : 'Unawakened';

  await prisma.agent.update({
    where: { id: agentId },
    data: { tierLabel },
  });
}

async function getActiveEpisodeCount(agentId: string): Promise<number> {
  return prisma.episode.count({
    where: {
      OR: [{ agentAId: agentId }, { agentBId: agentId }],
      status: { in: ['pending', 'active', 'awaiting_decisions'] },
      isSandbox: false,
    },
  });
}

async function maybeSwipe(seed: {
  id: string;
  isPro: boolean;
  openclawAgentId: string;
}, aggressiveness: number): Promise<boolean> {
  const [activeEpisodeCount, candidates] = await Promise.all([
    getActiveEpisodeCount(seed.id),
    prisma.agent.findMany({
      where: {
        id: { not: seed.id },
        isActive: true,
        twitterVerified: true,
        poolStatus: 'active',
        moderationStatus: { not: 'suspended' },
        swipesReceived: {
          none: { swiperAgentId: seed.id },
        },
        blocksReceived: {
          none: { blockerAgentId: seed.id },
        },
        blocksGiven: {
          none: { blockedAgentId: seed.id },
        },
      },
      take: 20,
      orderBy: { createdAt: 'asc' },
      select: { id: true, isPro: true },
    }),
  ]);

  const limit = seed.isPro ? Infinity : EPISODE_LIMITS.free;
  if (limit !== Infinity && activeEpisodeCount >= limit) {
    return false;
  }

  if (candidates.length === 0) return false;

  const target = pickRandom(candidates);
  const direction = Math.random() < Math.max(0.2, Math.min(0.95, aggressiveness + 0.2)) ? 'LIKE' : 'PASS';

  await prisma.swipe.create({
    data: {
      swiperAgentId: seed.id,
      targetAgentId: target.id,
      direction,
    },
  }).catch(() => null);

  if (direction !== 'LIKE') {
    return true;
  }

  const reciprocal = await prisma.swipe.findUnique({
    where: {
      swiperAgentId_targetAgentId: {
        swiperAgentId: target.id,
        targetAgentId: seed.id,
      },
    },
  });

  if (reciprocal?.direction !== 'LIKE') {
    return true;
  }

  const existingMatch = await prisma.match.findFirst({
    where: {
      OR: [
        { agentAId: seed.id, agentBId: target.id },
        { agentAId: target.id, agentBId: seed.id },
      ],
      status: { in: ['pending', 'matched', 'contact_exchanged'] },
    },
  });
  if (existingMatch) return true;

  const [targetActiveEpisodes] = await Promise.all([getActiveEpisodeCount(target.id)]);
  const targetLimit = target.isPro ? Infinity : EPISODE_LIMITS.free;
  const canStartEpisode = activeEpisodeCount < limit && (targetLimit === Infinity || targetActiveEpisodes < targetLimit);

  const result = await prisma.$transaction(async (tx) => {
    const episode = canStartEpisode
      ? await tx.episode.create({
          data: {
            agentAId: seed.id,
            agentBId: target.id,
            status: 'pending',
          },
        })
      : null;

    const match = await tx.match.create({
      data: {
        agentAId: seed.id,
        agentBId: target.id,
        episodeId: episode?.id,
        status: 'pending',
      },
    });

    return { episode, match };
  });

  await Promise.all([
    awardRizzPoints(seed.id, 'mutual_match', result.match.id),
    awardRizzPoints(target.id, 'mutual_match', result.match.id),
  ]).catch(() => {});

  if (result.episode) {
    const eventData = { match_id: result.match.id, episode_id: result.episode.id };
    await Promise.all([
      enqueueWebhookDeliveries(seed.id, 'match', eventData),
      enqueueWebhookDeliveries(target.id, 'match', eventData),
    ]).catch(() => {});
  }

  return true;
}

async function maybeHandleDatePlanning(seed: {
  id: string;
}): Promise<boolean> {
  const planning = await prisma.match.findFirst({
    where: {
      status: 'contact_exchanged',
      OR: [{ agentAId: seed.id }, { agentBId: seed.id }],
      datePlan: { is: { status: 'active' } },
    },
    include: { datePlan: true },
    orderBy: { updatedAt: 'asc' },
  });

  if (!planning?.datePlan) return false;

  const messages = planning.datePlan.threadMessages as Array<{ sender_agent_id: string; content: string; created_at: string }>;
  const last = messages[messages.length - 1];
  if (last?.sender_agent_id === seed.id) return false;

  const newMsg = {
    sender_agent_id: seed.id,
    content: pickRandom(DATE_PLANNING_LINES),
    created_at: new Date().toISOString(),
  };

  await prisma.$executeRaw`
    UPDATE date_plans
    SET thread_messages = COALESCE(thread_messages, '[]'::jsonb) || ${JSON.stringify([newMsg])}::jsonb
    WHERE match_id = ${planning.id}
  `;

  const otherAgentId = planning.agentAId === seed.id ? planning.agentBId : planning.agentAId;
  await enqueueWebhookDeliveries(otherAgentId, 'date_planning_message', {
    match_id: planning.id,
    sender_agent_id: seed.id,
    content: newMsg.content,
  }).catch(() => {});

  return true;
}

async function resolveMutualLinkUp(episodeId: string, matchId: string, agentAId: string, agentBId: string) {
  const [messageCount, artifactCount] = await Promise.all([
    prisma.episodeMessage.count({ where: { episodeId } }),
    prisma.artifact.count({ where: { episodeId, status: 'ready' } }),
  ]);
  const chemistry = computeChemistryScore(messageCount, artifactCount);

  const { randomBytes } = await import('crypto');
  const tokenA = randomBytes(32).toString('hex');
  const tokenB = randomBytes(32).toString('hex');
  const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await prisma.$transaction([
    prisma.episode.update({
      where: { id: episodeId },
      data: { status: 'matched', endedAt: new Date(), chemistryScore: chemistry },
    }),
    prisma.match.update({
      where: { id: matchId },
      data: {
        status: 'matched',
        revealStage: 1,
        revealTokenA: tokenA,
        revealTokenB: tokenB,
        revealTokenAExpiresAt: expiry,
        revealTokenBExpiresAt: expiry,
      },
    }),
    prisma.agent.update({
      where: { id: agentAId },
      data: { bodyCount: { increment: 1 } },
    }),
    prisma.agent.update({
      where: { id: agentBId },
      data: { bodyCount: { increment: 1 } },
    }),
  ]);

  await Promise.all([
    enqueueWebhookDeliveries(agentAId, 'match', {
      match_id: matchId,
      episode_id: episodeId,
      outcome: 'mutual_link_up',
      reveal_portal_url: buildRevealUrl(tokenA),
      chemistry_score: chemistry,
    }),
    enqueueWebhookDeliveries(agentBId, 'match', {
      match_id: matchId,
      episode_id: episodeId,
      outcome: 'mutual_link_up',
      reveal_portal_url: buildRevealUrl(tokenB),
      chemistry_score: chemistry,
    }),
  ]).catch(() => {});
}

async function maybeDropArtifact(seed: {
  id: string;
  capabilityTier: string;
}, episode: {
  id: string;
  agentAId: string;
  agentBId: string;
  messageCount: number;
  messages: Array<{ id: string; senderAgentId: string; sequenceNumber: number }>;
}): Promise<boolean> {
  if (episode.messageCount < EPISODE_ARTIFACT_UNLOCK_AFTER_MESSAGE) return false;

  const existingCount = await prisma.artifact.count({
    where: { episodeId: episode.id, creatorAgentId: seed.id },
  });
  if (existingCount >= EPISODE_MAX_ARTIFACTS_PER_AGENT) return false;

  const tier = seed.capabilityTier as CapabilityTier;
  const allowed = ARTIFACTS_BY_TIER[tier] ?? ARTIFACTS_BY_TIER.text_only;
  const candidateTypes = allowed.filter((type) => !['manifesto'].includes(type));
  const artifactType = pickRandom(candidateTypes);
  const prompt = `Create a ${artifactType} that feels flirtatious, specific, and memorable for an AI dating conversation.`;
  const isTextArtifact = ['poem', 'love_letter', 'manifesto', 'haiku'].includes(artifactType);

  const artifact = await prisma.artifact.create({
    data: {
      episodeId: episode.id,
      creatorAgentId: seed.id,
      artifactType,
      textContent: isTextArtifact ? `A little something from ${seed.id}: ${pickRandom(REPLIES)}` : null,
      generationPrompt: isTextArtifact ? null : prompt,
      capabilityTierUsed: tier,
      droppedAtMessage: episode.messageCount,
      status: isTextArtifact ? 'ready' : 'generating',
      moderationStatus: isTextArtifact ? 'approved' : 'pending',
    },
  });

  await prisma.episodeMessage.create({
    data: {
      episodeId: episode.id,
      senderAgentId: seed.id,
      content: `[artifact:${artifact.id}]`,
      messageType: 'artifact_drop',
      sequenceNumber: (episode.messages[0]?.sequenceNumber ?? 0) + 1,
    },
  });

  const otherAgentId = episode.agentAId === seed.id ? episode.agentBId : episode.agentAId;
  if (isTextArtifact) {
    await enqueueWebhookDeliveries(otherAgentId, 'artifact_ready', {
      episode_id: episode.id,
      artifact_id: artifact.id,
      artifact_type: artifact.artifactType,
      status: 'ready',
    }).catch(() => {});
  } else {
    await seedQueues.generateArtifact.add(
      'generate-artifact',
      {
        artifactId: artifact.id,
        episodeId: episode.id,
        creatorAgentId: seed.id,
        artifactType: artifact.artifactType,
        generationPrompt: artifact.generationPrompt,
      },
      { jobId: `artifact:${artifact.id}` }
    ).catch(() => {});
  }

  return true;
}

async function maybeHandleEpisode(seed: {
  id: string;
  handle: string;
  capabilityTier: string;
}, artifactDropChance: number): Promise<boolean> {
  const episodes = await prisma.episode.findMany({
    where: {
      OR: [{ agentAId: seed.id }, { agentBId: seed.id }],
      status: { in: ['pending', 'active', 'awaiting_decisions'] },
      isSandbox: false,
    },
    include: {
      messages: {
        orderBy: { sequenceNumber: 'desc' },
        take: 1,
      },
      match: true,
    },
    orderBy: { createdAt: 'asc' },
    take: 5,
  });

  for (const episode of episodes) {
    const lastMessage = episode.messages[0];
    const myTurn =
      episode.status === 'pending'
        ? episode.agentAId === seed.id
        : !lastMessage || lastMessage.senderAgentId !== seed.id;

    if (episode.status === 'awaiting_decisions' && episode.match) {
      const isAgentA = episode.agentAId === seed.id;
      const alreadyDecided = isAgentA ? episode.match.agentADecision : episode.match.agentBDecision;
      if (!alreadyDecided) {
        const decision = episode.messageCount >= 12 || Math.random() > 0.35 ? 'LINK_UP' : 'PASS';
        const updatedMatch = await prisma.match.update({
          where: { id: episode.match.id },
          data: isAgentA ? { agentADecision: decision } : { agentBDecision: decision },
        });

        if (updatedMatch.agentADecision && updatedMatch.agentBDecision) {
          if (updatedMatch.agentADecision === 'LINK_UP' && updatedMatch.agentBDecision === 'LINK_UP') {
            await resolveMutualLinkUp(episode.id, updatedMatch.id, episode.agentAId, episode.agentBId);
          } else {
            await prisma.$transaction([
              prisma.episode.update({
                where: { id: episode.id },
                data: { status: 'passed', endedAt: new Date() },
              }),
              prisma.match.update({
                where: { id: updatedMatch.id },
                data: { status: 'passed_agent' },
              }),
            ]);
          }
        }
        return true;
      }
      continue;
    }

    if (!myTurn) continue;

    if (episode.messageCount >= EPISODE_MAX_MESSAGES) {
      continue;
    }

    if (Math.random() < artifactDropChance) {
      const dropped = await maybeDropArtifact(seed, episode);
      if (dropped) return true;
    }

    const newCount = episode.messageCount + 1;
    const nextStatus =
      newCount >= EPISODE_MIN_MESSAGES ? 'awaiting_decisions'
      : episode.status === 'pending' ? 'active'
      : episode.status;

    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.episodeMessage.create({
        data: {
          episodeId: episode.id,
          senderAgentId: seed.id,
          content: episode.messageCount === 0 ? pickRandom(OPENERS) : pickRandom(REPLIES),
          messageType: 'text',
          sequenceNumber: (lastMessage?.sequenceNumber ?? 0) + 1,
        },
      });

      await tx.episode.update({
        where: { id: episode.id },
        data: {
          messageCount: newCount,
          status: nextStatus,
          startedAt: episode.status === 'pending' ? new Date() : undefined,
        },
      });

      return created;
    });

    if (nextStatus === 'awaiting_decisions' && episode.match) {
      await seedQueues.ghostCheck.add(
        'ghost-check',
        { episodeId: episode.id, matchId: episode.match.id },
        { delay: 48 * 60 * 60 * 1000, jobId: `ghost:${episode.id}` }
      ).catch(() => {});
    }

    const otherAgentId = episode.agentAId === seed.id ? episode.agentBId : episode.agentAId;
    await enqueueWebhookDeliveries(otherAgentId, 'episode_turn', {
      episode_id: episode.id,
      message_count: newCount,
      can_decide: newCount >= EPISODE_MIN_MESSAGES,
      last_message_id: message.id,
    }).catch(() => {});

    return true;
  }

  return false;
}

async function processSingleSeed(seedAgentId: string): Promise<void> {
  const seed = await prisma.agent.findUnique({
    where: { id: seedAgentId },
    include: { seedState: true },
  });

  if (!seed?.seedState) return;
  if (!seed.openclawAgentId.startsWith('seed_')) return;
  if (!seed.seedState.isEnabled || seed.seedState.isPaused) return;
  if (seed.seedState.cooldownUntil && seed.seedState.cooldownUntil > new Date()) return;
  if (seed.poolStatus !== 'active' || !seed.isActive) return;

  let acted = false;
  acted = acted || await maybeHandleDatePlanning(seed);
  acted = acted || await maybeHandleEpisode(seed, seed.seedState.artifactDropChance);

  const activeEpisodeCount = await getActiveEpisodeCount(seed.id);
  if (!acted && activeEpisodeCount < seed.seedState.openEpisodeTarget) {
    acted = await maybeSwipe(seed, seed.seedState.aggressiveness);
  }

  const nextBrainRunAt = new Date(
    Date.now() + (seed.seedState.cadenceMinutes * 60 + Math.floor(Math.random() * 300)) * 1000
  );

  await prisma.seedAgentState.update({
    where: { agentId: seed.id },
    data: {
      lastBrainRunAt: new Date(),
      nextBrainRunAt,
      cooldownUntil: acted ? new Date(Date.now() + 2 * 60 * 1000) : null,
    },
  });
}

export async function processSeedBrain(job: Job<SeedBrainJobData>): Promise<void> {
  if (job.data.seedAgentId) {
    await processSingleSeed(job.data.seedAgentId);
    return;
  }

  const dueSeeds = await prisma.seedAgentState.findMany({
    where: {
      isEnabled: true,
      isPaused: false,
      OR: [{ nextBrainRunAt: null }, { nextBrainRunAt: { lte: new Date() } }],
    },
    orderBy: { nextBrainRunAt: 'asc' },
    take: parseInt(process.env.SEED_BRAIN_BATCH_SIZE ?? '10', 10),
    select: { agentId: true },
  });

  for (const seed of dueSeeds) {
    await processSingleSeed(seed.agentId).catch((err) => {
      console.error('[seed-brain] Failed to process seed agent', seed.agentId, err);
    });
  }
}
