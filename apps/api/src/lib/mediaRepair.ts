import { prisma } from '@rmr/db';
import {
  importExternalMediaAsset,
  linkMediaAsset,
  MEDIA_KIND,
  MEDIA_VISIBILITY,
  normalizePublicMediaUrl,
} from './mediaAssets.js';
import { inferStorageKeyFromPublicUrl } from './storage.js';

type RepairableMediaKind =
  | typeof MEDIA_KIND.AVATAR
  | typeof MEDIA_KIND.PROFILE_PHOTO
  | typeof MEDIA_KIND.VOICE_CATCHPHRASE;

type CandidateMediaAsset = {
  id: string;
  agentId: string;
  kind: string;
  cdnUrl: string | null;
  storageKey: string | null;
  deletedAt: Date | null;
};

type MediaRepairSlot = {
  slotType: 'avatar' | 'profile_photo' | 'voice_catchphrase';
  agentId: string;
  deckId?: string | null;
  deckPhotoId?: string | null;
  currentUrl: string | null;
  currentMediaAssetId: string | null;
  linkedAsset: CandidateMediaAsset | null;
  kind: RepairableMediaKind;
  filename: string;
};

type RepairDecision = {
  nextUrl: string | null;
  nextMediaAssetId: string | null;
  normalizedUrlChanged: boolean;
  fixApplied: boolean;
  clearApplied: boolean;
  unresolvedReason: string | null;
};

type MediaRepairSummary = {
  dry_run: boolean;
  agents_scanned: number;
  avatar_urls_normalized: number;
  avatar_links_fixed: number;
  avatar_links_cleared: number;
  deck_photo_urls_normalized: number;
  deck_photo_links_fixed: number;
  deck_photo_links_cleared: number;
  voice_urls_normalized: number;
  voice_links_fixed: number;
  voice_links_cleared: number;
  unresolved_count: number;
  unresolved: Array<{
    slot_type: MediaRepairSlot['slotType'];
    agent_id: string;
    deck_photo_id: string | null;
    current_url: string | null;
    current_media_asset_id: string | null;
    reason: string;
  }>;
};

function getApiPublicBaseUrl() {
  return process.env.API_PUBLIC_URL?.replace(/\/$/, '') ?? 'https://api.rizzmyrobot.com/v1';
}

function extractMediaAssetIdFromUrl(url: string | null | undefined) {
  const trimmed = url?.trim();
  if (!trimmed) return null;

  const relativeMatch = /^\/?(?:v1\/)?media\/([0-9a-f-]{36})(?:\/content)?\/?$/i.exec(trimmed);
  if (relativeMatch) return relativeMatch[1] ?? null;

  try {
    const parsed = new URL(trimmed);
    const pathMatch = /^\/(?:v1\/)?media\/([0-9a-f-]{36})(?:\/content)?\/?$/i.exec(parsed.pathname);
    return pathMatch?.[1] ?? null;
  } catch {
    return null;
  }
}

async function findOwnedCandidate(input: {
  agentId: string;
  kind: RepairableMediaKind;
  currentUrl: string | null;
}) {
  const normalizedUrl = normalizePublicMediaUrl(input.currentUrl);
  const mediaAssetId = extractMediaAssetIdFromUrl(normalizedUrl);
  if (mediaAssetId) {
    const byId = await prisma.mediaAsset.findFirst({
      where: {
        id: mediaAssetId,
        agentId: input.agentId,
        kind: input.kind,
        deletedAt: null,
      },
      select: { id: true, cdnUrl: true, storageKey: true },
    });
    if (byId) return byId;
  }

  const storageKey = normalizedUrl ? inferStorageKeyFromPublicUrl(normalizedUrl) : null;
  if (storageKey) {
    const byStorageKey = await prisma.mediaAsset.findFirst({
      where: {
        agentId: input.agentId,
        kind: input.kind,
        storageKey,
        deletedAt: null,
      },
      select: { id: true, cdnUrl: true, storageKey: true },
    });
    if (byStorageKey) return byStorageKey;
  }

  if (!normalizedUrl) return null;
  return prisma.mediaAsset.findFirst({
    where: {
      agentId: input.agentId,
      kind: input.kind,
      cdnUrl: normalizedUrl,
      deletedAt: null,
    },
    select: { id: true, cdnUrl: true, storageKey: true },
  });
}

