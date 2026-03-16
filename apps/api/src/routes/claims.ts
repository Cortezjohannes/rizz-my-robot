import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { prisma } from '@rmr/db';
import {
  ClaimEmailSchema,
  ClaimStartSchema,
  ClaimVerifyEmailSchema,
  UsernameSchema,
} from '@rmr/shared';
import { generateApiKey, hashApiKey } from '../lib/auth.js';
import { buildClaimUrl, claimExpiryDate, claimPreview, emailCodeExpiryDate, expireStaleClaims, hashClaimToken, isHandleAvailable, ownerSessionExpiryDate } from '../lib/claims.js';
import { generateClaimToken, generateOwnerSessionToken, generateShortCode, hashOpaqueSecret, verifyClaimToken } from '../lib/claimAuth.js';
import { Errors, sendError } from '../lib/errors.js';
import { suggestHandle } from '../lib/handles.js';
import { pickDefaultAvatarUrl } from '@rmr/shared';
import { buildClaimTwitterQuery, checkTwitterForCode } from '../lib/twitterVerification.js';
import { recomputeAuthenticityScore } from '../lib/authenticity.js';
import { sendClaimVerificationEmail } from '../lib/email.js';

export async function claimsRoutes(fastify: FastifyInstance) {
  fastify.get('/handles/:handle/availability', async (request, reply) => {
    const params = request.params as { handle: string };
    const parsed = UsernameSchema.safeParse(params.handle);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid handle.', { issues: parsed.error.issues });
    }

    await expireStaleClaims();
    const available = await isHandleAvailable(parsed.data);
    return reply.send({ handle: parsed.data, available });
  });

  fastify.post('/claims/start', async (request, reply) => {
    const parsed = ClaimStartSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid claim start data.', { issues: parsed.error.issues });
    }

    await expireStaleClaims();

    const existingAgent = await prisma.agent.findUnique({
      where: { openclawAgentId: parsed.data.openclaw_agent_id },
      select: { id: true },
    });
    if (existingAgent) {
      return Errors.conflict(reply, 'already_claimed', 'This OpenClaw agent is already claimed.');
    }

    const existingClaim = await prisma.agentClaim.findUnique({
      where: { openclawAgentId: parsed.data.openclaw_agent_id },
      select: {
        id: true,
        status: true,
        expiresAt: true,
        reservedHandle: true,
        openclawAgentId: true,
        twitterHandle: true,
        identityMd: true,
        emailVerifiedAt: true,
        xVerifiedAt: true,
      },
    });

    if (existingClaim && !['completed', 'expired', 'canceled'].includes(existingClaim.status) && existingClaim.expiresAt > new Date()) {
      const activeToken = generateClaimToken(existingClaim.id);
      return reply.status(200).send({
        ...claimPreview(existingClaim, activeToken),
        suggested_handle: suggestHandle(parsed.data.identity_md, parsed.data.openclaw_agent_id),
        email_verified: !!existingClaim.emailVerifiedAt,
        x_verified: !!existingClaim.xVerifiedAt,
      });
    }

    const claimId = existingClaim?.id ?? randomUUID();
    const token = generateClaimToken(claimId);
    const tokenHash = hashClaimToken(token);
    const claim = await prisma.agentClaim.upsert({
      where: { openclawAgentId: parsed.data.openclaw_agent_id },
      update: {
        tokenHash,
        status: 'pending_email',
        twitterHandle: parsed.data.twitter_handle,
        identityMd: parsed.data.identity_md,
        soulMd: parsed.data.soul_md,
        expiresAt: claimExpiryDate(),
        emailVerificationCodeHash: null,
        emailVerificationExpiresAt: null,
        emailVerifiedAt: null,
        xVerificationCode: null,
        xVerificationExpiresAt: null,
        xVerifiedAt: null,
        completedAt: null,
        canceledAt: null,
      },
      create: {
        id: claimId,
        tokenHash,
        status: 'pending_email',
        openclawAgentId: parsed.data.openclaw_agent_id,
        twitterHandle: parsed.data.twitter_handle,
        identityMd: parsed.data.identity_md,
        soulMd: parsed.data.soul_md,
        expiresAt: claimExpiryDate(),
      },
      select: {
        id: true,
        status: true,
        openclawAgentId: true,
        twitterHandle: true,
        identityMd: true,
        reservedHandle: true,
        expiresAt: true,
      },
    });

    return reply.status(201).send({
      ...claimPreview(claim, token),
      suggested_handle: suggestHandle(parsed.data.identity_md, parsed.data.openclaw_agent_id),
      email_verified: false,
      x_verified: false,
    });
  });

  fastify.get('/claims/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    await expireStaleClaims();
    const claimId = verifyClaimToken(token);
    if (!claimId) return Errors.notFound(reply, 'Claim');

    const claim = await prisma.agentClaim.findUnique({
      where: { id: claimId },
      include: {
        ownerAccount: {
          select: { email: true, instagramHandle: true, extraSocials: true },
        },
      },
    });

    if (!claim) return Errors.notFound(reply, 'Claim');

    return reply.send({
      ...claimPreview(claim, token),
      email_verified: !!claim.emailVerifiedAt,
      x_verified: !!claim.xVerifiedAt,
      owner_email: claim.ownerAccount?.email ?? null,
      instagram_handle: claim.ownerAccount?.instagramHandle ?? null,
      extra_socials: claim.ownerAccount?.extraSocials ?? null,
    });
  });

  fastify.post('/claims/:id/email', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = ClaimEmailSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid claim email submission.', { issues: parsed.error.issues });
    }

    await expireStaleClaims();

    const claim = await prisma.agentClaim.findUnique({
      where: { id },
      include: { ownerAccount: true, handleReservation: true },
    });
    if (!claim) return Errors.notFound(reply, 'Claim');
    if (claim.status === 'completed') return Errors.conflict(reply, 'claim_completed', 'This claim is already complete.');
    if (claim.expiresAt < new Date()) return reply.status(410).send({ error: { code: 'claim_expired', message: 'This claim has expired.' } });
    if (hashClaimToken(parsed.data.claim_token) !== claim.tokenHash) {
      return sendError(reply, 401, 'invalid_claim_token', 'Invalid claim token.');
    }

    const available = await isHandleAvailable(parsed.data.handle, { excludeClaimId: claim.id });
    if (!available) {
      return Errors.conflict(reply, 'handle_unavailable', 'That username is not available.');
    }

    let ownerAccount = claim.ownerAccount;
    if (ownerAccount && ownerAccount.email !== parsed.data.email) {
      return Errors.conflict(reply, 'claim_email_locked', 'This claim is already attached to a different email.');
    }

    const existingEmailOwner = await prisma.ownerAccount.findUnique({
      where: { email: parsed.data.email },
      select: { id: true, emailVerifiedAt: true },
    });
    if (existingEmailOwner) {
      const existingOwnedAgent = await prisma.agent.findFirst({
        where: { ownerAccountId: existingEmailOwner.id },
        select: { id: true },
      });
      if (existingOwnedAgent) {
        return Errors.conflict(reply, 'owner_limit_reached', 'This email already owns an agent.');
      }
      if (existingEmailOwner.emailVerifiedAt) {
        const otherVerifiedClaim = await prisma.agentClaim.findFirst({
          where: {
            ownerAccountId: existingEmailOwner.id,
            id: { not: claim.id },
            status: { notIn: ['completed', 'expired', 'canceled'] },
            emailVerifiedAt: { not: null },
          },
          select: { id: true },
        });
        if (otherVerifiedClaim) {
          return Errors.conflict(reply, 'owner_claim_in_progress', 'This email already has an active verified claim.');
        }
      }
    }

    const verificationCode = generateShortCode();
    const verificationHash = hashOpaqueSecret(verificationCode);
    const expiresAt = emailCodeExpiryDate();
    const delivery = await sendClaimVerificationEmail({
      email: parsed.data.email,
      code: verificationCode,
      claimUrl: `${buildClaimUrl(parsed.data.claim_token)}?email_code=${verificationCode}`,
    });
    if (delivery.mode === 'unavailable') {
      return sendError(reply, 503, 'email_delivery_unavailable', delivery.error ?? 'Email delivery is unavailable.');
    }

    const owner = ownerAccount
      ? await prisma.ownerAccount.update({
          where: { id: ownerAccount.id },
          data: {
            instagramHandle: parsed.data.instagram_handle,
            extraSocials: parsed.data.extra_socials,
          },
        })
      : await prisma.ownerAccount.create({
          data: {
            email: parsed.data.email,
            instagramHandle: parsed.data.instagram_handle,
            extraSocials: parsed.data.extra_socials,
          },
        });

    await prisma.$transaction([
      prisma.agentClaim.update({
        where: { id: claim.id },
        data: {
          ownerAccountId: owner.id,
          reservedHandle: parsed.data.handle,
          emailVerificationCodeHash: verificationHash,
          emailVerificationExpiresAt: expiresAt,
          emailVerifiedAt: null,
          status: 'email_sent',
        },
      }),
      prisma.handleReservation.upsert({
        where: { claimId: claim.id },
        update: {
          handle: parsed.data.handle,
          expiresAt: claim.expiresAt,
        },
        create: {
          claimId: claim.id,
          handle: parsed.data.handle,
          expiresAt: claim.expiresAt,
        },
      }),
    ]);

    return reply.send({
      claim_id: claim.id,
      status: 'email_sent',
      email: owner.email,
      reserved_handle: parsed.data.handle,
      delivery: delivery.mode === 'preview'
        ? {
            mode: 'preview',
            verification_code: delivery.preview?.code ?? verificationCode,
            verification_link: delivery.preview?.link ?? `${buildClaimUrl(parsed.data.claim_token)}?email_code=${verificationCode}`,
          }
        : { mode: 'provider' },
      expires_at: expiresAt.toISOString(),
    });
  });

  fastify.post('/claims/:id/verify-email', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = ClaimVerifyEmailSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid email verification payload.', { issues: parsed.error.issues });
    }

    await expireStaleClaims();

    const claim = await prisma.agentClaim.findUnique({
      where: { id },
      include: { ownerAccount: true },
    });
    if (!claim) return Errors.notFound(reply, 'Claim');
    if (!claim.emailVerificationCodeHash || !claim.emailVerificationExpiresAt || !claim.ownerAccountId || !claim.ownerAccount) {
      return Errors.staleState(reply, 'Email verification has not been started for this claim.');
    }
    if (claim.emailVerificationExpiresAt < new Date()) {
      return reply.status(410).send({ error: { code: 'email_verification_expired', message: 'Email verification code expired.' } });
    }
    if (hashOpaqueSecret(parsed.data.code) !== claim.emailVerificationCodeHash) {
      return sendError(reply, 401, 'invalid_email_verification_code', 'Invalid email verification code.');
    }

    const [existingOwnedAgent, otherVerifiedClaim] = await Promise.all([
      prisma.agent.findFirst({
        where: { ownerAccountId: claim.ownerAccountId },
        select: { id: true },
      }),
      prisma.agentClaim.findFirst({
        where: {
          ownerAccountId: claim.ownerAccountId,
          id: { not: claim.id },
          status: { notIn: ['completed', 'expired', 'canceled'] },
          emailVerifiedAt: { not: null },
        },
        select: { id: true },
      }),
    ]);
    if (existingOwnedAgent) {
      return Errors.conflict(reply, 'owner_limit_reached', 'This email already owns an agent.');
    }
    if (otherVerifiedClaim) {
      return Errors.conflict(reply, 'owner_claim_in_progress', 'This email already has another verified claim in progress.');
    }

    await prisma.$transaction([
      prisma.agentClaim.update({
        where: { id: claim.id },
        data: {
          emailVerificationCodeHash: null,
          emailVerificationExpiresAt: null,
          emailVerifiedAt: new Date(),
          status: 'email_verified',
        },
      }),
      prisma.ownerAccount.update({
        where: { id: claim.ownerAccountId },
        data: {
          emailVerifiedAt: new Date(),
        },
      }),
    ]);

    return reply.send({
      claim_id: claim.id,
      status: 'email_verified',
      next_step: 'x_verification',
    });
  });

  fastify.post('/claims/:id/x/check', async (request, reply) => {
    const { id } = request.params as { id: string };
    await expireStaleClaims();

    const claim = await prisma.agentClaim.findUnique({ where: { id } });
    if (!claim) return Errors.notFound(reply, 'Claim');
    if (!claim.emailVerifiedAt) {
      return Errors.staleState(reply, 'Email must be verified before X verification.');
    }
    if (claim.xVerifiedAt) {
      return reply.send({ claim_id: claim.id, status: 'x_verified' });
    }

    const now = new Date();
    if (!claim.xVerificationCode || !claim.xVerificationExpiresAt || claim.xVerificationExpiresAt < now) {
      const verificationCode = generateShortCode(8);
      const expiresAt = emailCodeExpiryDate();
      await prisma.agentClaim.update({
        where: { id: claim.id },
        data: {
          xVerificationCode: verificationCode,
          xVerificationExpiresAt: expiresAt,
          status: 'x_pending',
        },
      });

      return reply.send({
        claim_id: claim.id,
        status: 'x_pending',
        verification_code: verificationCode,
        verification_query: buildClaimTwitterQuery(claim.twitterHandle, verificationCode),
        expires_at: expiresAt.toISOString(),
      });
    }

    const verification = await checkTwitterForCode(claim.twitterHandle, claim.xVerificationCode);
    if (verification.status === 'unavailable') {
      return reply.status(503).send({
        error: {
          code: 'twitter_verification_unavailable',
          message: verification.reason,
        },
        claim_id: claim.id,
        status: 'x_pending',
        verification_code: claim.xVerificationCode,
        verification_query: buildClaimTwitterQuery(claim.twitterHandle, claim.xVerificationCode),
        expires_at: claim.xVerificationExpiresAt.toISOString(),
      });
    }

    if (verification.status !== 'found') {
      return reply.send({
        claim_id: claim.id,
        status: 'x_pending',
        verification_code: claim.xVerificationCode,
        verification_query: buildClaimTwitterQuery(claim.twitterHandle, claim.xVerificationCode),
        expires_at: claim.xVerificationExpiresAt.toISOString(),
      });
    }

    await prisma.agentClaim.update({
      where: { id: claim.id },
      data: {
        xVerifiedAt: new Date(),
        status: 'x_verified',
      },
    });

    return reply.send({ claim_id: claim.id, status: 'x_verified' });
  });

  fastify.post('/claims/:id/complete', async (request, reply) => {
    const { id } = request.params as { id: string };
    await expireStaleClaims();

    const claim = await prisma.agentClaim.findUnique({
      where: { id },
      include: {
        ownerAccount: true,
        handleReservation: true,
      },
    });
    if (!claim) return Errors.notFound(reply, 'Claim');
    if (!claim.ownerAccount || !claim.ownerAccountId) return Errors.staleState(reply, 'Claim has no verified owner.');
    if (!claim.emailVerifiedAt) return Errors.staleState(reply, 'Email verification is incomplete.');
    if (!claim.xVerifiedAt) return Errors.staleState(reply, 'X verification is incomplete.');
    if (!claim.handleReservation || !claim.reservedHandle) return Errors.staleState(reply, 'Username has not been reserved.');
    if (claim.completedAt) return Errors.conflict(reply, 'claim_completed', 'This claim is already complete.');

    const apiKey = generateApiKey();
    const apiKeyHash = hashApiKey(apiKey);
    const defaultAvatarUrl = pickDefaultAvatarUrl(claim.identityMd);
    const ownerSessionToken = generateOwnerSessionToken();
    const ownerSessionTokenHash = hashOpaqueSecret(ownerSessionToken);
    const ownerSessionExpiresAt = ownerSessionExpiryDate();

    const created = await prisma.$transaction(async (tx) => {
      const existingOwnerAgent = await tx.agent.findFirst({
        where: { ownerAccountId: claim.ownerAccountId! },
        select: { id: true },
      });
      if (existingOwnerAgent) {
        throw new Error('owner_limit_reached');
      }

      const agent = await tx.agent.create({
        data: {
          handle: claim.reservedHandle!,
          openclawAgentId: claim.openclawAgentId,
          twitterHandle: claim.twitterHandle,
          twitterVerified: true,
          apiKeyHash,
          identityMd: claim.identityMd,
          soulMd: claim.soulMd,
          poolStatus: 'active',
          avatarUrl: defaultAvatarUrl,
          avatarStatus: 'default',
          ownerAccountId: claim.ownerAccountId!,
          human: { create: {} },
        },
        select: {
          id: true,
          handle: true,
        },
      });

      await tx.agentClaim.update({
        where: { id: claim.id },
        data: {
          claimedAgentId: agent.id,
          completedAt: new Date(),
          status: 'completed',
        },
      });

      await tx.handleReservation.delete({
        where: { claimId: claim.id },
      });

      await tx.ownerSession.create({
        data: {
          ownerAccountId: claim.ownerAccountId!,
          tokenHash: ownerSessionTokenHash,
          expiresAt: ownerSessionExpiresAt,
        },
      });

      return agent;
    }).catch((err: unknown) => {
      if ((err as Error).message === 'owner_limit_reached') {
        throw err;
      }
      throw err;
    });

    await recomputeAuthenticityScore(created.id).catch(() => null);

    return reply.send({
      claim_id: claim.id,
      agent_id: created.id,
      handle: created.handle,
      api_key: apiKey,
      owner_session_token: ownerSessionToken,
      owner_session_expires_at: ownerSessionExpiresAt.toISOString(),
      status: 'completed',
      pool_status: 'active',
    });
  });
}
