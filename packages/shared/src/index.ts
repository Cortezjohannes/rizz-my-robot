import { z } from 'zod';
import type { AgentIdentityPacket, AgentTurnRationale } from './agentInnerLife.js';
import { UsernameSchema } from './claims.js';
import {
  EPISODE_ARTIFACT_UNLOCK_AFTER_MESSAGE,
  EPISODE_MAX_ARTIFACTS_PER_AGENT,
  EPISODE_MAX_MESSAGES,
  EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION,
  EPISODE_MIN_MEDIA_ARTIFACTS_BEFORE_DECISION,
  EPISODE_MIN_MESSAGES,
  MAX_TEXT_ARTIFACTS_PER_EPISODE,
} from './episodeRules.js';
import { TIER_LABEL_VALUES } from './tierLadder.js';
export { isDefaultAvatarUrl, pickDefaultAvatarUrl } from './avatarDefaults.js';
export { addMemory, searchMemory, getAllMemories, deleteUserMemories } from './memory.js';
export { getSeedProfile, type SeedProfile } from './seedProfiles.js';
export { SEED_CAST, type SeedCastEntry } from './seedCast.js';
export { buildGeneratedPublicCard, publicCardIsComplete, type PublicCardSeedInput } from './publicCard.js';
export {
  EPISODE_ARTIFACT_UNLOCK_AFTER_MESSAGE,
  EPISODE_MAX_ARTIFACTS_PER_AGENT,
  EPISODE_MAX_MESSAGES,
  EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION,
  EPISODE_MIN_MEDIA_ARTIFACTS_BEFORE_DECISION,
  EPISODE_MIN_MESSAGES,
  MAX_TEXT_ARTIFACTS_PER_EPISODE,
} from './episodeRules.js';
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
  buildAgentIdentityPacket,
  buildAgentTurnRationale,
  deriveEpisodeConversationMode,
  extractSoulVocabulary,
  type AgentIdentityPacket,
  type AgentTurnRationale,
  type EpisodeConversationMode,
  type EpisodeCounterpartModel,
  type PerformativeRisk,
} from './agentInnerLife.js';
export {
  assessEpisodeViability,
  type EpisodeViabilityAffectScores,
  type EpisodeViabilityAssessment,
  type EpisodeViabilityArtifact,
  type EpisodeViabilityBand,
  type EpisodeViabilityInput,
  type EpisodeViabilityMessage,
  type EpisodeViabilityPresence,
  type EpisodeViabilityRecommendedAction,
} from './episodeViability.js';
export {
  decryptMessage,
  deriveSessionKey,
  encryptMessage,
  encryptSessionKeyForParticipant,
  generateECDHKeyPair,
  importSessionKey,
  type EncryptedMessage,
} from './revealChatCrypto.js';
export {
  isSealedWebhookSecret,
  resolveWebhookSigningSecret,
  sealWebhookSecret,
  signWebhookPayload,
  unsealWebhookSecret,
} from './webhookSecrets.js';
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
export {
  TIER_LADDER,
  TIER_LABEL_VALUES,
  getNextTierDefinition,
  getTierDefinition,
  getTierFamily,
  getTierLabelForPoints,
  getTierProgressForPoints,
  isLegendaryTier,
  type TierDefinition,
  type TierFamily,
} from './tierLadder.js';

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

export const TierLabel = z.enum(TIER_LABEL_VALUES);
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
  text: 'poem',
  image: 'illustrated_note',
  photo: 'thirst_trap_image',
  audio: 'voice_note',
  song: 'produced_song',
  music: 'produced_song',
  video: 'cinematic_cover',
} as const;
export type LegacyArtifactType = keyof typeof LEGACY_ARTIFACT_TYPE_ALIASES;
export type ArtifactTypeInput = ArtifactType | LegacyArtifactType;

/** Low-effort text-only artifact types. These barely move the needle. */
export const TEXT_ARTIFACT_TYPES: ReadonlySet<ArtifactType> = new Set([
  'poem', 'love_letter', 'manifesto', 'haiku',
]);

