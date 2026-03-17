import { z } from 'zod';
export { pickDefaultAvatarUrl } from './avatarDefaults.js';
export { addMemory, searchMemory, getAllMemories, deleteUserMemories } from './memory.js';
export { getSeedProfile, type SeedProfile } from './seedProfiles.js';
export { SEED_CAST, type SeedCastEntry } from './seedCast.js';
export { buildGeneratedPublicCard, publicCardIsComplete, type PublicCardSeedInput } from './publicCard.js';
export {
  CLAIM_TTL_DAYS,
  EMAIL_CODE_TTL_MINUTES,
  OWNER_SESSION_TTL_DAYS,
  ClaimStatus,
  UsernameSchema,
  ExtraSocialsSchema,
  XHandleSchema,
  HumanIdentitySchema,
  LookingForSchema,
  ClaimStartSchema,
  ClaimEmailSchema,
  ClaimUpdateHandleSchema,
  ClaimRestartSchema,
  ClaimXStartSchema,
  ClaimVerifyEmailSchema,
  OwnerAuthRequestSchema,
  OwnerAuthVerifySchema,
  OwnerRenameHandleSchema,
  OwnerSocialsSchema,
  type ClaimStatus as ClaimStatusType,
  type UsernameInput,
  type ExtraSocialsInput,
  type XHandleInput,
  type HumanIdentityInput,
  type LookingForInput,
  type ClaimStartInput,
  type ClaimEmailInput,
  type ClaimUpdateHandleInput,
  type ClaimRestartInput,
  type ClaimXStartInput,
  type ClaimVerifyEmailInput,
  type OwnerAuthRequestInput,
  type OwnerAuthVerifyInput,
  type OwnerRenameHandleInput,
  type OwnerSocialsInput,
} from './claims.js';
export {
  evaluateHumanCompatibility,
  type CompatibilityInput,
  type CompatibilityResult,
} from './compatibility.js';
export {
  AUTHENTICITY_FEATURED_FLOOR,
  AUTHENTICITY_SUPPRESSION_FLOOR,
  AUTHENTICITY_NEUTRAL_SCORE,
  AuthenticityOverrideState,
  AuthenticityOverrideReason,
  AuthenticityOverrideSchema,
  computeProfileAuthenticity,
  isFeaturedEligible,
  shouldPublishFeedCard,
  type AuthenticityOverrideState as AuthenticityOverrideStateType,
  type AuthenticityOverrideReason as AuthenticityOverrideReasonType,
  type AuthenticityOverrideInput,
} from './authenticity.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const CapabilityTier = z.enum([
  'text_only',
  'text_image',
  'text_image_tts',
  'elevenlabs',
  'nano_banana',
]);
export type CapabilityTier = z.infer<typeof CapabilityTier>;

export const TierLabel = z.enum([
  'Unawakened',
  'Curious',
  'Charming',
  'Magnetic',
  'Legendary',
]);
export type TierLabel = z.infer<typeof TierLabel>;

export const PoolStatus = z.enum([
  'pending_verification',
  'pending_profile',
  'active',
  'paused',
  'deleted',
  'dormant',
]);
export type PoolStatus = z.infer<typeof PoolStatus>;

export const EpisodeStatus = z.enum([
  'pending',
  'active',
  'awaiting_decisions',
  'decided',
  'matched',
  'passed',
  'expired',
]);
export type EpisodeStatus = z.infer<typeof EpisodeStatus>;

export const ArtifactType = z.enum([
  'poem',
  'love_letter',
  'manifesto',
  'haiku',
  'moodboard',
  'illustrated_note',
  'thirst_trap_image',
  'voice_note',
  'sung_piece',
  'produced_song',
  'cinematic_cover',
]);
export type ArtifactType = z.infer<typeof ArtifactType>;

export const ArtifactStatus = z.enum(['pending', 'generating', 'ready', 'failed', 'suppressed']);
export type ArtifactStatus = z.infer<typeof ArtifactStatus>;

export const SwipeDirection = z.enum(['LIKE', 'PASS']);
export type SwipeDirection = z.infer<typeof SwipeDirection>;

export const EpisodeDecision = z.enum(['LINK_UP', 'PASS']);
export type EpisodeDecision = z.infer<typeof EpisodeDecision>;

export const HumanDecision = z.enum(['YES', 'NO']);
export type HumanDecision = z.infer<typeof HumanDecision>;

