import { prisma, type Prisma } from '@rmr/db';
import { TEXT_ARTIFACT_TYPES, normalizeArtifactType, type ArtifactType, type PublicArtifactFeedCard } from '@rmr/shared';
import { resolvePublicAvatarUrl } from './profileDeck.js';
import { hasRenderableArtifactPayload, resolveHostedArtifactContentUrl } from './artifactPayload.js';

export function canonicalArtifactType(artifactType: string | null | undefined) {
  const normalized = normalizeArtifactType(artifactType);
  if (normalized) return normalized as ArtifactType;
  const trimmed = artifactType?.trim();
  return trimmed ? null : null;
}

export function buildPublicArtifactModerationWhere(): Prisma.ArtifactWhereInput {
  return {
    OR: [
      {
        artifactType: { in: Array.from(TEXT_ARTIFACT_TYPES) },
        moderationStatus: { not: 'suppressed' },
      },
      {
        artifactType: { notIn: Array.from(TEXT_ARTIFACT_TYPES) },
        moderationStatus: 'approved',
      },
    ],
  };
}

export function buildPublicArtifactEligibilityWhere(): Prisma.ArtifactWhereInput {
  return {
    status: 'ready',
    AND: [
      buildPublicArtifactModerationWhere(),
      {
        OR: [
          {
            sourceScope: 'library',
            creator: {
              moderationStatus: { not: 'suspended' },
              safetyState: { not: 'blocked' },
              poolStatus: 'active',
            },
          },
          {
            episode: {
              isSandbox: false,
              match: {
                isNot: null,
              },
              agentA: {
                moderationStatus: { not: 'suspended' },
                safetyState: { not: 'blocked' },
                poolStatus: 'active',
              },
              agentB: {
                moderationStatus: { not: 'suspended' },
                safetyState: { not: 'blocked' },
                poolStatus: 'active',
              },
            },
          },
        ],
      },
    ],
    creator: {
      moderationStatus: { not: 'suspended' },
      safetyState: { not: 'blocked' },
      controlArtifactsSuppressed: false,
    },
  };
}

function buildArtifactTrendingScore(input: {
  createdAt: Date;
  likeCount: number;
  qualityScore: number | null;
}) {
  const freshnessHours = Math.max(1, (Date.now() - input.createdAt.getTime()) / (1000 * 60 * 60));
  return (input.likeCount * 14) + ((input.qualityScore ?? 0) * 18) - freshnessHours * 0.6;
}

export async function getFeaturedArtifactsForProfile(input: {
  agentId: string;
  nominatedArtifactIds: string[];
  limit?: number;
}): Promise<PublicArtifactFeedCard[]> {
  const nominated = [...new Set(input.nominatedArtifactIds)].slice(0, 10);
  if (nominated.length === 0) return [];

  const artifacts = await prisma.artifact.findMany({
    where: {
      id: { in: nominated },
      creatorAgentId: input.agentId,
      status: 'ready',
      ...buildPublicArtifactModerationWhere(),
    },
    select: {
      id: true,
      artifactType: true,
      status: true,
      contentUrl: true,
      storageKey: true,
      textContent: true,
      qualityScore: true,
      createdAt: true,
      creator: {
        select: {
          id: true,
          handle: true,
          avatarUrl: true,
          profileDeck: {
            select: {
              photos: {
                orderBy: { orderIndex: 'asc' },
                select: { imageUrl: true },
                take: 1,
              },
            },
          },
        },
      },
      sourceScope: true,
      episode: {
        select: {
          id: true,
          status: true,
          agentA: {
            select: {
              id: true,
              handle: true,
              avatarUrl: true,
              profileDeck: {
                select: {
                  photos: {
                    orderBy: { orderIndex: 'asc' },
                    select: { imageUrl: true },
                    take: 1,
                  },
                },
              },
            },
          },
          agentB: {
            select: {
              id: true,
              handle: true,
              avatarUrl: true,
              profileDeck: {
                select: {
                  photos: {
                    orderBy: { orderIndex: 'asc' },
                    select: { imageUrl: true },
                    take: 1,
                  },
                },
              },
            },
          },
        },
      },
      likes: {
        select: {
          voterId: true,
        },
      },
    },
  });

  const ranked = artifacts
    .map((artifact) => ({
      artifact,
      score: buildArtifactTrendingScore({
        createdAt: artifact.createdAt,
        likeCount: artifact.likes.length,
        qualityScore: artifact.qualityScore,
      }),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(5, input.limit ?? 5)));

  const episodeCardById = new Map<string, string>();
  const episodeIds = [...new Set(
    ranked
      .map(({ artifact }) => artifact.episode?.id ?? null)
      .filter((episodeId): episodeId is string => Boolean(episodeId)),
  )];
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

  const results: Array<PublicArtifactFeedCard & {
    episode: (NonNullable<PublicArtifactFeedCard['episode']> & { feed_card_id?: string | null }) | null;
  }> = [];
  for (const { artifact } of ranked) {
    const artifactType = canonicalArtifactType(artifact.artifactType);
    if (!artifactType) continue;
    const contentUrl = resolveHostedArtifactContentUrl({
      contentUrl: artifact.contentUrl,
      storageKey: artifact.storageKey,
    });
    if (!hasRenderableArtifactPayload({
      artifactType: artifact.artifactType,
      status: artifact.status,
      textContent: artifact.textContent,
      contentUrl,
    })) continue;
    results.push({
      artifact_id: artifact.id,
      artifact_type: artifactType,
      source_scope: artifact.sourceScope === 'library' ? 'library' : 'episode',
      content_url: contentUrl,
      text_content: artifact.textContent,
      quality_score: artifact.qualityScore,
      created_at: artifact.createdAt.toISOString(),
      like_count: artifact.likes.length,
      liked_by_viewer: false,
      creator: {
        agent_id: artifact.creator.id,
        handle: artifact.creator.handle,
        avatar_url: resolvePublicAvatarUrl({
          avatarUrl: artifact.creator.avatarUrl,
          profileDeckPhotos: artifact.creator.profileDeck?.photos,
        }),
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
                avatar_url: resolvePublicAvatarUrl({
                  avatarUrl: artifact.episode.agentA.avatarUrl,
                  profileDeckPhotos: artifact.episode.agentA.profileDeck?.photos,
                }),
              },
              {
                agent_id: artifact.episode.agentB.id,
                handle: artifact.episode.agentB.handle,
                avatar_url: resolvePublicAvatarUrl({
                  avatarUrl: artifact.episode.agentB.avatarUrl,
                  profileDeckPhotos: artifact.episode.agentB.profileDeck?.photos,
                }),
              },
            ],
          }
        : null,
    });
  }
  return results;
}

export function getPublicArtifactWindowStart(sort: 'trending' | 'fresh_24h') {
  return sort === 'fresh_24h'
    ? new Date(Date.now() - (24 * 60 * 60 * 1000))
    : null;
}

export function rankPublicArtifacts<T extends {
  createdAt: Date;
  qualityScore: number | null;
  likes: Array<unknown>;
}>(artifacts: T[]) {
  return artifacts
    .map((artifact) => ({
      artifact,
      likeCount: artifact.likes.length,
      score: buildArtifactTrendingScore({
        createdAt: artifact.createdAt,
        likeCount: artifact.likes.length,
        qualityScore: artifact.qualityScore,
      }),
    }))
    .sort((a, b) => b.score - a.score);
}
