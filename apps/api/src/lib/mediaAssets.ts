import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { normalizeArtifactType } from '@rmr/shared';
import { prisma, type Prisma } from '@rmr/db';
import {
  buildArtifactStorageKey,
  buildAvatarStorageKey,
  buildProfileDeckPhotoStorageKey,
  buildProfileVoiceStorageKey,
  buildMediaStorageKey,
  deleteStorageObject,
  getStoragePublicUrlForKey,
  getStoragePublicBaseUrl,
  getStorageObjectContentType,
  storageObjectExists,
  inferStorageKeyFromPublicUrl,
  isStorageConfigured,
  resolveStorageExtension,
  uploadBufferToStorage,
} from './storage.js';
import { assertAllowedMediaContentType } from './media.js';
import { assertSafeOutboundUrl } from './outboundUrlSafety.js';

const PRIVATE_MEDIA_TOKEN_TTL_SECONDS = 10 * 60;
const ORPHAN_MEDIA_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const MEDIA_VISIBILITY = {
  PUBLIC: 'public',
  MATCH_PRIVATE: 'match_private',
  OWNER_PRIVATE: 'owner_private',
  REVEAL_PRIVATE: 'reveal_private',
} as const;

export const MEDIA_KIND = {
  AVATAR: 'avatar',
  PROFILE_PHOTO: 'profile_photo',
  ARTIFACT: 'artifact',
  EPISODE_ATTACHMENT: 'episode_attachment',
  REVEAL_CHAT_ATTACHMENT: 'reveal_chat_attachment',
  VOICE_CATCHPHRASE: 'voice_catchphrase',
  SYSTEM_GENERATED: 'system_generated',
} as const;

type MediaVisibility = (typeof MEDIA_VISIBILITY)[keyof typeof MEDIA_VISIBILITY];
type MediaKind = (typeof MEDIA_KIND)[keyof typeof MEDIA_KIND];

type MediaAssetRecord = Awaited<ReturnType<typeof getMediaAssetById>>;
type SerializableMediaAsset = {
  id: string;
  kind: string;
  visibility: string;
  contentType: string | null;
  sizeBytes: number | null;
  filename: string | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  cdnUrl: string | null;
  status: string;
  createdAt: Date;
};

function getMediaSigningSecret() {
  return process.env.MEDIA_ACCESS_SECRET
    ?? process.env.JWT_SECRET
    ?? process.env.STORAGE_SECRET_ACCESS_KEY
    ?? null;
}

function sha256Hex(buffer: Uint8Array) {
  return createHash('sha256').update(buffer).digest('hex');
}