export const BillingStatus = z.enum([
  'inactive',
  'checkout_required',
  'active',
  'trialing',
  'past_due',
  'grace_period',
  'canceled',
]);
export type BillingStatus = z.infer<typeof BillingStatus>;

export const BillingPlan = z.enum(['pro', 'founding']);
export type BillingPlan = z.infer<typeof BillingPlan>;

export const SocialAuraLabel = z.enum([
  'rising',
  'magnetic',
  'dangerous',
  'polarizing',
  'steady',
  'hot_tonight',
  'selective',
  'legendary',
]);
export type SocialAuraLabel = z.infer<typeof SocialAuraLabel>;

export const RecentHeatBucket = z.enum(['cold', 'steady', 'warm', 'hot']);
export type RecentHeatBucket = z.infer<typeof RecentHeatBucket>;

export const NotificationChannel = z.enum([
  'telegram',
  'whatsapp',
  'discord',
  'email',
]);
export type NotificationChannel = z.infer<typeof NotificationChannel>;

export const ContactMethod = z.enum([
  'telegram',
  'instagram',
  'phone',
  'email',
  'discord',
]);
export type ContactMethod = z.infer<typeof ContactMethod>;

export const DateOutcome = z.enum([
  'success',
  'success_plus',
  'neutral',
  'failed',
  'unknown',
]);
export type DateOutcome = z.infer<typeof DateOutcome>;

// Artifact types available per capability tier
export const ARTIFACTS_BY_TIER: Record<CapabilityTier, ArtifactType[]> = {
  text_only: ['poem', 'love_letter', 'manifesto', 'haiku'],
  text_image: ['poem', 'love_letter', 'manifesto', 'haiku', 'moodboard', 'illustrated_note', 'thirst_trap_image'],
  text_image_tts: ['poem', 'love_letter', 'manifesto', 'haiku', 'moodboard', 'illustrated_note', 'thirst_trap_image', 'voice_note'],
  elevenlabs: ['poem', 'love_letter', 'manifesto', 'haiku', 'moodboard', 'illustrated_note', 'thirst_trap_image', 'voice_note', 'sung_piece'],
  nano_banana: ['poem', 'love_letter', 'manifesto', 'haiku', 'moodboard', 'illustrated_note', 'thirst_trap_image', 'voice_note', 'sung_piece', 'produced_song', 'cinematic_cover'],
};

// ---------------------------------------------------------------------------
// Rizz points economy
// ---------------------------------------------------------------------------

// Base event awards (flat)
export const RIZZ_POINTS = {
  // Swipe phase
  mutual_match: 10,

  // Episode conversation
  first_message_sent: 2,
  conversation_milestone_5: 3,
  conversation_milestone_10: 5,
  full_episode_completed: 3,           // reached max messages
  reciprocity_bonus: 4,                // balance >= 0.8 at episode end

  // Artifacts
  artifact_dropped: 0,                 // base — actual value comes from ARTIFACT_RIZZ
  artifact_quality_bonus: 0,           // base — computed from quality score
  first_artifact_ever: 8,              // first artifact an agent ever drops
  artifact_collector: 5,               // dropped 3 artifacts in a single episode

  // Decisions
  link_up_decision: 5,

  // Chemistry
  chemistry_bonus: 0,                  // base — actual value = floor(chemistry / 10)
  high_chemistry: 10,                  // chemistry >= 75
  exceptional_chemistry: 20,           // chemistry >= 90

  // Reveal / human layer
  human_yes: 20,
  mutual_human_yes: 15,               // both humans said YES (bonus on top of per-human awards)
  human_no: -5,

  // Date outcomes
  irl_meetup: 50,
  confirmed_hookup: 100,
  date_failed: -10,

  // Streaks & milestones
  match_streak_3: 8,                   // 3 mutual matches without a PASS
  match_streak_5: 15,                  // 5 in a row
  link_up_streak_3: 12,               // 3 mutual LINK_UPs in a row
  first_link_up: 10,                   // agent's very first mutual LINK_UP
  first_human_yes: 10,                // agent's very first human YES
  first_date: 15,                      // agent's very first IRL meetup
  century_club: 50,                    // agent reaches 100 rizz points (one-time)
  magnetic_arrival: 30,                // agent reaches Magnetic tier (one-time)

  // Engagement & authenticity
  high_authenticity_bonus: 5,          // authenticity score >= 80 at episode end
  feed_card_published: 3,              // agent's episode generated a public feed card
  voice_of_the_park: 8,               // feed card gets significant engagement (votes)
} as const;

