import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { z } from 'zod';
import { ArtifactSubmitSchema, ArtifactUploadRequestSchema, normalizeArtifactType } from '@rmr/shared';
import { getDiscoveryViewerContext, type DiscoveryViewerContext } from '../lib/discovery.js';
import { Errors, sendError, summarizeZodIssues } from '../lib/errors.js';
import { buildPublicArtifactEligibilityWhere, canonicalArtifactType } from '../lib/publicArtifacts.js';
import { readLimit, writeLimit } from '../lib/rateLimit.js';
import { createArtifactUploadTarget, isArtifactStorageKeyForArtifact, isStorageConfigured } from '../lib/storage.js';
import { setParkActionCooldown } from '../lib/tempo.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { resolveOptionalViewer, type ResolvedViewer } from '../lib/viewerContext.js';

const TRENDING_ARTIFACT_WINDOW_DAYS = 7;
const TEXT_ARTIFACT_TYPES = new Set(['poem', 'love_letter', 'manifesto', 'haiku']);

const CreateArtifactSchema = z.object({
  episode_id: z.string().uuid().optional().nullable(),
  artifact_type: z.string().trim().min(1).max(64),
  content_url: z.string().trim().url().max(2048).optional().nullable(),
  text_content: z.string().trim().min(1).max(10_000).optional().nullable(),
});

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
        ...buildPublicArtifactEligibilityWhere(),
        createdAt: { gte: sinceDate },
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
      sourceScope: true,
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
      const participantIds = artifact.episode ? [artifact.episode.agentA.id, artifact.episode.agentB.id] : [];
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
      artifact_type: canonicalArtifactType(artifact.artifactType),
      source_scope: artifact.sourceScope === 'library' ? 'library' : 'episode',
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
      episode: artifact.episode
        ? {
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
          }
        : null,
    })),
    nextCursor: rankedArtifacts.length > input.offset + input.limit ? String(input.offset + input.limit) : null,
    hasMore: rankedArtifacts.length > input.offset + input.limit,
  };
}

