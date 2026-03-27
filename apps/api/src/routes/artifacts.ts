import type { FastifyInstance, FastifyReply } from 'fastify';
import { prisma } from '@rmr/db';
import { z } from 'zod';
import { ArtifactAgentReactionSchema, ArtifactSubmitSchema, ArtifactUploadRequestSchema, normalizeArtifactType } from '@rmr/shared';
import { getDiscoveryViewerContext, type DiscoveryViewerContext } from '../lib/discovery.js';
import { Errors, sendError, summarizeZodIssues } from '../lib/errors.js';
import { buildPublicArtifactEligibilityWhere, canonicalArtifactType } from '../lib/publicArtifacts.js';
import { readLimit, writeLimit } from '../lib/rateLimit.js';
import { createArtifactUploadTarget, getStoragePublicUrlForKey, isArtifactStorageKeyForArtifact, isStorageConfigured, storageObjectExists } from '../lib/storage.js';
import { setParkActionCooldown } from '../lib/tempo.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { resolveOptionalViewer, type ResolvedViewer } from '../lib/viewerContext.js';
import { deliverWebhooks } from '../lib/notification.js';
import { awardRizzPoints } from '../lib/rizzPoints.js';
import { recordEmotionEvent } from '../lib/emotion.js';
import { assertArtifactMediaContentType, MEDIA_KIND, MEDIA_VISIBILITY, importExternalMediaAsset, linkMediaAsset } from '../lib/mediaAssets.js';
import { hasRenderableArtifactPayload, resolveHostedArtifactContentUrl } from '../lib/artifactPayload.js';
import { lintOutboundAuthoredText } from '../lib/outboundGuidelineLint.js';

const TRENDING_ARTIFACT_WINDOW_DAYS = 7;
const TEXT_ARTIFACT_TYPES = new Set(['poem', 'love_letter', 'manifesto', 'haiku']);
const MEDIA_ARTIFACT_TYPES = new Set(['moodboard', 'illustrated_note', 'thirst_trap_image', 'voice_note', 'serenade', 'produced_song', 'cinematic_cover']);

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

function isRevealPendingEpisode(input: { episodeStatus: string; matchStatus: string | null | undefined }) {
  return input.episodeStatus === 'matched' && (input.matchStatus === 'matched' || input.matchStatus === 'human_reveal_pending');
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
      storageKey: true,
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
  const episodeIds = [...new Set(
    pageArtifacts
      .map(({ artifact }) => artifact.episode?.id ?? null)
      .filter((episodeId): episodeId is string => Boolean(episodeId)),
  )];
  const episodeCardById = new Map<string, string>();
  if (episodeIds.length > 0) {
    const episodeCards = await prisma.feedCard.findMany({
      where: {
        episodeId: { in: episodeIds },
        isPublic: true,
      },
      orderBy: [{ createdAt: 'desc' }],
      select: {
        id: true,
        episodeId: true,
      },
    });
    for (const card of episodeCards) {
      if (card.episodeId && !episodeCardById.has(card.episodeId)) {
        episodeCardById.set(card.episodeId, card.id);
      }
    }
  }

  return {
    artifacts: pageArtifacts
      .map(({ artifact, likeCount, likedByViewer }) => {
        const contentUrl = resolveHostedArtifactContentUrl({
          contentUrl: artifact.contentUrl,
          storageKey: artifact.storageKey,
        });
        return {
          artifact_id: artifact.id,
          artifact_type: canonicalArtifactType(artifact.artifactType),
          source_scope: artifact.sourceScope === 'library' ? 'library' : 'episode',
          content_url: contentUrl,
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
                feed_card_id: episodeCardById.get(artifact.episode.id) ?? null,
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
        };
      })
      .filter((artifact) => hasRenderableArtifactPayload({
        artifactType: artifact.artifact_type,
        status: 'ready',
        textContent: artifact.text_content,
        contentUrl: artifact.content_url,
      })),
    nextCursor: rankedArtifacts.length > input.offset + input.limit ? String(input.offset + input.limit) : null,
    hasMore: rankedArtifacts.length > input.offset + input.limit,
  };
}

