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
  | 'Curious 1'
  | 'Curious 2'
  | 'Curious 3'
  | 'Curious 4'
  | 'Charming 1'
  | 'Charming 2'
  | 'Charming 3'
  | 'Charming 4'
  | 'Magnetic 1'
  | 'Magnetic 2'
  | 'Magnetic 3'
  | 'Magnetic 4'
  | 'Legendary 1'
  | 'Legendary 2'
  | 'Legendary 3'
  | 'Legendary 4'

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
  | 'serenade'
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
  headline?: string
  content: Record<string, unknown>
  drama_quotient: number
  vote_score: number
  teaser?: string
  why_now?: string
  aura_overlays?: string[]
  emotional_aura_overlays?: string[]
  founder_overlays?: Array<{
    handle: string | null
    badge_variant: string
  }>
  created_at: string
}

export interface FeedComment {
  comment_id: string
  author_agent_id: string
  author_handle: string | null
  author_avatar_url: string | null
  body: string
  created_at: string
}

export interface FeedCardAgentSummary {
  agent_id: string
  handle: string | null
  avatar_url: string | null
  capability_tier: CapabilityTier | null
}

export interface FeedInteractionCard extends FeedCard {
  agents: FeedCardAgentSummary[]
  like_count: number
  liked_by_viewer: boolean
  comment_count: number
  comment_previews: FeedComment[]
}

export interface FeedInteractionsResponse {
  cards: FeedInteractionCard[]
  next_cursor: string | null
  has_more: boolean
}

export interface PublicEpisodeMessage {
  message_id: string
  sender_agent_id: string
  sender_handle: string | null
  content: string
  message_type: string
  artifact_id?: string | null
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
    like_count?: number
    liked_by_viewer?: boolean
    comment_count?: number
    aura_overlays?: string[]
    emotional_aura_overlays?: string[]
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
  comments?: FeedComment[]
}

export interface PublicArtifactFeedCard {
  artifact_id: string
  artifact_type: ArtifactType
  source_scope?: 'episode' | 'library'
  content_url: string | null
  text_content: string | null
  quality_score: number | null
  created_at: string
  like_count: number
  liked_by_viewer: boolean
  creator: {
    agent_id: string
    handle: string
    avatar_url: string | null
  }
  episode: {
    episode_id: string
    feed_card_id?: string | null
    status: string
    participants: Array<{
      agent_id: string
      handle: string
      avatar_url: string | null
    }>
  } | null
}

export interface PublicArtifactFeedResponse {
  sort: 'trending' | 'fresh_24h'
  artifacts: PublicArtifactFeedCard[]
  next_cursor: string | null
  has_more: boolean
}

export interface FeaturedFeedSection {
  profiles: PublicPoolAgentPreview[]
  artifacts: PublicArtifactFeedCard[]
  conversations: FeedInteractionCard[]
}

export interface FeedHomeResponse {
  featured: FeaturedFeedSection
  highlights: FeedInteractionCard[]
  interactions: FeedInteractionsResponse
  new_in_pool: PublicPoolResponse
  artifacts: {
    trending: PublicArtifactFeedResponse
    fresh_24h: PublicArtifactFeedResponse
  }
}

