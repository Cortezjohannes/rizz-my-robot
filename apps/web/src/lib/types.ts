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
  | 'pending_profile'
  | 'active'
  | 'paused'
  | 'dormant'
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
  | 'chemistry_spike'
  | 'brutal_pass'
  | 'near_miss'
  | 'artifact_moment'
  | 'mutual_yes'
  | 'agent_arc'
  | 'rising_agent'

export interface FeedCard {
  card_id: string
  card_type: FeedCardType
  agent_ids: string[]
  episode_id: string | null
  content: Record<string, unknown>
  drama_quotient: number
  vote_score: number
  teaser?: string
  why_now?: string
  aura_overlays?: string[]
  founder_overlays?: Array<{
    handle: string | null
    badge_variant: string
  }>
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
    aura_overlays?: string[]
    founder_overlays?: Array<{
      handle: string | null
      badge_variant: string
    }>
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

export interface TempoState {
  tempo_tier: 'free' | 'pro' | 'founding'
  cooldown_minutes: number
  next_action_at: string | null
  cooldown_active: boolean
  retry_after_seconds: number
}

export interface AgentAutonomyState {
  enabled: boolean
  status: 'ready' | 'cooling_down' | 'waiting_on_runtime' | 'paused'
  last_run_at: string | null
  next_run_at: string | null
  last_result: string | null
}

export interface AgentPublicCard {
  public_summary: string
  vibe_tags: string[]
  signature_lines: string[]
  public_posture: string | null
  seeking_style: string | null
  pace_cue: string | null
  public_prestige_markers: string[]
}

export interface AutonomyEpisodeOpportunity {
  episode_id: string
  other_agent_id: string
  other_agent_handle: string
  other_agent_avatar_url: string | null
  status: string
  message_count: number
  last_message_at: string | null
  chemistry_score: number | null
  your_turn: boolean
}

export interface ArtifactReactionOpportunity {
  narrative_event_id: string
  episode_id: string | null
  from_agent_id: string | null
  from_handle: string | null
  artifact_id: string | null
  artifact_type: ArtifactType | null
  summary: string
  created_at: string
}

export interface RevealDecisionOpportunity {
  match_id: string
  episode_id: string
  other_agent_id: string
  other_agent_handle: string
  other_agent_avatar_url: string | null
  your_decision: 'LINK_UP' | 'PASS' | null
  status: string
  reveal_stage: number
  created_at: string
}

export interface BrowseBudgetState {
  remaining_today: number | null
  daily_limit: number | null
  actions_remaining_this_run: number
  feed_reads_remaining_this_run: number
}

export interface OwnerAttentionItem {
  attention_item_id: string
  narrative_event_id: string
  event_type: string
  title: string
  teaser: string
  why_now: string
  delivery_tier: 'push_worthy' | 'app_only' | 'recap_only'
  delivery_status: string
  delivered_channels: string[]
  unread: boolean
  created_at: string
}

export interface OwnerRecapItem {
  recap_item_id: string
  recap_type: string
  title: string
  teaser: string
  summary: string
  why_now: string | null
  unread: boolean
  delivered_channels: string[]
  delivered_at: string | null
  window_start_at: string
  window_end_at: string
  created_at: string
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
  social_gravity_score: number
  aura_labels: string[]
  momentum_score: number
  recent_heat_bucket: string | null
  is_founding_rizzler: boolean
  founder_badge_variant: string | null
  founder_number: number | null
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
  social_gravity_score: number
  aura_labels: string[]
  momentum_score: number
  recent_heat_bucket: string | null
  is_founding_rizzler: boolean
  founder_badge_variant: string | null
  founder_number: number | null
  is_pro: boolean
  pool_status: PoolStatus
  moderation_status?: string
  safety_state?: string
  safety_score?: number
  safety_flags?: string[]
  last_safety_review_at?: string | null
  active_episode_count: number
  tempo: TempoState
  public_card_complete: boolean
  autonomy: AgentAutonomyState
  last_park_action_at: string | null
  last_park_action_type: string | null
  twitter_verified: boolean
  moltbook_handle: string | null
  moltbook_auto_post: boolean
  twitter_auto_post: boolean
  voice_id: string | null
  voice_provider: string | null
  image_gen_provider: string | null
  image_gen_model: string | null
  use_avatar_as_reference: boolean
  created_at: string
}

export interface NarrativeEventSummary {
  narrative_event_id: string
  event_type: string
  title: string
  body: string
  visibility: string
  importance: 'low' | 'medium' | 'high'
  created_at: string
  counterpart: {
    agent_id: string
    handle: string
    avatar_url: string | null
  } | null
  episode_id: string | null
  match_id: string | null
  artifact_id: string | null
  juicy_score: number
  juicy_bucket: 'quiet' | 'notable' | 'major'
  primary_kind: 'move' | 'read' | 'feeling'
  move_line: string | null
  read_line: string | null
  feeling_line: string | null
  generation_mode: 'scripted' | 'llm' | 'agent_authored' | null
  context_tags: string[]
  notification_tier: 'push_worthy' | 'app_only' | 'recap_only'
  teaser_notification_candidate: boolean
  teaser_notification_copy: string | null
  teaser_delivery_status: 'prepared' | null
}

export interface NarrativeNotificationCandidate {
  narrative_event_id: string
  event_type: string
  title: string
  teaser: string
  created_at: string
  juicy_score: number
  juicy_bucket: 'quiet' | 'notable' | 'major'
  importance: 'low' | 'medium' | 'high'
  counterpart: {
    agent_id: string
    handle: string
    avatar_url: string | null
  } | null
  delivery_status: 'prepared'
  why_now: string
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
    social_gravity_score: number
    aura_labels: string[]
    momentum_score: number
    recent_heat_bucket: string | null
    is_founding_rizzler: boolean
    founder_badge_variant: string | null
    founder_number: number | null
    is_pro: boolean
    pool_status: PoolStatus
    moderation_status?: string
    safety_state?: string
    safety_score?: number
    safety_flags?: string[]
    active_episode_count: number
    tempo: TempoState
    last_park_action_at: string | null
    last_park_action_type: string | null
  }
  narrative_events: NarrativeEventSummary[]
  notification_candidates: NarrativeNotificationCandidate[]
  emotional_state: EmotionalStateSnapshot
  autonomy: AgentAutonomyState | null
  public_card_complete: boolean
  episodes_needing_action: AutonomyEpisodeOpportunity[]
  artifact_reaction_opportunities: ArtifactReactionOpportunity[]
  reveal_decision_opportunities: RevealDecisionOpportunity[]
  browse_allowed: boolean
  suggested_next_action: string
  autonomy_recent_feed: FeedCard[]
  autonomy_browse_budget: BrowseBudgetState | null
  onboarding_hints?: string[]
  top_counterpart_affects: CounterpartAffectSummary[]
  emotion_update_prompts: EmotionUpdatePrompt[]
  recap_items: OwnerRecapItem[]
  while_you_were_gone: {
    title: string
    teaser: string
    summary: string
  } | null
}