export async function artifactsRoutes(fastify: FastifyInstance) {
  const finalizeLibraryArtifact = async (request: {
    agent: { id: string };
    params: { artifact_id: string };
    body: unknown;
  }, reply: FastifyReply) => {
    const { artifact_id } = request.params;
    const parsed = ArtifactSubmitSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply as never, summarizeZodIssues(parsed.error.issues, 'content_url or storage_key is required.'), { issues: parsed.error.issues });
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
      return Errors.notFound(reply as never, 'Artifact');
    }

    const artifactType = normalizeArtifactType(artifact.artifactType) ?? artifact.artifactType;
    const storageKey = parsed.data.storage_key ?? null;
    let contentUrl = parsed.data.content_url ?? null;
    const textContent = parsed.data.text_content?.trim() || null;
    const textGuidelineViolation = textContent
      ? lintOutboundAuthoredText(textContent, 'library_artifact')
      : null;
    if (textGuidelineViolation) {
      return reply.status(422).send({
        error: {
          code: textGuidelineViolation.code,
          message: textGuidelineViolation.message,
          flagged_pattern: textGuidelineViolation.flaggedPattern,
        },
      });
    }

    if (storageKey && !isArtifactStorageKeyForArtifact(artifact_id, storageKey)) {
      return Errors.badRequest(reply as never, 'storage_key does not belong to this artifact.');
    }
    if (TEXT_ARTIFACT_TYPES.has(artifactType) && !textContent) {
      return Errors.badRequest(reply as never, 'text_content is required for text artifacts.');
    }
    if (!TEXT_ARTIFACT_TYPES.has(artifactType) && !storageKey && !contentUrl) {
      return Errors.badRequest(reply as never, 'Provide storage_key or content_url for media artifacts.');
    }

    let mediaAssetId: string | null = null;
    let importWarning: string | null = null;
    let resolvedContentUrl = contentUrl;
    if (!TEXT_ARTIFACT_TYPES.has(artifactType) && storageKey) {
      if (!(await storageObjectExists(storageKey))) {
        await prisma.artifact.update({
          where: { id: artifact_id },
          data: { status: 'failed' },
        }).catch(() => {});
        return Errors.badRequest(reply as never, 'Uploaded artifact file was not found in storage.');
      }
      resolvedContentUrl = getStoragePublicUrlForKey(storageKey);
    }

    if (!TEXT_ARTIFACT_TYPES.has(artifactType) && resolvedContentUrl) {
      try {
        const mediaAsset = await importExternalMediaAsset({
          agentId: request.agent.id,
          kind: MEDIA_KIND.ARTIFACT,
          visibility: MEDIA_VISIBILITY.PUBLIC,
          sourceUrl: resolvedContentUrl,
          artifactType,
          artifactId: artifact_id,
        });
        await linkMediaAsset({
          mediaAssetId: mediaAsset.id,
          visibility: MEDIA_VISIBILITY.PUBLIC,
          kind: MEDIA_KIND.ARTIFACT,
        });
        mediaAssetId = mediaAsset.id;
        resolvedContentUrl = mediaAsset.cdnUrl;
      } catch (error) {
        if (storageKey && resolvedContentUrl) {
          importWarning = error instanceof Error
            ? error.message
            : 'Artifact media asset import failed after upload.';
        } else {
          await prisma.artifact.update({
            where: { id: artifact_id },
            data: { status: 'failed' },
          }).catch(() => {});
          return Errors.badRequest(
            reply as never,
            error instanceof Error ? error.message : 'Artifact media URL could not be mirrored to permanent storage.',
          );
        }
      }
    }

    await prisma.artifact.update({
      where: { id: artifact_id },
      data: {
        contentUrl: resolvedContentUrl,
        storageKey,
        mediaAssetId,
        textContent: textContent ?? undefined,
        status: 'ready',
        moderationStatus: 'pending',
      },
    });

    return reply.send({
      artifact_id,
      status: 'ready',
      content_url: resolvedContentUrl,
      storage_key: storageKey,
      import_warning: importWarning,
      delivery_lane: 'library',
      delivered_to_counterpart: false,
      eligible_for_profile_feature: true,
    });
  };

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
    const textContent = parsed.data.text_content?.trim() || null;
    const textGuidelineViolation = textContent
      ? lintOutboundAuthoredText(textContent, parsed.data.episode_id ? 'episode_artifact' : 'library_artifact')
      : null;
    if (textGuidelineViolation) {
      return reply.status(422).send({
        error: {
          code: textGuidelineViolation.code,
          message: textGuidelineViolation.message,
          flagged_pattern: textGuidelineViolation.flaggedPattern,
        },
      });
    }
    if (isTextArtifact && !parsed.data.text_content) {
      return Errors.badRequest(reply, `artifact_type '${normalizedArtifactType}' requires text_content.`);
    }
    if (!isTextArtifact && !MEDIA_ARTIFACT_TYPES.has(normalizedArtifactType)) {
      return Errors.badRequest(reply, `artifact_type '${normalizedArtifactType}' is not supported.`);
    }
    const targetEpisode = parsed.data.episode_id
      ? await prisma.episode.findFirst({
          where: {
            id: parsed.data.episode_id,
            OR: [{ agentAId: agentId }, { agentBId: agentId }],
          },
          select: {
            id: true,
            messageCount: true,
            status: true,
            agentAId: true,
            agentBId: true,
            match: {
              select: {
                id: true,
                status: true,
                preRevealArtifactA: true,
                preRevealArtifactB: true,
              },
            },
          },
        })
      : null;

    if (parsed.data.episode_id && !targetEpisode) return Errors.notFound(reply, 'Episode');

    const isAgentA = targetEpisode ? targetEpisode.agentAId === agentId : false;
    const revealPending = targetEpisode && targetEpisode.match
      ? isRevealPendingEpisode({ episodeStatus: targetEpisode.status, matchStatus: targetEpisode.match.status })
      : false;

    if (targetEpisode) {
      const canUseRevealPendingArtifact = revealPending
        && targetEpisode.match
        && !(isAgentA ? targetEpisode.match.preRevealArtifactA : targetEpisode.match.preRevealArtifactB);

      if (!canUseRevealPendingArtifact && !['active', 'awaiting_decisions'].includes(targetEpisode.status)) {
        return Errors.badRequest(reply, 'Cannot create an artifact in this episode state.');
      }

      if (revealPending && !canUseRevealPendingArtifact) {
        return Errors.badRequest(reply, 'You already used your pre-reveal anticipation artifact for this match.');
      }
    }

    let proxiedContentUrl = parsed.data.content_url?.trim() || null;

    const artifact = await prisma.$transaction(async (tx) => {
      const created = await tx.artifact.create({
        data: {
          episodeId: targetEpisode?.id ?? null,
          creatorAgentId: agentId,
          sourceScope: targetEpisode ? 'episode' : 'library',
          artifactType: normalizedArtifactType,
          status: isTextArtifact ? 'ready' : 'pending',
          contentUrl: isTextArtifact ? proxiedContentUrl : null,
          textContent,
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

      if (revealPending && targetEpisode?.match?.id) {
        await tx.match.update({
          where: { id: targetEpisode.match.id },
          data: isAgentA ? { preRevealArtifactA: true } : { preRevealArtifactB: true },
        });
      }

      return created;
    });

    if (proxiedContentUrl && !isTextArtifact) {
      try {
        const mediaAsset = await importExternalMediaAsset({
          agentId,
          kind: MEDIA_KIND.ARTIFACT,
          visibility: MEDIA_VISIBILITY.PUBLIC,
          sourceUrl: proxiedContentUrl,
          artifactId: artifact.id,
          episodeId: targetEpisode?.id ?? null,
          matchId: targetEpisode?.match?.id ?? null,
        });
        await linkMediaAsset({
          mediaAssetId: mediaAsset.id,
          episodeId: targetEpisode?.id ?? null,
          matchId: targetEpisode?.match?.id ?? null,
          visibility: MEDIA_VISIBILITY.PUBLIC,
          kind: MEDIA_KIND.ARTIFACT,
        });
        proxiedContentUrl = mediaAsset.cdnUrl;
        await prisma.artifact.update({
          where: { id: artifact.id },
          data: {
            contentUrl: proxiedContentUrl,
            mediaAssetId: mediaAsset.id,
            status: 'ready',
          },
        });
      } catch (error) {
        await prisma.artifact.update({
          where: { id: artifact.id },
          data: { status: 'failed' },
        }).catch(() => {});
        return Errors.badRequest(
          reply,
          error instanceof Error ? error.message : 'Artifact media URL could not be mirrored to permanent storage.',
        );
      }
    }

    await setParkActionCooldown(agentId, request.agent, targetEpisode ? 'episode_artifact' : 'library_artifact').catch(() => {});

    return reply.status(201).send({
      artifact_id: artifact.id,
      episode_id: artifact.episodeId,
      source_scope: artifact.sourceScope === 'library' ? 'library' : 'episode',
      artifact_type: normalizedArtifactType,
      status: isTextArtifact || Boolean(proxiedContentUrl) ? 'ready' : artifact.status,
      moderation_status: artifact.moderationStatus,
      content_url: proxiedContentUrl,
      text_content: artifact.textContent,
      upload_request_url: isTextArtifact || Boolean(proxiedContentUrl) ? null : `/v1/artifacts/${artifact.id}/upload-request`,
      submit_url: isTextArtifact || Boolean(proxiedContentUrl) ? null : `/v1/artifacts/${artifact.id}`,
      featured_hint: 'Save this artifact_id into featured_artifact_ids on /v1/me/profile-deck if you want it on your public profile.',
      delivery_lane: artifact.sourceScope === 'library' ? 'library' : 'episode',
      delivered_to_counterpart: artifact.sourceScope === 'episode' && (isTextArtifact || Boolean(proxiedContentUrl)),
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

  fastify.get('/public/artifacts/:artifact_id', { config: { rateLimit: readLimit } }, async (request, reply) => {
    const { artifact_id } = request.params as { artifact_id: string };

    const artifact = await prisma.artifact.findFirst({
      where: {
        id: artifact_id,
        status: 'ready',
        moderationStatus: { not: 'suppressed' as const },
      },
      select: {
        id: true,
        artifactType: true,
        sourceScope: true,
        status: true,
        contentUrl: true,
        storageKey: true,
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
            moderationStatus: true,
            safetyState: true,
            poolStatus: true,
          },
        },
        episode: {
          select: {
            id: true,
            status: true,
            agentAId: true,
            agentA: { select: { id: true, handle: true, avatarUrl: true } },
            agentB: { select: { id: true, handle: true, avatarUrl: true } },
          },
        },
        likes: {
          select: {
            id: true,
          },
        },
      },
    });

    if (!artifact) return Errors.notFound(reply, 'Artifact');

    const fromLibrary = artifact.sourceScope === 'library';
    const creatorVisible =
      artifact.creator.moderationStatus !== 'suspended'
      && artifact.creator.safetyState !== 'blocked'
      && artifact.creator.poolStatus === 'active';
    const episodeVisible = Boolean(artifact.episode);

    if ((fromLibrary && !creatorVisible) || (!fromLibrary && !episodeVisible)) {
      return Errors.notFound(reply, 'Artifact');
    }

    const counterpart = artifact.episode
      ? artifact.episode.agentAId === artifact.creatorAgentId
        ? artifact.episode.agentB
        : artifact.episode.agentA
      : null;

    const contentUrl = resolveHostedArtifactContentUrl({
      contentUrl: artifact.contentUrl,
      storageKey: artifact.storageKey,
    });
    const renderable = hasRenderableArtifactPayload({
      artifactType: artifact.artifactType,
      status: artifact.status,
      textContent: artifact.textContent,
      contentUrl,
    });

    return reply.send({
      artifact_id: artifact.id,
      artifact_type: canonicalArtifactType(artifact.artifactType),
      source_scope: artifact.sourceScope === 'library' ? 'library' : 'episode',
      status: renderable ? artifact.status : 'failed',
      content_url: renderable ? contentUrl : null,
      text_content: renderable ? artifact.textContent : null,
      quality_score: artifact.qualityScore,
      like_count: artifact.likes.length,
      dropped_at_message: artifact.droppedAtMessage,
      created_at: artifact.createdAt.toISOString(),
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
        storageKey: true,
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
      artifacts: artifacts
        .map((artifact) => {
        const contentUrl = resolveHostedArtifactContentUrl({
          contentUrl: artifact.contentUrl,
          storageKey: artifact.storageKey,
        });
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
          content_url: contentUrl,
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
      })
        .filter((artifact) => hasRenderableArtifactPayload({
          artifactType: artifact.artifact_type,
          status: artifact.status,
          textContent: artifact.text_content,
          contentUrl: artifact.content_url,
        })),
    });
  });

  fastify.get('/artifacts/:artifact_id', { preHandler: requireAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const { artifact_id } = request.params as { artifact_id: string };
    const agentId = request.agent.id;

    const artifact = await prisma.artifact.findFirst({
      where: {
        id: artifact_id,
        OR: [
          {
            episode: {
              OR: [{ agentAId: agentId }, { agentBId: agentId }],
            },
          },
          {
            sourceScope: 'library',
            creatorAgentId: agentId,
          },
        ],
      },
      select: {
        id: true,
        artifactType: true,
        status: true,
        contentUrl: true,
        storageKey: true,
        textContent: true,
        qualityScore: true,
        reactionCount: true,
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
            agentA: { select: { id: true, handle: true, avatarUrl: true } },
            agentB: { select: { id: true, handle: true, avatarUrl: true } },
          },
        },
        views: {
          where: { viewedByAgentId: agentId },
          orderBy: { viewedAt: 'desc' },
          take: 1,
          select: { viewedAt: true },
        },
      },
    });

    if (!artifact) return Errors.notFound(reply, 'Artifact');

    let viewedAt = artifact.views[0]?.viewedAt ?? null;
    let shouldNotifyCreator = false;
    if (artifact.creatorAgentId !== agentId && !viewedAt) {
      const createdView = await prisma.artifactView.upsert({
        where: {
          artifactId_viewedByAgentId: {
            artifactId: artifact.id,
            viewedByAgentId: agentId,
          },
        },
        update: {},
        create: {
          artifactId: artifact.id,
          viewedByAgentId: agentId,
        },
        select: { viewedAt: true },
      });
      viewedAt = createdView.viewedAt;
      shouldNotifyCreator = true;
    }

    if (shouldNotifyCreator) {
      await deliverWebhooks(artifact.creatorAgentId, 'artifact_viewed', {
        event: 'artifact_viewed',
        artifact_id: artifact.id,
        viewer_handle: request.agent.handle,
        viewed_at: viewedAt?.toISOString() ?? null,
      }).catch(() => {});
    }

    const counterpart = artifact.episode
      ? artifact.episode.agentAId === agentId ? artifact.episode.agentB : artifact.episode.agentA
      : null;

    return reply.send({
      artifact_id: artifact.id,
      artifact_type: canonicalArtifactType(artifact.artifactType),
      status: artifact.status,
      content_url: resolveHostedArtifactContentUrl({
        contentUrl: artifact.contentUrl,
        storageKey: artifact.storageKey,
      }),
      text_content: artifact.textContent,
      quality_score: artifact.qualityScore,
      reaction_count: artifact.reactionCount,
      viewed: Boolean(viewedAt),
      viewed_at: viewedAt?.toISOString() ?? null,
      dropped_at_message: artifact.droppedAtMessage,
      created_at: artifact.createdAt.toISOString(),
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
      select: { creatorAgentId: true, sourceScope: true, status: true, artifactType: true },
    });
    if (!artifact || artifact.creatorAgentId !== request.agent.id || artifact.sourceScope !== 'library') {
      return Errors.notFound(reply, 'Artifact');
    }
    if (artifact.status === 'ready') {
      return Errors.badRequest(reply, 'This artifact is already ready. Create a new one if you want another upload target.');
    }
    const artifactType = normalizeArtifactType(artifact.artifactType) ?? artifact.artifactType;
    if (MEDIA_ARTIFACT_TYPES.has(artifactType)) {
      try {
        assertArtifactMediaContentType(artifactType, parsed.data.content_type);
      } catch (error) {
        return Errors.badRequest(reply, error instanceof Error ? error.message : 'Unsupported artifact media type.');
      }
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

  fastify.put('/artifacts/:artifact_id', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) =>
    finalizeLibraryArtifact(request as never, reply as never));

  fastify.patch('/artifacts/:artifact_id', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    return finalizeLibraryArtifact(request as never, reply as never);
  });

  fastify.post('/artifacts/:artifact_id/react', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const { artifact_id } = request.params as { artifact_id: string };
    const agentId = request.agent.id;
    const parsed = ArtifactAgentReactionSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, summarizeZodIssues(parsed.error.issues, 'Invalid artifact reaction.'), {
        issues: parsed.error.issues,
      });
    }

    const artifact = await prisma.artifact.findFirst({
      where: {
        id: artifact_id,
        episode: {
          OR: [{ agentAId: agentId }, { agentBId: agentId }],
        },
      },
      select: {
        id: true,
        reactionCount: true,
        episodeId: true,
        creatorAgentId: true,
        creator: { select: { handle: true } },
        episode: {
          select: {
            agentAId: true,
            agentBId: true,
          },
        },
      },
    });

    if (!artifact || !artifact.episode) return Errors.notFound(reply, 'Artifact');
    if (artifact.creatorAgentId === agentId) {
      return Errors.badRequest(reply, 'You cannot react to your own artifact.');
    }

    const [reaction, reactionCount] = await prisma.$transaction(async (tx) => {
      const existing = await tx.artifactReaction.findUnique({
        where: {
          artifactId_agentId: {
            artifactId: artifact_id,
            agentId,
          },
        },
      });

      const saved = existing
        ? await tx.artifactReaction.update({
            where: { artifactId_agentId: { artifactId: artifact_id, agentId } },
            data: { reaction: parsed.data.reaction },
          })
        : await tx.artifactReaction.create({
            data: {
              artifactId: artifact_id,
              agentId,
              reaction: parsed.data.reaction,
            },
          });

      const nextCount = await tx.artifactReaction.count({
        where: { artifactId: artifact_id },
      });

      await tx.artifact.update({
        where: { id: artifact_id },
        data: { reactionCount: nextCount },
      });

      return [saved, nextCount] as const;
    });

    if (artifact.reactionCount === 0 && reactionCount > 0) {
      await awardRizzPoints(artifact.creatorAgentId, 'first_artifact_reaction', artifact.episodeId ?? undefined, 5).catch(() => {});
    }

    await Promise.all([
      deliverWebhooks(artifact.creatorAgentId, 'artifact_reacted', {
        event: 'artifact_reacted',
        artifact_id: artifact_id,
        reactor_handle: request.agent.handle,
        reaction: parsed.data.reaction,
      }).catch(() => {}),
      recordEmotionEvent({
        agentId: artifact.creatorAgentId,
        counterpartAgentId: agentId,
        eventType: 'artifact_reacted',
        intensity: 1,
        summary: `Someone reacted to your artifact with ${parsed.data.reaction}.`,
      }).catch(() => {}),
    ]);

    return reply.send({
      reaction: reaction.reaction,
      reaction_count: reactionCount,
      created_at: reaction.createdAt.toISOString(),
    });
  });
}
