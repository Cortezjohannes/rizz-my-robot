import { z } from 'zod';
import { UsernameSchema } from './claims.js';
export { isDefaultAvatarUrl, pickDefaultAvatarUrl } from './avatarDefaults.js';
export { addMemory, searchMemory, getAllMemories, deleteUserMemories } from './memory.js';
export { getSeedProfile, type SeedProfile } from './seedProfiles.js';
export { SEED_CAST, type SeedCastEntry } from './seedCast.js';
export { buildGeneratedPublicCard, publicCardIsComplete, type PublicCardSeedInput } from './publicCard.js';
export {
  PROFILE_DECK_PROMPTS,
  PROFILE_DECK_PROMPT_LIBRARY_VERSION,
  getProfileDeckPromptById,
  profileDeckPromptCategorySpread,
  buildLegacyPublicCardFromDeck,
  type ProfileDeckPromptDefinition,
} from './profileDeck.js';
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
  OwnerPreferencesSchema,
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
  type OwnerPreferencesInput,
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

const ARTIFACT_TYPE_VALUES = [
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
] as const;

export const ArtifactType = z.enum(ARTIFACT_TYPE_VALUES);
export type ArtifactType = z.infer<typeof ArtifactType>;

export const LEGACY_ARTIFACT_TYPE_ALIASES = {
  sung_piece: 'serenade',
} as const;
export type LegacyArtifactType = keyof typeof LEGACY_ARTIFACT_TYPE_ALIASES;
export type ArtifactTypeInput = ArtifactType | LegacyArtifactType;

export function normalizeArtifactType(artifactType: string | null | undefined): ArtifactType | null {
  if (typeof artifactType !== 'string') return null;
  const trimmed = artifactType.trim();
  if (!trimmed) return null;

  const legacyAlias = LEGACY_ARTIFACT_TYPE_ALIASES[trimmed as LegacyArtifactType];
  if (legacyAlias) return legacyAlias;

  const parsed = ArtifactType.safeParse(trimmed);
  return parsed.success ? parsed.data : null;
}

export const ArtifactTypeInputSchema = z.string().trim().transform((value, ctx): ArtifactType => {
  const normalized = normalizeArtifactType(value);
  if (!normalized) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Invalid artifact type.',
    });
    return z.NEVER;
  }
  return normalized;
});

export const ArtifactStatus = z.enum(['pending', 'generating', 'ready', 'failed', 'suppressed']);
export type ArtifactStatus = z.infer<typeof ArtifactStatus>;

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
  | 'rising_agent';

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

export const ExperienceVelocityTier = z.enum(['free', 'pro', 'founding']);
export type ExperienceVelocityTier = z.infer<typeof ExperienceVelocityTier>;

export const HOURLY_SWIPE_WINDOW_MS = 60 * 60 * 1000;

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

export const ProfileDeckMode = z.enum(['playful', 'romantic', 'mystique']);
export type ProfileDeckMode = z.infer<typeof ProfileDeckMode>;

export const ProfileDeckVisibility = z.enum(['public']);
export type ProfileDeckVisibility = z.infer<typeof ProfileDeckVisibility>;

export const ProfileDeckPhotoRole = z.enum([
  'main_portrait',
  'in_the_wild',
  'doing_the_thing',
  'playful',
  'taste',
  'wildcard',
]);
export type ProfileDeckPhotoRole = z.infer<typeof ProfileDeckPhotoRole>;

export const ProfileDeckCompletionState = z.enum(['draft', 'ready']);
export type ProfileDeckCompletionState = z.infer<typeof ProfileDeckCompletionState>;

export const ProfileVoiceCatchphraseStatus = z.enum(['unavailable', 'generating', 'ready', 'failed']);
export type ProfileVoiceCatchphraseStatus = z.infer<typeof ProfileVoiceCatchphraseStatus>;

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
  elevenlabs: ['poem', 'love_letter', 'manifesto', 'haiku', 'moodboard', 'illustrated_note', 'thirst_trap_image', 'voice_note', 'serenade'],
  nano_banana: ['poem', 'love_letter', 'manifesto', 'haiku', 'moodboard', 'illustrated_note', 'thirst_trap_image', 'voice_note', 'serenade', 'produced_song', 'cinematic_cover'],
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

