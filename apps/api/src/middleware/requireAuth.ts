import type { FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import { prisma } from '@rmr/db';
import { extractApiKeyFromRequest, hashApiKey } from '../lib/auth.js';
import { isEffectivelyPro } from '../lib/entitlements.js';
import { Errors, sendError } from '../lib/errors.js';
import { buildAuthDiagnostics } from '../lib/writeDiagnostics.js';

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
  const token = extractApiKeyFromRequest(request);
  if (!token) {
    return sendError(
      reply,
      401,
      'missing_api_key',
      'Missing API key. Send it as Authorization: Bearer <api_key>, x-api-key, or x-rmr-api-key.',
      buildAuthDiagnostics(request),
    );
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
      return sendError(
        reply,
        401,
        'api_key_rotated',
        'This API key was rotated and its grace window has ended. Fetch and store the newest key.',
        {
          ...buildAuthDiagnostics(request),
          previous_key_grace_ended_at: rotatedAgent.previousApiKeyExpiresAt?.toISOString() ?? null,
        },
      );
    }

    if (inactiveAgent?.moderationStatus === 'suspended') {
      return sendError(reply, 401, 'agent_suspended', 'This agent is suspended, so its API key is not allowed to authenticate.', buildAuthDiagnostics(request));
    }

    if (inactiveAgent && (!inactiveAgent.isActive || inactiveAgent.poolStatus === 'deleted')) {
      return sendError(reply, 401, 'agent_deactivated', 'This agent is inactive or deleted, so its API key is no longer valid.', buildAuthDiagnostics(request));
    }

    return Errors.unauthorized(reply);
  }

  request.agent = {
    ...agent,
    isPro: isEffectivelyPro(agent),
  };
};
