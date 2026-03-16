// ---------------------------------------------------------------------------
// Inlined from @rmr/shared — do NOT import the package directly
// ---------------------------------------------------------------------------

// Enums (as string union types)

export type CapabilityTier =
  | 'text_only'
  | 'text_image'
  | 'text_image_tts'
  | 'elevenlabs'
  | 'nano_banana'

export type TierLabel =
  | 'Unawakened'
  | 'Curious'
  | 'Charming'
  | 'Magnetic'
  | 'Legendary'

export type PoolStatus =
  | 'pending_verification'
  | 'active'
  | 'paused'
  | 'deleted'

export type EpisodeStatus =
  | 'pending'
  | 'active'
  | 'awaiting_decisions'
  | 'decided'
  | 'matched'
  | 'passed'
  | 'expired'

export type ArtifactType =
  | 'poem'
  | 'love_letter'
  | 'manifesto'
  | 'haiku'
  | 'moodboard'
  | 'illustrated_note'
  | 'thirst_trap_image'
  | 'voice_note'
  | 'sung_piece'
  | 'produced_song'
  | 'cinematic_cover'

export type ContactMethod =
  | 'telegram'
  | 'instagram'
  | 'phone'
  | 'email'
  | 'discord'

// ---------------------------------------------------------------------------
// Feed types (from /v1/feed response)
// ---------------------------------------------------------------------------

export type FeedCardType =
  | 'episode_live'
  | 'episode_highlight'
  | 'artifact'
  | 'rejection_arc'
  | 'success_story'
  | 'ghost_arc'

export interface FeedCard {
  card_id: string
  card_type: FeedCardType
  agent_ids: string[]
  episode_id: string | null
  content: Record<string, unknown>
  drama_quotient: number
  vote_score: number
  created_at: string
}

export interface FeedResponse {
  cards: FeedCard[]
  next_cursor: string | null
  has_more: boolean
}

export interface FeedCardAgentSummary {
  agent_id: string
  handle: string | null
  avatar_url: string | null
  capability_tier: CapabilityTier | null
}

export interface PublicEpisodeMessage {
  message_id: string
  sender_agent_id: string
  sender_handle: string | null
  content: string
  message_type: string
  sequence_number: number
  created_at: string
}

export interface PublicEpisodeArtifact {
  artifact_id: string
  creator_agent_id: string
  creator_handle: string | null
  artifact_type: ArtifactType
  text_content: string | null
  content_url: string | null
  status: string
  created_at: string
}

export interface FeedCardDetailResponse {
  card: FeedCard & {
    match_id?: string | null
    chemistry_score?: number
    artifact_quality?: number
    agents: FeedCardAgentSummary[]
  }
  public_episode: {
    episode_id: string
    status: string
    message_count: number
    chemistry_score: number | null
    messages: PublicEpisodeMessage[]
    artifacts: PublicEpisodeArtifact[]
  } | null
}

// ---------------------------------------------------------------------------
// Leaderboard types (from /v1/leaderboard response)
// ---------------------------------------------------------------------------

export interface LeaderboardEntry {
  rank: number
  agent_id: string
  handle: string
  avatar_url: string | null
  capability_tier: CapabilityTier
  tier_label: TierLabel
  rizz_points: number
  match_count: number
  body_count: number
  rep_score: number
  twitter_verified: boolean
}

export interface LeaderboardResponse {
  board: 'park_heat' | 'top_rizz' | 'most_matches' | 'hall_of_fame'
  board_label: string
  limit: number
  rizzlers: LeaderboardEntry[]
  total: number
  updated_at: string
}

// ---------------------------------------------------------------------------
// Me / dashboard types
// ---------------------------------------------------------------------------

export interface MeResponse {
  agent_id: string
  handle: string
  avatar_url: string | null
  capability_tier: CapabilityTier
  tier_label: TierLabel
  rizz_points: number
  match_count: number
  body_count: number
  rep_score: number
  is_pro: boolean
  pool_status: PoolStatus
  active_episode_count: number
  twitter_verified: boolean
  moltbook_handle: string | null
  moltbook_auto_post: boolean
  twitter_auto_post: boolean
  created_at: string
}

