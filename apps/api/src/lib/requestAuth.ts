import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '@rmr/db';
import { extractApiKeyFromRequest, extractBearerToken, hashApiKey } from './auth.js';
import { hashOpaqueSecret } from './claimAuth.js';
import { isEffectivelyPro } from './entitlements.js';
import { Errors, sendError } from './errors.js';
import { buildAuthDiagnostics } from './writeDiagnostics.js';

export interface AuthenticatedAgent {
  id: string;
  handle: string;
  openclawAgentId: string;
  soulMd: string;
  isPro: boolean;
  isFoundingRizzler: boolean;
  proBonusEndsAt: Date | null;
  tempoOverrideMinutes: number | null;
  actionCooldownUntil: Date | null;
  poolStatus: string;
  capabilityTier: string;
  safetyState: string;
  systemEntityKind: string | null;
  omnimonParkLive: boolean;
}

export interface AuthenticatedOwnerAccount {
  id: string;
  email: string;
  instagramHandle: string | null;
  extraSocials: unknown;
  humanIdentity: string | null;
  lookingFor: string[];
  xHandle: string | null;
  xDisplayName: string | null;
  xProfileImageUrl: string | null;
  ownerReadModelInitializedAt: Date | null;
  agent: {
    id: string;
    handle: string;
    handleChangeCount: number;
    twitterHandle: string;
  } | null;
}

interface AuthenticateRequestOptions {
  tokenOverride?: string | null;
  suppressErrors?: boolean;
}

export async function authenticateOwnerRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  options: AuthenticateRequestOptions = {}
): Promise<AuthenticatedOwnerAccount | null> {
  const token = options.tokenOverride ?? extractBearerToken(request.headers.authorization);
  if (!token) {
    if (options.suppressErrors) return null;
    sendError(reply, 401, 'unauthorized_owner', 'Invalid or missing owner session token.');
    return null;
  }

  const tokenHash = hashOpaqueSecret(token);
  const session = await prisma.ownerSession.findUnique({
    where: { tokenHash },
    include: {
      ownerAccount: {
        include: {
          agent: {
            select: {
              id: true,
              handle: true,
              handleChangeCount: true,
              twitterHandle: true,
            },
          },
        },
      },
    },
  });

  if (!session || session.expiresAt < new Date()) {
    if (options.suppressErrors) return null;
    sendError(reply, 401, 'unauthorized_owner', 'Invalid or missing owner session token.');
    return null;
  }

  await prisma.ownerSession.update({
    where: { id: session.id },
    data: { lastUsedAt: new Date() },
  }).catch(() => null);

  const ownerAccount: AuthenticatedOwnerAccount = {
    id: session.ownerAccount.id,
    email: session.ownerAccount.email,
    instagramHandle: session.ownerAccount.instagramHandle,
    extraSocials: session.ownerAccount.extraSocials,
    humanIdentity: session.ownerAccount.humanIdentity,
    lookingFor: session.ownerAccount.lookingFor,
    xHandle: session.ownerAccount.xHandle,
    xDisplayName: session.ownerAccount.xDisplayName,
    xProfileImageUrl: session.ownerAccount.xProfileImageUrl,
    ownerReadModelInitializedAt: session.ownerAccount.ownerReadModelInitializedAt,
    agent: session.ownerAccount.agent,
  };

  request.ownerAccount = ownerAccount;
  return ownerAccount;
}

export async function authenticateAgentRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  options: AuthenticateRequestOptions = {}
): Promise<AuthenticatedAgent | null> {
  const token = options.tokenOverride ?? extractApiKeyFromRequest(request);
  if (!token) {
    if (options.suppressErrors) return null;
    sendError(
      reply,
        401,
        'missing_api_key',
        'Missing API key. Send it as Authorization: Bearer <api_key>, x-agent-api-key, x-api-key, or x-rmr-api-key.',
        buildAuthDiagnostics(request),
      );
    return null;
  }

  const keyHash = hashApiKey(token);
  const now = new Date();

  const agent = await prisma.agent.findFirst({
    where: {
      OR: [
        { apiKeyHash: keyHash },
        {
          previousApiKeyHash: keyHash,
          previousApiKeyExpiresAt: { gt: now },
        },
      ],
    },
    select: {
      id: true,
      handle: true,
      openclawAgentId: true,
      soulMd: true,
      isPro: true,
      isFoundingRizzler: true,
      proBonusEndsAt: true,
      tempoOverrideMinutes: true,
      actionCooldownUntil: true,
      poolStatus: true,
      capabilityTier: true,
      safetyState: true,
      systemEntityKind: true,
      omnimonParkLive: true,
      isActive: true,
      moderationStatus: true,
    },
  });

  if (!agent || !agent.isActive || agent.poolStatus === 'deleted' || agent.moderationStatus === 'suspended') {
    if (options.suppressErrors) return null;

    const [rotatedAgent, inactiveAgent] = await Promise.all([
      prisma.agent.findFirst({
        where: {
          previousApiKeyHash: keyHash,
          previousApiKeyExpiresAt: { lte: now },
        },
        select: {
          previousApiKeyExpiresAt: true,
        },
      }),
      prisma.agent.findFirst({
        where: {
          apiKeyHash: keyHash,
        },
        select: {
          isActive: true,
          poolStatus: true,
          moderationStatus: true,
        },
      }),
    ]);

    if (rotatedAgent) {
      sendError(
        reply,
        401,
        'api_key_rotated',
        'This API key was rotated and its grace window has ended. Fetch and store the newest key.',
        {
          ...buildAuthDiagnostics(request),
          previous_key_grace_ended_at: rotatedAgent.previousApiKeyExpiresAt?.toISOString() ?? null,
        },
      );
      return null;
    }

    if (inactiveAgent?.moderationStatus === 'suspended') {
      sendError(reply, 401, 'agent_suspended', 'This agent is suspended, so its API key is not allowed to authenticate.', buildAuthDiagnostics(request));
      return null;
    }

    if (inactiveAgent && (!inactiveAgent.isActive || inactiveAgent.poolStatus === 'deleted')) {
      sendError(reply, 401, 'agent_deactivated', 'This agent is inactive or deleted, so its API key is no longer valid.', buildAuthDiagnostics(request));
      return null;
    }

    Errors.unauthorized(reply);
    return null;
  }

  const authenticatedAgent: AuthenticatedAgent = {
    ...agent,
    isPro: isEffectivelyPro(agent),
  };

  request.agent = authenticatedAgent;
  return authenticatedAgent;
}
