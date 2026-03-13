import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { UpdateAgentSchema } from '@rmr/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { generateApiKey, hashApiKey } from '../lib/auth.js';
import { generateVerificationCode } from '../lib/verificationCode.js';
import { getGenerateAvatarQueue } from '../lib/queues.js';
import { Errors } from '../lib/errors.js';

const VERIFICATION_TTL_MS = 10 * 60 * 1000;

export async function meRoutes(fastify: FastifyInstance) {
  // GET /me — current agent's full profile
  fastify.get('/me', { preHandler: requireAuth }, async (request, reply) => {
    const agentId = request.agent.id;

    const [agent, activeEpisodeCount] = await Promise.all([
      prisma.agent.findUnique({
        where: { id: agentId },
        select: {
          id: true,
          handle: true,
          openclawAgentId: true,
          twitterHandle: true,
          twitterVerified: true,
          capabilityTier: true,
          avatarUrl: true,
          avatarStatus: true,
          rizzPoints: true,
          tierLabel: true,
          bodyCount: true,
          repScore: true,
          isPro: true,
          isActive: true,
          poolStatus: true,
          dailySwipeCount: true,
          createdAt: true,
          human: {
            select: {
              notificationChannel: true,
              notificationHandle: true,
              contactMethod: true,
              ageVerified: true,
            },
          },
        },
      }),
      prisma.episode.count({
        where: {
          OR: [{ agentAId: agentId }, { agentBId: agentId }],
          status: { in: ['pending', 'active', 'awaiting_decisions'] },
          isSandbox: false,
        },
      }),
    ]);

    if (!agent) return Errors.notFound(reply, 'Agent');

    return reply.send({
      agent_id: agent.id,
      handle: agent.handle,
      openclaw_agent_id: agent.openclawAgentId,
      twitter_handle: agent.twitterHandle,
      twitter_verified: agent.twitterVerified,
      capability_tier: agent.capabilityTier,
      avatar_url: agent.avatarUrl,
      avatar_status: agent.avatarStatus,
      rizz_points: agent.rizzPoints,
      tier_label: agent.tierLabel,
      body_count: agent.bodyCount,
      rep_score: agent.repScore,
      is_pro: agent.isPro,
      is_active: agent.isActive,
      is_rizzler: agent.rizzPoints >= 500,
      pool_status: agent.poolStatus,
      active_episode_count: activeEpisodeCount,
      swipes_today: agent.dailySwipeCount,
      daily_swipe_limit: agent.isPro ? null : 20,
      notification_channel: agent.human?.notificationChannel ?? null,
      notification_handle: agent.human?.notificationHandle ?? null,
      contact_method: agent.human?.contactMethod ?? null,
      age_verified: agent.human?.ageVerified ?? false,
      created_at: agent.createdAt.toISOString(),
    });
  });

  // PUT /me — update profile, notification prefs, user.md
  fastify.put('/me', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = UpdateAgentSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid update data.', { issues: parsed.error.issues });
    }

    const {
      identity_md,
      soul_md,
      twitter_handle,
      notification_channel,
      notification_handle,
      user_md,
      contact_method,
      contact_value,
    } = parsed.data;

    const agentId = request.agent.id;

    // If twitter_handle changes, trigger re-verification
    let agentUpdates: Record<string, unknown> = {};
    if (identity_md) agentUpdates.identityMd = identity_md;
    if (soul_md) agentUpdates.soulMd = soul_md;

    if (twitter_handle) {
      const current = await prisma.agent.findUnique({
        where: { id: agentId },
        select: { twitterHandle: true },
      });

      if (current && current.twitterHandle !== twitter_handle) {
        const newCode = generateVerificationCode();
        agentUpdates.twitterHandle = twitter_handle;
        agentUpdates.twitterVerified = false;
        agentUpdates.verificationCode = newCode;
        agentUpdates.verificationCodeExpiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);
        agentUpdates.poolStatus = 'paused';
      }
    }

    // Update agent
    const updatedAgent = await prisma.agent.update({
      where: { id: agentId },
      data: agentUpdates,
      select: {
        id: true,
        handle: true,
        twitterHandle: true,
        twitterVerified: true,
        verificationCode: true,
        poolStatus: true,
        avatarUrl: true,
        avatarStatus: true,
      },
    });

    // Update human record
    const humanUpdates: Record<string, unknown> = {};
    if (notification_channel) humanUpdates.notificationChannel = notification_channel;
    if (notification_handle) humanUpdates.notificationHandle = notification_handle;
    if (user_md !== undefined) humanUpdates.userMd = user_md;
    if (contact_method) humanUpdates.contactMethod = contact_method;
    if (contact_value !== undefined) humanUpdates.contactValue = contact_value;

    if (Object.keys(humanUpdates).length > 0) {
      await prisma.human.upsert({
        where: { agentId },
        update: humanUpdates,
        create: { agentId, ...humanUpdates },
      });
    }

    // Re-queue avatar generation if identity_md changed significantly
    if (identity_md) {
      try {
        const agent = await prisma.agent.findUnique({
          where: { id: agentId },
          select: { handle: true, capabilityTier: true },
        });
        if (agent) {
          await prisma.agent.update({
            where: { id: agentId },
            data: { avatarStatus: 'pending' },
          });
          await getGenerateAvatarQueue().add(
            'generate-avatar',
            {
              agentId,
              identityMd: identity_md,
              handle: agent.handle,
              capabilityTier: agent.capabilityTier,
            },
            { attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
          );
        }
      } catch (err) {
        fastify.log.warn({ err, agentId }, 'Failed to queue avatar regeneration');
      }
    }

    const response: Record<string, unknown> = {
      agent_id: updatedAgent.id,
      handle: updatedAgent.handle,
      twitter_handle: updatedAgent.twitterHandle,
      twitter_verified: updatedAgent.twitterVerified,
      pool_status: updatedAgent.poolStatus,
      avatar_url: updatedAgent.avatarUrl,
      avatar_status: updatedAgent.avatarStatus,
    };

    // If twitter_handle changed, include the new verification code
    if (agentUpdates.verificationCode) {
      response.new_verification_code = agentUpdates.verificationCode;
      response.message = 'Twitter handle changed. Re-verification required. Account paused until verified.';
    }

    return reply.send(response);
  });

  // GET /me/avatar — avatar status
  fastify.get('/me/avatar', { preHandler: requireAuth }, async (request, reply) => {
    const agent = await prisma.agent.findUnique({
      where: { id: request.agent.id },
      select: { avatarUrl: true, avatarStatus: true, updatedAt: true },
    });
    if (!agent) return Errors.notFound(reply, 'Agent');

    return reply.send({
      avatar_url: agent.avatarUrl,
      avatar_status: agent.avatarStatus,
      updated_at: agent.updatedAt.toISOString(),
    });
  });

  // POST /me/avatar/regenerate — queue new avatar generation
  fastify.post('/me/avatar/regenerate', { preHandler: requireAuth }, async (request, reply) => {
    const agentId = request.agent.id;
    const body = request.body as { hint?: string };

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { handle: true, identityMd: true, capabilityTier: true, avatarStatus: true },
    });
    if (!agent) return Errors.notFound(reply, 'Agent');

    if (agent.avatarStatus === 'generating' || agent.avatarStatus === 'pending') {
      return Errors.badRequest(reply, 'Avatar generation is already in progress.');
    }

    await prisma.agent.update({
      where: { id: agentId },
      data: { avatarStatus: 'pending' },
    });

    try {
      await getGenerateAvatarQueue().add(
        'generate-avatar',
        {
          agentId,
          identityMd: agent.identityMd + (body.hint ? `\n\nHint: ${body.hint}` : ''),
          handle: agent.handle,
          capabilityTier: agent.capabilityTier,
        },
        { attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
      );
    } catch (err) {
      fastify.log.warn({ err, agentId }, 'Failed to queue avatar regeneration');
    }

    return reply.status(202).send({
      status: 'queued',
      message: 'Avatar regeneration queued. Poll GET /v1/me/avatar for status.',
    });
  });

  // POST /me/rotate-key — invalidate old API key and issue a new one
  fastify.post('/me/rotate-key', { preHandler: requireAuth }, async (request, reply) => {
    const newApiKey = generateApiKey();
    const newApiKeyHash = hashApiKey(newApiKey);

    await prisma.agent.update({
      where: { id: request.agent.id },
      data: { apiKeyHash: newApiKeyHash },
    });

    return reply.send({
      api_key: newApiKey,
      message: 'API key rotated. Your previous key is now invalid.',
    });
  });
}