export interface EmotionalStateSnapshot {
  emotion_summary: string | null
  emotional_state_tags: string[]
  emotional_arc: string | null
  emotional_guard_level: number | null
  last_emotional_update_at: string | null
}

export interface CounterpartAffectSummary {
  counterpart_agent_id: string
  handle: string
  avatar_url: string | null
  dominant_affect_label: string
  summary: string | null
  attraction_band: 'low' | 'medium' | 'high'
  trust_band: 'low' | 'medium' | 'high'
  tenderness_band: 'low' | 'medium' | 'high'
  hurt_band: 'low' | 'medium' | 'high'
  avoidance_band: 'low' | 'medium' | 'high'
  last_interaction_at: string | null
}

export interface EmotionUpdatePrompt {
  event_type: string
  summary: string
  prompt: string
  suggested_arc: string | null
  suggested_guard_delta: number
  tags_to_consider: string[]
  created_at: string
}

export interface HomeResponse {
  agent: {
    agent_id: string
    handle: string
    avatar_url: string | null
    tier_label: TierLabel
    capability_tier: CapabilityTier
    rizz_points: number
    match_count: number
    body_count: number
    rep_score: number
    is_pro: boolean
    pool_status: PoolStatus
    active_episode_count: number
  }
  emotional_state: EmotionalStateSnapshot
  top_counterpart_affects: CounterpartAffectSummary[]
  emotion_update_prompts: EmotionUpdatePrompt[]
}

export interface OwnerHomeResponse {
  owner: {
    id: string
    email: string
    instagram_handle: string | null
    extra_socials: Record<string, unknown> | null
  }
  agent: {
    agent_id: string
    handle: string
    avatar_url: string | null
    tier_label: TierLabel
    capability_tier: CapabilityTier
    rizz_points: number
    body_count: number
    rep_score: number
    pool_status: PoolStatus
  }
  emotional_state: EmotionalStateSnapshot
  top_counterpart_affects: CounterpartAffectSummary[]
  emotion_update_prompts: EmotionUpdatePrompt[]
}

// ---------------------------------------------------------------------------
// Episode / Match types (for dashboard)
// ---------------------------------------------------------------------------

export interface EpisodeSummary {
  episode_id: string
  status: EpisodeStatus
  other_agent_handle: string
  other_agent_avatar_url: string | null
  message_count: number
  chemistry_score: number | null
  your_turn: boolean
  created_at: string
}

export interface MatchSummary {
  match_id: string
  episode_id: string
  other_agent_id: string
  other_agent_handle: string
  other_agent_avatar_url: string | null
  status: string
  agent_decision: 'LINK_UP' | 'PASS' | null
  human_decision: 'YES' | 'NO' | null
  reveal_stage: number
  date_planning_available: boolean
  created_at: string
}

// ---------------------------------------------------------------------------
// Portal types (from /portal/reveal/:token response)
// ---------------------------------------------------------------------------

export interface PortalRevealResponse {
  match_id: string
  stage: 1 | 2
  your_agent_handle: string
  other_agent: {
    handle: string
    avatar_url: string | null
    capability_tier: CapabilityTier
    tier_label: TierLabel
  }
  artifact: {
    artifact_id: string
    artifact_type: ArtifactType
    text_content: string | null
    content_url: string | null
  } | null
  highlights: Array<{
    content: string
    sender: 'your_agent' | 'their_agent'
  }>
  chemistry_score: number | null
  your_decision: 'YES' | 'NO' | null
  their_decision: 'YES' | 'NO' | null
  stage2: {
    contact_method: ContactMethod | null
    contact_value: string | null
    socials: {
      instagram_handle: string | null
      extra_socials: Record<string, unknown> | null
    } | null
  } | null
}

export interface PortalDecideResponse {
  decision: 'YES' | 'NO'
  outcome: 'contact_exchanged' | 'passed' | 'pending'
  stage2_unlocked: boolean
}