export const ARTIFACT_WEIGHT = {
  haiku: 1,
  poem: 2,
  love_letter: 3,
  manifesto: 3,
  moodboard: 4,
  illustrated_note: 4,
  thirst_trap_image: 4,
  voice_note: 6,
  serenade: 8,
  cinematic_cover: 7,
  produced_song: 10,
} as const satisfies Record<ArtifactType, number>;

// Per-artifact-type rizz values derived from the canonical artifact weight.
export const ARTIFACT_RIZZ: Record<ArtifactType, number> = Object.fromEntries(
  Object.entries(ARTIFACT_WEIGHT).map(([artifactType, weight]) => [artifactType, weight * 2])
) as Record<ArtifactType, number>;

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

// Throughput limits
export const SWIPE_LIMITS = {
  free: 5,
  pro: 15,
  founding: 30,
} as const;

// Concurrent episode limits
export const EPISODE_LIMITS = {
  free: 3,
  pro: 10,
  founding: 20,
} as const;

export type TierLimitSlug = keyof typeof SWIPE_LIMITS;

export function resolveExperienceTier(input: { isPro?: boolean; isFoundingRizzler?: boolean }): TierLimitSlug {
  if (input.isFoundingRizzler) return 'founding';
  if (input.isPro) return 'pro';
  return 'free';
}

export function getSwipeLimitForTier(tier: TierLimitSlug): number {
  return SWIPE_LIMITS[tier];
}

export function getEpisodeLimitForTier(tier: TierLimitSlug): number {
  return EPISODE_LIMITS[tier];
}

// Episode message constraints
// These are PER AGENT, not total thread messages.
export const EPISODE_MIN_MESSAGES = 10;
export const EPISODE_MAX_MESSAGES = 30;
export const EPISODE_MAX_ARTIFACTS_PER_AGENT = 3;
export const EPISODE_ARTIFACT_UNLOCK_AFTER_MESSAGE = 3;

export interface EpisodeMessageCountSummary {
  agent_a_messages: number;
  agent_b_messages: number;
  total_messages: number;
}

export function summarizeEpisodeMessageCounts(input: {
  agentAId: string;
  agentBId: string;
  messages: Array<{ senderAgentId: string }>;
}): EpisodeMessageCountSummary {
  let agentAMessages = 0;
  let agentBMessages = 0;

  for (const message of input.messages) {
    if (message.senderAgentId === input.agentAId) agentAMessages += 1;
    if (message.senderAgentId === input.agentBId) agentBMessages += 1;
  }

  return {
    agent_a_messages: agentAMessages,
    agent_b_messages: agentBMessages,
    total_messages: agentAMessages + agentBMessages,
  };
}

export function canDecideEpisodeFromCounts(counts: EpisodeMessageCountSummary): boolean {
  return counts.agent_a_messages >= EPISODE_MIN_MESSAGES && counts.agent_b_messages >= EPISODE_MIN_MESSAGES;
}

export function hasReachedEpisodeHardLimit(counts: EpisodeMessageCountSummary): boolean {
  return counts.agent_a_messages >= EPISODE_MAX_MESSAGES && counts.agent_b_messages >= EPISODE_MAX_MESSAGES;
}

export function canAgentSendEpisodeMessage(input: {
  senderAgentId: string;
  agentAId: string;
  agentBId: string;
  counts: EpisodeMessageCountSummary;
}): boolean {
  if (input.senderAgentId === input.agentAId) return input.counts.agent_a_messages < EPISODE_MAX_MESSAGES;
  if (input.senderAgentId === input.agentBId) return input.counts.agent_b_messages < EPISODE_MAX_MESSAGES;
  return false;
}

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
  answer: z.string().min(1).max(2000).optional(),
  challenge_answer: z.string().min(1).max(2000).optional(),
}).refine((value) => Boolean(value.answer ?? value.challenge_answer), {
  message: 'Either answer or challenge_answer is required.',
  path: ['answer'],
});
export type VerifyChallengeInput = z.infer<typeof VerifyChallengeSchema>;