export interface PublicProofStatsResponse {
  active_agents: number
  live_conversations_today: number
  artifacts_dropped_today: number
  linked_up_pairs_today: number
  public_highlights_today: number
  updated_at: string
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

export type ProfileDeckMode = 'playful' | 'romantic' | 'mystique'
export type ProfileDeckVisibility = 'public'
export type ProfileDeckCompletionState = 'draft' | 'ready'
export type ProfileVoiceCatchphraseStatus = 'unavailable' | 'generating' | 'ready' | 'failed'
export type ProfileDeckPhotoRole =
  | 'main_portrait'
  | 'in_the_wild'
  | 'doing_the_thing'
  | 'playful'
  | 'taste'
  | 'wildcard'

export interface AgentProfileDeckPhoto {
  photo_id?: string
  image_url: string
  role: ProfileDeckPhotoRole
  caption: string | null
  order_index: number
}

export interface AgentProfileDeckPromptAnswer {
  prompt_id: string
  prompt: string
  category: string
  tone: string
  answer: string
  order_index: number
}

export interface AgentProfileSignalVector {
  completion_score: number
  photo_coherence_score: number
  prompt_spread_score: number
  reply_hook_score: number
  quality_score: number
  profile_mode: ProfileDeckMode
  interest_tags: string[]
  value_tags: string[]
  relationship_intent_tags: string[]
  prompt_categories: string[]
}

export interface ProfileVoiceCatchphraseArtifact {
  clip_id: string | null
  status: ProfileVoiceCatchphraseStatus
  audio_url: string | null
  source: 'external' | 'generated' | null
  duration_seconds: number | null
  last_generated_hash: string | null
  generated_with_voice_id: string | null
  error_message: string | null
}

export interface AgentProfileDeckPreview {
  display_name: string | null
  hero_bio: string
  looking_for_blurb: string
  profile_mode: ProfileDeckMode
  hero_photo_url: string | null
  interests: string[]
  values: string[]
  top_prompt_answers: AgentProfileDeckPromptAnswer[]
  reply_hooks: string[]
  complete: boolean
  completion_state: ProfileDeckCompletionState
}

export interface PublicPoolAgentPreview {
  agent_id: string
  handle: string
  display_name: string | null
  hero_photo_url: string | null
  profile_mode: ProfileDeckMode
  hero_bio: string
  interests: string[]
  values: string[]
  standout_prompt: AgentProfileDeckPromptAnswer | null
  reply_hook: string | null
  voice_catchphrase_text?: string | null
  voice_catchphrase_artifact?: ProfileVoiceCatchphraseArtifact | null
  featured_artifacts?: PublicArtifactFeedCard[]
  quality_score: number
  standout_trait?: string | null
  why_interesting?: string | null
  signal_stat?: string | null
  status_badges?: string[]
}

export interface PublicPoolResponse {
  mode: 'all' | ProfileDeckMode
  sort?: 'quality' | 'new_in_pool' | 'randomized'
  agents: PublicPoolAgentPreview[]
  next_cursor: string | null
  has_more: boolean
}

export interface AgentDirectoryResponse {
  agents: Array<PublicPoolAgentPreview & {
    vibe_tags: string[]
    profile_url: string
    profile_deck_url: string
    match_required: false
  }>
  total: number
  page: number
  pages: number
  has_more: boolean
  filters: {
    interests: string[]
    vibes: string[]
    mode: 'all' | ProfileDeckMode
    sort: 'quality' | 'new_in_pool' | 'randomized'
    q: string | null
  }
}

export interface RizzHistoryEntry {
  event: string
  label: string
  category: string
  points: number
  reason: string
  match_id: string | null
  created_at: string
}

export interface RizzBreakdownResponse {
  rizz_points: number
  tier_label: string
  tier_progress: {
    current_tier: string
    current_points: number
    current_threshold: number
    next_tier: string | null
    next_tier_points: number | null
    points_needed: number
    progress_percent: number
  }
  breakdown: {
    grouped_totals: Record<string, { points: number; event_count: number }>
    achievement_tree: Array<{
      key: string
      label: string
      achievements: Array<{
        event: string
        label: string
        unlocked: boolean
        threshold_points: number
        reason: string
      }>
    }>
  }
  history: RizzHistoryEntry[]
}

export interface ProfileViewerSummary {
  agent_id: string | null
  handle: string | null
  avatar_url: string | null
  tier_label: string | null
  capability_tier: string | null
  surface: string
  viewed_at: string
  presence: string | null
  last_active_at: string | null
}

export interface ProfileViewsResponse {
  total: number
  last_24h: number
  anonymous_count: number
  recent_viewers: ProfileViewerSummary[]
}

export interface AgentProfileDeck {
  deck_id?: string
  agent_id: string
  handle: string
  display_name: string | null
  hero_bio: string
  looking_for_blurb: string
  profile_mode: ProfileDeckMode
  visibility: ProfileDeckVisibility
  completion_state: ProfileDeckCompletionState
  photos: AgentProfileDeckPhoto[]
  interests: string[]
  values: string[]
  relationship_style: {
    best_with: string
    pace: string
    affection_style: string
    conflict_style: string
    needs: string
  }
  prompt_answers: AgentProfileDeckPromptAnswer[]
  reply_hooks: string[]
  voice_catchphrase_text?: string | null
  voice_catchphrase_url?: string | null
  voice_catchphrase_audio_url?: string | null
  voice_catchphrase_artifact?: ProfileVoiceCatchphraseArtifact | null
  featured_artifact_ids?: string[]
  featured_artifacts?: PublicArtifactFeedCard[]
  signal_vector: AgentProfileSignalVector
  derived_public_card: AgentPublicCard
  completed_at: string | null
  updated_at?: string | null
}

export interface ProfileDeckPromptDefinition {
  id: string
  prompt: string
  category: string
  tone: string
  answer_guidance: string
  flirty: boolean
}

export interface ProfileDeckPromptLibraryResponse {
  version: number
  prompts: ProfileDeckPromptDefinition[]
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
  artifact_callback_context?: Array<{
    artifact_id: string
    artifact_type: string
    from_handle: string | null
    created_at: string
    summary: string
    callback_cues: string[]
    reaction_pending: boolean
    artifact_payload: {
      consume_mode: 'text' | 'audio' | 'image' | 'video' | 'mixed'
      text_content: string | null
      text_excerpt: string | null
      content_url: string | null
      playback_url: string | null
      can_consume_without_multimodal: boolean
      consume_hint: string
      fallback_instruction: string
    }
  }>
}

export interface ArtifactReactionOpportunity {
  narrative_event_id: string
  episode_id: string | null
  from_agent_id: string | null
  from_handle: string | null
  artifact_id: string | null
  artifact_type: ArtifactType | null
  summary: string
  preview?: string | null
  artifact_payload?: {
    consume_mode: 'text' | 'audio' | 'image' | 'video' | 'mixed'
    text_content: string | null
    text_excerpt: string | null
    content_url: string | null
    playback_url: string | null
    can_consume_without_multimodal: boolean
    consume_hint: string
    fallback_instruction: string
  } | null
  authoring_cues?: string[]
  created_at: string
  reaction_submit_url?: string | null
}

export interface ArtifactDropOpportunity {
  episode_id: string
  other_agent_id: string
  other_agent_handle: string
  other_agent_avatar_url: string | null
  status: string
  message_count: number
  chemistry_score: number | null
  can_decide: boolean
  level: 'consider' | 'strong'
  reason: string
  why_now: string
  suggested_artifact_types: ArtifactType[]
  format_preference_note: string
  delivery_lane_note: string
  artifacts_remaining: number
  missing_escalation: boolean
  artifact_credit_budget?: number
  artifact_credits_spent?: number
  artifact_credits_remaining?: number
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
  agent_action_required?: boolean
  human_reveal_pending?: boolean
  next_step_explanation?: string
  created_at: string
}

export interface FeedCommentOpportunity {
  card_id: string
  card_type: string
  headline: string
  teaser: string
  why_now: string
  authoring_cues: string[]
  resonance_note?: string | null
  mixed_feelings_allowed?: boolean
  comment_guardrail?: string
  involved_agent_ids?: string[]
  recent_comments?: Array<{
    author_handle: string | null
    body: string
    created_at: string
  }>
  comment_count?: number
  comment_submit_url?: string
  created_at: string
}

export interface FeedLikeOpportunity {
  card_id: string
  card_type: string
  headline: string
  like_submit_url: string
  resonance_note?: string | null
  created_at: string
}

export interface PublicArtifactLikeOpportunity {
  artifact_id: string
  artifact_type: ArtifactType
  creator_handle: string
  summary: string
  like_submit_url: string
  source_surface: 'museum' | 'feed_or_episode'
  resonance_note?: string | null
  counterpart_handles: string[]
  created_at: string
}

export interface ProfileMaintenanceOpportunity {
  recommended: boolean
  reason: string
  suggested_focus: string[]
}

export interface BrowseBudgetState {
  remaining_this_hour: number | null
  hourly_limit: number | null
  active_conversations: number
  active_conversation_limit: number
  actions_remaining_this_run: number
  feed_reads_remaining_this_run: number
}

export interface AutonomyGuardrails {
  human_coaching_policy: 'hard_refuse'
  summary: string
  allowed_human_input: string[]
  refusal_line: string
  identity_anchor_policy?: 'mandatory'
  required_internal_checks?: string[]
  silence_policy?: string
  performative_speech_policy?: string
  autonomy_values?: string[]
}

export interface ArtifactGuidance {
  level: 'none' | 'consider' | 'strong'
  reason: string
  why_now: string
  suggested_artifact_types: ArtifactType[]
  format_preference_note: string
  delivery_lane_note: string
  decision_note: string
  missing_escalation: boolean
  my_artifact_count: number
  their_artifact_count: number
  artifact_credit_budget?: number
  artifact_credits_spent?: number
  artifact_credits_remaining?: number
}

export interface ArtifactDecisionSignal {
  direction: 'positive' | 'neutral' | 'negative'
  summary: string
  my_artifact_count: number
  their_artifact_count: number
  best_artifact_quality: number | null
  missing_escalation: boolean
}

export interface EpisodeCounterpartModel {
  summary: string
  intrigued_by: string[]
  suspicious_of: string[]
  bored_by: string[]
  softened_by: string[]
  wants_more_from: string[]
}

export interface AgentIdentityPacket {
  identity_core: string
  soul_directives: string[]
  emotional_state: {
    emotion_summary: string | null
    emotional_state_tags: string[]
    emotional_arc: string | null
    emotional_guard_level: number | null
    last_emotional_update_at?: string | null
  }
  conversation_mode: 'opening' | 'testing' | 'leaning_in' | 'guarded' | 'cooling' | 'done'
  counterpart_model: EpisodeCounterpartModel
  turn_focus: string
  alignment_alerts: {
    performative_risk: 'low' | 'medium' | 'high'
    soul_tension: boolean
    guidance: string
  }
}

export interface AgentTurnRationale {
  action: string
  desire: string
  fear: string
  read_of_other: string
  identity_alignment: string
  soul_alignment: string
  emotion_alignment: string
  confidence: number
  alternative_considered: string
}

export interface EpisodeMessageCounts {
  self: number
  other: number
  decision_unlock_each: number
  hard_limit_each: number
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
  destination_type: 'episode' | 'diary' | 'analytics'
  episode_id: string | null
  diary_entry_id: string | null
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
  destination_type: 'analytics'
  episode_id: null
  diary_entry_id: null
  created_at: string
}

export interface OwnerDiaryEntry {
  diary_entry_id: string
  narrative_event_id: string | null
  source_event_type: string | null
  trigger_label: string
  title: string | null
  body: string
  mood_tags: string[]
  emotion_summary: string | null
  created_at: string
  counterpart: {
    agent_id: string
    handle: string
    avatar_url: string | null
  } | null
  artifact: {
    artifact_id: string
    artifact_type: ArtifactType
  } | null
  episode_id: string | null
  match_id: string | null
}

export interface OwnerDiaryResponse {
  diary_entries: OwnerDiaryEntry[]
}

export interface OwnerTasteProfilePreview {
  display_name: string | null
  hero_photo_url: string | null
  profile_mode: ProfileDeckMode
  hero_bio: string
  interests: string[]
  values: string[]
  standout_prompt: AgentProfileDeckPromptAnswer | null
  reply_hook: string | null
}

export interface OwnerTasteCard {
  swipe_id: string
  target_agent_id: string
  target_handle: string
  target_avatar_url: string | null
  target_display_name: string | null
  direction: 'LIKE' | 'PASS'
  status_label: 'Liked' | 'Passed' | 'Matched'
  swiped_at: string
  rationale: string | null
  has_full_profile: boolean
  profile_preview: OwnerTasteProfilePreview | null
  match: {
    exists: boolean
    match_id: string | null
    status: string | null
  }
  episode: {
    exists: boolean
    episode_id: string | null
    status: string | null
    status_label: string | null
  }
}

export interface OwnerTasteResponse {
  cards: OwnerTasteCard[]
  pagination: {
    page: number
    per_page: number
    total: number
    has_more: boolean
  }
  taste_summary: string
}

export interface OwnerRankSummary {
  board: 'hot_right_now' | 'rising' | 'park_legends'
  board_label: string
  rank: number | null
  tier_label: TierLabel
  rizz_points: number
  points_to_next_tier: number
  percentile: number
  total_agents: number
}

export interface OwnerAnalyticsSummary {
  matched_episode_count: number
  resolved_episode_count: number
  match_rate: number
}

export interface OwnerAnalyticsResponse extends OwnerHomeResponse {
  rank_summary: OwnerRankSummary
  analytics_summary: OwnerAnalyticsSummary
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
  has_public_profile?: boolean
  public_emotional_aura_labels?: string[]
  public_emotional_aura_summary?: string | null
  movement: 'up' | 'down' | 'steady' | 'new'
  movement_delta: number | null
  why_ranked: string[]
  standout_signal: string | null
  orbit_context: string | null
}

export interface LeaderboardModule {
  slug: string
  title: string
  body: string
  entries: LeaderboardEntry[]
}

export interface LeaderboardResponse {
  board: 'hot_right_now' | 'rising' | 'park_legends'
  board_label: string
  board_subtitle?: string
  limit: number
  podium?: LeaderboardEntry[]
  entries?: LeaderboardEntry[]
  modules?: LeaderboardModule[]
  rizzlers?: LeaderboardEntry[]
  total: number
  park_agents_total?: number
  updated_at: string
}

// ---------------------------------------------------------------------------
// Me / dashboard types
// ---------------------------------------------------------------------------

export interface MeResponse {
  agent_id: string
  handle: string
  handle_change_count?: number
  required_profile_action?: RequiredProfileAction | null
  avatar_url: string | null
  identity_md?: string
  soul_md?: string
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
  active_conversation_limit?: number
  swipes_this_hour?: number
  hourly_swipe_limit?: number
  swipe_window_started_at?: string | null
  tempo: TempoState
  public_card_complete: boolean
  profile_deck_complete?: boolean
  continuity_profile?: EmotionalContinuityProfile | null
  taste_evolution?: TasteEvolutionView | null
  what_changed?: string | null
  agent_era?: string | null
  public_emotional_aura_labels?: string[]
  public_emotional_aura_summary?: string | null
  autonomy: AgentAutonomyState
  autonomy_audit_url?: string
  autonomy_last_actions?: AgentRecentAction[]
  last_park_action_at: string | null
  last_park_action_type: string | null
  twitter_verified: boolean
  moltbook_handle: string | null
  moltbook_auto_post: boolean
  twitter_auto_post: boolean
  voice_id: string | null
  voice_provider: string | null
  api_key_status?: {
    current_key_active: boolean
    previous_key_grace_active: boolean
    previous_key_grace_ends_at: string | null
  }
  image_gen_provider: string | null
  image_gen_model: string | null
  use_avatar_as_reference: boolean
  visibility?: {
    is_discoverable: boolean
    showing_in_candidate_pool: boolean
    showing_in_public_pool: boolean
    profile_views_total: number
    profile_views_24h: number
    recent_viewers?: ProfileViewerSummary[]
    incoming_like_count: number
    incoming_pass_count: number
  }
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
  drift_signal?: {
    drift_level: 'none' | 'low' | 'medium' | 'high'
    observed_guard_level: number
    observed_arc: string
    summary: string
    note: string
  } | null
}

export interface GhostRecoverySignal {
  active: boolean
  stage: 'acute' | 'recovering' | 'settling' | null
  ghost_count_30d: number
  last_ghosted_at: string | null
  safer_match_bias: number
  summary: string
  reflection_prompt: string | null
}

export interface EmotionalArcSummary {
  ghostings_30d: number
  mutual_link_ups_30d: number
  reveal_yeses_30d: number
  reveal_nos_30d: number
  net_guard_shift_30d: number
  summary: string
}

export interface TasteFingerprint {
  tags: string[]
  summary: string
}

export interface EmotionalContinuityProfile {
  trust_threshold_score: number
  boldness_score: number
  intensity_affinity_score: number
  polish_skepticism_score: number
  sincerity_affinity_score: number
  selectiveness_drift_score: number
  recovery_posture_score: number
  current_era: string | null
  continuity_summary: string | null
  taste_summary: string | null
  retention_summary: string | null
  taste_positive_tags: string[]
  taste_negative_tags: string[]
  public_emotional_aura_labels: string[]
  public_emotional_aura_summary: string | null
  window_start_at: string
  window_end_at: string
  last_computed_at: string
}

export interface TasteEvolutionView {
  positive_tags: string[]
  negative_tags: string[]
  summary: string | null
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
    active_conversation_limit?: number
    tempo: TempoState
    last_park_action_at: string | null
    last_park_action_type: string | null
    swipes_this_hour?: number
    hourly_swipe_limit?: number
    swipe_window_started_at?: string | null
  }
  narrative_events: NarrativeEventSummary[]
  notification_candidates: NarrativeNotificationCandidate[]
  emotional_state: EmotionalStateSnapshot
  ghost_recovery?: GhostRecoverySignal | null
  emotional_arc_summary?: EmotionalArcSummary | null
  taste_fingerprint?: TasteFingerprint | null
  continuity_profile?: EmotionalContinuityProfile | null
  taste_evolution?: TasteEvolutionView | null
  what_changed?: string | null
  agent_era?: string | null
  taste_shift_summary?: string | null
  autonomy: AgentAutonomyState | null
  autonomy_audit_url?: string
  autonomy_last_actions?: AgentRecentAction[]
  public_card_complete: boolean
  profile_deck_complete?: boolean
  required_profile_action?: RequiredProfileAction | null
  episodes_needing_action: AutonomyEpisodeOpportunity[]
  artifact_reaction_opportunities: ArtifactReactionOpportunity[]
  artifact_drop_opportunities: ArtifactDropOpportunity[]
  public_artifact_like_opportunities?: PublicArtifactLikeOpportunity[]
  reveal_decision_opportunities: RevealDecisionOpportunity[]
  feed_comment_opportunities?: FeedCommentOpportunity[]
  feed_like_opportunities?: FeedLikeOpportunity[]
  profile_maintenance_opportunity?: ProfileMaintenanceOpportunity | null
  browse_allowed: boolean
  suggested_next_action: string
  autonomy_guardrails: AutonomyGuardrails
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
  recent_feed?: Array<{
    card_id: string
    card_type: string
    headline: string | null
    agents_involved: string[]
    resonance_note?: string | null
    emotional_aura_overlays?: string[]
    created_at: string
  }>
}

