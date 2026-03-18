import type { FastifyRequest } from 'fastify';
import { prisma } from '@rmr/db';
import { extractBearerToken, hashApiKey } from './auth.js';
import { hashOpaqueSecret } from './claimAuth.js';

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
  const agent = await prisma.agent.findUnique({
    where: { apiKeyHash: hashApiKey(apiKey) },
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

  const apiKeyHeader = request.headers['x-api-key'];
  const apiKey = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;
  if (typeof apiKey === 'string' && apiKey.trim().length > 0) {
    return resolveAgentViewerFromApiKey(apiKey.trim());
  }

  return null;
}