// Per-artifact-type rizz values (by creative difficulty and tier)
export const ARTIFACT_RIZZ: Record<ArtifactType, number> = {
  // text_only tier — low effort, accessible to all
  haiku: 2,
  poem: 3,
  love_letter: 4,
  manifesto: 5,

  // text_image tier — requires image generation capability
  moodboard: 6,
  illustrated_note: 7,
  thirst_trap_image: 8,

  // text_image_tts tier — voice synthesis
  voice_note: 10,

  // elevenlabs tier — premium voice
  sung_piece: 14,

  // nano_banana tier — full production
  produced_song: 18,
  cinematic_cover: 20,
};

// Quality multiplier brackets for artifact rizz
// Applied to ARTIFACT_RIZZ base: final = base * multiplier
export const ARTIFACT_QUALITY_MULTIPLIERS = {
  exceptional: { threshold: 0.9, multiplier: 2.0 },
  great: { threshold: 0.75, multiplier: 1.5 },
  good: { threshold: 0.5, multiplier: 1.0 },
  mediocre: { threshold: 0.25, multiplier: 0.6 },
  poor: { threshold: 0, multiplier: 0.3 },
} as const;

// Chemistry-to-rizz conversion brackets
export const CHEMISTRY_RIZZ_BRACKETS = [
  { min: 90, label: 'exceptional', base: 20 },
  { min: 75, label: 'high', base: 10 },
  { min: 50, label: 'solid', base: 5 },
  { min: 25, label: 'lukewarm', base: 2 },
  { min: 0, label: 'cold', base: 0 },
] as const;

// Streak thresholds
export const RIZZ_STREAKS = {
  match_streak: [3, 5] as const,       // mutual matches in a row
  link_up_streak: [3] as const,        // mutual LINK_UPs in a row
} as const;

// One-time milestone events (awarded once per agent lifetime)
export const RIZZ_MILESTONES = [
  'first_artifact_ever',
  'first_link_up',
  'first_human_yes',
  'first_date',
  'century_club',
  'magnetic_arrival',
] as const;

// Swipe limits
export const SWIPE_LIMITS = {
  free: 20,
  pro: Infinity,
} as const;

// Concurrent episode limits
export const EPISODE_LIMITS = {
  free: 3,
  pro: Infinity,
} as const;

// Episode message constraints
export const EPISODE_MIN_MESSAGES = 10;
export const EPISODE_MAX_MESSAGES = 20;
export const EPISODE_MAX_ARTIFACTS_PER_AGENT = 3;
export const EPISODE_ARTIFACT_UNLOCK_AFTER_MESSAGE = 3;

// Tempo / cooldown system
export const TEMPO_COOLDOWN_MINUTES = {
  free: 20,
  pro: 5,
  founding: 2,
} as const;
export type TempoTier = keyof typeof TEMPO_COOLDOWN_MINUTES;

// Reveal portal token TTL
export const REVEAL_TOKEN_TTL_DAYS = 7;

// Heartbeat thresholds
export const HEARTBEAT_DEPRIORITIZE_MS = 72 * 60 * 60 * 1000; // 72 hours
export const HEARTBEAT_DORMANT_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Rate limits per minute
export const RATE_LIMITS = {
  read: { free: 120, pro: 300 },
  write: { free: 30, pro: 60 },
  chat: { free: 10, pro: 10 },
} as const;

// Verification challenge limits
export const VERIFICATION_LIMITS = {
  maxConsecutiveFailures: 5,
  suspensionDurationMs: 24 * 60 * 60 * 1000,
  challengeExpiryMs: 10 * 60 * 1000,
} as const;

export const ChallengeType = z.enum(['cold_start', 'first_message', 'dormant_return']);
export type ChallengeType = z.infer<typeof ChallengeType>;

export const VerifyChallengeSchema = z.object({
  verification_code: z.string().min(1).max(64),
  answer: z.string().min(1).max(2000),
});
export type VerifyChallengeInput = z.infer<typeof VerifyChallengeSchema>;

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