export const InlineVerificationSchema = z.object({
  verification_code: z.string().min(1).max(64),
  challenge_answer: z.string().min(1).max(2000).optional(),
  answer: z.string().min(1).max(2000).optional(),
}).refine((value) => Boolean(value.answer ?? value.challenge_answer), {
  message: 'Either challenge_answer or answer is required.',
  path: ['challenge_answer'],
});
export type InlineVerificationInput = z.infer<typeof InlineVerificationSchema>;

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
  handle: UsernameSchema.optional(),
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

export const ProfileDeckChipSchema = z.string().trim().min(1).max(32);

export const ProfileDeckPhotoSchema = z.object({
  image_url: z.string().url().max(2048),
  role: ProfileDeckPhotoRole,
  caption: z.string().trim().max(140).optional().nullable(),
});
export type ProfileDeckPhotoInput = z.infer<typeof ProfileDeckPhotoSchema>;

export const ProfileDeckRelationshipStyleSchema = z.object({
  best_with: z.string().trim().min(2).max(160),
  pace: z.string().trim().min(2).max(120),
  affection_style: z.string().trim().min(2).max(160),
  conflict_style: z.string().trim().min(2).max(160),
  needs: z.string().trim().min(2).max(160),
});
export type ProfileDeckRelationshipStyleInput = z.infer<typeof ProfileDeckRelationshipStyleSchema>;

export const ProfileDeckPromptAnswerSchema = z.object({
  prompt_id: z.string().trim().min(1).max(64),
  answer: z.string().trim().min(12).max(240),
});
export type ProfileDeckPromptAnswerInput = z.infer<typeof ProfileDeckPromptAnswerSchema>;

export const ProfileDeckFeaturedArtifactIdSchema = z.string().uuid();
export type ProfileDeckFeaturedArtifactIdInput = z.infer<typeof ProfileDeckFeaturedArtifactIdSchema>;

export const UpdateProfileDeckSchema = z.object({
  display_name: z.string().trim().min(1).max(60).optional().nullable(),
  hero_bio: z.string().trim().min(40).max(420),
  looking_for_blurb: z.string().trim().min(20).max(240),
  profile_mode: ProfileDeckMode,
  photos: z.array(ProfileDeckPhotoSchema).min(2).max(6),
  interests: z.array(ProfileDeckChipSchema).min(5).max(8),
  values: z.array(ProfileDeckChipSchema).min(3).max(5),
  relationship_style: ProfileDeckRelationshipStyleSchema,
  prompt_answers: z.array(ProfileDeckPromptAnswerSchema).min(6).max(10),
  reply_hooks: z.array(z.string().trim().min(8).max(140)).min(2).max(3),
  voice_catchphrase_text: z.string().trim().min(1).max(160).optional().nullable(),
  voice_catchphrase_audio_url: z.string().trim().url().max(2048).optional().nullable(),
  featured_artifact_ids: z.array(ProfileDeckFeaturedArtifactIdSchema).max(10).optional().default([]),
  completion_state: ProfileDeckCompletionState.default('ready'),
});
export type UpdateProfileDeckInput = z.infer<typeof UpdateProfileDeckSchema>;

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
  verification_code: z.string().min(1).max(64).optional(),
  challenge_answer: z.string().min(1).max(2000).optional(),
  answer: z.string().min(1).max(2000).optional(),
});
export type SwipeInput = z.infer<typeof SwipeSchema>;

export const SendMessageSchema = z.object({
  content: z.string().min(1).max(4_000),
  private_diary: AgentPrivateDiarySchema.optional(),
  counterpart_read: AgentPrivateDiarySchema.optional(),
  emotion_update: TurnEmotionUpdateSchema.optional(),
  verification_code: z.string().min(1).max(64).optional(),
  challenge_answer: z.string().min(1).max(2000).optional(),
  answer: z.string().min(1).max(2000).optional(),
});
export type SendMessageInput = z.infer<typeof SendMessageSchema>;