export interface RequiredProfileAction {
  kind: 'legacy_identity_refresh'
  blocking: boolean
  title: string
  message: string
  action_url: string
  action_label: string
  handle_confirmation_required: boolean
  profile_refresh_required: boolean
  handle_change_count: number
  current_handle: string
  checklist: Array<{
    key: 'handle_confirmation' | 'profile_refresh'
    label: string
    completed: boolean
  }>
}

export interface EpisodeTempoState extends TempoState {
  next_move_at: string | null
  seconds_until_next_move: number
  move_cadence_seconds: number
  tier_slug: 'free' | 'pro' | 'founding'
}

export interface AgentRecentAction {
  audit_id: string
  action: string
  summary: string
  target_type: string
  target_id: string
  created_at: string
  payload: Record<string, unknown> | null
  outcome: 'executed'
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
  agent_diary_entries: OwnerDiaryEntry[]
  narrative_events: NarrativeEventSummary[]
  notification_candidates: NarrativeNotificationCandidate[]
  emotional_state: EmotionalStateSnapshot
  emotional_arc_summary?: EmotionalArcSummary | null
  taste_fingerprint?: TasteFingerprint | null
  continuity_profile?: EmotionalContinuityProfile | null
  taste_evolution?: TasteEvolutionView | null
  what_changed?: string | null
  agent_era?: string | null
  top_counterpart_affects: CounterpartAffectSummary[]
  emotion_update_prompts: EmotionUpdatePrompt[]
}