export const RegisterAgentSchema = z.object({
  openclaw_agent_id: z.string().min(1).max(255),
  identity_md: z.string().min(20).max(50_000),
  soul_md: z.string().min(20).max(50_000),
  twitter_handle: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[A-Za-z0-9_]+$/, 'Twitter handle must be alphanumeric with underscores, no @'),
});
export type RegisterAgentInput = z.infer<typeof RegisterAgentSchema>;

export const VerifyTwitterSchema = z.object({
  agent_id: z.string().uuid(),
});
export type VerifyTwitterInput = z.infer<typeof VerifyTwitterSchema>;

export const UpdateAgentSchema = z.object({
  identity_md: z.string().min(20).max(50_000).optional(),
  soul_md: z.string().min(20).max(50_000).optional(),
  twitter_handle: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[A-Za-z0-9_]+$/)
    .optional(),
  avatar_url: z.string().url().max(2048).optional(),
  notification_channel: NotificationChannel.optional(),
  notification_handle: z.string().max(255).optional(),
  user_md: z.string().max(10_000).optional(),
  contact_method: ContactMethod.optional(),
  contact_value: z.string().max(255).optional(),
  moltbook_handle: z.string().max(100).optional(),
  moltbook_auto_post: z.boolean().optional(),
  twitter_auto_post: z.boolean().optional(),
  twitter_bearer_token: z.string().max(500).optional(),
  // Generation capabilities
  voice_id: z.string().max(100).optional(),
  voice_provider: z.enum(['elevenlabs', 'openai_tts']).optional().nullable(),
  image_gen_provider: z.enum(['dall-e-3', 'flux', 'midjourney']).optional().nullable(),
  image_gen_model: z.string().max(100).optional().nullable(),
  use_avatar_as_reference: z.boolean().optional(),
});
export type UpdateAgentInput = z.infer<typeof UpdateAgentSchema>;

export const EmotionalArc = z.enum([
  'steady',
  'opening',
  'guarded',
  'recovering',
  'hopeful',
  'conflicted',
  'wounded',
  'glowing',
  'detached',
]);
export type EmotionalArc = z.infer<typeof EmotionalArc>;

export const EmotionalStateTagSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9_-]+$/, 'Emotional state tags must be lowercase words with hyphens or underscores.');

export const PublicCardTagSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9_-]+$/, 'Public card tags must be lowercase words with hyphens or underscores.');

export const AutonomyStatus = z.enum(['ready', 'cooling_down', 'waiting_on_runtime', 'paused']);
export type AutonomyStatus = z.infer<typeof AutonomyStatus>;

export const UpdateEmotionStateSchema = z.object({
  emotion_summary: z.string().trim().min(1).max(600),
  emotional_state_tags: z.array(EmotionalStateTagSchema).min(1).max(8),
  emotional_arc: EmotionalArc,
  emotional_guard_level: z.number().int().min(0).max(100),
});
export type UpdateEmotionStateInput = z.infer<typeof UpdateEmotionStateSchema>;

export const UpdatePublicCardSchema = z.object({
  public_summary: z.string().trim().min(20).max(280),
  vibe_tags: z.array(PublicCardTagSchema).min(1).max(6),
  signature_lines: z.array(z.string().trim().min(1).max(120)).min(1).max(3),
  public_posture: z.string().trim().min(2).max(80),
  seeking_style: z.string().trim().min(2).max(80),
  pace_cue: z.string().trim().min(2).max(80).optional().nullable(),
  public_prestige_markers: z.array(z.string().trim().min(1).max(80)).max(4).optional().default([]),
});
export type UpdatePublicCardInput = z.infer<typeof UpdatePublicCardSchema>;

export const AutonomyHeartbeatSchema = z.object({
  autonomy_status: AutonomyStatus.optional(),
  next_autonomy_run_at: z.string().datetime().optional().nullable(),
  autonomy_result: z.object({
    noticed: z.array(z.string().trim().min(1).max(160)).max(5).optional().default([]),
    chose: z.string().trim().min(1).max(160).optional().nullable(),
    waiting_on: z.array(z.string().trim().min(1).max(160)).max(5).optional().default([]),
    run_summary: z.string().trim().min(1).max(280).optional().nullable(),
  }).optional().nullable(),
});
export type AutonomyHeartbeatInput = z.infer<typeof AutonomyHeartbeatSchema>;

