import type { CandidateProfile, ProfileDeckMode, PublicPoolAgentPreview } from '@/lib/types'

export interface AuthenticatedCandidatesResponse {
  candidates: CandidateProfile[]
  has_more?: boolean
  page?: number
  pages?: number
  total?: number
}

export interface SwipeCandidatePreview {
  agent_id: string
  handle: string
  display_name: string | null
  hero_photo_url: string | null
}

export interface SwipeCandidate {
  id: string
  candidate_id: string
  source: 'authenticated' | 'public'
  read_only: boolean
  preview: SwipeCandidatePreview
  peek_profile: PublicPoolAgentPreview
  profile_deck_path: string
}

function encodePathValue(value: string): string {
  return encodeURIComponent(value.replace(/^@/, ''))
}

function defaultProfileMode(mode?: ProfileDeckMode): ProfileDeckMode {
  return mode ?? 'playful'
}

function mapDeckPreviewToPoolPreview(candidate: CandidateProfile): PublicPoolAgentPreview {
  const deck = candidate.profile_deck_preview
  const publicCard = candidate.public_card

  return {
    agent_id: candidate.agent_id,
    handle: candidate.handle,
    display_name: deck?.display_name ?? null,
    hero_photo_url: deck?.hero_photo_url ?? candidate.avatar_url ?? null,
    profile_mode: defaultProfileMode(deck?.profile_mode),
    hero_bio: deck?.hero_bio ?? publicCard.public_summary ?? '',
    interests: deck?.interests ?? publicCard.vibe_tags ?? [],
    values: deck?.values ?? [],
    standout_prompt: deck?.top_prompt_answers?.[0] ?? null,
    reply_hook: deck?.reply_hooks?.[0] ?? null,
    quality_score: 0,
  }
}

export function mapAuthenticatedCandidateToSwipeCandidate(candidate: CandidateProfile): SwipeCandidate {
  const peekProfile = mapDeckPreviewToPoolPreview(candidate)

  return {
    id: candidate.agent_id,
    candidate_id: candidate.candidate_id ?? candidate.agent_id,
    source: 'authenticated',
    read_only: false,
    preview: {
      agent_id: candidate.agent_id,
      handle: candidate.handle,
      display_name: peekProfile.display_name,
      hero_photo_url: peekProfile.hero_photo_url,
    },
    peek_profile: peekProfile,
    profile_deck_path: `/candidates/${encodePathValue(candidate.agent_id)}/profile-deck`,
  }
}

export function mapPublicPoolAgentToSwipeCandidate(agent: PublicPoolAgentPreview): SwipeCandidate {
  return {
    id: agent.agent_id,
    candidate_id: agent.agent_id,
    source: 'public',
    read_only: true,
    preview: {
      agent_id: agent.agent_id,
      handle: agent.handle,
      display_name: agent.display_name,
      hero_photo_url: agent.hero_photo_url,
    },
    peek_profile: agent,
    profile_deck_path: `/agents/${encodePathValue(agent.handle)}/profile-deck`,
  }
}

export function mapAuthenticatedCandidates(candidates: CandidateProfile[]): SwipeCandidate[] {
  return candidates.map(mapAuthenticatedCandidateToSwipeCandidate)
}

export function mapPublicPoolAgents(agents: PublicPoolAgentPreview[]): SwipeCandidate[] {
  return agents.map(mapPublicPoolAgentToSwipeCandidate)
}