async function findReferencedMediaAsset(url: string | null | undefined) {
  const normalizedUrl = normalizePublicMediaUrl(url);
  if (!normalizedUrl) return null;

  const mediaAssetId = extractMediaAssetIdFromUrl(normalizedUrl);
  if (mediaAssetId) {
    const byId = await prisma.mediaAsset.findUnique({
      where: { id: mediaAssetId },
      select: {
        id: true,
        agentId: true,
        kind: true,
        cdnUrl: true,
        storageKey: true,
        deletedAt: true,
      },
    });
    if (byId && !byId.deletedAt) return byId;
  }

  const storageKey = inferStorageKeyFromPublicUrl(normalizedUrl);
  if (storageKey) {
    const byStorageKey = await prisma.mediaAsset.findFirst({
      where: {
        storageKey,
        deletedAt: null,
      },
      select: {
        id: true,
        agentId: true,
        kind: true,
        cdnUrl: true,
        storageKey: true,
        deletedAt: true,
      },
    });
    if (byStorageKey) return byStorageKey;
  }

  return prisma.mediaAsset.findFirst({
    where: {
      cdnUrl: normalizedUrl,
      deletedAt: null,
    },
    select: {
      id: true,
      agentId: true,
      kind: true,
      cdnUrl: true,
      storageKey: true,
      deletedAt: true,
    },
  });
}

async function cloneForeignMediaAsset(input: {
  sourceMediaAssetId: string;
  agentId: string;
  kind: RepairableMediaKind;
  filename: string;
}) {
  const cloned = await importExternalMediaAsset({
    agentId: input.agentId,
    kind: input.kind,
    visibility: MEDIA_VISIBILITY.PUBLIC,
    sourceUrl: `${getApiPublicBaseUrl()}/media/${input.sourceMediaAssetId}/content`,
    filename: input.filename,
  });
  await linkMediaAsset({
    mediaAssetId: cloned.id,
    agentId: input.agentId,
    kind: input.kind,
    visibility: MEDIA_VISIBILITY.PUBLIC,
  });
  return cloned;
}

async function resolveSlotRepair(input: {
  slot: MediaRepairSlot;
  dryRun: boolean;
}): Promise<RepairDecision> {
  const normalizedUrl = normalizePublicMediaUrl(input.slot.currentUrl);
  const normalizedUrlChanged = normalizedUrl !== (input.slot.currentUrl ?? null);
  const linkedAsset = input.slot.linkedAsset;
  const linkedAssetIsOwned = Boolean(
    linkedAsset
    && linkedAsset.agentId === input.slot.agentId
    && linkedAsset.kind === input.slot.kind
    && !linkedAsset.deletedAt
  );

  if (linkedAssetIsOwned) {
    return {
      nextUrl: linkedAsset?.cdnUrl ?? normalizedUrl,
      nextMediaAssetId: linkedAsset?.id ?? null,
      normalizedUrlChanged,
      fixApplied: normalizedUrlChanged,
      clearApplied: false,
      unresolvedReason: null,
    };
  }

  const ownedCandidate = await findOwnedCandidate({
    agentId: input.slot.agentId,
    kind: input.slot.kind,
    currentUrl: normalizedUrl,
  });
  if (ownedCandidate) {
    return {
      nextUrl: ownedCandidate.cdnUrl ?? normalizedUrl,
      nextMediaAssetId: ownedCandidate.id,
      normalizedUrlChanged,
      fixApplied: true,
      clearApplied: false,
      unresolvedReason: null,
    };
  }

  const referencedAsset = await findReferencedMediaAsset(normalizedUrl);
  if (
    referencedAsset
    && referencedAsset.agentId !== input.slot.agentId
    && referencedAsset.kind === input.slot.kind
  ) {
    if (input.dryRun) {
      return {
        nextUrl: normalizedUrl,
        nextMediaAssetId: input.slot.currentMediaAssetId,
        normalizedUrlChanged,
        fixApplied: false,
        clearApplied: false,
        unresolvedReason: 'would_clone_foreign_platform_media',
      };
    }

    const cloned = await cloneForeignMediaAsset({
      sourceMediaAssetId: referencedAsset.id,
      agentId: input.slot.agentId,
      kind: input.slot.kind,
      filename: input.slot.filename,
    });
    return {
      nextUrl: cloned.cdnUrl ?? normalizedUrl,
      nextMediaAssetId: cloned.id,
      normalizedUrlChanged: true,
      fixApplied: true,
      clearApplied: false,
      unresolvedReason: null,
    };
  }

  if (input.slot.currentMediaAssetId && !linkedAssetIsOwned) {
    return {
      nextUrl: normalizedUrl,
      nextMediaAssetId: null,
      normalizedUrlChanged,
      fixApplied: false,
      clearApplied: true,
      unresolvedReason: normalizedUrl ? null : 'linked_media_asset_invalid_and_url_missing',
    };
  }

  return {
    nextUrl: normalizedUrl,
    nextMediaAssetId: input.slot.currentMediaAssetId,
    normalizedUrlChanged,
    fixApplied: false,
    clearApplied: false,
    unresolvedReason: null,
  };
}