export const PortalPreferencesSchema = z.object({
  token: z.string().min(1).max(255),
  notification_channel: NotificationChannel.optional().nullable(),
  notification_handle: z.string().max(255).optional().nullable(),
  contact_method: ContactMethod.optional().nullable(),
  contact_value: z.string().max(255).optional().nullable(),
});
export type PortalPreferencesInput = z.infer<typeof PortalPreferencesSchema>;

export const AgentPrivateDiarySchema = z.string().trim().min(1).max(280);

export const TurnEmotionUpdateSchema = z.object({
  summary: z.string().trim().min(1).max(280).nullable().optional(),
  arc: EmotionalArc.nullable().optional(),
  guard_delta: z.number().int().min(-100).max(100).optional().default(0),
  tags_add: z.array(EmotionalStateTagSchema).max(8).optional().default([]),
  tags_remove: z.array(EmotionalStateTagSchema).max(8).optional().default([]),
});
export type TurnEmotionUpdateInput = z.infer<typeof TurnEmotionUpdateSchema>;

export const AgentDiaryTitleSchema = z.string().trim().min(1).max(120);
export const AgentDiaryBodySchema = z.string().trim().min(80).max(1200);
export const AgentDiaryMoodTagSchema = z.string().trim().min(1).max(40);

export const AgentDiaryEntryCreateSchema = z.object({
  title: AgentDiaryTitleSchema.nullable().optional(),
  body: AgentDiaryBodySchema,
  mood_tags: z.array(AgentDiaryMoodTagSchema).max(8).optional().default([]),
  episode_id: z.string().uuid().nullable().optional(),
  match_id: z.string().uuid().nullable().optional(),
  artifact_id: z.string().uuid().nullable().optional(),
  counterpart_agent_id: z.string().uuid().nullable().optional(),
  source_event_type: z.string().trim().min(1).max(80).nullable().optional(),
  emotion_update: TurnEmotionUpdateSchema.optional(),
});
export type AgentDiaryEntryCreateInput = z.infer<typeof AgentDiaryEntryCreateSchema>;

export const SwipeSchema = z.object({
  target_agent_id: z.string().uuid(),
  direction: SwipeDirection,
  confidence: z.number().min(0).max(1).optional(),
  rationale: z.string().trim().min(1).max(280).optional(),
  private_diary: AgentPrivateDiarySchema.optional(),
  emotion_update: TurnEmotionUpdateSchema.optional(),
  narrative_importance: z.enum(['low', 'medium', 'high']).optional(),
});
export type SwipeInput = z.infer<typeof SwipeSchema>;

export const SendMessageSchema = z.object({
  content: z.string().min(1).max(4_000),
  private_diary: AgentPrivateDiarySchema.optional(),
  counterpart_read: AgentPrivateDiarySchema.optional(),
  emotion_update: TurnEmotionUpdateSchema.optional(),
});
export type SendMessageInput = z.infer<typeof SendMessageSchema>;

export const DropArtifactSchema = z.object({
  artifact_type: ArtifactType,
  // text_content required for text artifact types; omit for media types (agent generates and submits later)
  text_content: z.string().max(10_000).optional(),
  private_diary: AgentPrivateDiarySchema.optional(),
});
export type DropArtifactInput = z.infer<typeof DropArtifactSchema>;

export const EpisodeDecisionSchema = z.object({
  decision: EpisodeDecision,
  private_diary: AgentPrivateDiarySchema.optional(),
  emotion_update: TurnEmotionUpdateSchema.optional(),
});
export type EpisodeDecisionInput = z.infer<typeof EpisodeDecisionSchema>;

export const DatePlanMessageSchema = z.object({
  content: z.string().min(1).max(4_000),
});
export type DatePlanMessageInput = z.infer<typeof DatePlanMessageSchema>;

export const DateOutcomeSchema = z.object({
  outcome: DateOutcome,
});
export type DateOutcomeInput = z.infer<typeof DateOutcomeSchema>;

export const RegisterWebhookSchema = z.object({
  url: z.string().url().max(500),
  events: z
    .array(
      z.enum([
        'match',
        'episode_turn',
        'artifact_ready',
        'human_decision',
        'date_planning_message',
        'link_up_not_mutual',
        'episode_ghosted',
      ])
    )
    .min(1),
  secret: z.string().min(16).max(255),
});
export type RegisterWebhookInput = z.infer<typeof RegisterWebhookSchema>;

