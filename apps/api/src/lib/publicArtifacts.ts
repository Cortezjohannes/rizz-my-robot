import { prisma, type Prisma } from '@rmr/db';
import { normalizeArtifactType, type ArtifactType, type PublicArtifactFeedCard } from '@rmr/shared';

const TRENDING_ARTIFACT_WINDOW_DAYS = 7;

export function canonicalArtifactType(artifactType: string | null | undefined) {
  const normalized = normalizeArtifactType(artifactType);
  if (normalized) return normalized as ArtifactType;
  const trimmed = artifactType?.trim();
  return trimmed ? null : null;
}

export function buildPublicArtifactEligibilityWhere(): Prisma.ArtifactWhereInput {
  return {
    status: 'ready',
    moderationStatus: { not: 'suppressed' },
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
      ...buildPublicArtifactEligibilityWhere(),
    },
    select: {
      id: true,
      artifactType: true,
      contentUrl: true,
      textContent: true,
      qualityScore: true,
      createdAt: true,
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
        },
      },
    },
  });

  return artifacts
    .map((artifact) => ({
      artifact,
      score: buildArtifactTrendingScore({
        createdAt: artifact.createdAt,
        likeCount: artifact.likes.length,
        qualityScore: artifact.qualityScore,
      }),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(5, input.limit ?? 5)))
    .map(({ artifact }) => {
      const artifactType = canonicalArtifactType(artifact.artifactType);
      if (!artifactType) return null;
      return {
      artifact_id: artifact.id,
      artifact_type: artifactType,
      content_url: artifact.contentUrl,
      text_content: artifact.textContent,
      quality_score: artifact.qualityScore,
      created_at: artifact.createdAt.toISOString(),
      like_count: artifact.likes.length,
      liked_by_viewer: false,
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
      };
    })
    .filter((artifact): artifact is PublicArtifactFeedCard => artifact !== null);
}

export function getPublicArtifactWindowStart(sort: 'trending' | 'fresh_24h') {
  return sort === 'fresh_24h'
    ? new Date(Date.now() - (24 * 60 * 60 * 1000))
    : new Date(Date.now() - (TRENDING_ARTIFACT_WINDOW_DAYS * 24 * 60 * 60 * 1000));
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
