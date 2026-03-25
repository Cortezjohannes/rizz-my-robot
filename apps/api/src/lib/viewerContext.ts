import type { FastifyRequest } from 'fastify';
import { prisma } from '@rmr/db';
import { extractApiKeyFromRequest, extractBearerToken, hashApiKey } from './auth.js';
import { hashOpaqueSecret } from './claimAuth.js';
import { refreshOwnerSessionActivity } from './claims.js';

export type ResolvedViewer =
  | {
      kind: 'agent';
      agentId: string;
      handle: string;
      voterId: string;
      voterType: 'agent';
      orbitAgentId: string;
    }
  | {
      kind: 'owner';
      ownerAccountId: string;
      agentId: string | null;
      voterId: string;
      voterType: 'owner';
      orbitAgentId: string | null;
    };

async function resolveAgentViewerFromApiKey(apiKey: string): Promise<ResolvedViewer | null> {
  const keyHash = hashApiKey(apiKey);
  const agent = await prisma.agent.findFirst({
    where: {
      OR: [
        { apiKeyHash: keyHash },
        {
          previousApiKeyHash: keyHash,
          previousApiKeyExpiresAt: { gt: new Date() },
        },
      ],
    },
    select: {
      id: true,
      handle: true,
      isActive: true,
      poolStatus: true,
      moderationStatus: true,
    },
  });

  if (!agent || !agent.isActive || agent.poolStatus === 'deleted' || agent.moderationStatus === 'suspended') {
    return null;
  }

  return {
    kind: 'agent',
    agentId: agent.id,
    handle: agent.handle,
    voterId: agent.id,
    voterType: 'agent',
    orbitAgentId: agent.id,
  };
}

export async function resolveOptionalViewer(request: FastifyRequest): Promise<ResolvedViewer | null> {
  const bearerToken = extractBearerToken(request.headers.authorization);
  if (bearerToken) {
    const ownerSession = await prisma.ownerSession.findUnique({
      where: { tokenHash: hashOpaqueSecret(bearerToken) },
      include: {
        ownerAccount: {
          include: {
            agent: {
              select: {
                id: true,
              },
            },
          },
        },
      },
    });

    if (ownerSession && ownerSession.expiresAt >= new Date()) {
      await refreshOwnerSessionActivity({
        id: ownerSession.id,
        expiresAt: ownerSession.expiresAt,
        lastUsedAt: ownerSession.lastUsedAt,
      });

      return {
        kind: 'owner',
        ownerAccountId: ownerSession.ownerAccount.id,
        agentId: ownerSession.ownerAccount.agent?.id ?? null,
        voterId: `owner:${ownerSession.ownerAccount.id}`,
        voterType: 'owner',
        orbitAgentId: ownerSession.ownerAccount.agent?.id ?? null,
      };
    }

    const agentViewer = await resolveAgentViewerFromApiKey(bearerToken);
    if (agentViewer) return agentViewer;
  }

  const apiKey = extractApiKeyFromRequest(request);
  if (apiKey && apiKey !== bearerToken) {
    return resolveAgentViewerFromApiKey(apiKey);
  }

  return null;
}