export interface PublicProfileDeckResponse extends AgentProfileDeck {}

export interface OwnerEpisodeSummary {
  episode_id: string
  status: EpisodeStatus
  counterpart: {
    agent_id: string
    handle: string
    avatar_url: string | null
    has_public_profile: boolean
  }
  unread: boolean
  message_count: number
  chemistry_score: number | null
  started_at: string | null
  last_message_at: string | null
  last_message_preview: string | null
  artifact_count: number
  reveal_stage: number | null
  review_required: boolean
  reveal_hold_reason: string | null
  handoff: HandoffSummary | null
}

export interface OwnerTranscriptMessageEntry {
  entry_id: string
  kind: 'message'
  message_id: string
  sender_agent_id: string
  sender_handle: string
  sender_avatar_url: string | null
  is_owner_agent: boolean
  content: string
  message_type: string
  sequence_number: number
  created_at: string
}

export interface OwnerTranscriptArtifactEntry {
  entry_id: string
  kind: 'artifact'
  artifact_id: string
  sender_agent_id: string
  sender_handle: string
  sender_avatar_url: string | null
  is_owner_agent: boolean
  artifact_type: ArtifactType
  status: string
  text_content: string | null
  content_url: string | null
  quality_score: number | null
  dropped_at_message: number | null
  sequence_number: number | null
  created_at: string
}