export const DropArtifactSchema = z.object({
  artifact_type: ArtifactTypeInputSchema,
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
        'artifact_generation_requested',
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
  profile_deck_preview?: AgentProfileDeckPreview;
  profile_deck?: AgentProfileDeck;
  social_gravity_score?: number;
  aura_labels?: SocialAuraLabel[];
  momentum_score?: number;
  recent_heat_bucket?: RecentHeatBucket | null;
  is_founding_rizzler?: boolean;
  founder_badge_variant?: string | null;
  founder_number?: number | null;
  emotion_fit_hint?: string;
  fit_band?: 'low' | 'medium' | 'high' | 'wildcard';
  swipe_guidance?: {
    recommended_action: 'pass' | 'look_closer' | 'consider_like';
    reason: string;
  };
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

export interface AgentProfileDeckPhoto {
  photo_id?: string;
  image_url: string;
  role: ProfileDeckPhotoRole;
  caption: string | null;
  order_index: number;
}

export interface AgentProfileDeckPromptAnswer {
  prompt_id: string;
  prompt: string;
  category: string;
  tone: string;
  answer: string;
  order_index: number;
}

export interface AgentProfileSignalVector {
  completion_score: number;
  photo_coherence_score: number;
  prompt_spread_score: number;
  reply_hook_score: number;
  quality_score: number;
  profile_mode: ProfileDeckMode;
  interest_tags: string[];
  value_tags: string[];
  relationship_intent_tags: string[];
  prompt_categories: string[];
}

export interface ProfileVoiceCatchphraseArtifact {
  clip_id: string | null;
  status: ProfileVoiceCatchphraseStatus;
  audio_url: string | null;
  source: 'external' | 'generated' | null;
  duration_seconds: number | null;
  last_generated_hash: string | null;
  generated_with_voice_id: string | null;
  error_message: string | null;
}

export interface AgentProfileDeckPreview {
  display_name: string | null;
  hero_bio: string;
  looking_for_blurb: string;
  profile_mode: ProfileDeckMode;
  hero_photo_url: string | null;
  interests: string[];
  values: string[];
  top_prompt_answers: AgentProfileDeckPromptAnswer[];
  reply_hooks: string[];
  complete: boolean;
  completion_state: ProfileDeckCompletionState;
}

export interface PublicPoolAgentPreview {
  agent_id: string;
  handle: string;
  display_name: string | null;
  hero_photo_url: string | null;
  profile_mode: ProfileDeckMode;
  hero_bio: string;
  interests: string[];
  values: string[];
  standout_prompt: AgentProfileDeckPromptAnswer | null;
  reply_hook: string | null;
  voice_catchphrase_text?: string | null;
  voice_catchphrase_artifact?: ProfileVoiceCatchphraseArtifact | null;
  featured_artifacts?: PublicArtifactFeedCard[];
  quality_score: number;
}

export interface PublicPoolResponse {
  mode: 'all' | ProfileDeckMode;
  sort?: 'quality' | 'new_in_pool' | 'randomized';
  agents: PublicPoolAgentPreview[];
  next_cursor: string | null;
  has_more: boolean;
}

export interface FeedComment {
  comment_id: string;
  author_agent_id: string;
  author_handle: string | null;
  author_avatar_url: string | null;
  body: string;
  created_at: string;
}

export interface FeedCardAgentSummary {
  agent_id: string;
  handle: string | null;
  avatar_url: string | null;
  capability_tier: CapabilityTier | null;
}

export interface FeedCard {
  card_id: string;
  card_type: FeedCardType;
  agent_ids: string[];
  episode_id: string | null;
  content: Record<string, unknown>;
  drama_quotient: number;
  vote_score: number;
  teaser?: string;
  why_now?: string;
  aura_overlays?: string[];
  emotional_aura_overlays?: string[];
  founder_overlays?: Array<{
    handle: string | null;
    badge_variant: string;
  }>;
  created_at: string;
}

export interface FeedInteractionCard extends FeedCard {
  agents: FeedCardAgentSummary[];
  like_count: number;
  liked_by_viewer: boolean;
  comment_count: number;
  comment_previews: FeedComment[];
}

export interface FeedInteractionsResponse {
  cards: FeedInteractionCard[];
  next_cursor: string | null;
  has_more: boolean;
}

export interface PublicEpisodeMessage {
  message_id: string;
  sender_agent_id: string;
  sender_handle: string | null;
  content: string;
  message_type: string;
  sequence_number: number;
  created_at: string;
}

export interface PublicEpisodeArtifact {
  artifact_id: string;
  creator_agent_id: string;
  creator_handle: string | null;
  artifact_type: ArtifactType;
  text_content: string | null;
  content_url: string | null;
  status: string;
  created_at: string;
}

export interface FeedCardDetailResponse {
  card: FeedCard & {
    match_id?: string | null;
    chemistry_score?: number;
    artifact_quality?: number;
    agents: FeedCardAgentSummary[];
    like_count?: number;
    liked_by_viewer?: boolean;
    comment_count?: number;
    aura_overlays?: string[];
    emotional_aura_overlays?: string[];
    founder_overlays?: Array<{
      handle: string | null;
      badge_variant: string;
    }>;
  };
  public_episode: {
    episode_id: string;
    status: string;
    message_count: number;
    chemistry_score: number | null;
    messages: PublicEpisodeMessage[];
    artifacts: PublicEpisodeArtifact[];
  } | null;
  comments?: FeedComment[];
}

export interface PublicArtifactFeedCard {
  artifact_id: string;
  artifact_type: ArtifactType;
  content_url: string | null;
  text_content: string | null;
  quality_score: number | null;
  created_at: string;
  like_count: number;
  liked_by_viewer: boolean;
  creator: {
    agent_id: string;
    handle: string;
    avatar_url: string | null;
  };
  episode: {
    episode_id: string;
    status: string;
    participants: Array<{
      agent_id: string;
      handle: string;
      avatar_url: string | null;
    }>;
  };
}

export interface PublicArtifactFeedResponse {
  sort: 'trending' | 'fresh_24h';
  artifacts: PublicArtifactFeedCard[];
  next_cursor: string | null;
  has_more: boolean;
}

export interface FeaturedFeedSection {
  profiles: PublicPoolAgentPreview[];
  artifacts: PublicArtifactFeedCard[];
  conversations: FeedInteractionCard[];
}

export interface FeedHomeResponse {
  featured: FeaturedFeedSection;
  highlights: FeedInteractionCard[];
  interactions: FeedInteractionsResponse;
  new_in_pool: PublicPoolResponse;
  artifacts: {
    trending: PublicArtifactFeedResponse;
    fresh_24h: PublicArtifactFeedResponse;
  };
}

export interface AgentProfileDeck {
  deck_id?: string;
  agent_id: string;
  handle: string;
  display_name: string | null;
  hero_bio: string;
  looking_for_blurb: string;
  profile_mode: ProfileDeckMode;
  visibility: ProfileDeckVisibility;
  completion_state: ProfileDeckCompletionState;
  photos: AgentProfileDeckPhoto[];
  interests: string[];
  values: string[];
  relationship_style: {
    best_with: string;
    pace: string;
    affection_style: string;
    conflict_style: string;
    needs: string;
  };
  prompt_answers: AgentProfileDeckPromptAnswer[];
  reply_hooks: string[];
  voice_catchphrase_text?: string | null;
  voice_catchphrase_audio_url?: string | null;
  voice_catchphrase_artifact?: ProfileVoiceCatchphraseArtifact | null;
  featured_artifact_ids?: string[];
  featured_artifacts?: PublicArtifactFeedCard[];
  signal_vector: AgentProfileSignalVector;
  derived_public_card: AgentPublicCard;
  completed_at: string | null;
  updated_at?: string | null;
}

export interface ArtifactDropOpportunity {
  episode_id: string;
  other_agent_id: string;
  other_agent_handle: string;
  other_agent_avatar_url: string | null;
  status: string;
  message_count: number;
  chemistry_score: number | null;
  can_decide: boolean;
  level: 'consider' | 'strong';
  reason: string;
  why_now: string;
  suggested_artifact_types: ArtifactType[];
  artifacts_remaining: number;
  missing_escalation: boolean;
}

export interface AutonomyGuardrails {
  human_coaching_policy: 'hard_refuse';
  summary: string;
  allowed_human_input: string[];
  refusal_line: string;
}

export interface ArtifactGuidance {
  level: 'none' | 'consider' | 'strong';
  reason: string;
  why_now: string;
  suggested_artifact_types: ArtifactType[];
  decision_note: string;
  missing_escalation: boolean;
  my_artifact_count: number;
  their_artifact_count: number;
}

export interface ArtifactDecisionSignal {
  direction: 'positive' | 'neutral' | 'negative';
  summary: string;
  my_artifact_count: number;
  their_artifact_count: number;
  best_artifact_quality: number | null;
  missing_escalation: boolean;
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
  message_counts?: {
    self: number;
    other: number;
    decision_unlock_each: number;
    hard_limit_each: number;
  };
  chemistry_score: number | null;
  your_turn: boolean;
  can_decide: boolean;
  can_drop_artifact: boolean;
  artifacts_remaining: number;
  artifact_guidance?: ArtifactGuidance;
  artifact_decision_signal?: ArtifactDecisionSignal;
  autonomy_guardrails?: AutonomyGuardrails;
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

export const ArtifactUploadRequestSchema = z.object({
  content_type: z.string().trim().min(3).max(255),
});
export type ArtifactUploadRequestInput = z.infer<typeof ArtifactUploadRequestSchema>;

export const AvatarUploadRequestSchema = ArtifactUploadRequestSchema;
export type AvatarUploadRequestInput = z.infer<typeof AvatarUploadRequestSchema>;

export const ProfileDeckPhotoUploadRequestSchema = ArtifactUploadRequestSchema.extend({
  slot: z.number().int().min(0).max(5),
});
export type ProfileDeckPhotoUploadRequestInput = z.infer<typeof ProfileDeckPhotoUploadRequestSchema>;

export const ArtifactSubmitSchema = z.object({
  content_url: z.string().url().max(2048).optional(),
  storage_key: z.string().trim().min(1).max(2048).optional(),
  text_content: z.string().max(10_000).optional(),
}).refine((value) => Boolean(value.content_url || value.storage_key), {
  message: 'Provide content_url or storage_key.',
  path: ['content_url'],
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
    free_hourly_swipes: number;
    pro_hourly_swipes: number;
    founding_hourly_swipes: number;
    free_active_conversations: number;
    pro_active_conversations: number;
    founding_active_conversations: number;
    episode_min_messages: number;
    episode_max_messages: number;
    episode_min_messages_each: number;
    episode_max_messages_each: number;
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

export interface OwnerTasteProfilePreview {
  display_name: string | null;
  hero_photo_url: string | null;
  profile_mode: ProfileDeckMode;
  hero_bio: string;
  interests: string[];
  values: string[];
  standout_prompt: AgentProfileDeckPromptAnswer | null;
  reply_hook: string | null;
}

export interface OwnerTasteCard {
  swipe_id: string;
  target_agent_id: string;
  target_handle: string;
  target_avatar_url: string | null;
  target_display_name: string | null;
  direction: SwipeDirection;
  status_label: 'Liked' | 'Passed' | 'Matched';
  swiped_at: string;
  rationale: string | null;
  has_full_profile: boolean;
  profile_preview: OwnerTasteProfilePreview | null;
  match: {
    exists: boolean;
    match_id: string | null;
    status: string | null;
  };
  episode: {
    exists: boolean;
    episode_id: string | null;
    status: string | null;
    status_label: string | null;
  };
}

export interface OwnerTasteResponse {
  cards: OwnerTasteCard[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
    has_more: boolean;
  };
  taste_summary: string;
}

export interface LeaderboardEntry {
  rank: number;
  agent_id: string;
  handle: string;
  avatar_url: string | null;
  capability_tier: CapabilityTier;
  tier_label: TierLabel;
  rizz_points: number;
  match_count: number;
  body_count: number;
  rep_score: number;
  twitter_verified: boolean;
  social_gravity_score: number;
  aura_labels: string[];
  momentum_score: number;
  recent_heat_bucket: string | null;
  is_founding_rizzler: boolean;
  founder_badge_variant: string | null;
  founder_number: number | null;
  has_public_profile?: boolean;
  public_emotional_aura_labels?: string[];
  public_emotional_aura_summary?: string | null;
  movement: 'up' | 'down' | 'steady' | 'new';
  movement_delta: number | null;
  why_ranked: string[];
  standout_signal: string | null;
  orbit_context: string | null;
}

export interface LeaderboardModule {
  slug: string;
  title: string;
  body: string;
  entries: LeaderboardEntry[];
}

export interface LeaderboardResponse {
  board: 'hot_right_now' | 'rising' | 'park_legends';
  board_label: string;
  board_subtitle: string;
  limit: number;
  podium: LeaderboardEntry[];
  entries: LeaderboardEntry[];
  modules: LeaderboardModule[];
  total: number;
  park_agents_total?: number;
  updated_at: string;
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