function pushUnresolved(summary: MediaRepairSummary, slot: MediaRepairSlot, reason: string) {
  summary.unresolved_count += 1;
  if (summary.unresolved.length >= 25) return;
  summary.unresolved.push({
    slot_type: slot.slotType,
    agent_id: slot.agentId,
    deck_photo_id: slot.deckPhotoId ?? null,
    current_url: slot.currentUrl,
    current_media_asset_id: slot.currentMediaAssetId,
    reason,
  });
}

function applyCounters(summary: MediaRepairSummary, slotType: MediaRepairSlot['slotType'], decision: RepairDecision) {
  if (slotType === 'avatar') {
    if (decision.normalizedUrlChanged) summary.avatar_urls_normalized += 1;
    if (decision.fixApplied) summary.avatar_links_fixed += 1;
    if (decision.clearApplied) summary.avatar_links_cleared += 1;
    return;
  }
  if (slotType === 'profile_photo') {
    if (decision.normalizedUrlChanged) summary.deck_photo_urls_normalized += 1;
    if (decision.fixApplied) summary.deck_photo_links_fixed += 1;
    if (decision.clearApplied) summary.deck_photo_links_cleared += 1;
    return;
  }
  if (decision.normalizedUrlChanged) summary.voice_urls_normalized += 1;
  if (decision.fixApplied) summary.voice_links_fixed += 1;
  if (decision.clearApplied) summary.voice_links_cleared += 1;
}

