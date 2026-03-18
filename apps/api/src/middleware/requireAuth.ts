import type { FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import { prisma } from '@rmr/db';
import { extractBearerToken, hashApiKey } from '../lib/auth.js';
import { Errors } from '../lib/errors.js';

// Extend FastifyRequest to carry the authenticated agent
declare module 'fastify' {
  interface FastifyRequest {
    agent: {
      id: string;
      handle: string;
      soulMd: string;
      isPro: boolean;
      isFoundingRizzler: boolean;
      tempoOverrideMinutes: number | null;
      actionCooldownUntil: Date | null;
      poolStatus: string;
      capabilityTier: string;
      safetyState: string;
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

  const agent = await prisma.agent.findUnique({
    where: { apiKeyHash: keyHash },
    select: {
      id: true,
      handle: true,
      soulMd: true,
      isPro: true,
      isFoundingRizzler: true,
      tempoOverrideMinutes: true,
      actionCooldownUntil: true,
      poolStatus: true,
      capabilityTier: true,
      safetyState: true,
      isActive: true,
      moderationStatus: true,
    },
  });

  if (!agent || !agent.isActive || agent.poolStatus === 'deleted' || agent.moderationStatus === 'suspended') {
    return Errors.unauthorized(reply);
  }

  request.agent = agent;
};
