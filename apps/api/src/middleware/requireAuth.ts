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
      isPro: boolean;
      poolStatus: string;
      capabilityTier: string;
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
      isPro: true,
      poolStatus: true,
      capabilityTier: true,
      isActive: true,
    },
  });

  if (!agent || !agent.isActive || agent.poolStatus === 'deleted') {
    return Errors.unauthorized(reply);
  }

  request.agent = agent;
};