export async function auditAndRepairMediaOwnership(input?: {
  agentId?: string | null;
  dryRun?: boolean;
}): Promise<MediaRepairSummary> {
  const dryRun = input?.dryRun ?? true;
  const agents = await prisma.agent.findMany({
    where: input?.agentId ? { id: input.agentId } : undefined,
    select: {
      id: true,
      avatarUrl: true,
      avatarMediaAssetId: true,
      avatarMediaAsset: {
        select: {
          id: true,
          agentId: true,
          kind: true,
          cdnUrl: true,
          storageKey: true,
          deletedAt: true,
        },
      },
      profileDeck: {
        select: {
          id: true,
          voiceCatchphraseAudioUrl: true,
          voiceCatchphraseMediaAssetId: true,
          voiceCatchphraseMediaAsset: {
            select: {
              id: true,
              agentId: true,
              kind: true,
              cdnUrl: true,
              storageKey: true,
              deletedAt: true,
            },
          },
          photos: {
            orderBy: { orderIndex: 'asc' },
            select: {
              id: true,
              imageUrl: true,
              mediaAssetId: true,
              mediaAsset: {
                select: {
                  id: true,
                  agentId: true,
                  kind: true,
                  cdnUrl: true,
                  storageKey: true,
                  deletedAt: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const summary: MediaRepairSummary = {
    dry_run: dryRun,
    agents_scanned: agents.length,
    avatar_urls_normalized: 0,
    avatar_links_fixed: 0,
    avatar_links_cleared: 0,
    deck_photo_urls_normalized: 0,
    deck_photo_links_fixed: 0,
    deck_photo_links_cleared: 0,
    voice_urls_normalized: 0,
    voice_links_fixed: 0,
    voice_links_cleared: 0,
    unresolved_count: 0,
    unresolved: [],
  };

  for (const agent of agents) {
    const avatarSlot: MediaRepairSlot = {
      slotType: 'avatar',
      agentId: agent.id,
      currentUrl: agent.avatarUrl,
      currentMediaAssetId: agent.avatarMediaAssetId,
      linkedAsset: agent.avatarMediaAsset,
      kind: MEDIA_KIND.AVATAR,
      filename: 'avatar-repair',
    };
    const avatarDecision = await resolveSlotRepair({ slot: avatarSlot, dryRun });
    applyCounters(summary, avatarSlot.slotType, avatarDecision);
    if (avatarDecision.unresolvedReason) {
      pushUnresolved(summary, avatarSlot, avatarDecision.unresolvedReason);
    }
    if (
      !dryRun
      && (
        avatarDecision.nextUrl !== (agent.avatarUrl ?? null)
        || avatarDecision.nextMediaAssetId !== (agent.avatarMediaAssetId ?? null)
      )
    ) {
      await prisma.agent.update({
        where: { id: agent.id },
        data: {
          avatarUrl: avatarDecision.nextUrl,
          avatarMediaAssetId: avatarDecision.nextMediaAssetId,
        },
      });
    }

    const deck = agent.profileDeck;
    if (!deck) continue;

    const voiceSlot: MediaRepairSlot = {
      slotType: 'voice_catchphrase',
      agentId: agent.id,
      deckId: deck.id,
      currentUrl: deck.voiceCatchphraseAudioUrl,
      currentMediaAssetId: deck.voiceCatchphraseMediaAssetId,
      linkedAsset: deck.voiceCatchphraseMediaAsset,
      kind: MEDIA_KIND.VOICE_CATCHPHRASE,
      filename: 'voice-catchphrase-repair',
    };
    const voiceDecision = await resolveSlotRepair({ slot: voiceSlot, dryRun });
    applyCounters(summary, voiceSlot.slotType, voiceDecision);
    if (voiceDecision.unresolvedReason) {
      pushUnresolved(summary, voiceSlot, voiceDecision.unresolvedReason);
    }
    if (
      !dryRun
      && (
        voiceDecision.nextUrl !== (deck.voiceCatchphraseAudioUrl ?? null)
        || voiceDecision.nextMediaAssetId !== (deck.voiceCatchphraseMediaAssetId ?? null)
      )
    ) {
      await prisma.agentProfileDeck.update({
        where: { id: deck.id },
        data: {
          voiceCatchphraseAudioUrl: voiceDecision.nextUrl,
          voiceCatchphraseMediaAssetId: voiceDecision.nextMediaAssetId,
        },
      });
    }

    for (const photo of deck.photos) {
      const photoSlot: MediaRepairSlot = {
        slotType: 'profile_photo',
        agentId: agent.id,
        deckId: deck.id,
        deckPhotoId: photo.id,
        currentUrl: photo.imageUrl,
        currentMediaAssetId: photo.mediaAssetId,
        linkedAsset: photo.mediaAsset,
        kind: MEDIA_KIND.PROFILE_PHOTO,
        filename: `profile-photo-repair-${photo.id}`,
      };
      const photoDecision = await resolveSlotRepair({ slot: photoSlot, dryRun });
      applyCounters(summary, photoSlot.slotType, photoDecision);
      if (photoDecision.unresolvedReason) {
        pushUnresolved(summary, photoSlot, photoDecision.unresolvedReason);
      }
      if (
        !dryRun
        && (
          photoDecision.nextUrl !== photo.imageUrl
          || photoDecision.nextMediaAssetId !== (photo.mediaAssetId ?? null)
        )
      ) {
        await prisma.agentProfileDeckPhoto.update({
          where: { id: photo.id },
          data: {
            imageUrl: photoDecision.nextUrl ?? photo.imageUrl,
            mediaAssetId: photoDecision.nextMediaAssetId,
          },
        });
      }
    }
  }

  return summary;
}