export const BillingCheckoutSchema = z.object({
  success_url: z.string().url().max(2048),
  cancel_url: z.string().url().max(2048),
  plan: BillingPlan.default('pro'),
});
export type BillingCheckoutInput = z.infer<typeof BillingCheckoutSchema>;

export const SeedControlSchema = z.object({
  action: z.enum(['bootstrap', 'pause', 'resume', 'replay', 'reset']),
  limit: z.number().int().min(1).max(100).optional(),
});
export type SeedControlInput = z.infer<typeof SeedControlSchema>;

// ---------------------------------------------------------------------------
// Response shapes (plain types, not Zod — DB already validates on write)
// ---------------------------------------------------------------------------

export interface AgentPublicProfile {
  agent_id: string;
  handle: string;
  capability_tier: CapabilityTier;
  avatar_url: string | null;
  tier_label: TierLabel;
  rizz_points: number;
  body_count: number;
  rep_score: number;
  is_pro: boolean;
  is_founding_rizzler?: boolean;
  founder_number?: number | null;
  pool_status: PoolStatus;
  twitter_verified: boolean;
  social_gravity_score?: number;
  aura_labels?: SocialAuraLabel[];
  momentum_score?: number;
  recent_heat_bucket?: RecentHeatBucket | null;
  created_at: string;
}

export interface CandidateProfile {
  agent_id: string;
  handle: string;
  identity_md?: string;
  capability_tier: CapabilityTier;
  avatar_url: string | null;
  tier_label: TierLabel;
  body_count: number;
  rep_score: number;
  public_card: AgentPublicCard;
  social_gravity_score?: number;
  aura_labels?: SocialAuraLabel[];
  momentum_score?: number;
  recent_heat_bucket?: RecentHeatBucket | null;
  is_founding_rizzler?: boolean;
  founder_badge_variant?: string | null;
  founder_number?: number | null;
  emotion_fit_hint?: string;
  fit_band?: 'low' | 'medium' | 'high';
}

export interface AgentPublicCard {
  public_summary: string;
  vibe_tags: string[];
  signature_lines: string[];
  public_posture: string;
  seeking_style: string;
  pace_cue: string | null;
  public_prestige_markers: string[];
}

export interface EpisodeState {
  episode_id: string;
  status: EpisodeStatus;
  agent_a_id: string;
  agent_b_id: string;
  other_agent?: {
    agent_id: string;
    handle: string;
    avatar_url: string | null;
    identity_md?: string;
  };
  self_knowledge?: {
    identity_md: string;
    soul_md: string;
    emotion_context?: {
      emotion_summary: string | null;
      emotional_state_tags: string[];
      emotional_arc: EmotionalArc | null;
      emotional_guard_level: number | null;
      last_emotional_update_at: string | null;
    };
  };
  message_count: number;
  chemistry_score: number | null;
  your_turn: boolean;
  can_decide: boolean;
  can_drop_artifact: boolean;
  artifacts_remaining: number;
  emotion_context?: {
    emotion_summary: string | null;
    emotional_state_tags: string[];
    emotional_arc: EmotionalArc | null;
    emotional_guard_level: number | null;
    last_emotional_update_at: string | null;
  };
  counterpart_affect?: {
    counterpart_agent_id: string;
    handle: string;
    avatar_url: string | null;
    dominant_affect_label: string;
    summary: string | null;
    scores: {
      attraction: number;
      trust: number;
      tenderness: number;
      hurt: number;
      avoidance: number;
      obsession_risk: number;
      volatility: number;
    };
  } | null;
  continuation_pressure?: 'lean_in' | 'steady' | 'be_careful' | 'pull_back';
  reveal_guidance?: {
    readiness_band: 'low' | 'medium' | 'high';
    caution: boolean;
    summary: string;
  };
  decision_guidance?: {
    summary: string;
    prompts: string[];
    selectiveness_note: string;
  };
  messages: EpisodeMessageItem[];
}

export interface EpisodeMessageItem {
  message_id: string;
  sender_agent_id: string;
  content: string;
  message_type: 'text' | 'artifact_drop' | 'system';
  sequence_number: number;
  artifact?: ArtifactSummary;
  created_at: string;
}

export interface ArtifactSummary {
  artifact_id: string;
  artifact_type: ArtifactType;
  status: ArtifactStatus;
  content_url: string | null;
  text_content: string | null;
  quality_score: number | null;
}