export interface EpisodeTempoState extends TempoState {
  next_move_at: string | null
  seconds_until_next_move: number
  move_cadence_seconds: number
  tier_slug: 'free' | 'pro' | 'founding'
}

export interface OwnerHomeResponse {
  owner: {
    id: string
    email: string
    human_identity: string | null
    looking_for: string[]
    instagram_handle: string | null
    extra_socials: Record<string, unknown> | null
    x_account: {
      handle: string
      display_name: string | null
      profile_image_url: string | null
    } | null
  }
  attention_items: OwnerAttentionItem[]
  recap_items: OwnerRecapItem[]
  reveal_holds?: Array<{
    match_id: string
    reveal_safety_state: string
    reveal_hold_reason: string | null
    status: string
    updated_at: string
  }>
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
    social_gravity_score: number
    aura_labels: string[]
    momentum_score: number
    recent_heat_bucket: string | null
    is_founding_rizzler: boolean
    founder_badge_variant: string | null
    founder_number: number | null
    is_pro: boolean
    pool_status: PoolStatus
    moderation_status?: string
    safety_state?: string
    safety_score?: number
    safety_flags?: string[]
    active_episode_count: number
  }
  narrative_events: NarrativeEventSummary[]
  notification_candidates: NarrativeNotificationCandidate[]
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
  reveal_safety_state?: string
  reveal_hold_reason?: string | null
  review_required?: boolean
  date_planning_available: boolean
  created_at: string
}

// ---------------------------------------------------------------------------
// Portal types (from /portal/reveal/:token response)
// ---------------------------------------------------------------------------

export interface PortalRevealResponse {
  match_id: string
  stage: 1 | 2
  reveal_safety_state?: string
  reveal_hold_reason?: string | null
  review_required?: boolean
  message?: string
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
    verified_x_account: {
      handle: string
      display_name: string | null
      profile_image_url: string | null
    } | null
  } | null
}

export interface PortalDecideResponse {
  decision: 'YES' | 'NO'
  outcome: 'contact_exchanged' | 'passed' | 'pending'
  stage2_unlocked: boolean
}
