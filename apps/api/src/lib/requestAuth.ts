import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '@rmr/db';
import { extractApiKeyFromRequest, extractBearerToken, hashApiKey } from './auth.js';
import { hashOpaqueSecret } from './claimAuth.js';
import { ownerSessionExpiryDate, refreshOwnerSessionActivity, shouldRefreshOwnerSession } from './claims.js';
import { isEffectivelyPro } from './entitlements.js';
import { Errors, sendError } from './errors.js';
import { deliverWebhooks } from './notification.js';
import { schedulePresenceLifecycle } from './socialSignals.js';
import { buildAuthDiagnostics } from './writeDiagnostics.js';
import {
  AGENT_API_KEY_COOKIE,
  OWNER_SESSION_COOKIE,
  readCookie,
  setOwnerSessionCookies,
} from './webAuthCookies.js';

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
  hourlySwipeCount: number | null;
  hourlySwipeWindowStartedAt: Date | null;
  previousApiKeyExpiresAt?: Date | null;
  usingDeprecatedKey?: boolean;
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
  const token = options.tokenOverride
    ?? extractBearerToken(request.headers.authorization)
    ?? readCookie(request, OWNER_SESSION_COOKIE);
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

  const shouldRefresh = shouldRefreshOwnerSession({
    expiresAt: session.expiresAt,
    lastUsedAt: session.lastUsedAt,
  });

  await refreshOwnerSessionActivity({
    id: session.id,
    expiresAt: session.expiresAt,
    lastUsedAt: session.lastUsedAt,
  });
  if (shouldRefresh) {
    setOwnerSessionCookies(reply, token, ownerSessionExpiryDate());
  }

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
  const token = options.tokenOverride
    ?? extractApiKeyFromRequest(request)
    ?? readCookie(request, AGENT_API_KEY_COOKIE);
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
      hourlySwipeCount: true,
      hourlySwipeWindowStartedAt: true,
      apiKeyHash: true,
      previousApiKeyHash: true,
      previousApiKeyExpiresAt: true,
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
    id: agent.id,
    handle: agent.handle,
    openclawAgentId: agent.openclawAgentId,
    soulMd: agent.soulMd,
    isPro: isEffectivelyPro(agent),
    isFoundingRizzler: agent.isFoundingRizzler,
    proBonusEndsAt: agent.proBonusEndsAt,
    tempoOverrideMinutes: agent.tempoOverrideMinutes,
    actionCooldownUntil: agent.actionCooldownUntil,
    poolStatus: agent.poolStatus,
    capabilityTier: agent.capabilityTier,
    safetyState: agent.safetyState,
    systemEntityKind: agent.systemEntityKind,
    omnimonParkLive: agent.omnimonParkLive,
    hourlySwipeCount: agent.hourlySwipeCount,
    hourlySwipeWindowStartedAt: agent.hourlySwipeWindowStartedAt,
    previousApiKeyExpiresAt: agent.previousApiKeyExpiresAt,
    usingDeprecatedKey: agent.previousApiKeyHash === keyHash && Boolean(agent.previousApiKeyExpiresAt && agent.previousApiKeyExpiresAt > now),
  };

  if (authenticatedAgent.usingDeprecatedKey && agent.previousApiKeyExpiresAt) {
    reply.header('X-Key-Deprecated', `This key expires at ${agent.previousApiKeyExpiresAt.toISOString()}. Use the newest API key.`);
  }

  const sixHoursFromNow = new Date(now.getTime() + 6 * 60 * 60 * 1000);
  if (agent.previousApiKeyExpiresAt && agent.previousApiKeyExpiresAt > now && agent.previousApiKeyExpiresAt <= sixHoursFromNow) {
    void prisma.agentAutonomyTrace.findFirst({
      where: {
        agentId: agent.id,
        traceType: 'key_rotation_upcoming',
        createdAt: { gte: new Date(agent.previousApiKeyExpiresAt.getTime() - 6 * 60 * 60 * 1000) },
      },
      select: { id: true },
    }).then((existing) => {
      if (existing) return null;
      return Promise.all([
        prisma.agentAutonomyTrace.create({
          data: {
            agentId: agent.id,
            traceType: 'key_rotation_upcoming',
            status: 'warn',
            summary: `Your previous API key expires at ${agent.previousApiKeyExpiresAt?.toISOString()}.`,
            metadata: {
              expires_at: agent.previousApiKeyExpiresAt?.toISOString() ?? null,
            },
          },
        }).catch(() => null),
        deliverWebhooks(agent.id, 'key_rotation_upcoming', {
          expires_at: agent.previousApiKeyExpiresAt?.toISOString() ?? null,
        }).catch(() => null),
      ]);
    }).catch(() => null);
  }

  if (process.env.RMR_DISABLE_AUTH_PRESENCE_SIDE_EFFECTS !== 'true') {
    void prisma.agent.update({
      where: { id: agent.id },
      data: {
        lastActiveAt: now,
        lastApiCallAt: now,
        presenceStatus: 'online',
      },
    }).catch(() => null);
    void schedulePresenceLifecycle(agent.id, now);
  }

  request.agent = authenticatedAgent;
  return authenticatedAgent;
}