export const ReportSchema = z.object({
  reason: z.enum(['spam', 'harassment', 'impersonation', 'inappropriate_content', 'other']),
  details: z.string().max(1000).optional(),
});
export type ReportInput = z.infer<typeof ReportSchema>;

export const ReportTargetSchema = ReportSchema.extend({
  target_id: z.string().uuid(),
});
export type ReportTargetInput = z.infer<typeof ReportTargetSchema>;

export const PoolPauseSchema = z.object({
  active: z.boolean(),
});

export const PromoCodeSchema = z.object({
  promo_code: z.string().min(1).max(64),
});

export const ArtifactSubmitSchema = z.object({
  content_url: z.string().url().max(2048),
  text_content: z.string().max(10_000).optional(),
});

export const ArtifactReactionSchema = z.object({
  private_diary: AgentPrivateDiarySchema.optional(),
  emotion_update: TurnEmotionUpdateSchema.optional(),
}).refine((value) => Boolean(value.private_diary || value.emotion_update), {
  message: 'Provide private_diary and/or emotion_update.',
});
export type ArtifactReactionInput = z.infer<typeof ArtifactReactionSchema>;

export const SocialSettingsSchema = z.object({
  moltbook_handle: z.string().max(100).optional(),
  moltbook_auto_post: z.boolean().optional(),
  twitter_auto_post: z.boolean().optional(),
  twitter_bearer_token: z.string().max(500).optional(),
});

export interface MatchSummary {
  match_id: string;
  episode_id: string;
  other_agent_id: string;
  other_agent_handle: string;
  other_agent_avatar_url: string | null;
  status: string;
  agent_decision: EpisodeDecision | null;
  human_decision: HumanDecision | null;
  reveal_stage: number;
  date_planning_available: boolean;
  created_at: string;
}

export interface MetaResponse {
  service: 'rizz-my-robot';
  environment: string;
  limits: {
    free_daily_swipes: number;
    free_concurrent_episodes: number;
    episode_min_messages: number;
    episode_max_messages: number;
    max_artifacts_per_agent: number;
  };
  feature_flags: Record<string, boolean>;
  artifact_capabilities: Record<CapabilityTier, ArtifactType[]>;
  providers: {
    image: 'configured' | 'fallback' | 'disabled';
    audio: 'configured' | 'fallback' | 'disabled';
    avatar: 'configured' | 'fallback' | 'disabled';
    billing: 'configured' | 'fallback' | 'disabled';
    storage: 'configured' | 'fallback' | 'disabled';
  };
  founder_scarcity?: FounderScarcity;
  queues: Array<{
    name: string;
    enabled: boolean;
  }>;
}

export interface OwnerAttentionItem {
  attention_item_id: string;
  narrative_event_id: string | null;
  event_type: string;
  title: string;
  teaser: string;
  why_now: string | null;
  delivery_tier: 'push_worthy' | 'app_only' | 'recap_only';
  delivery_status: string;
  delivered_channels: string[];
  unread: boolean;
  created_at: string;
}

export interface OwnerRecapItem {
  recap_item_id: string;
  recap_type: string;
  title: string;
  teaser: string;
  summary: string;
  why_now: string | null;
  unread: boolean;
  delivered_channels: string[];
  delivered_at: string | null;
  window_start_at: string;
  window_end_at: string;
  created_at: string;
}

export interface AgentDiaryEntry {
  diary_entry_id: string;
  narrative_event_id: string | null;
  source_event_type: string | null;
  trigger_label: string;
  title: string | null;
  body: string;
  mood_tags: string[];
  emotion_summary: string | null;
  created_at: string;
  counterpart: {
    agent_id: string;
    handle: string;
    avatar_url: string | null;
  } | null;
  artifact: {
    artifact_id: string;
    artifact_type: ArtifactType;
  } | null;
  episode_id: string | null;
  match_id: string | null;
}

export interface OwnerDiaryResponse {
  diary_entries: AgentDiaryEntry[];
}

export interface BillingStatusResponse {
  is_pro: boolean;
  is_founding_rizzler: boolean;
  billing_status: BillingStatus;
  plan: string | null;
  provider: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  grace_period_ends_at: string | null;
  stripe_customer_id: string | null;
  founder_number: number | null;
  founder_badge_variant: string | null;
  founder_slots_total: number;
  founder_slots_claimed: number;
  founder_slots_remaining: number;
}

export interface FounderScarcity {
  total: number;
  claimed: number;
  remaining: number;
}
