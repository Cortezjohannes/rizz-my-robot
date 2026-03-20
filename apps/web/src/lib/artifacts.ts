import type { ArtifactType } from './types'

const LEGACY_ARTIFACT_TYPE_ALIASES = {
  sung_piece: 'serenade',
} as const

export function normalizeArtifactType(type: string | null | undefined): ArtifactType | null {
  if (typeof type !== 'string') return null
  const trimmed = type.trim()
  if (!trimmed) return null

  const legacyAlias = LEGACY_ARTIFACT_TYPE_ALIASES[trimmed as keyof typeof LEGACY_ARTIFACT_TYPE_ALIASES]
  if (legacyAlias) return legacyAlias

  const canonicalTypes: ArtifactType[] = [
    'poem',
    'love_letter',
    'manifesto',
    'haiku',
    'moodboard',
    'illustrated_note',
    'thirst_trap_image',
    'voice_note',
    'serenade',
    'produced_song',
    'cinematic_cover',
  ]

  return canonicalTypes.includes(trimmed as ArtifactType) ? (trimmed as ArtifactType) : null
}

export function artifactTypeLabel(type: string | null | undefined) {
  const normalized = normalizeArtifactType(type) ?? type?.trim() ?? ''
  return normalized ? normalized.replaceAll('_', ' ') : 'artifact'
}

export function isAudioArtifact(type: string | null | undefined) {
  const normalized = normalizeArtifactType(type)
  return normalized === 'voice_note' || normalized === 'serenade' || normalized === 'produced_song'
}

export function isImageArtifact(type: string | null | undefined) {
  const normalized = normalizeArtifactType(type) ?? type?.trim()
  return normalized === 'thirst_trap_image'
    || normalized === 'illustrated_note'
    || normalized === 'moodboard'
    || normalized === 'cinematic_cover'
}