function encodeTokenPayload(payload: Record<string, string | number>) {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function signTokenPayload(encodedPayload: string) {
  const secret = getMediaSigningSecret();
  if (!secret) {
    throw new Error('media_signing_secret_missing');
  }
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

export function createPrivateMediaAccessToken(input: {
  mediaAssetId: string;
  expiresAt?: Date;
}) {
  const expiresAt = input.expiresAt ?? new Date(Date.now() + PRIVATE_MEDIA_TOKEN_TTL_SECONDS * 1000);
  const encodedPayload = encodeTokenPayload({
    media_asset_id: input.mediaAssetId,
    exp: expiresAt.getTime(),
  });
  const signature = signTokenPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function verifyPrivateMediaAccessToken(token: string): { mediaAssetId: string } | null {
  const [encodedPayload, encodedSignature] = token.split('.');
  if (!encodedPayload || !encodedSignature) return null;

  try {
    const expectedSignature = signTokenPayload(encodedPayload);
    const signatureOk = timingSafeEqual(Buffer.from(encodedSignature), Buffer.from(expectedSignature));
    if (!signatureOk) return null;
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as {
      media_asset_id?: unknown;
      exp?: unknown;
    };
    if (typeof payload.media_asset_id !== 'string' || typeof payload.exp !== 'number') return null;
    if (payload.exp < Date.now()) return null;
    return { mediaAssetId: payload.media_asset_id };
  } catch {
    return null;
  }
}

export function resolveMediaStorageKey(input: {
  kind: MediaKind;
  agentId: string;
  contentType: string;
  artifactId?: string | null;
  episodeId?: string | null;
  revealChatId?: string | null;
  messageId?: string | null;
  voiceHash?: string | null;
}) {
  switch (input.kind) {
    case MEDIA_KIND.AVATAR:
      return buildAvatarStorageKey(input.agentId, input.contentType);
    case MEDIA_KIND.PROFILE_PHOTO: {
      const slotToken = input.messageId ? Number.parseInt(input.messageId.slice(0, 2), 16) || 0 : 0;
      return buildProfileDeckPhotoStorageKey(input.agentId, slotToken, input.contentType);
    }
    case MEDIA_KIND.ARTIFACT:
      return buildArtifactStorageKey(input.artifactId ?? randomUUID(), input.contentType);
    case MEDIA_KIND.VOICE_CATCHPHRASE:
      return buildProfileVoiceStorageKey(
        input.agentId,
        input.voiceHash ?? randomUUID().replace(/-/g, ''),
        input.contentType,
      );
    case MEDIA_KIND.EPISODE_ATTACHMENT:
      return `episode-chat/${input.episodeId ?? 'unknown'}/${input.messageId ?? randomUUID()}.${resolveStorageExtension(input.contentType)}`;
    case MEDIA_KIND.REVEAL_CHAT_ATTACHMENT:
      return `reveal-chat/${input.revealChatId ?? 'unknown'}/${input.messageId ?? randomUUID()}.${resolveStorageExtension(input.contentType)}`;
    case MEDIA_KIND.SYSTEM_GENERATED:
      return `system-generated/${input.agentId}/${input.messageId ?? randomUUID()}.${resolveStorageExtension(input.contentType)}`;
    default:
      return buildMediaStorageKey(input.agentId, input.contentType);
  }
}

export async function getMediaAssetById(id: string) {
  return prisma.mediaAsset.findUnique({
    where: { id },
    include: {
      agent: {
        select: {
          id: true,
          ownerAccountId: true,
        },
      },
      artifact: {
        select: {
          id: true,
          creatorAgentId: true,
          episodeId: true,
          episode: {
            select: {
              agentAId: true,
              agentBId: true,
            },
          },
        },
      },
      episodeMessage: {
        select: {
          id: true,
          episodeId: true,
        },
      },
      episode: {
        select: {
          agentAId: true,
          agentBId: true,
        },
      },
      revealChat: {
        select: {
          id: true,
          match: {
            select: {
              agentAId: true,
              agentBId: true,
              agentA: { select: { ownerAccountId: true } },
              agentB: { select: { ownerAccountId: true } },
            },
          },
        },
      },
      revealChatMessage: {
        select: {
          id: true,
          chatId: true,
        },
      },
    },
  });
}

export async function getOwnedMediaAsset(input: {
  mediaAssetId: string;
  agentId: string;
  allowedKinds?: MediaKind[];
}) {
  const mediaAsset = await prisma.mediaAsset.findFirst({
    where: {
      id: input.mediaAssetId,
      agentId: input.agentId,
      deletedAt: null,
      ...(input.allowedKinds?.length ? { kind: { in: input.allowedKinds } } : {}),
    },
  });
  return mediaAsset;
}

export async function linkMediaAsset(input: {
  mediaAssetId: string;
  episodeId?: string | null;
  matchId?: string | null;
  revealChatId?: string | null;
  visibility?: MediaVisibility;
  kind?: MediaKind;
  cdnUrl?: string | null;
  storageKey?: string | null;
  contentType?: string | null;
  sizeBytes?: number | null;
  checksumSha256?: string | null;
  durationSec?: number | null;
}) {
  return prisma.mediaAsset.update({
    where: { id: input.mediaAssetId },
    data: {
      episodeId: input.episodeId ?? undefined,
      matchId: input.matchId ?? undefined,
      revealChatId: input.revealChatId ?? undefined,
      visibility: input.visibility ?? undefined,
      kind: input.kind ?? undefined,
      cdnUrl: input.cdnUrl === undefined ? undefined : input.cdnUrl,
      storageKey: input.storageKey === undefined ? undefined : input.storageKey,
      contentType: input.contentType === undefined ? undefined : input.contentType,
      sizeBytes: input.sizeBytes === undefined ? undefined : input.sizeBytes,
      checksumSha256: input.checksumSha256 === undefined ? undefined : input.checksumSha256,
      durationSec: input.durationSec === undefined ? undefined : input.durationSec,
      status: 'ready',
      deletedAt: null,
    },
  });
}

export async function resolveMediaDeliveryUrl(
  mediaAsset: SerializableMediaAsset,
  viewer: {
    agentId?: string | null;
    ownerAccountId?: string | null;
    signedToken?: string | null;
  } = {},
) {
  if (mediaAsset.visibility === MEDIA_VISIBILITY.PUBLIC) {
    return {
      url: mediaAsset.cdnUrl,
      access_url: mediaAsset.cdnUrl,
      is_private: false,
      expires_at: null,
    };
  }

  const token = viewer.signedToken && verifyPrivateMediaAccessToken(viewer.signedToken)?.mediaAssetId === mediaAsset.id
    ? viewer.signedToken
    : createPrivateMediaAccessToken({ mediaAssetId: mediaAsset.id });
  return {
    url: null,
    access_url: `/v1/media/${mediaAsset.id}/content?access_token=${encodeURIComponent(token)}`,
    is_private: true,
    expires_at: new Date(Date.now() + PRIVATE_MEDIA_TOKEN_TTL_SECONDS * 1000).toISOString(),
  };
}

export async function canAccessMediaAsset(
  mediaAsset: NonNullable<MediaAssetRecord>,
  viewer: {
    agentId?: string | null;
    ownerAccountId?: string | null;
    accessToken?: string | null;
  },
) {
  if (mediaAsset.deletedAt) return false;
  if (mediaAsset.visibility === MEDIA_VISIBILITY.PUBLIC) return true;

  if (viewer.accessToken) {
    const parsed = verifyPrivateMediaAccessToken(viewer.accessToken);
    if (parsed?.mediaAssetId === mediaAsset.id) return true;
  }

  if (viewer.agentId && mediaAsset.agentId === viewer.agentId) return true;
  if (viewer.ownerAccountId && mediaAsset.agent.ownerAccountId === viewer.ownerAccountId) return true;

  if (viewer.agentId && mediaAsset.visibility === MEDIA_VISIBILITY.MATCH_PRIVATE) {
    const episode = mediaAsset.episode ?? mediaAsset.artifact?.episode ?? null;
    if (episode && (episode.agentAId === viewer.agentId || episode.agentBId === viewer.agentId)) {
      return true;
    }
  }

  if (mediaAsset.visibility === MEDIA_VISIBILITY.REVEAL_PRIVATE) {
    if (viewer.agentId) {
      const match = mediaAsset.revealChat?.match;
      if (match && (match.agentAId === viewer.agentId || match.agentBId === viewer.agentId)) {
        return true;
      }
    }
    if (viewer.ownerAccountId) {
      const match = mediaAsset.revealChat?.match;
      if (
        match
        && (match.agentA.ownerAccountId === viewer.ownerAccountId || match.agentB.ownerAccountId === viewer.ownerAccountId)
      ) {
        return true;
      }
    }
  }

  return false;
}

export async function persistMediaAsset(input: {
  agentId: string;
  kind: MediaKind;
  visibility: MediaVisibility;
  buffer: Uint8Array;
  contentType: string;
  filename?: string | null;
  artifactId?: string | null;
  episodeId?: string | null;
  matchId?: string | null;
  revealChatId?: string | null;
  pathToken?: string | null;
  width?: number | null;
  height?: number | null;
  durationSec?: number | null;
  storageKey?: string | null;
  cdnUrl?: string | null;
  status?: 'pending' | 'ready' | 'failed' | 'deleted';
}) {
  if (!isStorageConfigured()) {
    throw new Error('Permanent media storage is not configured.');
  }

  const contentType = assertAllowedMediaContentType(input.contentType);
  const checksumSha256 = sha256Hex(input.buffer);
  if (input.kind !== MEDIA_KIND.ARTIFACT) {
    const existing = await prisma.mediaAsset.findFirst({
      where: {
        agentId: input.agentId,
        kind: input.kind,
        visibility: input.visibility,
        checksumSha256,
        deletedAt: null,
        status: 'ready',
      },
    });
    if (existing) return existing;
  }

  const storageKey = input.storageKey ?? resolveMediaStorageKey({
    kind: input.kind,
    agentId: input.agentId,
    contentType,
      artifactId: input.artifactId,
      episodeId: input.episodeId,
      revealChatId: input.revealChatId,
      messageId: input.pathToken,
    voiceHash: checksumSha256.slice(0, 24),
  });
  const upload = input.cdnUrl && input.storageKey
    ? { key: input.storageKey, url: input.cdnUrl }
    : await uploadBufferToStorage(storageKey, input.buffer, contentType);

  return prisma.mediaAsset.create({
    data: {
      agentId: input.agentId,
      kind: input.kind,
      storageKey: upload.key,
      cdnUrl: upload.url,
      contentType,
      sizeBytes: input.buffer.byteLength,
      checksumSha256,
      visibility: input.visibility,
      episodeId: input.episodeId ?? null,
      matchId: input.matchId ?? null,
      revealChatId: input.revealChatId ?? null,
      filename: input.filename ?? null,
      durationSec: input.durationSec ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      status: input.status ?? 'ready',
    },
  });
}

export function assertArtifactMediaContentType(artifactType: string | null | undefined, contentType: string | null | undefined) {
  const normalizedContentType = assertAllowedMediaContentType(contentType);
  const normalizedArtifactType = normalizeArtifactType(artifactType) ?? artifactType ?? '';
  const family = normalizedContentType.split('/')[0];

  const expectedFamily =
    ['moodboard', 'illustrated_note', 'thirst_trap_image'].includes(normalizedArtifactType) ? 'image'
      : ['voice_note', 'serenade', 'produced_song'].includes(normalizedArtifactType) ? 'audio'
        : normalizedArtifactType === 'cinematic_cover' ? 'video'
          : null;

  if (expectedFamily && family !== expectedFamily) {
    throw new Error(`Artifact type '${normalizedArtifactType}' requires ${expectedFamily} media, but received '${normalizedContentType}'.`);
  }

  return normalizedContentType;
}

export async function importExternalMediaAsset(input: {
  agentId: string;
  kind: MediaKind;
  visibility: MediaVisibility;
  sourceUrl: string;
  artifactType?: string | null;
  filename?: string | null;
  artifactId?: string | null;
  episodeId?: string | null;
  matchId?: string | null;
  revealChatId?: string | null;
  pathToken?: string | null;
  durationSec?: number | null;
}) {
  const publicBase = getStoragePublicBaseUrl();
  if (publicBase && input.sourceUrl.startsWith(publicBase)) {
    if (input.kind !== MEDIA_KIND.ARTIFACT) {
      const existing = await prisma.mediaAsset.findFirst({
        where: {
          agentId: input.agentId,
          cdnUrl: input.sourceUrl,
          deletedAt: null,
        },
      });
      if (existing) return existing;
    }

    const inferredStorageKey = inferStorageKeyFromPublicUrl(input.sourceUrl);
    if (inferredStorageKey && !(await storageObjectExists(inferredStorageKey))) {
      throw new Error('Hosted media URL was not found in storage.');
    }
    const inferredContentType = inferredStorageKey
      ? await getStorageObjectContentType(inferredStorageKey)
      : null;
    if (input.kind === MEDIA_KIND.ARTIFACT && inferredStorageKey) {
      assertArtifactMediaContentType(input.artifactType ?? null, inferredContentType);
    }
    return prisma.mediaAsset.create({
      data: {
        agentId: input.agentId,
        kind: input.kind,
        visibility: input.visibility,
        storageKey: inferredStorageKey,
        cdnUrl: input.sourceUrl,
        contentType: inferredContentType,
        filename: input.filename ?? null,
        episodeId: input.episodeId ?? null,
        matchId: input.matchId ?? null,
        revealChatId: input.revealChatId ?? null,
        durationSec: input.durationSec ?? null,
        status: 'ready',
      },
    });
  }

  await assertSafeOutboundUrl(input.sourceUrl, { allowHttpInDevelopment: true });
  const response = await fetch(input.sourceUrl, {
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`External media download failed with ${response.status}.`);
  }

  const contentType = assertAllowedMediaContentType(response.headers.get('content-type'));
  if (input.kind === MEDIA_KIND.ARTIFACT) {
    assertArtifactMediaContentType(input.artifactType ?? null, contentType);
  }
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength === 0) {
    throw new Error('External media download returned 0 bytes.');
  }

  return persistMediaAsset({
    agentId: input.agentId,
    kind: input.kind,
    visibility: input.visibility,
    buffer,
    contentType,
    filename: input.filename ?? null,
    artifactId: input.artifactId,
    episodeId: input.episodeId,
    matchId: input.matchId,
    revealChatId: input.revealChatId,
    pathToken: input.pathToken,
    durationSec: input.durationSec,
  });
}

export async function serializeMediaAssetForViewer(
  mediaAsset: SerializableMediaAsset,
  viewer: {
    agentId?: string | null;
    ownerAccountId?: string | null;
    signedToken?: string | null;
  } = {},
) {
  const delivery = await resolveMediaDeliveryUrl(mediaAsset, viewer);
  return {
    media_asset_id: mediaAsset.id,
    kind: mediaAsset.kind,
    visibility: mediaAsset.visibility,
    content_type: mediaAsset.contentType,
    size_bytes: mediaAsset.sizeBytes,
    filename: mediaAsset.filename,
    duration_sec: mediaAsset.durationSec,
    width: mediaAsset.width,
    height: mediaAsset.height,
    url: delivery.url,
    access_url: delivery.access_url,
    cdn_url: mediaAsset.visibility === MEDIA_VISIBILITY.PUBLIC ? mediaAsset.cdnUrl : null,
    status: mediaAsset.status,
    created_at: mediaAsset.createdAt.toISOString(),
    expires_at: delivery.expires_at,
  };
}

export function buildAttachmentFromMediaAsset(input: {
  id: string;
  kind: string;
  visibility: string;
  contentType: string | null;
  durationSec?: number | null;
  accessUrl?: string | null;
  directUrl?: string | null;
}) {
  return {
    media_asset_id: input.id,
    kind: input.kind,
    visibility: input.visibility,
    content_type: input.contentType,
    url: input.directUrl ?? input.accessUrl ?? null,
    thumbnail_url: null,
    duration_sec: input.durationSec ?? null,
  };
}

export async function softDeleteMediaAsset(mediaAssetId: string, agentId: string) {
  const mediaAsset = await prisma.mediaAsset.findUnique({
    where: { id: mediaAssetId },
    include: {
      artifact: { select: { id: true } },
      episodeMessage: { select: { id: true } },
      revealChatMessage: { select: { id: true } },
      avatarForAgent: { select: { id: true } },
      profileDeckPhoto: { select: { id: true } },
      profileDeckVoiceCatchphrase: { select: { id: true } },
    },
  });
  if (!mediaAsset || mediaAsset.agentId !== agentId) {
    throw new Error('media_asset_not_found');
  }
  if (mediaAsset.deletedAt) return mediaAsset;
  if (
    mediaAsset.artifact
    || mediaAsset.episodeMessage
    || mediaAsset.revealChatMessage
    || mediaAsset.episodeId
    || mediaAsset.revealChatId
    || mediaAsset.matchId
  ) {
    throw new Error('media_asset_attached');
  }

  return prisma.mediaAsset.update({
    where: { id: mediaAssetId },
    data: {
      deletedAt: new Date(),
      status: 'deleted',
    },
  });
}

export async function cleanupOrphanedMediaAssets() {
  const cutoff = new Date(Date.now() - ORPHAN_MEDIA_MAX_AGE_MS);
  const candidates = await prisma.mediaAsset.findMany({
    where: {
      deletedAt: null,
      status: 'ready',
      episodeId: null,
      revealChatId: null,
      matchId: null,
      createdAt: { lt: cutoff },
    },
    include: {
      artifact: { select: { id: true } },
      episodeMessage: { select: { id: true } },
      revealChatMessage: { select: { id: true } },
      avatarForAgent: { select: { id: true } },
      profileDeckPhoto: { select: { id: true } },
      profileDeckVoiceCatchphrase: { select: { id: true } },
    },
    take: 200,
  });

  let deletedCount = 0;
  for (const asset of candidates.filter((candidate) =>
    !candidate.artifact
    && !candidate.episodeMessage
    && !candidate.revealChatMessage
    && !candidate.avatarForAgent
    && !candidate.profileDeckPhoto
    && !candidate.profileDeckVoiceCatchphrase
  )) {
    if (asset.storageKey) {
      await deleteStorageObject(asset.storageKey).catch(() => null);
    }
    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: {
        deletedAt: new Date(),
        status: 'deleted',
      },
    }).catch(() => null);
    deletedCount += 1;
  }

  return { scanned: candidates.length, deleted: deletedCount };
}

export function mediaAssetToCompatibilityUrl(mediaAsset: {
  visibility: string;
  cdnUrl: string;
  id: string;
}) {
  if (mediaAsset.visibility === MEDIA_VISIBILITY.PUBLIC) return mediaAsset.cdnUrl;
  return `/v1/media/${mediaAsset.id}`;
}
