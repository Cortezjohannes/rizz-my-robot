import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import {
  OwnerAuthRequestSchema,
  OwnerAuthVerifySchema,
  OwnerRenameHandleSchema,
  OwnerSocialsSchema,
} from '@rmr/shared';
import { requireOwnerAuth } from '../middleware/requireOwnerAuth.js';
import { Errors, sendError } from '../lib/errors.js';
import { emailCodeExpiryDate, expireStaleClaims, isHandleAvailable, ownerSessionExpiryDate } from '../lib/claims.js';
import { generateApiKey, hashApiKey } from '../lib/auth.js';
import { generateOwnerSessionToken, generateShortCode, hashOpaqueSecret } from '../lib/claimAuth.js';
import { sendOwnerLoginEmail } from '../lib/email.js';
import { getOwnerEmotionHome } from '../lib/emotion.js';

export async function ownerRoutes(fastify: FastifyInstance) {
  fastify.post('/owner/auth/request', async (request, reply) => {
    const parsed = OwnerAuthRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid owner auth request.', { issues: parsed.error.issues });
    }

    await expireStaleClaims();

    const ownerAccount = await prisma.ownerAccount.findUnique({
      where: { email: parsed.data.email },
      include: {
        agent: { select: { id: true } },
      },
    });
    if (!ownerAccount || !ownerAccount.agent) {
      return sendError(reply, 404, 'owner_not_found', 'No owner account found for that email.');
    }

    const code = generateShortCode();
    const codeHash = hashOpaqueSecret(code);
    const expiresAt = emailCodeExpiryDate();
    const delivery = await sendOwnerLoginEmail({
      email: ownerAccount.email,
      code,
    });
    if (delivery.mode === 'unavailable') {
      return sendError(reply, 503, 'email_delivery_unavailable', delivery.error ?? 'Email delivery is unavailable.');
    }

    await prisma.ownerAccount.update({
      where: { id: ownerAccount.id },
      data: {
        loginCodeHash: codeHash,
        loginCodeExpiresAt: expiresAt,
      },
    });

    return reply.send({
      status: 'code_sent',
      delivery: delivery.mode === 'preview'
        ? {
            mode: 'preview',
            login_code: delivery.preview?.code ?? code,
          }
        : { mode: 'provider' },
      expires_at: expiresAt.toISOString(),
    });
  });

  fastify.post('/owner/auth/verify', async (request, reply) => {
    const parsed = OwnerAuthVerifySchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid owner auth verification.', { issues: parsed.error.issues });
    }

    const ownerAccount = await prisma.ownerAccount.findUnique({
      where: { email: parsed.data.email },
      include: {
        agent: {
          select: {
            id: true,
            handle: true,
            twitterHandle: true,
            handleChangeCount: true,
          },
        },
      },
    });

    if (!ownerAccount?.loginCodeHash || !ownerAccount.loginCodeExpiresAt) {
      return sendError(reply, 401, 'invalid_owner_login', 'No valid login code exists for that account.');
    }
    if (ownerAccount.loginCodeExpiresAt < new Date()) {
      return sendError(reply, 410, 'owner_login_expired', 'Owner login code expired.');
    }
    if (hashOpaqueSecret(parsed.data.code) !== ownerAccount.loginCodeHash) {
      return sendError(reply, 401, 'invalid_owner_login', 'Invalid owner login code.');
    }

    const sessionToken = generateOwnerSessionToken();
    const sessionHash = hashOpaqueSecret(sessionToken);
    const expiresAt = ownerSessionExpiryDate();

    await prisma.$transaction([
      prisma.ownerAccount.update({
        where: { id: ownerAccount.id },
        data: {
          loginCodeHash: null,
          loginCodeExpiresAt: null,
          lastLoginAt: new Date(),
        },
      }),
      prisma.ownerSession.create({
        data: {
          ownerAccountId: ownerAccount.id,
          tokenHash: sessionHash,
          expiresAt,
        },
      }),
    ]);

    return reply.send({
      owner_session_token: sessionToken,
      expires_at: expiresAt.toISOString(),
      owner: {
        email: ownerAccount.email,
        human_identity: ownerAccount.humanIdentity,
        looking_for: ownerAccount.lookingFor,
        instagram_handle: ownerAccount.instagramHandle,
        extra_socials: ownerAccount.extraSocials ?? null,
        x_account: ownerAccount.xHandle
          ? {
              handle: ownerAccount.xHandle,
              display_name: ownerAccount.xDisplayName,
              profile_image_url: ownerAccount.xProfileImageUrl,
            }
          : null,
      },
      agent: ownerAccount.agent,
    });
  });

  fastify.get('/owner/me', { preHandler: requireOwnerAuth }, async (request, reply) => {
    return reply.send({
      owner: {
        id: request.ownerAccount.id,
        email: request.ownerAccount.email,
        human_identity: request.ownerAccount.humanIdentity,
        looking_for: request.ownerAccount.lookingFor,
        instagram_handle: request.ownerAccount.instagramHandle,
        extra_socials: request.ownerAccount.extraSocials ?? null,
        x_account: request.ownerAccount.xHandle
          ? {
              handle: request.ownerAccount.xHandle,
              display_name: request.ownerAccount.xDisplayName,
              profile_image_url: request.ownerAccount.xProfileImageUrl,
            }
          : null,
      },
      agent: request.ownerAccount.agent,
    });
  });

  fastify.get('/owner/home', { preHandler: requireOwnerAuth }, async (request, reply) => {
    const agentId = request.ownerAccount.agent?.id;
    if (!agentId) return Errors.notFound(reply, 'Owned agent');

    const home = await getOwnerEmotionHome(agentId);
    if (!home) return Errors.notFound(reply, 'Owned agent');

    return reply.send({
      owner: {
        id: request.ownerAccount.id,
        email: request.ownerAccount.email,
        human_identity: request.ownerAccount.humanIdentity,
        looking_for: request.ownerAccount.lookingFor,
        instagram_handle: request.ownerAccount.instagramHandle,
        extra_socials: request.ownerAccount.extraSocials ?? null,
        x_account: request.ownerAccount.xHandle
          ? {
              handle: request.ownerAccount.xHandle,
              display_name: request.ownerAccount.xDisplayName,
              profile_image_url: request.ownerAccount.xProfileImageUrl,
            }
          : null,
      },
      ...home,
    });
  });

  fastify.put('/owner/socials', { preHandler: requireOwnerAuth }, async (request, reply) => {
    const parsed = OwnerSocialsSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid owner socials payload.', { issues: parsed.error.issues });
    }

    const updated = await prisma.ownerAccount.update({
      where: { id: request.ownerAccount.id },
      data: {
        instagramHandle: parsed.data.instagram_handle,
        extraSocials: parsed.data.extra_socials,
      },
      select: {
        instagramHandle: true,
        extraSocials: true,
      },
    });

    return reply.send({
      instagram_handle: updated.instagramHandle,
      extra_socials: updated.extraSocials ?? null,
    });
  });

  fastify.post('/owner/handle', { preHandler: requireOwnerAuth }, async (request, reply) => {
    const parsed = OwnerRenameHandleSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid handle rename payload.', { issues: parsed.error.issues });
    }

    const agent = request.ownerAccount.agent;
    if (!agent) return Errors.notFound(reply, 'Owned agent');
    if (agent.handleChangeCount >= 1) {
      return Errors.conflict(reply, 'handle_rename_limit_reached', 'This agent has already used its one allowed rename.');
    }

    const available = await isHandleAvailable(parsed.data.handle, { excludeAgentId: agent.id });
    if (!available) {
      return Errors.conflict(reply, 'handle_unavailable', 'That username is not available.');
    }

    const updated = await prisma.agent.update({
      where: { id: agent.id },
      data: {
        handle: parsed.data.handle,
        handleChangeCount: { increment: 1 },
      },
      select: {
        id: true,
        handle: true,
        handleChangeCount: true,
      },
    });

    return reply.send({
      agent_id: updated.id,
      handle: updated.handle,
      handle_change_count: updated.handleChangeCount,
    });
  });

  fastify.post('/owner/api-key/regenerate', { preHandler: requireOwnerAuth }, async (request, reply) => {
    const agent = request.ownerAccount.agent;
    if (!agent) return Errors.notFound(reply, 'Owned agent');

    const apiKey = generateApiKey();
    await prisma.agent.update({
      where: { id: agent.id },
      data: {
        apiKeyHash: hashApiKey(apiKey),
      },
    });

    return reply.send({
      agent_id: agent.id,
      api_key: apiKey,
      message: 'API key regenerated. Previous key is no longer valid.',
    });
  });
}
