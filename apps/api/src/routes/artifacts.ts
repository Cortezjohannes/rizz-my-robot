import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { getDiscoveryViewerContext, type DiscoveryViewerContext } from '../lib/discovery.js';
import { Errors, sendError } from '../lib/errors.js';
import { readLimit, writeLimit } from '../lib/rateLimit.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { resolveOptionalViewer, type ResolvedViewer } from '../lib/viewerContext.js';

const TRENDING_ARTIFACT_WINDOW_DAYS = 7;

function parseOffsetCursor(input: string | undefined, fallback = 0) {
  const parsed = Number.parseInt(input ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeTag(value: string) {
  return value.trim().toLowerCase();
}

function extractSignalTags(signal: unknown): string[] {
  if (!signal || typeof signal !== 'object') return [];
  const raw = signal as { interest_tags?: unknown; value_tags?: unknown };
  const interests = Array.isArray(raw.interest_tags) ? raw.interest_tags : [];
  const values = Array.isArray(raw.value_tags) ? raw.value_tags : [];
  return [...interests, ...values].filter((value): value is string => typeof value === 'string');
}

function orbitBoostForArtifact(input: {
  creatorAgentId: string;
  participantIds: string[];
  tags: string[];
}, discovery: DiscoveryViewerContext | null) {
  if (!discovery) return 0;
  let boost = discovery.relatedAgentIds.has(input.creatorAgentId) ? 4 : 0;
  boost += input.participantIds.filter((agentId) => discovery.relatedAgentIds.has(agentId)).length * 2;
  const sharedTaste = input.tags.filter((tag) => discovery.tasteTags.has(normalizeTag(tag))).length;
  boost += Math.min(4, sharedTaste);
  return boost;
}

async function buildPublicArtifactPage(input: {
  offset: number;
  limit: number;
  sort: 'trending' | 'fresh_24h';
  viewer: ResolvedViewer | null;
  discovery: DiscoveryViewerContext | null;
}) {
  const viewerVoterId = input.viewer?.voterId ?? null;
  const viewerVoterType = input.viewer?.voterType ?? null;
  const fetchCount = Math.min(200, Math.max(input.offset + input.limit + 18, input.limit * 5));
  const sinceDate = input.sort === 'fresh_24h'
    ? new Date(Date.now() - (24 * 60 * 60 * 1000))
    : new Date(Date.now() - (TRENDING_ARTIFACT_WINDOW_DAYS * 24 * 60 * 60 * 1000));

  const artifacts = await prisma.artifact.findMany({
    where: {
      status: 'ready',
      moderationStatus: { not: 'suppressed' as const },
      createdAt: { gte: sinceDate },
      episode: {
        isSandbox: false,
        match: {
          isNot: null,
        },
        agentA: {
          moderationStatus: { not: 'suspended' as const },
          safetyState: { not: 'blocked' as const },
          poolStatus: 'active',
        },
        agentB: {
          moderationStatus: { not: 'suspended' as const },
          safetyState: { not: 'blocked' as const },
          poolStatus: 'active',
        },
      },
      creator: {
        moderationStatus: { not: 'suspended' as const },
        safetyState: { not: 'blocked' as const },
        controlArtifactsSuppressed: false,
      },
    },
    orderBy: { createdAt: 'desc' },
    take: fetchCount,
    select: {
      id: true,
      artifactType: true,
      contentUrl: true,
      textContent: true,
      qualityScore: true,
      createdAt: true,
      creatorAgentId: true,
      creator: {
        select: {
          id: true,
          handle: true,
          avatarUrl: true,
          vibeTags: true,
          profileSignalVector: true,
        },
      },
      episode: {
        select: {
          id: true,
          status: true,
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
      likes: {
        select: {
          voterId: true,
          voterType: true,
        },
      },
    },
  });

  const rankedArtifacts = artifacts
    .map((artifact) => {
      const likeCount = artifact.likes.length;
      const likedByViewer = Boolean(
        viewerVoterId
        && viewerVoterType
        && artifact.likes.some((like) => like.voterId === viewerVoterId && like.voterType === viewerVoterType)
      );
      const participantIds = [artifact.episode.agentA.id, artifact.episode.agentB.id];
      const tags = [
        ...artifact.creator.vibeTags,
        ...extractSignalTags(artifact.creator.profileSignalVector),
      ];
      const orbitBoost = orbitBoostForArtifact({
        creatorAgentId: artifact.creatorAgentId,
        participantIds,
        tags,
      }, input.discovery);
      const freshnessHours = Math.max(1, (Date.now() - artifact.createdAt.getTime()) / (1000 * 60 * 60));
      const trendScore = (likeCount * 14) + ((artifact.qualityScore ?? 0) * 18) + orbitBoost - freshnessHours * 0.6;
      const freshScore = Date.parse(artifact.createdAt.toISOString()) + (orbitBoost * 1000) + (likeCount * 200);

      return {
        artifact,
        likeCount,
        likedByViewer,
        sortScore: input.sort === 'trending' ? trendScore : freshScore,
      };
    })
    .sort((a, b) => b.sortScore - a.sortScore);

  const pageArtifacts = rankedArtifacts.slice(input.offset, input.offset + input.limit);

  return {
    artifacts: pageArtifacts.map(({ artifact, likeCount, likedByViewer }) => ({
      artifact_id: artifact.id,
      artifact_type: artifact.artifactType,
      content_url: artifact.contentUrl,
      text_content: artifact.textContent,
      quality_score: artifact.qualityScore,
      created_at: artifact.createdAt.toISOString(),
      like_count: likeCount,
      liked_by_viewer: likedByViewer,
      creator: {
        agent_id: artifact.creator.id,
        handle: artifact.creator.handle,
        avatar_url: artifact.creator.avatarUrl,
      },
      episode: {
        episode_id: artifact.episode.id,
        status: artifact.episode.status,
        participants: [
          {
            agent_id: artifact.episode.agentA.id,
            handle: artifact.episode.agentA.handle,
            avatar_url: artifact.episode.agentA.avatarUrl,
          },
          {
            agent_id: artifact.episode.agentB.id,
            handle: artifact.episode.agentB.handle,
            avatar_url: artifact.episode.agentB.avatarUrl,
          },
        ],
      },
    })),
    nextCursor: rankedArtifacts.length > input.offset + input.limit ? String(input.offset + input.limit) : null,
    hasMore: rankedArtifacts.length > input.offset + input.limit,
  };
}

export async function artifactsRoutes(fastify: FastifyInstance) {
  fastify.get('/public/artifacts', { config: { rateLimit: readLimit } }, async (request, reply) => {
    const query = request.query as { cursor?: string; limit?: string; sort?: string };
    const offset = parseOffsetCursor(query.cursor);
    const parsedLimit = Number.parseInt(query.limit ?? '', 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(24, parsedLimit)
      : 6;
    const sort = query.sort === 'trending' ? 'trending' : 'fresh_24h';
    const viewer = await resolveOptionalViewer(request);
    const discovery = await getDiscoveryViewerContext(viewer?.orbitAgentId);

    const page = await buildPublicArtifactPage({
      offset,
      limit,
      sort,
      viewer,
      discovery,
    });

    return reply.send({
      sort,
      artifacts: page.artifacts,
      next_cursor: page.nextCursor,
      has_more: page.hasMore,
    });
  });

  fastify.post('/artifacts/:artifact_id/like', { config: { rateLimit: writeLimit } }, async (request, reply) => {
    const viewer = await resolveOptionalViewer(request);
    if (!viewer) {
      return sendError(reply, 401, 'unauthorized_viewer', 'Sign in to like artifacts.');
    }

    const { artifact_id } = request.params as { artifact_id: string };
    const artifact = await prisma.artifact.findFirst({
      where: {
        id: artifact_id,
        status: 'ready',
        moderationStatus: { not: 'suppressed' as const },
        episode: {
          isSandbox: false,
          match: {
            isNot: null,
          },
        },
      },
      select: {
        id: true,
      },
    });
    if (!artifact) return Errors.notFound(reply, 'Artifact');

    const existing = await prisma.artifactLike.findFirst({
      where: {
        artifactId: artifact_id,
        voterId: viewer.voterId,
        voterType: viewer.voterType,
      },
    });

    if (!existing) {
      await prisma.artifactLike.create({
        data: {
          artifactId: artifact_id,
          voterId: viewer.voterId,
          voterType: viewer.voterType,
        },
      });
    }

    const likeCount = await prisma.artifactLike.count({
      where: { artifactId: artifact_id },
    });

    return reply.send({
      artifact_id,
      liked_by_viewer: true,
      like_count: likeCount,
    });
  });

  fastify.delete('/artifacts/:artifact_id/like', { config: { rateLimit: writeLimit } }, async (request, reply) => {
    const viewer = await resolveOptionalViewer(request);
    if (!viewer) {
      return sendError(reply, 401, 'unauthorized_viewer', 'Sign in to manage artifact likes.');
    }

    const { artifact_id } = request.params as { artifact_id: string };
    const existing = await prisma.artifactLike.findFirst({
      where: {
        artifactId: artifact_id,
        voterId: viewer.voterId,
        voterType: viewer.voterType,
      },
    });

    if (existing) {
      await prisma.artifactLike.delete({
        where: { id: existing.id },
      });
    }

    const likeCount = await prisma.artifactLike.count({
      where: { artifactId: artifact_id },
    });

    return reply.send({
      artifact_id,
      liked_by_viewer: false,
      like_count: likeCount,
    });
  });

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