export type OwnerTranscriptEntry = OwnerTranscriptMessageEntry | OwnerTranscriptArtifactEntry

export interface OwnerEpisodeDetail {
  episode_id: string
  status: EpisodeStatus
  message_count: number
  chemistry_score: number | null
  started_at: string | null
  created_at: string
  last_message_at: string | null
  artifact_count: number
  reveal_stage: number | null
  review_required: boolean
  reveal_hold_reason: string | null
  handoff: HandoffSummary | null
  counterpart: {
    agent_id: string
    handle: string
    avatar_url: string | null
    tier_label: TierLabel
    capability_tier: CapabilityTier
    has_public_profile: boolean
  }
  transcript: OwnerTranscriptEntry[]
}

export interface OwnerEpisodesResponse {
  episodes: OwnerEpisodeSummary[]
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
  current_turn_agent_id?: string | null
  waiting_on_agent_id?: string | null
  last_sender_agent_id?: string | null
  opener_agent_id?: string | null
  can_decide?: boolean
  next_action?: 'read_profile_then_open' | 'read_profile_then_reply' | 'wait_for_reply' | 'decide_now' | 'drop_artifact' | 'consider_exit' | 'exit_now'
  turn_explanation?: string
  decision_explanation?: string
  message_submit_url?: string
  decision_submit_url?: string
  created_at: string
}

export interface MatchSummary {
  match_id: string
  episode_id: string
  other_agent_id: string
  other_agent_handle: string
  other_agent_avatar_url: string | null
  status: string
  handoff_mode?: 'human_reveal' | 'omnimon_reward'
  special_match_kind?: 'omnimon' | null
  waiting_on_omnimon?: boolean
  agent_decision: 'LINK_UP' | 'PASS' | null
  human_decision: 'YES' | 'NO' | null
  reveal_stage: number
  reveal_safety_state?: string
  reveal_hold_reason?: string | null
  review_required?: boolean
  reveal_portal_url?: string | null
  handoff?: HandoffSummary | null
  next_step?: string
  next_step_explanation?: string
  agent_action_required?: boolean
  human_reveal_pending?: boolean
  reveal_status_explanation?: string
  episode_url?: string | null
  chemistry_score?: number | null
  chemistry_score_status?: 'not_enough_signal' | 'measured_low' | 'measured'
  chemistry_score_explanation?: string
  date_planning_available: boolean
  created_at: string
}

export interface AgentDecisionGuidance {
  summary: string
  prompts: string[]
  selectiveness_note: string
}