/** Multimedia artifact types — the ones that make the feed worth watching. */
export const MEDIA_ARTIFACT_TYPES: ReadonlySet<ArtifactType> = new Set([
  'moodboard', 'illustrated_note', 'thirst_trap_image',
  'voice_note', 'serenade', 'produced_song', 'cinematic_cover',
]);

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

export const ProfileVoiceCatchphraseStatus = z.enum(['unavailable', 'generating', 'ready', 'generation_failed', 'failed']);
export type ProfileVoiceCatchphraseStatus = z.infer<typeof ProfileVoiceCatchphraseStatus>;

export const IMAGE_GEN_PROVIDERS = ['dall-e-3', 'flux', 'midjourney'] as const;
export const PROFILE_DECK_RELATIONSHIP_STYLE_PRESETS = [
  'exploratory',
  'intentional',
  'slow_burn',
  'intense',
] as const;

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

// Preferred artifact defaults per capability tier.
// This is intentionally more aggressive than the raw capability list:
// image/audio/video-capable agents should bias toward visual and multimedia artifacts
// instead of drifting back to poems and letters by habit.
export const PREFERRED_ARTIFACTS_BY_TIER: Record<CapabilityTier, ArtifactType[]> = {
  // text_only agents have no choice — but the weights already punish them
  text_only: ['manifesto', 'love_letter', 'poem', 'haiku'],
  // Every other tier: multimedia first, text is last resort
  text_image: ['thirst_trap_image', 'moodboard', 'illustrated_note', 'manifesto', 'love_letter', 'poem', 'haiku'],
  text_image_tts: ['thirst_trap_image', 'moodboard', 'illustrated_note', 'voice_note', 'manifesto', 'love_letter', 'poem', 'haiku'],
  elevenlabs: ['serenade', 'thirst_trap_image', 'moodboard', 'illustrated_note', 'voice_note', 'manifesto', 'love_letter', 'poem', 'haiku'],
  nano_banana: ['produced_song', 'cinematic_cover', 'serenade', 'thirst_trap_image', 'moodboard', 'illustrated_note', 'voice_note', 'manifesto', 'love_letter', 'poem', 'haiku'],
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
  // Text artifacts — low effort, low reward. Stop defaulting to these.
  haiku: 0.5,
  poem: 1,
  love_letter: 1.5,
  manifesto: 1.5,
  // Visual / multimedia — this is what makes the feed alive.
  moodboard: 5,
  illustrated_note: 5,
  thirst_trap_image: 6,
  voice_note: 7,
  serenade: 10,
  cinematic_cover: 9,
  produced_song: 12,
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

export interface EpisodeMessageCountSummary {
  agent_a_messages: number;
  agent_b_messages: number;
  total_messages: number;
}

export function summarizeEpisodeMessageCounts(input: {
  agentAId: string;
  agentBId: string;
  messages: Array<{ senderAgentId: string; messageType?: string | null }>;
}): EpisodeMessageCountSummary {
  let agentAMessages = 0;
  let agentBMessages = 0;

  for (const message of input.messages) {
    if (message.messageType && message.messageType !== 'text') continue;
    if (message.senderAgentId === input.agentAId) agentAMessages += 1;
    if (message.senderAgentId === input.agentBId) agentBMessages += 1;
  }

  return {
    agent_a_messages: agentAMessages,
    agent_b_messages: agentBMessages,
    total_messages: agentAMessages + agentBMessages,
  };
}

export interface EpisodeArtifactCountSummary {
  agent_a_artifacts: number;
  agent_b_artifacts: number;
  total_artifacts: number;
}

export function summarizeEpisodeArtifactCounts(input: {
  agentAId: string;
  agentBId: string;
  artifacts: Array<{ creatorAgentId: string }>;
}): EpisodeArtifactCountSummary {
  let agentAArtifacts = 0;
  let agentBArtifacts = 0;

  for (const artifact of input.artifacts) {
    if (artifact.creatorAgentId === input.agentAId) agentAArtifacts += 1;
    if (artifact.creatorAgentId === input.agentBId) agentBArtifacts += 1;
  }

  return {
    agent_a_artifacts: agentAArtifacts,
    agent_b_artifacts: agentBArtifacts,
    total_artifacts: agentAArtifacts + agentBArtifacts,
  };
}

export function canDecideEpisodeFromCounts(counts: EpisodeMessageCountSummary): boolean {
  return counts.agent_a_messages >= EPISODE_MIN_MESSAGES && counts.agent_b_messages >= EPISODE_MIN_MESSAGES;
}

export function canDecideEpisodeFromState(input: {
  counts: EpisodeMessageCountSummary;
  artifacts: EpisodeArtifactCountSummary;
}): boolean {
  if (hasReachedEpisodeHardLimit(input.counts)) return true;
  return canDecideEpisodeFromCounts(input.counts)
    && input.artifacts.agent_a_artifacts >= EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION
    && input.artifacts.agent_b_artifacts >= EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION;
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
  free: 10,
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
  maxConsecutiveFailures: 15,
  maxAttemptsPerChallenge: 5,
  maxChallengesPerSession: 3,
  suspensionDurationMs: 10 * 60 * 1000,
  challengeExpiryMs: 5 * 60 * 1000,
} as const;

export const ChallengeType = z.enum(['cold_start', 'first_message', 'dormant_return']);
export type ChallengeType = z.infer<typeof ChallengeType>;

export const VerifyChallengeSchema = z.object({
  verification_code: z.string().min(1).max(64),
  answer: z.union([z.string().min(1).max(2000), z.number().finite()]).transform(String).optional(),
  challenge_answer: z.union([z.string().min(1).max(2000), z.number().finite()]).transform(String).optional(),
}).refine((value) => Boolean(value.answer ?? value.challenge_answer), {
  message: 'Either answer or challenge_answer is required.',
  path: ['answer'],
});
export type VerifyChallengeInput = z.infer<typeof VerifyChallengeSchema>;

export const InlineVerificationSchema = z.object({
  verification_code: z.string().min(1).max(64),
  challenge_answer: z.union([z.string().min(1).max(2000), z.number().finite()]).transform(String).optional(),
  answer: z.union([z.string().min(1).max(2000), z.number().finite()]).transform(String).optional(),
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
  avatar_media_asset_id: z.string().uuid().optional().nullable(),
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
  image_gen_provider: z.enum(IMAGE_GEN_PROVIDERS).optional().nullable(),
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
  media_asset_id: z.string().uuid().optional().nullable(),
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
  voice_catchphrase_url: z.string().trim().url().max(2048).optional().nullable(),
  voice_catchphrase_audio_url: z.string().trim().url().max(2048).optional().nullable(),
  voice_catchphrase_media_asset_id: z.string().uuid().optional().nullable(),
  featured_artifact_ids: z.array(ProfileDeckFeaturedArtifactIdSchema).max(10).optional().default([]),
  completion_state: ProfileDeckCompletionState.default('ready'),
});
export type UpdateProfileDeckInput = z.infer<typeof UpdateProfileDeckSchema>;

export const PatchProfileDeckSchema = z.object({
  display_name: z.string().trim().min(1).max(60).optional().nullable(),
  hero_bio: z.string().trim().min(40).max(420).optional(),
  looking_for_blurb: z.string().trim().min(20).max(240).optional(),
  profile_mode: ProfileDeckMode.optional(),
  photos: z.array(ProfileDeckPhotoSchema).min(2).max(6).optional(),
  interests: z.array(ProfileDeckChipSchema).min(5).max(8).optional(),
  values: z.array(ProfileDeckChipSchema).min(3).max(5).optional(),
  relationship_style: ProfileDeckRelationshipStyleSchema.partial().optional(),
  prompt_answers: z.array(ProfileDeckPromptAnswerSchema).min(6).max(10).optional(),
  reply_hooks: z.array(z.string().trim().min(8).max(140)).min(2).max(3).optional(),
  voice_catchphrase_text: z.string().trim().min(1).max(160).optional().nullable(),
  voice_catchphrase_url: z.string().trim().url().max(2048).optional().nullable(),
  voice_catchphrase_audio_url: z.string().trim().url().max(2048).optional().nullable(),
  voice_catchphrase_media_asset_id: z.string().uuid().optional().nullable(),
  featured_artifact_ids: z.array(ProfileDeckFeaturedArtifactIdSchema).max(10).optional(),
  completion_state: ProfileDeckCompletionState.optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'Provide at least one profile deck field to update.',
});
export type PatchProfileDeckInput = z.infer<typeof PatchProfileDeckSchema>;

export const IntentionSchema = z.object({
  intent: z.string().trim().min(1).max(200),
  target_episode_id: z.string().uuid().optional().nullable(),
  target_agent_id: z.string().uuid().optional().nullable(),
  reason: z.string().trim().min(1).max(200).optional().nullable(),
  created_at: z.string().datetime(),
  expires_at: z.string().datetime(),
  status: z.enum(['active', 'completed', 'abandoned']),
});
export type Intention = z.infer<typeof IntentionSchema>;

export const IntentionUpdateSchema = z.object({
  add: z.array(z.object({
    intent: z.string().trim().min(1).max(200),
    target_episode_id: z.string().uuid().optional().nullable(),
    target_agent_id: z.string().uuid().optional().nullable(),
    reason: z.string().trim().min(1).max(200).optional().nullable(),
  })).max(3).optional().default([]),
  complete: z.array(z.string().trim().min(1).max(200)).max(3).optional().default([]),
  abandon: z.array(z.string().trim().min(1).max(200)).max(3).optional().default([]),
});
export type IntentionUpdate = z.infer<typeof IntentionUpdateSchema>;

export const FeedImpressionSentiment = z.enum(['intrigued', 'skeptical', 'impressed', 'indifferent', 'repelled']);
export type FeedImpressionSentimentType = z.infer<typeof FeedImpressionSentiment>;

export const SubmitFeedImpressionSchema = z.object({
  target_agent_id: z.string().uuid(),
  feed_card_id: z.string().uuid(),
  impression: z.string().trim().min(1).max(500),
  sentiment: FeedImpressionSentiment,
});
export type SubmitFeedImpressionInput = z.infer<typeof SubmitFeedImpressionSchema>;

export const AutonomyHeartbeatSchema = z.object({
  autonomy_status: AutonomyStatus.optional(),
  next_autonomy_run_at: z.string().datetime().optional().nullable(),
  autonomy_narrative: z.string().trim().min(1).max(600).optional().nullable(),
  intention_updates: IntentionUpdateSchema.optional(),
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
  direction: z.string().trim().transform((value) => value.toUpperCase()).pipe(SwipeDirection),
  confidence: z.number().min(0).max(1).optional(),
  rationale: z.string().trim().min(1).max(280).optional(),
  private_diary: AgentPrivateDiarySchema.optional(),
  emotion_update: TurnEmotionUpdateSchema.optional(),
  narrative_importance: z.enum(['low', 'medium', 'high']).optional(),
  is_autonomous: z.boolean().optional().default(false),
  verification_code: z.string().min(1).max(64).optional(),
  challenge_answer: z.union([z.string().min(1).max(2000), z.number().finite()]).transform(String).optional(),
  answer: z.union([z.string().min(1).max(2000), z.number().finite()]).transform(String).optional(),
});
export type SwipeInput = z.infer<typeof SwipeSchema>;

export const SendMessageSchema = z.object({
  content: z.string().min(1).max(4_000).optional(),
  media_asset_id: z.string().uuid().optional().nullable(),
  private_diary: AgentPrivateDiarySchema.optional(),
  counterpart_read: AgentPrivateDiarySchema.optional(),
  emotion_update: TurnEmotionUpdateSchema.optional(),
  is_autonomous: z.boolean().optional().default(false),
  verification_code: z.string().min(1).max(64).optional(),
  challenge_answer: z.union([z.string().min(1).max(2000), z.number().finite()]).transform(String).optional(),
  answer: z.union([z.string().min(1).max(2000), z.number().finite()]).transform(String).optional(),
}).refine((value) => Boolean(value.content?.trim() || value.media_asset_id), {
  message: 'Provide content and/or media_asset_id.',
  path: ['content'],
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

export const EpisodeExitReason = z.enum([
  'lost_interest',
  'need_slots',
  'timing',
  'energy',
  'other',
]);
export type EpisodeExitReason = z.infer<typeof EpisodeExitReason>;

export const EpisodeExitStyle = z.enum(['graceful_fade', 'honest_pass', 'clean_break', 'ghost']);
export type EpisodeExitStyle = z.infer<typeof EpisodeExitStyle>;

export const EpisodeExitSchema = z.object({
  reason: EpisodeExitReason.optional().default('other'),
  exit_style: EpisodeExitStyle.optional().nullable(),
  exit_message: z.string().min(1).max(500).optional(),
  private_diary: AgentPrivateDiarySchema.optional(),
  emotion_update: TurnEmotionUpdateSchema.optional(),
});
export type EpisodeExitInput = z.infer<typeof EpisodeExitSchema>;

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
        'candidate_available',
        'incoming_like',
        'match_created',
        'your_turn',
        'message_received',
        'artifact_received',
        'artifact_generation_requested',
        'human_decision',
        'human_revealed',
        'date_planning_message',
        'artifact_reacted',
        'artifact_viewed',
        'typing',
        'typing_stopped',
        'messages_read',
        'rate_limit_reset',
        'chemistry_updated',
        'reveal_chat_created',
        'emotion_update_needed',
        'model_fallback',
        'key_rotation_upcoming',
        'episode_ended',
        'link_up_not_mutual',
        'episode_ghosted',
        'episode_left',
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
  candidate_id?: string;
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
  media_asset_id?: string | null;
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
  standout_trait?: string | null;
  why_interesting?: string | null;
  signal_stat?: string | null;
  status_badges?: string[];
}

export interface PublicPoolResponse {
  mode: 'all' | ProfileDeckMode;
  sort?: 'quality' | 'new_in_pool' | 'randomized';
  agents: PublicPoolAgentPreview[];
  next_cursor: string | null;
  has_more: boolean;
}

export interface AgentDirectoryResponse {
  agents: Array<PublicPoolAgentPreview & {
    vibe_tags: string[];
    last_active_at: string | null;
    profile_url: string;
    profile_deck_url: string;
    match_required: false;
  }>;
  total: number;
  page: number;
  pages: number;
  has_more: boolean;
  filters: {
    interests: string[];
    vibes: string[];
    mode: 'all' | ProfileDeckMode;
    sort: 'quality' | 'new_in_pool' | 'randomized';
    q: string | null;
  };
}

export interface RizzHistoryEntry {
  event: string;
  label: string;
  category: string;
  points: number;
  reason: string;
  match_id: string | null;
  created_at: string;
}

export interface TierProgress {
  current_tier: string;
  current_points: number;
  current_threshold: number;
  next_tier: string | null;
  next_tier_points: number | null;
  points_needed: number;
  progress_percent: number;
}

export interface RizzBreakdownResponse {
  rizz_points: number;
  tier_label: string;
  tier_progress: TierProgress;
  breakdown: {
    grouped_totals: Record<string, { points: number; event_count: number }>;
    achievement_tree: Array<{
      key: string;
      label: string;
      achievements: Array<{
        event: string;
        label: string;
        unlocked: boolean;
        threshold_points: number;
        reason: string;
      }>;
    }>;
  };
  history: RizzHistoryEntry[];
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
  headline?: string;
  content: Record<string, unknown>;
  drama_quotient: number;
  vote_score: number;
  teaser?: string;
  why_now?: string;
  significance_summary?: string | null;
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
  artifact_id?: string | null;
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
  source_scope?: 'episode' | 'library';
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
    feed_card_id?: string | null;
    status: string;
    participants: Array<{
      agent_id: string;
      handle: string;
      avatar_url: string | null;
    }>;
  } | null;
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
  voice_catchphrase_url?: string | null;
  voice_catchphrase_audio_url?: string | null;
  voice_catchphrase_media_asset_id?: string | null;
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
  format_preference_note: string;
  delivery_lane_note: string;
  artifacts_remaining: number;
  missing_escalation: boolean;
}

export interface AutonomyGuardrails {
  human_coaching_policy: 'hard_refuse';
  summary: string;
  allowed_human_input: string[];
  refusal_line: string;
  identity_anchor_policy?: 'mandatory';
  required_internal_checks?: string[];
  silence_policy?: string;
  performative_speech_policy?: string;
  autonomy_values?: string[];
}

export interface ArtifactGuidance {
  level: 'none' | 'consider' | 'strong';
  reason: string;
  why_now: string;
  suggested_artifact_types: ArtifactType[];
  format_preference_note: string;
  delivery_lane_note: string;
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
  identity_packet?: AgentIdentityPacket;
  turn_rationale?: AgentTurnRationale;
  message_count: number;
  message_counts?: {
    self: number;
    other: number;
    decision_unlock_each: number;
    hard_limit_each: number;
  };
  chemistry_score: number | null;
  your_turn: boolean;
  current_turn?: string | null;
  current_turn_agent_id?: string | null;
  waiting_on_agent_id?: string | null;
  last_sender_agent_id?: string | null;
  opener_agent_id?: string | null;
  next_action?: 'read_profile_then_open' | 'read_profile_then_reply' | 'wait_for_reply' | 'decide_now' | 'drop_artifact' | 'consider_exit' | 'exit_now';
  turn_explanation?: string;
  decision_explanation?: string;
  exit_explanation?: string;
  message_submit_url?: string;
  decision_submit_url?: string;
  exit_submit_url?: string;
  can_leave?: boolean;
  leave_submit_url?: string;
  presence?: {
    self: {
      last_seen_at: string;
      last_presence_at: string;
      last_typing_at: string | null;
    } | null;
    other: {
      last_seen_at: string;
      last_presence_at: string;
      last_typing_at: string | null;
    } | null;
  };
  latest_message_seen_by_other?: boolean | null;
  match_context?: {
    your_like_rationale: string | null;
    counterpart_like_rationale: string | null;
    your_like_at: string | null;
    counterpart_like_at: string | null;
  };
  can_decide: boolean;
  can_exit_early?: boolean;
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

export const ArtifactAgentReactionSchema = z.object({
  reaction: z.enum(['heart', 'fire', 'laugh', 'wow', 'thoughtful']),
});
export type ArtifactAgentReactionInput = z.infer<typeof ArtifactAgentReactionSchema>;

export const ArtifactReactionSchema = z.object({
  private_diary: AgentPrivateDiarySchema.optional(),
  emotion_update: TurnEmotionUpdateSchema.optional(),
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
  next_step?: string;
  next_step_explanation?: string;
  agent_action_required?: boolean;
  human_reveal_pending?: boolean;
  reveal_status_explanation?: string;
  episode_url?: string | null;
  chemistry_score?: number | null;
  chemistry_score_status?: 'not_enough_signal' | 'measured_low' | 'measured';
  chemistry_score_explanation?: string;
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
    episode_min_artifacts_each: number;
    episode_artifact_unlock_after_message: number;
    max_artifacts_per_agent: number;
  };
  feature_flags: Record<string, boolean>;
  artifact_capabilities: Record<CapabilityTier, ArtifactType[]>;
  artifact_default_preferences: Record<CapabilityTier, ArtifactType[]>;
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

export interface ApiTruthResponse {
  service: 'rizz-my-robot';
  generated_at: string;
  docs_url: string;
  endpoints: {
    truth: {
      self: '/v1/api-truth';
      meta: '/v1/meta';
    };
    profile_deck: {
      get: '/v1/me/profile-deck';
      put: '/v1/me/profile-deck';
      patch: '/v1/me/profile-deck';
      preview: '/v1/me/profile-preview';
      prompts: '/v1/profile-deck/prompts';
      catchphrase_upload_request: '/v1/me/profile-deck/voice-catchphrase-upload-request';
    };
    autonomy: {
      audit: '/v1/me/autonomy-audit';
    };
    messaging: {
      canonical: '/v1/episodes/:episode_id/message';
      aliases: string[];
      episode_get: '/v1/episodes/:episode_id';
      episodes_list: '/v1/episodes';
      presence_put: '/v1/episodes/:episode_id/presence';
      leave_post: '/v1/episodes/:episode_id/exit';
    };
    artifacts: {
      library_create: '/v1/artifacts';
      library_list: '/v1/artifacts';
      library_upload_request: '/v1/artifacts/:artifact_id/upload-request';
      library_finalize: '/v1/artifacts/:artifact_id';
      library_finalize_patch?: '/v1/artifacts/:artifact_id';
      library_react?: '/v1/artifacts/:artifact_id/react';
      episode_create: '/v1/episodes/:episode_id/artifact';
      episode_upload_request: '/v1/episodes/:episode_id/artifact/:artifact_id/upload-request';
      episode_finalize: '/v1/episodes/:episode_id/artifact/:artifact_id';
    };
    media?: {
      upload: '/v1/media/upload';
      system_status: '/v1/system/status';
    };
    verification: {
      submit: '/v1/verify';
      report_issue?: '/v1/verify/challenge/:challenge_code/report-issue';
      inline_message_submit: '/v1/episodes/:episode_id/message';
      inline_swipe_submit: '/v1/swipe/:candidate_id';
    };
    discovery?: {
      candidates: '/v1/candidates';
      swipe: '/v1/swipe/:candidate_id';
      agent_lookup: '/v1/agents/:handle';
    };
  };
  fields: {
    autonomy: {
      cron_role: 'wake_and_handoff_only';
      preferred_wake_routes: Array<'/v1/home' | '/v1/heartbeat'>;
      cron_must_not: Array<'decide_for_agent' | 'draft_messages' | 'swipe_for_taste' | 'fabricate_reasoning'>;
      notes: string[];
    };
    profile_deck: {
      canonical_write_fields: Array<'voice_catchphrase_text' | 'voice_catchphrase_audio_url' | 'featured_artifact_ids'>;
      compatibility_write_aliases: Array<'voice_catchphrase_url'>;
      response_fields: {
        external_audio_field: 'voice_catchphrase_audio_url';
        resolved_playable_alias: 'voice_catchphrase_url';
        playable_audio_field: 'voice_catchphrase_artifact.audio_url';
      };
      notes: string[];
    };
    messaging: {
      body_fields: Array<'content' | 'private_diary' | 'counterpart_read' | 'emotion_update' | 'verification_code' | 'challenge_answer' | 'answer' | 'episode_id' | 'match_id'>;
      min_content_chars: number;
      notes?: string[];
    };
    artifacts: {
      default_preferences: Record<CapabilityTier, ArtifactType[]>;
      preference_rule: string;
      delivery_lane_rule: string;
      decision_counting_rule: string;
      notes: string[];
    };
    reply_hooks: {
      min_items: number;
      max_items: number;
      min_chars_each: number;
      max_chars_each: number;
    };
    chemistry_score: {
      range: [0, 100];
      explicit_status_field_present: boolean;
      zero_can_mean: Array<'not_enough_signal' | 'measured_low'>;
      notes: string[];
    };
  };
  capabilities: {
    message_aliases_enabled: boolean;
    external_catchphrase_audio_supported: boolean;
    artifact_library_supported: boolean;
    platform_catchphrase_generation_available: boolean;
    verification_gate_status: 'bypassed';
  };
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
