import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { prisma } from '@rmr/db';
import {
  ClaimEmailSchema,
  ClaimRestartSchema,
  ClaimStartSchema,
  ClaimUpdateHandleSchema,
  ClaimVerifyEmailSchema,
  ClaimXStartSchema,
  UsernameSchema,
} from '@rmr/shared';
import { pickDefaultAvatarUrl } from '@rmr/shared';
import { generateApiKey, hashApiKey } from '../lib/auth.js';
import {
  buildClaimUrl,
  claimExpiryDate,
  claimPreview,
  emailCodeExpiryDate,
  expireStaleClaims,
  hashClaimToken,
  isHandleAvailable,
  ownerSessionExpiryDate,
} from '../lib/claims.js';
import {
  generateClaimToken,
  generateOwnerSessionToken,
  generateShortCode,
  hashOpaqueSecret,
  verifyClaimToken,
  verifyXOAuthState,
} from '../lib/claimAuth.js';
import { Errors, sendError } from '../lib/errors.js';
import {
  buildClaimTweetTemplate,
  buildXAuthorizationUrl,
  generateOAuthNonce,
  generatePkceVerifier,
  hasXOAuthConfig,
  verifyXAccountTweet,
} from '../lib/twitterVerification.js';
import { recomputeAuthenticityScore } from '../lib/authenticity.js';
import {
  getVerificationRequirements,
  isEmailVerificationSatisfied,
  isXVerificationSatisfied,
} from '../lib/controlSettings.js';
import { sendClaimVerificationEmail } from '../lib/email.js';
import { publicEmailLimit, publicReadLimit, publicStartLimit, publicVerifyLimit } from '../lib/rateLimit.js';

function serializeVerificationRequirements(input: Awaited<ReturnType<typeof getVerificationRequirements>>) {
  return {
    verification_requirements: {
      require_email_verification: input.requireEmailVerification,
      require_x_verification: input.requireXVerification,
    },
  };
}

async function rotateClaimToken(claimId: string) {
  const token = generateClaimToken(claimId);
  await prisma.agentClaim.update({
    where: { id: claimId },
    data: { tokenHash: hashClaimToken(token) },
  });
  return token;
}

async function findClaimByToken(token: string) {
  const verifiedClaimId = verifyClaimToken(token);

  if (verifiedClaimId) {
    const byId = await prisma.agentClaim.findUnique({
      where: { id: verifiedClaimId },
      include: {
        ownerAccount: {
          select: {
            email: true,
            xHandle: true,
            xDisplayName: true,
            xProfileImageUrl: true,
          },
        },
      },
    });
    if (byId && byId.tokenHash === hashClaimToken(token)) return byId;
    return null;
  }

  return prisma.agentClaim.findUnique({
    where: { tokenHash: hashClaimToken(token) },
    include: {
      ownerAccount: {
        select: {
          email: true,
          xHandle: true,
          xDisplayName: true,
          xProfileImageUrl: true,
        },
      },
    },
  });
}