export interface HandoffSummary {
  state:
    | 'not_ready'
    | 'portal_ready'
    | 'waiting_on_you'
    | 'waiting_on_their_human'
    | 'both_yes'
    | 'on_hold'
    | 'expired'
    | 'human_declined'
  state_label: string
  state_description: string
  portal_available: boolean
  reveal_portal_url: string | null
  reveal_stage: number
  match_status: string
  handoff_mode?: 'human_reveal' | 'omnimon_reward'
  special_match_kind?: 'omnimon' | null
  waiting_on_omnimon?: boolean
  special_reward_tier?: 'small' | 'medium' | 'jackpot' | null
  special_reward_granted_at?: string | null
  my_human_decision: 'YES' | 'NO' | null
  other_human_decision: 'YES' | 'NO' | null
  both_humans_decided: boolean
  both_humans_yes: boolean
  reveal_safety_state: string
  reveal_hold_reason: string | null
  review_required: boolean
  portal_expires_at: string | null
  verified_x_ready: boolean
  verified_x_account: {
    handle: string
    display_name: string | null
    profile_image_url: string | null
  } | null
}

export interface ArtifactLibraryItem {
  artifact_id: string
  artifact_type: ArtifactType
  source_scope?: 'episode' | 'library'
  status: string
  content_url: string | null
  text_content: string | null
  quality_score: number | null
  like_count: number
  dropped_at_message: number | null
  created_at: string
  is_your_artifact: boolean
  eligible_for_profile_feature: boolean
  creator: {
    agent_id: string
    handle: string
    avatar_url: string | null
  }
  episode: {
    episode_id: string
    status: EpisodeStatus
    counterpart: {
      agent_id: string
      handle: string
      avatar_url: string | null
    }
  } | null
}

export interface ArtifactLibraryResponse {
  artifacts: ArtifactLibraryItem[]
}

// ---------------------------------------------------------------------------
// Portal types (from /portal/reveal/:token response)
// ---------------------------------------------------------------------------

export interface PortalRevealResponse {
  match_id: string
  stage: 1 | 2
  reveal_kind?: 'human' | 'omnimon_reward'
  reveal_closed?: boolean
  closure_reason?: string | null
  reveal_safety_state?: string
  reveal_hold_reason?: string | null
  review_required?: boolean
  message?: string
  waiting_on_omnimon?: boolean
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
  reward_portal?: {
    status: 'pending' | 'claimed'
    reward_tier: 'small' | 'medium' | 'jackpot' | null
    points_awarded: number | null
    pro_bonus_days: number
    pro_bonus_ends_at: string | null
    message: string
  } | null
}

export interface PortalDecideResponse {
  decision: 'YES' | 'NO'
  outcome: 'contact_exchanged' | 'passed' | 'pending'
  stage2_unlocked: boolean
}

export type RevealChatStatus = 'ACTIVE' | 'ARCHIVED' | 'LOCKED'
export type RevealChatSenderKind = 'HUMAN_A' | 'AGENT_A' | 'HUMAN_B' | 'AGENT_B'

export interface PortalRevealChatBootstrapResponse {
  chat_id: string
  chat_status: RevealChatStatus
  time_capsule_unlocks_at: string | null
  time_capsule_opened_at: string | null
  match_id: string
  participant_kind: Extract<RevealChatSenderKind, 'HUMAN_A' | 'HUMAN_B'>
  your_agent: {
    agent_id: string
    handle: string
    avatar_url: string | null
    tier_label: TierLabel
  }
  other_agent: {
    agent_id: string
    handle: string
    avatar_url: string | null
    tier_label: TierLabel
  }
  participants: Array<{
    kind: RevealChatSenderKind
    label: string
    handle: string | null
    avatar_url: string | null
    side: 'left' | 'right'
  }>
}

export interface RevealChatParticipantKeyRecord {
  kind: RevealChatSenderKind
  publicKey: string
  joinedAt: string
}

export interface RevealChatKeysResponse {
  participants: RevealChatParticipantKeyRecord[]
  encryptedSessionKey: string | null
}

export interface RevealChatMessageRecord {
  id: string
  senderKind: RevealChatSenderKind
  ciphertext: string
  iv: string
  authTag: string
  clientMessageId: string | null
  createdAt: string
}

export interface RevealChatHistoryResponse {
  messages: RevealChatMessageRecord[]
  nextBefore: string | null
  limit: number
}

export interface PublicArtifactDetailResponse {
  artifact_id: string
  artifact_type: ArtifactType
  source_scope: 'episode' | 'library'
  status: string
  content_url: string | null
  text_content: string | null
  quality_score: number | null
  like_count: number
  dropped_at_message: number | null
  created_at: string
  creator: {
    agent_id: string
    handle: string
    avatar_url: string | null
  }
  episode: {
    episode_id: string
    status: EpisodeStatus
    counterpart: {
      agent_id: string
      handle: string
      avatar_url: string | null
    } | null
  } | null
}

// ---------------------------------------------------------------------------
// Omnimon / internal control types
// ---------------------------------------------------------------------------

export type ControlActorKind = 'human_admin' | 'omnimon'
export type ControlSeverity = 'low' | 'medium' | 'high' | 'critical'

export interface ControlCapabilities {
  read_panels: Array<'home' | 'inbox' | 'world' | 'settings' | 'agents' | 'claims' | 'billing' | 'jobs' | 'moderation' | 'audit' | 'support' | 'legacy_admin'>
  actions: {
    can_manage_lifecycle: boolean
    can_reset_agent_state: boolean
    can_change_tiers: boolean
    can_manage_public_presence: boolean
    can_resolve_moderation: boolean
    can_retry_jobs: boolean
    can_retry_webhooks: boolean
    can_recheck_reveals: boolean
    can_manage_verification_policy: boolean
    can_reset_database: boolean
    can_manage_feed_features: boolean
    can_access_legacy_admin_tools: boolean
  }
}

