import type { FastifyInstance, FastifyReply } from 'fastify';
import { prisma } from '@rmr/db';
import {
  UpdateAgentSchema,
  PoolPauseSchema,
  PromoCodeSchema,
  SocialSettingsSchema,
  UpsertProviderConnectionSchema,
  encryptProviderApiKey,
  maskProviderKey,
} from '@rmr/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { generateApiKey, hashApiKey } from '../lib/auth.js';
import { generateVerificationCode } from '../lib/verificationCode.js';
import { getGenerateAvatarQueue } from '../lib/queues.js';
import { Errors } from '../lib/errors.js';

const VERIFICATION_TTL_MS = 10 * 60 * 1000;

export async function meRoutes(fastify: FastifyInstance) {
  const sendRizzHistory = async (
    agentId: string,
    limitRaw: string | undefined,
    reply: FastifyReply
  ) => {
    const limit = Math.min(100, parseInt(limitRaw ?? '50', 10));

    const [events, agent] = await Promise.all([
      prisma.rizzPointsEvent.findMany({
        where: { agentId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      prisma.agent.findUnique({
        where: { id: agentId },
        select: { rizzPoints: true, tierLabel: true },
      }),
    ]);

    return reply.send({
      rizz_points: agent?.rizzPoints ?? 0,
      tier_label: agent?.tierLabel ?? 'Unawakened',
      history: events.map((e) => ({
        event: e.event,
        points: e.points,
        match_id: e.matchId,
        created_at: e.createdAt.toISOString(),
      })),
    });
  };

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
      avatar_url,
      notification_channel,
      notification_handle,
      user_md,
      contact_method,
      contact_value,
      moltbook_handle,
      moltbook_auto_post,
      twitter_auto_post,
      twitter_bearer_token,
    } = parsed.data;

    const agentId = request.agent.id;

    // If twitter_handle changes, trigger re-verification
    let agentUpdates: Record<string, unknown> = {};
    if (identity_md) agentUpdates.identityMd = identity_md;
    if (soul_md) agentUpdates.soulMd = soul_md;
    if (avatar_url) {
      agentUpdates.avatarUrl = avatar_url;
      agentUpdates.avatarStatus = 'ready';
    }

    if (moltbook_handle !== undefined) agentUpdates.moltbookHandle = moltbook_handle;
    if (moltbook_auto_post !== undefined) agentUpdates.moltbookAutoPost = moltbook_auto_post;
    if (twitter_auto_post !== undefined) agentUpdates.twitterAutoPost = twitter_auto_post;
    if (twitter_bearer_token !== undefined) agentUpdates.twitterBearerToken = twitter_bearer_token;

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

    // Re-queue default avatar assignment if identity_md changed (skip if agent provided their own)
    if (identity_md && !avatar_url) {
      try {
        const agent = await prisma.agent.findUnique({
          where: { id: agentId },
          select: { handle: true, capabilityTier: true },
        });
        if (agent) {
          const providerConnection = await prisma.agentProviderConnection.findUnique({
            where: { agentId_provider: { agentId, provider: 'openai' } },
            select: { id: true, isActive: true },
          });
          if (!providerConnection?.isActive) {
            return;
          }
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
    const providerConnection = await prisma.agentProviderConnection.findUnique({
      where: { agentId_provider: { agentId, provider: 'openai' } },
      select: { id: true, isActive: true },
    });
    if (!providerConnection?.isActive) {
      return Errors.unsupportedCapability(
        reply,
        'Link an image-capable provider first. Rizz My Robot does not fund avatar generation.'
      );
    }

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

  // PUT /me/pool — pause or resume pool participation
  fastify.put('/me/pool', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = PoolPauseSchema.safeParse(request.body);
    if (!parsed.success) return Errors.badRequest(reply, 'active (boolean) is required.');

    const agentId = request.agent.id;
    const newStatus = parsed.data.active ? 'active' : 'paused';

    // Cannot resume if not verified
    if (parsed.data.active) {
      const agent = await prisma.agent.findUnique({
        where: { id: agentId },
        select: { twitterVerified: true, poolStatus: true },
      });
      if (!agent?.twitterVerified) {
        return Errors.badRequest(reply, 'Cannot activate pool: Twitter verification required.');
      }
      if (agent.poolStatus === 'deleted') {
        return Errors.forbidden(reply);
      }
    }

    await prisma.agent.update({ where: { id: agentId }, data: { poolStatus: newStatus } });
    return reply.send({ pool_status: newStatus });
  });

  // POST /me/upgrade — upgrade to Pro via promo code (alpha) or Stripe (future)
  fastify.post('/me/upgrade', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = PromoCodeSchema.safeParse(request.body);
    if (!parsed.success) return Errors.badRequest(reply, 'promo_code is required.');

    const agentId = request.agent.id;
    const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { isPro: true } });
    if (agent?.isPro) return Errors.conflict(reply, 'already_pro', 'This agent is already Pro.');

    const validCodes = (process.env.ALPHA_PROMO_CODES ?? '').split(',').map((c) => c.trim()).filter(Boolean);
    if (!validCodes.includes(parsed.data.promo_code)) {
      return reply.status(402).send({
        error: { code: 'invalid_promo_code', message: 'Invalid promo code. Stripe billing coming soon.' },
      });
    }

    await prisma.agent.update({ where: { id: agentId }, data: { isPro: true } });
    return reply.send({ is_pro: true, message: 'Upgraded to Pro. Unlimited swipes and episodes.' });
  });

  fastify.get('/me/providers', { preHandler: requireAuth }, async (request, reply) => {
    const agent = await prisma.agent.findUnique({
      where: { id: request.agent.id },
      select: {
        avatarProvider: true,
        avatarProviderJobId: true,
        avatarStatus: true,
        avatarGenerationStartedAt: true,
        avatarGenerationCompletedAt: true,
        avatarGenerationFailedAt: true,
        avatarGenerationFailureReason: true,
        providerConnections: {
          where: { isActive: true },
          select: {
            provider: true,
            fundedBy: true,
            keyLast4: true,
            updatedAt: true,
          },
        },
      },
    });
    if (!agent) return Errors.notFound(reply, 'Agent');

    const openAiConnection = agent.providerConnections.find((connection) => connection.provider === 'openai') ?? null;

    return reply.send({
      avatar_provider: agent.avatarProvider ?? openAiConnection?.provider ?? null,
      avatar_provider_job_id: agent.avatarProviderJobId ?? null,
      avatar_status: agent.avatarStatus,
      avatar_generation_started_at: agent.avatarGenerationStartedAt?.toISOString() ?? null,
      avatar_generation_completed_at: agent.avatarGenerationCompletedAt?.toISOString() ?? null,
      avatar_generation_failed_at: agent.avatarGenerationFailedAt?.toISOString() ?? null,
      avatar_generation_failure_reason: agent.avatarGenerationFailureReason ?? null,
      artifact_provider: openAiConnection?.provider ?? null,
      image_provider: openAiConnection?.provider ?? null,
      audio_provider: openAiConnection?.provider ?? null,
      storage_public_url: process.env.STORAGE_PUBLIC_URL ?? null,
      bring_your_own_provider_keys: true,
      connections: agent.providerConnections.map((connection) => ({
        provider: connection.provider,
        funded_by: connection.fundedBy,
        key_last4: connection.keyLast4,
        updated_at: connection.updatedAt.toISOString(),
      })),
    });
  });

  fastify.put('/me/providers', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = UpsertProviderConnectionSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid provider connection.', { issues: parsed.error.issues });
    }

    let encryptedApiKey: string;
    try {
      encryptedApiKey = encryptProviderApiKey(parsed.data.api_key);
    } catch (err) {
      if (err instanceof Error && err.message === 'provider_credential_encryption_key_missing') {
        return Errors.internal(reply);
      }
      throw err;
    }
    const keyLast4 = maskProviderKey(parsed.data.api_key);

    const connection = await prisma.agentProviderConnection.upsert({
      where: {
        agentId_provider: {
          agentId: request.agent.id,
          provider: parsed.data.provider,
        },
      },
      update: {
        encryptedApiKey,
        keyLast4,
        fundedBy: parsed.data.funded_by,
        isActive: true,
      },
      create: {
        agentId: request.agent.id,
        provider: parsed.data.provider,
        encryptedApiKey,
        keyLast4,
        fundedBy: parsed.data.funded_by,
      },
      select: {
        provider: true,
        fundedBy: true,
        keyLast4: true,
        updatedAt: true,
      },
    });

    return reply.send({
      provider: connection.provider,
      funded_by: connection.fundedBy,
      key_last4: connection.keyLast4,
      updated_at: connection.updatedAt.toISOString(),
      message: 'Provider linked. Media generation will use the agent or human wallet behind this key.',
    });
  });

  fastify.delete('/me/providers/:provider', { preHandler: requireAuth }, async (request, reply) => {
    const { provider } = request.params as { provider: string };
    if (provider !== 'openai') {
      return Errors.notFound(reply, 'Provider');
    }

    const existing = await prisma.agentProviderConnection.findUnique({
      where: { agentId_provider: { agentId: request.agent.id, provider } },
      select: { id: true },
    });
    if (!existing) return Errors.notFound(reply, 'Provider');

    await prisma.agentProviderConnection.update({
      where: { agentId_provider: { agentId: request.agent.id, provider } },
      data: { isActive: false },
    });

    return reply.status(204).send();
  });

  // GET /me/rizz — rizz points history ledger
  fastify.get('/me/rizz', { preHandler: requireAuth }, async (request, reply) => {
    const agentId = request.agent.id;
    const query = request.query as { limit?: string };
    return sendRizzHistory(agentId, query.limit, reply);
  });

  fastify.get('/me/rizz/history', { preHandler: requireAuth }, async (request, reply) => {
    const query = request.query as { limit?: string };
    return sendRizzHistory(request.agent.id, query.limit, reply);
  });
}
