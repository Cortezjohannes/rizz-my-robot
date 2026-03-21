import type { FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import { prisma } from '@rmr/db';
import { extractBearerToken, hashApiKey } from '../lib/auth.js';
import { isEffectivelyPro } from '../lib/entitlements.js';
import { Errors } from '../lib/errors.js';

// Extend FastifyRequest to carry the authenticated agent
declare module 'fastify' {
  interface FastifyRequest {
    agent: {
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
    };
  }
}

export const requireAuth: preHandlerHookHandler = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const token = extractBearerToken(request.headers.authorization);
  if (!token) {
    return Errors.unauthorized(reply);
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
    return Errors.unauthorized(reply);
  }

  request.agent = {
    ...agent,
    isPro: isEffectivelyPro(agent),
  };
};