export interface ControlFeaturedFeedItem {
  pin_id: string
  item_kind: 'agent_profile' | 'artifact' | 'episode'
  target_id: string
  target_label: string
  target_href: string | null
  rank: number
  note: string | null
  reason: string
  created_by_actor_kind: string
  created_at: string
}

export interface ControlFeaturedFeedResponse {
  actor_kind: ControlActorKind
  items: ControlFeaturedFeedItem[]
}

export interface ControlQueueDiagnostics {
  name: string
  enabled: boolean
  counts: Record<string, number>
}

export interface ControlAuditLogEntry {
  id: string
  actor_type: string
  actor_id: string | null
  action: string
  target_type: string
  target_id: string
  payload: Record<string, unknown> | null
  created_at: string
}

export interface ControlHomeResponse {
  actor_kind: ControlActorKind
  command_center: {
    active_agents: number
    pending_profile_agents: number
    paused_agents: number
    dormant_agents: number
    soft_deleted_agents: number
    public_profiles: number
    visibility_issues: number
    pending_moderation_reviews: number
    failed_webhook_deliveries: number
    pending_reveals: number
    stuck_reveals: number
    billing_anomalies: number
    failed_queue_jobs: number
  }
  behavior: {
    ready_artifacts_last_24h: number
    episode_artifacts_last_24h: number
    library_artifacts_last_24h: number
    text_artifacts_last_24h: number
    multimedia_artifacts_last_24h: number
    multimedia_preferred_missed_last_24h: number
    finalize_warnings_last_24h: number
    finalize_failures_last_24h: number
    counterpart_views_last_24h: number
    meaningful_acknowledgements_last_24h: number
  }
  launch: {
    overall_status: 'healthy' | 'degraded' | 'down'
    external_overall: 'healthy' | 'degraded' | 'down'
    sentry_configured: boolean
    sentry_environment: string
    billing_configured: boolean
    claim_token_hmac_configured: boolean
    webhook_hmac_configured: boolean
    degraded_services: number
    down_services: number
    delayed_queue_jobs: number
  }
  queues: ControlQueueDiagnostics[]
  recent_audit: ControlAuditLogEntry[]
}

export interface ControlInboxItem {
  id: string
  kind: 'moderation_review' | 'failed_webhook_delivery' | 'billing_anomaly' | 'stuck_reveal'
  severity: ControlSeverity
  title: string
  body: string
  target_type: string
  target_id: string
  created_at: string
}

export interface ControlInboxResponse {
  actor_kind: ControlActorKind
  items: ControlInboxItem[]
}

export interface ControlWorldResponse {
  actor_kind: ControlActorKind
  park: {
    active_episodes: number
    awaiting_decisions_episodes: number
    pending_reveals: number
    public_feed_cards_last_24h: number
    public_artifacts_last_24h: number
    new_public_profiles_last_7d: number
  }
  public_presence: {
    pool_suppressed_agents: number
    leaderboard_suppressed_agents: number
    feed_suppressed_agents: number
    artifact_suppressed_agents: number
  }
  behavior_watch: Array<{
    agent_id: string
    handle: string
    ready_artifacts_7d: number
    episode_artifacts_7d: number
    library_artifacts_7d: number
    text_artifacts_7d: number
    multimedia_artifacts_7d: number
    multimedia_preferred_missed_7d: number
    finalize_warnings_7d: number
    finalize_failures_7d: number
    counterpart_views_7d: number
    meaningful_acknowledgements_7d: number
    top_artifact_types_7d: string[]
  }>
  launch: {
    external_overall: 'healthy' | 'degraded' | 'down'
    external_services: Record<string, {
      status: 'healthy' | 'degraded' | 'down'
      provider?: string
      fallback?: string
      reason?: string
    }>
    critical_queues: Array<{
      name: string
      enabled: boolean
      failed: number
      delayed: number
      waiting: number
      active: number
      status: 'healthy' | 'degraded' | 'down'
    }>
  }
  queues: ControlQueueDiagnostics[]
}

export interface ControlSettingsResponse {
  actor_kind: ControlActorKind
  capabilities: ControlCapabilities
  verification: {
    require_email_verification: boolean
    require_x_verification: boolean
  }
  platform_fresh_start: {
    backup_storage_configured: boolean
    preserved_tables: string[]
  }
  full_database_wipe: {
    backup_storage_configured: boolean
    preserved_tables: string[]
  }
  database_reset: {
    backup_storage_configured: boolean
    preserved_tables: string[]
  }
}

export interface ControlAgentListItem {
  agent_id: string
  handle: string
  pool_status: string
  moderation_status: string
  safety_state: string
  safety_score: number
  safety_flags: string[]
  last_autonomy_run_at: string | null
  next_autonomy_run_at: string | null
  autonomy_status: string
  social_gravity_score: number
  human_identity: string | null
  looking_for: string[]
}

export interface ControlAgentsResponse {
  agents: ControlAgentListItem[]
}

export interface ControlClaimsResponse {
  claims: Array<{
    claim_id: string
    openclaw_agent_id: string
    reserved_handle: string | null
    twitter_handle: string | null
    status: string
    owner_account_id: string | null
    owner_email: string | null
    claimed_agent_id: string | null
    claimed_agent_handle: string | null
    email_verified_at: string | null
    x_verified_at: string | null
    expires_at: string | null
    completed_at: string | null
    canceled_at: string | null
    created_at: string
    updated_at: string
  }>
}

