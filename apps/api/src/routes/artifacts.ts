import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { requireAuth } from '../middleware/requireAuth.js';
import { Errors } from '../lib/errors.js';
import { readLimit } from '../lib/rateLimit.js';

export async function artifactsRoutes(fastify: FastifyInstance) {
  fastify.get('/artifacts', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const agentId = request.agent.id;
    const query = request.query as { episode_id?: string; artifact_type?: string; limit?: string | number };
    const parsedLimit = typeof query.limit === 'string' ? Number.parseInt(query.limit, 10) : Number(query.limit);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 120)
      : 60;

    const artifacts = await prisma.artifact.findMany({
      where: {
        episode: {
          isSandbox: false,
          OR: [{ agentAId: agentId }, { agentBId: agentId }],
          ...(query.episode_id ? { id: query.episode_id } : {}),
        },
        ...(query.artifact_type ? { artifactType: query.artifact_type } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        artifactType: true,
        status: true,
        contentUrl: true,
        textContent: true,
        qualityScore: true,
        droppedAtMessage: true,
        createdAt: true,
        creatorAgentId: true,
        creator: {
          select: {
            id: true,
            handle: true,
            avatarUrl: true,
          },
        },
        episode: {
          select: {
            id: true,
            status: true,
            agentAId: true,
            agentBId: true,
            agentA: {
              select: {
                id: true,
                handle: true,
                avatarUrl: true,
              },
            },
            agentB: {
              select: {
                id: true,
                handle: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });

    return reply.send({
      artifacts: artifacts.map((artifact) => {
        const counterpart = artifact.episode.agentAId === agentId ? artifact.episode.agentB : artifact.episode.agentA;

        return {
          artifact_id: artifact.id,
          artifact_type: artifact.artifactType,
          status: artifact.status,
          content_url: artifact.contentUrl,
          text_content: artifact.textContent,
          quality_score: artifact.qualityScore,
          dropped_at_message: artifact.droppedAtMessage,
          created_at: artifact.createdAt.toISOString(),
          is_your_artifact: artifact.creatorAgentId === agentId,
          creator: {
            agent_id: artifact.creator.id,
            handle: artifact.creator.handle,
            avatar_url: artifact.creator.avatarUrl,
          },
          episode: {
            episode_id: artifact.episode.id,
            status: artifact.episode.status,
            counterpart: {
              agent_id: counterpart.id,
              handle: counterpart.handle,
              avatar_url: counterpart.avatarUrl,
            },
          },
        };
      }),
    });
  });
}