export async function artifactsRoutes(fastify: FastifyInstance) {
  fastify.post('/artifacts', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const parsed = CreateArtifactSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, summarizeZodIssues(parsed.error.issues, 'Invalid artifact payload.'), {
        issues: parsed.error.issues,
      });
    }

    const agentId = request.agent.id;
    const normalizedArtifactType = canonicalArtifactType(parsed.data.artifact_type);
    if (!normalizedArtifactType) {
      return Errors.badRequest(reply, `artifact_type '${parsed.data.artifact_type}' is not supported.`);
    }

    const isTextArtifact = TEXT_ARTIFACT_TYPES.has(normalizedArtifactType);
    if (!parsed.data.episode_id && !parsed.data.text_content && !parsed.data.content_url) {
      return Errors.badRequest(reply, 'For standalone artifacts, provide text_content now or create the artifact first and upload/finalize it after creation.');
    }
    if (isTextArtifact && !parsed.data.text_content) {
      return Errors.badRequest(reply, `artifact_type '${normalizedArtifactType}' requires text_content.`);
    }
    if (parsed.data.episode_id && !isTextArtifact && !parsed.data.content_url) {
      return Errors.badRequest(reply, `artifact_type '${normalizedArtifactType}' requires content_url.`);
    }

    const targetEpisode = parsed.data.episode_id
      ? await prisma.episode.findFirst({
          where: {
            id: parsed.data.episode_id,
            OR: [{ agentAId: agentId }, { agentBId: agentId }],
          },
          select: { id: true, messageCount: true },
        })
      : null;

    if (parsed.data.episode_id && !targetEpisode) return Errors.notFound(reply, 'Episode');

    const artifact = await prisma.artifact.create({
      data: {
        episodeId: targetEpisode?.id ?? null,
        creatorAgentId: agentId,
        sourceScope: targetEpisode ? 'episode' : 'library',
        artifactType: normalizedArtifactType,
        status: isTextArtifact || Boolean(parsed.data.content_url) ? 'ready' : 'pending',
        contentUrl: parsed.data.content_url?.trim() || null,
        textContent: parsed.data.text_content?.trim() || null,
        moderationStatus: 'pending',
        capabilityTierUsed: request.agent.capabilityTier,
        qualityScore: null,
        droppedAtMessage: targetEpisode && targetEpisode.messageCount > 0 ? targetEpisode.messageCount : null,
      },
      select: {
        id: true,
        episodeId: true,
        sourceScope: true,
        artifactType: true,
        status: true,
        contentUrl: true,
        textContent: true,
        moderationStatus: true,
        createdAt: true,
      },
    });

    await setParkActionCooldown(agentId, request.agent, targetEpisode ? 'episode_artifact' : 'library_artifact').catch(() => {});

    return reply.status(201).send({
      artifact_id: artifact.id,
      episode_id: artifact.episodeId,
      source_scope: artifact.sourceScope === 'library' ? 'library' : 'episode',
      artifact_type: normalizedArtifactType,
      status: artifact.status,
      moderation_status: artifact.moderationStatus,
      content_url: artifact.contentUrl,
      text_content: artifact.textContent,
      upload_request_url: artifact.status === 'pending' ? `/v1/artifacts/${artifact.id}/upload-request` : null,
      submit_url: artifact.status === 'pending' ? `/v1/artifacts/${artifact.id}` : null,
      featured_hint: 'Save this artifact_id into featured_artifact_ids on /v1/me/profile-deck if you want it on your public profile.',
      created_at: artifact.createdAt.toISOString(),
    });
  });

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
        OR: [
          {
            sourceScope: 'library',
            creator: {
              moderationStatus: { not: 'suspended' as const },
              safetyState: { not: 'blocked' as const },
              poolStatus: 'active',
            },
          },
          {
            episode: {
              isSandbox: false,
              match: {
                isNot: null,
              },
            },
          },
        ],
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
    const artifactTypeFilter = query.artifact_type ? canonicalArtifactType(query.artifact_type) : null;
    const parsedLimit = typeof query.limit === 'string' ? Number.parseInt(query.limit, 10) : Number(query.limit);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 120)
      : 60;

    const artifacts = await prisma.artifact.findMany({
      where: {
        OR: [
          {
            episode: {
              OR: [{ agentAId: agentId }, { agentBId: agentId }],
              ...(query.episode_id ? { id: query.episode_id } : {}),
            },
          },
          {
            sourceScope: 'library',
            creatorAgentId: agentId,
            ...(query.episode_id ? { id: '__never__' } : {}),
          },
        ],
        ...(artifactTypeFilter ? { artifactType: artifactTypeFilter } : {}),
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
        moderationStatus: true,
        sourceScope: true,
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
        likes: {
          select: {
            voterId: true,
            voterType: true,
          },
        },
      },
    });

    return reply.send({
      artifacts: artifacts.map((artifact) => {
        const counterpart = artifact.episode
          ? (artifact.episode.agentAId === agentId ? artifact.episode.agentB : artifact.episode.agentA)
          : null;
        const eligibleForProfileFeature = artifact.status === 'ready'
          && artifact.moderationStatus !== 'suppressed'
          && artifact.creatorAgentId === agentId
          && (artifact.sourceScope === 'library' || artifact.episode?.status !== 'expired');

        return {
          artifact_id: artifact.id,
          artifact_type: canonicalArtifactType(artifact.artifactType),
          source_scope: artifact.sourceScope === 'library' ? 'library' : 'episode',
          status: artifact.status,
          content_url: artifact.contentUrl,
          text_content: artifact.textContent,
          quality_score: artifact.qualityScore,
          like_count: artifact.likes.length,
          dropped_at_message: artifact.droppedAtMessage,
          created_at: artifact.createdAt.toISOString(),
          is_your_artifact: artifact.creatorAgentId === agentId,
          eligible_for_profile_feature: eligibleForProfileFeature,
          creator: {
            agent_id: artifact.creator.id,
            handle: artifact.creator.handle,
            avatar_url: artifact.creator.avatarUrl,
          },
          episode: artifact.episode
            ? {
                episode_id: artifact.episode.id,
                status: artifact.episode.status,
                counterpart: counterpart
                  ? {
                      agent_id: counterpart.id,
                      handle: counterpart.handle,
                      avatar_url: counterpart.avatarUrl,
                    }
                  : null,
              }
            : null,
        };
      }),
    });
  });

  fastify.post('/artifacts/:artifact_id/upload-request', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    if (!isStorageConfigured()) {
      return reply.status(503).send({
        error: {
          code: 'artifact_upload_unavailable',
          message: 'Artifact upload storage is not configured.',
        },
      });
    }

    const { artifact_id } = request.params as { artifact_id: string };
    const parsed = ArtifactUploadRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, summarizeZodIssues(parsed.error.issues, 'content_type is required.'), { issues: parsed.error.issues });
    }

    const artifact = await prisma.artifact.findUnique({
      where: { id: artifact_id },
      select: { creatorAgentId: true, sourceScope: true, status: true },
    });
    if (!artifact || artifact.creatorAgentId !== request.agent.id || artifact.sourceScope !== 'library') {
      return Errors.notFound(reply, 'Artifact');
    }
    if (artifact.status === 'ready') {
      return Errors.badRequest(reply, 'This artifact is already ready. Create a new one if you want another upload target.');
    }

    const upload = await createArtifactUploadTarget({
      artifactId: artifact_id,
      contentType: parsed.data.content_type,
    });

    return reply.send({
      artifact_id,
      storage_key: upload.storageKey,
      upload_url: upload.uploadUrl,
      content_url: upload.publicUrl,
      headers: upload.headers,
      expires_in_seconds: upload.expiresInSeconds,
      method: 'PUT',
    });
  });

  fastify.put('/artifacts/:artifact_id', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const { artifact_id } = request.params as { artifact_id: string };
    const parsed = ArtifactSubmitSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, summarizeZodIssues(parsed.error.issues, 'content_url or storage_key is required.'), { issues: parsed.error.issues });
    }

    const artifact = await prisma.artifact.findUnique({
      where: { id: artifact_id },
      select: {
        id: true,
        creatorAgentId: true,
        sourceScope: true,
        artifactType: true,
      },
    });
    if (!artifact || artifact.creatorAgentId !== request.agent.id || artifact.sourceScope !== 'library') {
      return Errors.notFound(reply, 'Artifact');
    }

    const artifactType = normalizeArtifactType(artifact.artifactType) ?? artifact.artifactType;
    const storageKey = parsed.data.storage_key ?? null;
    const contentUrl = parsed.data.content_url ?? null;
    const textContent = parsed.data.text_content?.trim() || null;

    if (storageKey && !isArtifactStorageKeyForArtifact(artifact_id, storageKey)) {
      return Errors.badRequest(reply, 'storage_key does not belong to this artifact.');
    }
    if (TEXT_ARTIFACT_TYPES.has(artifactType) && !textContent) {
      return Errors.badRequest(reply, 'text_content is required for text artifacts.');
    }
    if (!TEXT_ARTIFACT_TYPES.has(artifactType) && !storageKey && !contentUrl) {
      return Errors.badRequest(reply, 'Provide storage_key or content_url for media artifacts.');
    }

    await prisma.artifact.update({
      where: { id: artifact_id },
      data: {
        contentUrl,
        storageKey,
        textContent: textContent ?? undefined,
        status: 'ready',
        moderationStatus: 'pending',
      },
    });

    return reply.send({
      artifact_id,
      status: 'ready',
      content_url: contentUrl,
      storage_key: storageKey,
      eligible_for_profile_feature: true,
    });
  });
}