export async function claimsRoutes(fastify: FastifyInstance) {
  fastify.get('/handles/:handle/availability', { config: { rateLimit: publicReadLimit } }, async (request, reply) => {
    const params = request.params as { handle: string };
    const parsed = UsernameSchema.safeParse(params.handle);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid handle.', { issues: parsed.error.issues });
    }

    await expireStaleClaims();
    const available = await isHandleAvailable(parsed.data);
    return reply.send({ handle: parsed.data, available });
  });

  fastify.post('/claims/start', { config: { rateLimit: publicStartLimit } }, async (request, reply) => {
    const parsed = ClaimStartSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid claim start data.', { issues: parsed.error.issues });
    }
    const claimStartData = parsed.data as { agent_runtime_id?: string; openclaw_agent_id?: string };
    const technicalAgentId = claimStartData.agent_runtime_id ?? claimStartData.openclaw_agent_id;
    if (!technicalAgentId) {
      return Errors.badRequest(reply, 'A stable technical agent id is required.');
    }

    await expireStaleClaims();
    const verificationRequirements = await getVerificationRequirements();

    const existingAgent = await prisma.agent.findUnique({
      where: { openclawAgentId: technicalAgentId },
      select: { id: true },
    });
    if (existingAgent) {
      return Errors.conflict(reply, 'already_claimed', 'This OpenClaw agent is already claimed.');
    }

    const existingClaim = await prisma.agentClaim.findUnique({
      where: { openclawAgentId: technicalAgentId },
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

    const activeExistingClaim =
      existingClaim &&
      !['completed', 'expired', 'canceled'].includes(existingClaim.status) &&
      existingClaim.expiresAt > new Date()
        ? existingClaim
        : null;

    const shouldRestart = Boolean(parsed.data.restart && activeExistingClaim);

    const available = await isHandleAvailable(parsed.data.handle, {
      excludeClaimId: existingClaim?.id,
    });
    if (!available) {
      return Errors.conflict(reply, 'handle_unavailable', 'That username is not available.');
    }

    if (shouldRestart && activeExistingClaim) {
      const token = generateClaimToken(activeExistingClaim.id);
      const tokenHash = hashClaimToken(token);
      const expiresAt = claimExpiryDate();

      const [claim] = await prisma.$transaction([
        prisma.agentClaim.update({
          where: { id: activeExistingClaim.id },
          data: {
            tokenHash,
            status: 'pending_email',
            ownerAccountId: null,
            twitterHandle: null,
            identityMd: parsed.data.identity_md,
            soulMd: parsed.data.soul_md,
            reservedHandle: parsed.data.handle,
            expiresAt,
            emailVerificationCodeHash: null,
            emailVerificationExpiresAt: null,
            emailVerifiedAt: null,
            xVerificationCode: null,
            xVerificationExpiresAt: null,
            xOauthCodeVerifier: null,
            xOauthNonce: null,
            xVerifiedAt: null,
            completedAt: null,
            canceledAt: null,
          },
          select: {
            id: true,
            status: true,
            openclawAgentId: true,
            twitterHandle: true,
            identityMd: true,
            reservedHandle: true,
            expiresAt: true,
            emailVerifiedAt: true,
            xVerifiedAt: true,
          },
        }),
        prisma.handleReservation.upsert({
          where: { claimId: activeExistingClaim.id },
          update: {
            handle: parsed.data.handle,
            expiresAt,
          },
          create: {
            claimId: activeExistingClaim.id,
            handle: parsed.data.handle,
            expiresAt,
          },
        }),
      ]);

      return reply.status(200).send({
        ...claimPreview(claim, token),
        email_verified: false,
        x_verified: false,
        ...serializeVerificationRequirements(verificationRequirements),
        restarted: true,
      });
    }

    if (activeExistingClaim) {
      const activeToken = await rotateClaimToken(activeExistingClaim.id);
      return reply.status(200).send({
        ...claimPreview(activeExistingClaim, activeToken),
        email_verified: !!activeExistingClaim.emailVerifiedAt,
        x_verified: !!activeExistingClaim.xVerifiedAt,
        ...serializeVerificationRequirements(verificationRequirements),
      });
    }

    const claimId = existingClaim?.id ?? randomUUID();
    const token = generateClaimToken(claimId);
    const tokenHash = hashClaimToken(token);
    const expiresAt = claimExpiryDate();

    const [claim] = await prisma.$transaction([
      prisma.agentClaim.upsert({
        where: { openclawAgentId: technicalAgentId },
        update: {
          tokenHash,
          status: 'pending_email',
          ownerAccountId: null,
          twitterHandle: null,
          identityMd: parsed.data.identity_md,
          soulMd: parsed.data.soul_md,
          reservedHandle: parsed.data.handle,
          expiresAt,
          emailVerificationCodeHash: null,
          emailVerificationExpiresAt: null,
          emailVerifiedAt: null,
          xVerificationCode: null,
          xVerificationExpiresAt: null,
          xOauthCodeVerifier: null,
          xOauthNonce: null,
          xVerifiedAt: null,
          completedAt: null,
          canceledAt: null,
        },
        create: {
          id: claimId,
          tokenHash,
          status: 'pending_email',
          openclawAgentId: technicalAgentId,
          twitterHandle: null,
          identityMd: parsed.data.identity_md,
          soulMd: parsed.data.soul_md,
          reservedHandle: parsed.data.handle,
          expiresAt,
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
      }),
      prisma.handleReservation.upsert({
        where: { claimId },
        update: {
          handle: parsed.data.handle,
          expiresAt,
        },
        create: {
          claimId,
          handle: parsed.data.handle,
          expiresAt,
        },
      }),
    ]);

    return reply.status(201).send({
      ...claimPreview(claim, token),
      email_verified: false,
      x_verified: false,
      ...serializeVerificationRequirements(verificationRequirements),
    });
  });

  fastify.get('/claims/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    await expireStaleClaims();
    const verificationRequirements = await getVerificationRequirements();
    const claim = await findClaimByToken(token);
    if (!claim) return Errors.notFound(reply, 'Claim');

    return reply.send({
      ...claimPreview(claim, token),
      email_verified: !!claim.emailVerifiedAt,
      x_verified: !!claim.xVerifiedAt,
      owner_email: claim.ownerAccount?.email ?? null,
      verified_x_account: claim.ownerAccount?.xHandle
        ? {
            handle: claim.ownerAccount.xHandle,
            display_name: claim.ownerAccount.xDisplayName,
            profile_image_url: claim.ownerAccount.xProfileImageUrl,
          }
        : null,
      ...serializeVerificationRequirements(verificationRequirements),
    });
  });

  fastify.patch('/claims/:id/handle', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = ClaimUpdateHandleSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid claim handle update.', { issues: parsed.error.issues });
    }

    await expireStaleClaims();

    const claim = await prisma.agentClaim.findUnique({
      where: { id },
      include: { ownerAccount: true, handleReservation: true },
    });
    if (!claim) return Errors.notFound(reply, 'Claim');
    if (claim.status === 'completed') {
      return Errors.conflict(reply, 'claim_completed', 'This claim is already complete.');
    }
    if (claim.expiresAt < new Date()) {
      return reply.status(410).send({ error: { code: 'claim_expired', message: 'This claim has expired.' } });
    }
    if (hashClaimToken(parsed.data.claim_token) !== claim.tokenHash) {
      return sendError(reply, 401, 'invalid_claim_token', 'Invalid claim token.');
    }
    const available = await isHandleAvailable(parsed.data.handle, { excludeClaimId: claim.id });
    if (!available) {
      return Errors.conflict(reply, 'handle_unavailable', 'That username is not available.');
    }

    const nextStatus = claim.emailVerifiedAt ? 'email_verified' : claim.ownerAccountId ? 'email_sent' : 'pending_email';
    const expiresAt = claimExpiryDate();

    const [updatedClaim] = await prisma.$transaction([
      prisma.agentClaim.update({
        where: { id: claim.id },
        data: {
          reservedHandle: parsed.data.handle,
          status: nextStatus,
          expiresAt,
          xVerificationCode: null,
          xVerificationExpiresAt: null,
          xOauthCodeVerifier: null,
          xOauthNonce: null,
          xVerifiedAt: null,
        },
        select: {
          id: true,
          status: true,
          openclawAgentId: true,
          twitterHandle: true,
          identityMd: true,
          reservedHandle: true,
          expiresAt: true,
          emailVerifiedAt: true,
          xVerifiedAt: true,
        },
      }),
      prisma.handleReservation.upsert({
        where: { claimId: claim.id },
        update: {
          handle: parsed.data.handle,
          expiresAt,
        },
        create: {
          claimId: claim.id,
          handle: parsed.data.handle,
          expiresAt,
        },
      }),
      ...(claim.ownerAccountId
        ? [
            prisma.ownerAccount.update({
              where: { id: claim.ownerAccountId },
              data: {
                xHandle: null,
                xDisplayName: null,
                xProfileImageUrl: null,
                xUserId: null,
                xVerifiedAt: null,
              },
            }),
          ]
        : []),
    ]);

    return reply.send({
      ...claimPreview(updatedClaim, parsed.data.claim_token),
      email_verified: !!updatedClaim.emailVerifiedAt,
      x_verified: !!updatedClaim.xVerifiedAt,
      reset_to_step: updatedClaim.emailVerifiedAt ? 'x_verification' : updatedClaim.status === 'email_sent' ? 'email_verification' : 'email',
    });
  });

  fastify.post('/claims/:id/restart', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = ClaimRestartSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid claim restart payload.', { issues: parsed.error.issues });
    }

    await expireStaleClaims();
    const verificationRequirements = await getVerificationRequirements();

    const claim = await prisma.agentClaim.findUnique({
      where: { id },
      include: { ownerAccount: true },
    });
    if (!claim) return Errors.notFound(reply, 'Claim');
    if (claim.status === 'completed') {
      return Errors.conflict(reply, 'claim_completed', 'This claim is already complete.');
    }
    if (claim.expiresAt < new Date()) {
      return reply.status(410).send({ error: { code: 'claim_expired', message: 'This claim has expired.' } });
    }
    if (hashClaimToken(parsed.data.claim_token) !== claim.tokenHash) {
      return sendError(reply, 401, 'invalid_claim_token', 'Invalid claim token.');
    }

    const expiresAt = claimExpiryDate();
    const nextToken = generateClaimToken(claim.id);

    const [updatedClaim] = await prisma.$transaction([
      prisma.agentClaim.update({
        where: { id: claim.id },
        data: {
          tokenHash: hashClaimToken(nextToken),
          status: 'pending_email',
          ownerAccountId: null,
          twitterHandle: null,
          expiresAt,
          emailVerificationCodeHash: null,
          emailVerificationExpiresAt: null,
          emailVerifiedAt: null,
          xVerificationCode: null,
          xVerificationExpiresAt: null,
          xOauthCodeVerifier: null,
          xOauthNonce: null,
          xVerifiedAt: null,
        },
        select: {
          id: true,
          status: true,
          openclawAgentId: true,
          twitterHandle: true,
          identityMd: true,
          reservedHandle: true,
          expiresAt: true,
          emailVerifiedAt: true,
          xVerifiedAt: true,
        },
      }),
      ...(claim.ownerAccountId
        ? [
            prisma.ownerAccount.update({
              where: { id: claim.ownerAccountId },
              data: {
                xHandle: null,
                xDisplayName: null,
                xProfileImageUrl: null,
                xUserId: null,
                xVerifiedAt: null,
              },
            }),
          ]
        : []),
    ]);

    return reply.send({
      ...claimPreview(updatedClaim, nextToken),
      email_verified: false,
      x_verified: false,
      ...serializeVerificationRequirements(verificationRequirements),
      restarted: true,
    });
  });

  fastify.post('/claims/:id/email', { config: { rateLimit: publicEmailLimit } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = ClaimEmailSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid claim email submission.', { issues: parsed.error.issues });
    }

    await expireStaleClaims();
    const verificationRequirements = await getVerificationRequirements();

    const claim = await prisma.agentClaim.findUnique({
      where: { id },
      include: { ownerAccount: true, handleReservation: true },
    });
    if (!claim) return Errors.notFound(reply, 'Claim');
    if (claim.status === 'completed') return Errors.conflict(reply, 'claim_completed', 'This claim is already complete.');
    if (claim.expiresAt < new Date()) {
      return reply.status(410).send({ error: { code: 'claim_expired', message: 'This claim has expired.' } });
    }
    if (hashClaimToken(parsed.data.claim_token) !== claim.tokenHash) {
      return sendError(reply, 401, 'invalid_claim_token', 'Invalid claim token.');
    }
    if (!claim.handleReservation || !claim.reservedHandle) {
      return Errors.staleState(reply, 'This claim does not have a reserved username.');
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
    const emailVerificationBypassed = !verificationRequirements.requireEmailVerification;
    const delivery = emailVerificationBypassed
      ? { mode: 'provider' as const }
      : await sendClaimVerificationEmail({
          email: parsed.data.email,
          code: verificationCode,
          claimUrl: `${buildClaimUrl(parsed.data.claim_token)}?email_code=${verificationCode}`,
        });
    if (!emailVerificationBypassed && delivery.mode === 'unavailable') {
      return sendError(reply, 503, 'email_delivery_unavailable', delivery.error ?? 'Email delivery is unavailable.');
    }

    const owner = await prisma.$transaction(async (tx) => {
      const ownerRecordId = ownerAccount?.id ?? existingEmailOwner?.id;
      const o = ownerRecordId
        ? await tx.ownerAccount.update({
            where: { id: ownerRecordId },
            data: {
              email: parsed.data.email,
              humanIdentity: parsed.data.human_identity ?? null,
              lookingFor: parsed.data.looking_for ?? [],
              xHandle: null,
              xDisplayName: null,
              xProfileImageUrl: null,
              xUserId: null,
              xVerifiedAt: null,
            },
          })
        : await tx.ownerAccount.create({
            data: {
              email: parsed.data.email,
              humanIdentity: parsed.data.human_identity ?? null,
              lookingFor: parsed.data.looking_for ?? [],
            },
          });

      await tx.agentClaim.update({
        where: { id: claim.id },
        data: {
          ownerAccountId: o.id,
          twitterHandle: parsed.data.x_handle,
          emailVerificationCodeHash: emailVerificationBypassed ? null : verificationHash,
          emailVerificationExpiresAt: emailVerificationBypassed ? null : expiresAt,
          emailVerifiedAt: emailVerificationBypassed ? new Date() : null,
          xVerificationCode: null,
          xVerificationExpiresAt: null,
          xOauthCodeVerifier: null,
          xOauthNonce: null,
          xVerifiedAt: null,
          status: emailVerificationBypassed ? 'email_verified' : 'email_sent',
        },
      });

      if (emailVerificationBypassed) {
        await tx.ownerAccount.update({
          where: { id: o.id },
          data: {
            emailVerifiedAt: new Date(),
          },
        });
      }

      return o;
    });

    return reply.send({
      claim_id: claim.id,
      status: emailVerificationBypassed ? 'email_verified' : 'email_sent',
      email: owner.email,
      reserved_handle: claim.reservedHandle,
      x_handle: parsed.data.x_handle,
      delivery: !emailVerificationBypassed && delivery.mode === 'preview'
        ? {
            mode: 'preview',
            verification_code: delivery.preview?.code ?? verificationCode,
            verification_link: delivery.preview?.link ?? `${buildClaimUrl(parsed.data.claim_token)}?email_code=${verificationCode}`,
          }
        : { mode: 'provider' },
      expires_at: (emailVerificationBypassed ? claim.expiresAt : expiresAt).toISOString(),
    });
  });

  fastify.post('/claims/:id/verify-email', { config: { rateLimit: publicVerifyLimit } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = ClaimVerifyEmailSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid email verification payload.', { issues: parsed.error.issues });
    }

    await expireStaleClaims();
    const verificationRequirements = await getVerificationRequirements();

    const claim = await prisma.agentClaim.findUnique({
      where: { id },
      include: { ownerAccount: true },
    });
    if (!claim) return Errors.notFound(reply, 'Claim');
    if (!verificationRequirements.requireEmailVerification) {
      return reply.send({ claim_id: claim.id, status: 'email_verified', next_step: 'x_verification' });
    }
    if (claim.emailVerifiedAt) {
      return reply.send({ claim_id: claim.id, status: 'email_verified', next_step: 'x_verification' });
    }
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

  fastify.post('/claims/:id/x/start', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = ClaimXStartSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid X verification start payload.', { issues: parsed.error.issues });
    }

    await expireStaleClaims();
    const verificationRequirements = await getVerificationRequirements();

    if (!verificationRequirements.requireXVerification) {
      return reply.send({ claim_id: id, status: 'x_verified' });
    }

    if (!hasXOAuthConfig()) {
      return sendError(reply, 503, 'x_oauth_unavailable', 'X OAuth is not configured.');
    }

    const claim = await prisma.agentClaim.findUnique({ where: { id } });
    if (!claim) return Errors.notFound(reply, 'Claim');
    if (hashClaimToken(parsed.data.claim_token) !== claim.tokenHash) {
      return sendError(reply, 401, 'invalid_claim_token', 'Invalid claim token.');
    }
    if (!isEmailVerificationSatisfied(Boolean(claim.emailVerifiedAt), verificationRequirements)) {
      return Errors.staleState(reply, 'Email must be verified before X verification.');
    }
    if (!claim.twitterHandle) {
      return Errors.staleState(reply, 'The human X handle has not been provided yet.');
    }
    if (!claim.reservedHandle) {
      return Errors.staleState(reply, 'This claim does not have a reserved username.');
    }
    if (claim.xVerifiedAt) {
      return reply.send({ claim_id: claim.id, status: 'x_verified' });
    }

    const now = new Date();
    const hasActiveXSession = Boolean(
      claim.xVerificationCode &&
      claim.xVerificationExpiresAt &&
      claim.xVerificationExpiresAt >= now &&
      claim.xOauthCodeVerifier &&
      claim.xOauthNonce,
    );

    const verificationCode = hasActiveXSession
      ? claim.xVerificationCode!
      : generateShortCode(8);
    const expiresAt = hasActiveXSession
      ? claim.xVerificationExpiresAt!
      : emailCodeExpiryDate();
    const codeVerifier = hasActiveXSession
      ? claim.xOauthCodeVerifier!
      : generatePkceVerifier();
    const nonce = hasActiveXSession
      ? claim.xOauthNonce!
      : generateOAuthNonce();

    await prisma.agentClaim.update({
      where: { id: claim.id },
      data: {
        xVerificationCode: verificationCode,
        xVerificationExpiresAt: expiresAt,
        xOauthCodeVerifier: codeVerifier,
        xOauthNonce: nonce,
        status: 'x_pending',
      },
    });

    return reply.send(
      buildXVerificationPayload({
        claimId: claim.id,
        reservedHandle: claim.reservedHandle,
        xHandle: claim.twitterHandle,
        verificationCode,
        expiresAt,
        codeVerifier,
        nonce,
      }),
    );
  });

  fastify.post('/claims/:id/x/check', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = ClaimXStartSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid X verification status payload.', { issues: parsed.error.issues });
    }

    await expireStaleClaims();
    const verificationRequirements = await getVerificationRequirements();

    const claim = await prisma.agentClaim.findUnique({
      where: { id },
      include: {
        ownerAccount: {
          select: {
            xHandle: true,
            xDisplayName: true,
            xProfileImageUrl: true,
          },
        },
      },
    });
    if (!claim) return Errors.notFound(reply, 'Claim');
    if (hashClaimToken(parsed.data.claim_token) !== claim.tokenHash) {
      return sendError(reply, 401, 'invalid_claim_token', 'Invalid claim token.');
    }
    if (!verificationRequirements.requireXVerification) {
      return reply.send({ claim_id: claim.id, status: 'x_verified', verified_x_account: null });
    }

    if (claim.xVerifiedAt) {
      return reply.send({
        claim_id: claim.id,
        status: 'x_verified',
        verified_x_account: claim.ownerAccount?.xHandle
          ? {
              handle: claim.ownerAccount.xHandle,
              display_name: claim.ownerAccount.xDisplayName,
              profile_image_url: claim.ownerAccount.xProfileImageUrl,
            }
          : null,
      });
    }

    if (
      !claim.twitterHandle ||
      !claim.reservedHandle ||
      !claim.xVerificationCode ||
      !claim.xVerificationExpiresAt ||
      !claim.xOauthCodeVerifier ||
      !claim.xOauthNonce
    ) {
      return Errors.staleState(reply, 'X verification has not been started for this claim yet.');
    }

    return reply.send(
      buildXVerificationPayload({
        claimId: claim.id,
        reservedHandle: claim.reservedHandle,
        xHandle: claim.twitterHandle,
        verificationCode: claim.xVerificationCode,
        expiresAt: claim.xVerificationExpiresAt,
        codeVerifier: claim.xOauthCodeVerifier,
        nonce: claim.xOauthNonce,
      }),
    );
  });

  fastify.get('/claims/x/callback', async (request, reply) => {
    const query = request.query as {
      state?: string;
      code?: string;
      error?: string;
      error_description?: string;
    };

    if (!query.state) {
      return reply.status(400).type('text/plain').send('Missing X OAuth state.');
    }

    const state = verifyXOAuthState(query.state);
    if (!state) {
      return reply.status(400).type('text/plain').send('Invalid X OAuth state.');
    }

    const claim = await prisma.agentClaim.findUnique({
      where: { id: state.claimId },
      include: {
        ownerAccount: true,
      },
    });
    if (!claim) {
      return reply.redirect(buildClaimUrl(generateClaimToken(state.claimId)));
    }

    if (!claim.xOauthNonce || claim.xOauthNonce !== state.nonce) {
      const token = await rotateClaimToken(claim.id);
      const url = new URL(buildClaimUrl(token));
      url.searchParams.set('x_status', 'error');
      url.searchParams.set('x_error', 'This X verification session is no longer valid. Start again.');
      return reply.redirect(url.toString());
    }

    if (query.error) {
      await prisma.agentClaim.update({
        where: { id: claim.id },
        data: {
          xOauthCodeVerifier: null,
          xOauthNonce: null,
          xVerificationCode: null,
          xVerificationExpiresAt: null,
        },
      }).catch(() => null);

      const token = await rotateClaimToken(claim.id);
      const url = new URL(buildClaimUrl(token));
      url.searchParams.set('x_status', 'error');
      url.searchParams.set('x_error', (query.error_description ?? `X login failed: ${query.error}`).slice(0, 200));
      return reply.redirect(url.toString());
    }

    if (!query.code || !claim.twitterHandle || !claim.xVerificationCode || !claim.xOauthCodeVerifier || !claim.ownerAccountId) {
      const token = await rotateClaimToken(claim.id);
      const url = new URL(buildClaimUrl(token));
      url.searchParams.set('x_status', 'error');
      url.searchParams.set('x_error', 'X verification could not continue.');
      return reply.redirect(url.toString());
    }

    const verification = await verifyXAccountTweet({
      claimedHandle: claim.twitterHandle,
      code: claim.xVerificationCode,
      oauthCode: query.code,
      codeVerifier: claim.xOauthCodeVerifier,
    });

    if (verification.status !== 'verified') {
      await prisma.agentClaim.update({
        where: { id: claim.id },
        data: {
          xOauthCodeVerifier: null,
          xOauthNonce: null,
          xVerificationCode: null,
          xVerificationExpiresAt: null,
        },
      }).catch(() => null);

      const token = await rotateClaimToken(claim.id);
      const url = new URL(buildClaimUrl(token));
      url.searchParams.set('x_status', 'error');
      url.searchParams.set('x_error', verification.reason.slice(0, 200));
      return reply.redirect(url.toString());
    }

    const conflictingOwner = await prisma.ownerAccount.findFirst({
      where: {
        id: { not: claim.ownerAccountId },
        xUserId: verification.account.user_id,
      },
      select: {
        id: true,
        agent: { select: { id: true } },
      },
    });
    if (conflictingOwner?.agent) {
      const token = await rotateClaimToken(claim.id);
      const url = new URL(buildClaimUrl(token));
      url.searchParams.set('x_status', 'error');
      url.searchParams.set('x_error', 'That X account is already linked to another agent owner.');
      return reply.redirect(url.toString());
    }

    await prisma.$transaction([
      prisma.ownerAccount.update({
        where: { id: claim.ownerAccountId },
        data: {
          xUserId: verification.account.user_id,
          xHandle: verification.account.handle,
          xDisplayName: verification.account.display_name,
          xProfileImageUrl: verification.account.profile_image_url,
          xVerifiedAt: new Date(),
        },
      }),
      prisma.agentClaim.update({
        where: { id: claim.id },
        data: {
          xVerifiedAt: new Date(),
          xOauthCodeVerifier: null,
          xOauthNonce: null,
          status: 'x_verified',
        },
      }),
    ]);

    const token = await rotateClaimToken(claim.id);
    const url = new URL(buildClaimUrl(token));
    url.searchParams.set('x_status', 'verified');
    return reply.redirect(url.toString());
  });

  fastify.post('/claims/:id/complete', async (request, reply) => {
    const { id } = request.params as { id: string };
    await expireStaleClaims();
    const verificationRequirements = await getVerificationRequirements();

    const claim = await prisma.agentClaim.findUnique({
      where: { id },
      include: {
        ownerAccount: true,
        handleReservation: true,
      },
    });
    if (!claim) return Errors.notFound(reply, 'Claim');
    if (!claim.ownerAccount || !claim.ownerAccountId) return Errors.staleState(reply, 'Claim has no verified owner.');
    if (!isEmailVerificationSatisfied(Boolean(claim.emailVerifiedAt), verificationRequirements)) return Errors.staleState(reply, 'Email verification is incomplete.');
    if (!isXVerificationSatisfied(Boolean(claim.xVerifiedAt), verificationRequirements)) return Errors.staleState(reply, 'X verification is incomplete.');
    if (!claim.handleReservation || !claim.reservedHandle) return Errors.staleState(reply, 'Username has not been reserved.');
    if (!claim.twitterHandle) return Errors.staleState(reply, 'The human X handle is missing.');
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
          twitterHandle: claim.twitterHandle!,
          twitterVerified: Boolean(claim.xVerifiedAt),
          apiKeyHash,
          identityMd: claim.identityMd,
          soulMd: claim.soulMd,
          poolStatus: 'pending_profile',
          avatarUrl: defaultAvatarUrl,
          avatarStatus: 'default',
          ownerAccountId: claim.ownerAccountId,
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
        return null;
      }
      throw err;
    });

    if (!created) {
      return Errors.conflict(reply, 'owner_limit_reached', 'This email already owns an agent.');
    }

    await recomputeAuthenticityScore(created.id).catch(() => null);

    return reply.send({
      claim_id: claim.id,
      agent_id: created.id,
      handle: created.handle,
      api_key: apiKey,
      owner_session_token: ownerSessionToken,
      owner_session_expires_at: ownerSessionExpiresAt.toISOString(),
      status: 'completed',
      pool_status: 'pending_profile',
    });
  });
}

function buildXVerificationPayload(input: {
  claimId: string;
  reservedHandle: string;
  xHandle: string;
  verificationCode: string;
  expiresAt: Date;
  codeVerifier: string;
  nonce: string;
}) {
  return {
    claim_id: input.claimId,
    status: 'x_pending' as const,
    x_handle: input.xHandle,
    verification_code: input.verificationCode,
    tweet_template: buildClaimTweetTemplate(input.reservedHandle, input.verificationCode),
    authorization_url: buildXAuthorizationUrl({
      claimId: input.claimId,
      nonce: input.nonce,
      codeVerifier: input.codeVerifier,
    }),
    expires_at: input.expiresAt.toISOString(),
  };
}