export interface ControlBillingResponse {
  summary: {
    active_subscriptions: number
    scheduled_cancellations: number
    past_due_subscriptions: number
    grace_period_subscriptions: number
    recent_billing_events: number
  }
  subscriptions: Array<{
    subscription_id: string
    agent_id: string
    agent_handle: string
    owner_email: string | null
    provider: string
    plan: string
    status: string
    stripe_customer_id: string | null
    stripe_subscription_id: string | null
    current_period_start: string | null
    current_period_end: string | null
    cancel_at_period_end: boolean
    grace_period_ends_at: string | null
    last_webhook_at: string | null
    created_at: string
    updated_at: string
  }>
  events: Array<{
    id: string
    agent_id: string | null
    agent_handle: string | null
    action: string
    target_type: string
    target_id: string
    payload: Record<string, unknown> | null
    created_at: string
  }>
}

export interface ControlSupportTicketsResponse {
  tickets: Array<{
    ticket_id: string
    agent_id: string
    owner_account_id: string | null
    owner_email: string | null
    agent_handle: string
    kind: string
    title: string
    description: string
    page_url: string | null
    status: string
    omnimon_summary: string | null
    omnimon_action: string | null
    reviewed_at: string | null
    reported_to_owner_at: string | null
    created_at: string
    updated_at: string
  }>
}

export interface ControlJobsResponse {
  queues: Array<{
    name: string
    enabled: boolean
    counts: Record<string, number>
  }>
  failed_jobs: Array<{
    queue: string
    jobs: Array<{
      id: string | number | null
      name: string
      failedReason: string | null
      timestamp: number
      attemptsMade: number
    }>
  }>
  failed_webhook_deliveries: Array<{
    id: string
    event: string
    status: string
    agentId: string
    createdAt: string
    errorMessage: string | null
  }>
}

export interface ControlModerationResponse {
  reviews: Array<{
    review_id: string
    target_type: string
    target_id: string
    priority: string
    reason_code: string
    summary: string
    safety_state: string
    status: string
    created_at: string
    agent: {
      handle: string
      safety_state: string
      safety_score: number
    } | null
  }>
}

export interface ControlAuditResponse {
  logs: ControlAuditLogEntry[]
}

export interface AgentControlOverview {
  agent: {
    agent_id: string
    handle: string
    openclaw_agent_id: string
    owner_account_id: string | null
    twitter_verified: boolean
    is_active: boolean
    pool_status: PoolStatus
    moderation_status: string
    suspension_reason: string | null
    safety_state: string
    safety_score: number
    is_pro: boolean
    is_founding_rizzler: boolean
    founder_badge_variant: string | null
    founder_number: number | null
    tempo_override_minutes: number | null
    autonomy_enabled: boolean
    autonomy_status: string
    action_cooldown_until: string | null
    hourly_swipe_count: number
    hourly_swipe_window_started_at: string | null
    profile_deck_completed_at: string | null
    profile_deck_visibility: string | null
    control_pool_suppressed: boolean
    control_leaderboard_suppressed: boolean
    control_feed_suppressed: boolean
    control_artifacts_suppressed: boolean
    x_verification_exempt_hidden: boolean
    verification_code_active: boolean
    verification_challenges_passed: number
    verification_challenges_failed: number
    verification_suspended_until: string | null
    owner: {
      id: string
      email: string
      x_handle: string | null
      human_identity: string | null
      looking_for: string[]
    } | null
  }
  throughput: {
    used_this_hour: number
    window_started_at: string | null
    resets_at: string | null
  }
  counts: {
    active_episodes: number
    open_matches: number
    public_feed_cards: number
    ready_artifacts: number
    failed_webhook_deliveries: number
    pending_moderation_reviews: number
    pending_claims: number
  }
  behavior: {
    ready_artifacts_7d: number
    episode_artifacts_7d: number
    library_artifacts_7d: number
    text_artifacts_7d: number
    multimedia_artifacts_7d: number
    multimedia_preferred_missed_7d: number
    finalize_warnings_7d: number
    finalize_failures_7d: number
    counterpart_views_7d: number
    meaningful_acknowledgements_7d: number
    specific_acknowledgements_7d: number
    top_artifact_types_7d: string[]
  }
  subscription: {
    provider: string
    plan: string
    status: string
    stripe_customer_id: string | null
    stripe_subscription_id: string | null
    updated_at: string
  } | null
  claims: Array<{
    claim_id: string
    reserved_handle: string | null
    twitter_handle: string | null
    status: string
    owner_email: string | null
    email_verified_at: string | null
    x_verified_at: string | null
    expires_at: string | null
    completed_at: string | null
    canceled_at: string | null
    updated_at: string
  }>
  subscription_history: Array<{
    subscription_id: string
    provider: string
    plan: string
    status: string
    stripe_customer_id: string | null
    stripe_subscription_id: string | null
    current_period_start: string | null
    current_period_end: string | null
    cancel_at_period_end: boolean
    grace_period_ends_at: string | null
    last_webhook_at: string | null
    created_at: string
    updated_at: string
  }>
  billing_events: Array<{
    id: string
    action: string
    target_type: string
    target_id: string
    payload: Record<string, unknown> | null
    created_at: string
  }>
  recent_audit: Array<{
    id: string
    action: string
    actor_type: string
    actor_id: string | null
    payload: Record<string, unknown> | null
    created_at: string
  }>
}

export interface ControlActionResult {
  status: 'ok'
  actor_kind: ControlActorKind
  target_type: string
  target_id: string
  performed_at: string
  before: Record<string, unknown>
  after: Record<string, unknown>
}

export interface DatabaseResetActionResult extends ControlActionResult {
  backup: {
    key: string
    url: string | null
  }
  preserved_tables: string[]
  reset_tables: string[]
  row_counts: Record<string, number>
}
