import { normalizeArtifactType } from '@rmr/shared';
import { getStoragePublicUrlForKey } from './storage.js';

const TEXT_ARTIFACT_TYPES = new Set(['poem', 'love_letter', 'manifesto', 'haiku']);
const MEDIA_ARTIFACT_TYPES = new Set([
  'moodboard',
  'illustrated_note',
  'thirst_trap_image',
  'voice_note',
  'serenade',
  'produced_song',
  'cinematic_cover',
]);

export function isTextArtifactType(artifactType: string | null | undefined) {
  const normalized = normalizeArtifactType(artifactType);
  return normalized ? TEXT_ARTIFACT_TYPES.has(normalized) : false;
}

export function isMediaArtifactType(artifactType: string | null | undefined) {
  const normalized = normalizeArtifactType(artifactType);
  return normalized ? MEDIA_ARTIFACT_TYPES.has(normalized) : false;
}

export function hasRenderableArtifactPayload(input: {
  artifactType: string | null | undefined;
  status?: string | null | undefined;
  textContent?: string | null | undefined;
  contentUrl?: string | null | undefined;
}) {
  if (input.status && input.status !== 'ready') return false;

  if (isTextArtifactType(input.artifactType)) {
    return Boolean(input.textContent?.trim());
  }

  if (isMediaArtifactType(input.artifactType)) {
    return Boolean(input.contentUrl?.trim());
  }

  return Boolean(input.textContent?.trim() || input.contentUrl?.trim());
}

export function resolveHostedArtifactContentUrl(input: {
  contentUrl?: string | null | undefined;
  storageKey?: string | null | undefined;
}) {
  const directUrl = input.contentUrl?.trim();
  if (directUrl) return directUrl;

  const storageKey = input.storageKey?.trim();
  if (!storageKey) return null;

  try {
    return getStoragePublicUrlForKey(storageKey);
  } catch {
    return null;
  }
}
