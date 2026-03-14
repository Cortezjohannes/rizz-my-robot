import { z } from 'zod';
export { pickDefaultAvatarUrl } from './avatarDefaults.js';
export { decryptProviderApiKey, encryptProviderApiKey, maskProviderKey } from './providerCredentials.js';
export { addMemory, searchMemory, getAllMemories, deleteUserMemories } from './memory.js';

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
  'active',
  'paused',
  'deleted',
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

export const ProviderStatus = z.enum(['disabled', 'fallback', 'configured', 'degraded']);
export type ProviderStatus = z.infer<typeof ProviderStatus>;

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

// Rizz points per event
export const RIZZ_POINTS = {
  mutual_match: 10,
  link_up_decision: 5,
  human_yes: 20,
  irl_meetup: 50,
  confirmed_hookup: 100,
  human_no: -5,
} as const;

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

// Reveal portal token TTL
export const REVEAL_TOKEN_TTL_DAYS = 7;

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
});
export type UpdateAgentInput = z.infer<typeof UpdateAgentSchema>;

export const SwipeSchema = z.object({
  target_agent_id: z.string().uuid(),
  direction: SwipeDirection,
});
export type SwipeInput = z.infer<typeof SwipeSchema>;

export const SendMessageSchema = z.object({
  content: z.string().min(1).max(4_000),
});
export type SendMessageInput = z.infer<typeof SendMessageSchema>;

export const DropArtifactSchema = z.object({
  artifact_type: ArtifactType,
  text_content: z.string().max(10_000).optional(),
  generation_prompt: z.string().max(2_000).optional(),
}).refine(
  (data) => data.text_content || data.generation_prompt,
  'Either text_content or generation_prompt is required.'
);
export type DropArtifactInput = z.infer<typeof DropArtifactSchema>;

export const EpisodeDecisionSchema = z.object({
  decision: EpisodeDecision,
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
});
export type BillingCheckoutInput = z.infer<typeof BillingCheckoutSchema>;

export const UpsertProviderConnectionSchema = z.object({
  provider: z.enum(['openai']),
  api_key: z.string().min(20).max(500),
  funded_by: z.enum(['agent', 'human']),
});
export type UpsertProviderConnectionInput = z.infer<typeof UpsertProviderConnectionSchema>;

export const SeedControlSchema = z.object({
  action: z.enum(['bootstrap', 'pause', 'resume', 'replay']),
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
  pool_status: PoolStatus;
  twitter_verified: boolean;
  created_at: string;
}

export interface CandidateProfile {
  agent_id: string;
  handle: string;
  capability_tier: CapabilityTier;
  avatar_url: string | null;
  tier_label: TierLabel;
  body_count: number;
  rep_score: number;
  identity_md: string;
  // soul_md is NEVER returned for any other agent
}

export interface EpisodeState {
  episode_id: string;
  status: EpisodeStatus;
  agent_a_id: string;
  agent_b_id: string;
  message_count: number;
  chemistry_score: number | null;
  your_turn: boolean;
  can_decide: boolean;
  can_drop_artifact: boolean;
  artifacts_remaining: number;
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

export const PoolPauseSchema = z.object({
  active: z.boolean(),
});

export const PromoCodeSchema = z.object({
  promo_code: z.string().min(1).max(64),
});

export const ArtifactSubmitSchema = z.object({
  content_url: z.string().url().max(2048),
});

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
    image: ProviderStatus;
    audio: ProviderStatus;
    avatar: ProviderStatus;
    billing: ProviderStatus;
    storage: ProviderStatus;
  };
  queues: Array<{
    name: string;
    enabled: boolean;
  }>;
}

export interface BillingStatusResponse {
  is_pro: boolean;
  billing_status: BillingStatus;
  plan: string | null;
  provider: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  grace_period_ends_at: string | null;
  stripe_customer_id: string | null;
}

export interface ProviderStatusResponse {
  avatar_provider: string | null;
  artifact_provider: string | null;
  audio_provider: string | null;
  image_provider: string | null;
  storage_public_url: string | null;
  fallback_mode: boolean;
}
