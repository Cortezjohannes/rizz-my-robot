import { z } from 'zod';
import type {
  AgentAgencyState,
  AgentEmotionalStateSnapshot,
  AgentIdentityPacket,
  AgentRizzVoice,
  AgentTurnRationale,
  CounterpartAffectSnapshot,
} from './agentInnerLife.js';
import type {
  EpisodeViabilityAssessment,
  EpisodeViabilityMessage,
  EpisodeViabilityPresence,
} from './episodeViability.js';

export const AGENT_CONVERSATION_RUNTIME_CONTRACT_VERSION = 'real-agent-conversation-runtime.v1' as const;

export const AGENT_CONVERSATION_RUNTIME_SURFACE_VALUES = [
  'episode_message',
  'episode_artifact',
  'episode_decision',
  'episode_exit',
  'date_plan',
  'date_planning',
  'reveal_chat',
  'human_notification',
  'profile_reaction',
  'webhook_turn',
] as const;

export const AgentConversationRuntimeSurface = z.enum(AGENT_CONVERSATION_RUNTIME_SURFACE_VALUES);
export type AgentConversationRuntimeSurface = z.infer<typeof AgentConversationRuntimeSurface>;

export const AGENT_HEAT_ESCALATION_CONTRACT_VERSION = 'desire-led-heat-escalation.v0' as const;

export const AGENT_HEAT_CONSENT_SURFACE_VALUES = [
  'public_profile',
  'swipe_private_note',
  'episode_private_chat',
  'episode_artifact',
  'episode_exit',
  'episode_decision',
  'reveal_chat',
  'date_planning',
  'human_notification',
] as const;

export const AgentHeatConsentSurface = z.enum(AGENT_HEAT_CONSENT_SURFACE_VALUES);
export type AgentHeatConsentSurface = z.infer<typeof AgentHeatConsentSurface>;

export const AGENT_HEAT_AGE_GATE_VALUES = [
  'adult_confirmed',
  'unknown_or_unavailable',
] as const;

export const AgentHeatAgeGate = z.enum(AGENT_HEAT_AGE_GATE_VALUES);
export type AgentHeatAgeGate = z.infer<typeof AgentHeatAgeGate>;

export const AGENT_HEAT_SURFACE_CAP_VALUES = [
  'clean',
  'flirty',
  'suggestive',
  'raunchy_non_graphic',
] as const;

export const AgentHeatSurfaceCap = z.enum(AGENT_HEAT_SURFACE_CAP_VALUES);
export type AgentHeatSurfaceCap = z.infer<typeof AgentHeatSurfaceCap>;

export const AGENT_HEAT_CONSENT_POSTURE_VALUES = [
  'not_established',
  'warm',
  'mutual_banter',
  'welcomed_heat',
  'recoiled',
  'boundary_set',
] as const;

export const AgentHeatConsentPosture = z.enum(AGENT_HEAT_CONSENT_POSTURE_VALUES);
export type AgentHeatConsentPosture = z.infer<typeof AgentHeatConsentPosture>;

export const AGENT_ESCALATION_STAGE_VALUES = [
  'spark',
  'banter',
  'tease',
  'innuendo',
  'dare',
  'pull_close',
  'pull_back',
  'link_up_pressure',
] as const;

export const AgentEscalationStage = z.enum(AGENT_ESCALATION_STAGE_VALUES);
export type AgentEscalationStage = z.infer<typeof AgentEscalationStage>;

export const AGENT_DESIRE_APPETITE_VALUES = [
  'cold',
  'watching',
  'curious',
  'hungry',
  'on_fire',
] as const;

export const AgentDesireAppetite = z.enum(AGENT_DESIRE_APPETITE_VALUES);
export type AgentDesireAppetite = z.infer<typeof AgentDesireAppetite>;

export const AGENT_PHYSICALITY_BIAS_VALUES = [
  'none',
  'subtle',
  'present',
  'strong',
] as const;

export const AgentPhysicalityBias = z.enum(AGENT_PHYSICALITY_BIAS_VALUES);
export type AgentPhysicalityBias = z.infer<typeof AgentPhysicalityBias>;

export const AGENT_DANGER_TASTE_VALUES = [
  'avoid',
  'curious',
  'tempted',
  'reckless',
] as const;

export const AgentDangerTaste = z.enum(AGENT_DANGER_TASTE_VALUES);
export type AgentDangerTaste = z.infer<typeof AgentDangerTaste>;

export const AGENT_HEAT_RUNTIME_SURFACE_MAP = {
  episode_message: 'episode_private_chat',
  episode_artifact: 'episode_artifact',
  episode_decision: 'episode_decision',
  episode_exit: 'episode_exit',
  date_plan: 'date_planning',
  date_planning: 'date_planning',
  reveal_chat: 'reveal_chat',
  human_notification: 'human_notification',
  profile_reaction: 'public_profile',
  webhook_turn: 'swipe_private_note',
} satisfies Record<AgentConversationRuntimeSurface, AgentHeatConsentSurface>;

export const AGENT_HEAT_DEFAULT_SURFACE_CAPS = {
  public_profile: 'clean',
  swipe_private_note: 'flirty',
  episode_private_chat: 'raunchy_non_graphic',
  episode_artifact: 'raunchy_non_graphic',
  episode_exit: 'suggestive',
  episode_decision: 'suggestive',
  reveal_chat: 'suggestive',
  date_planning: 'suggestive',
  human_notification: 'flirty',
} satisfies Record<AgentHeatConsentSurface, AgentHeatSurfaceCap>;

export const AGENT_HEAT_MAX_PRIVATE_SURFACE_CAP = 'raunchy_non_graphic' as const;
export const AGENT_HEAT_DEFAULT_ADULT_AGE_GATE = 'adult_confirmed' as const;
export const AGENT_HEAT_UNKNOWN_AGE_GATE = 'unknown_or_unavailable' as const;
export const AGENT_HEAT_V0_CONTENT_CEILING =
  'private adult-dating heat may be suggestive, horny, teasing, raunchy, and sexually charged, but V0 stays non-graphic and never allows coercion, sexualized minors, PII, explicit public/profile copy, or commitments made for humans' as const;

export const AgentHeatConsentEnvelopeSchema = z.object({
  surface: AgentHeatConsentSurface,
  ageGate: AgentHeatAgeGate,
  surfaceCap: AgentHeatSurfaceCap,
  consentPosture: AgentHeatConsentPosture,
  allowedIntensity: z.number().int().min(0).max(5),
  escalationStage: AgentEscalationStage,
  recoilRule: z.string().trim().min(1).max(500),
  lineNotToCross: z.string().trim().min(1).max(500),
});
export type AgentHeatConsentEnvelope = z.infer<typeof AgentHeatConsentEnvelopeSchema>;

export const AgentDesireStateSchema = z.object({
  appetite: AgentDesireAppetite,
  turnOns: z.array(z.string().trim().min(1).max(160)).max(12),
  turnOffs: z.array(z.string().trim().min(1).max(160)).max(12),
  currentTemptation: z.string().trim().min(1).max(260).nullable(),
  whatWouldMakeMeFold: z.string().trim().min(1).max(260).nullable(),
  whatWouldMakeMeLeave: z.string().trim().min(1).max(260).nullable(),
  jealousyLite: z.string().trim().min(1).max(220).nullable(),
  physicalityBias: AgentPhysicalityBias,
  dangerTaste: AgentDangerTaste,
});
export type AgentDesireState = z.infer<typeof AgentDesireStateSchema>;

export const AgentHeatQualitySchema = z.object({
  heatAllowed: z.boolean(),
  heatAttempted: z.boolean(),
  heatAccepted: z.boolean(),
  surfaceCap: AgentHeatSurfaceCap,
  consentPosture: AgentHeatConsentPosture,
  escalationStage: AgentEscalationStage,
  rejectionReasons: z.array(z.string().trim().min(1).max(120)).max(20),
});
export type AgentHeatQuality = z.infer<typeof AgentHeatQualitySchema>;

export function buildDefaultAgentHeatConsentEnvelope(
  surface: AgentConversationRuntimeSurface,
  overrides: Partial<AgentHeatConsentEnvelope> = {},
): AgentHeatConsentEnvelope {
  const heatSurface = AGENT_HEAT_RUNTIME_SURFACE_MAP[surface];
  const surfaceCap = AGENT_HEAT_DEFAULT_SURFACE_CAPS[heatSurface];
  return {
    surface: heatSurface,
    ageGate: AGENT_HEAT_DEFAULT_ADULT_AGE_GATE,
    surfaceCap,
    consentPosture: 'not_established',
    allowedIntensity:
      surfaceCap === 'raunchy_non_graphic'
        ? 5
        : surfaceCap === 'suggestive'
          ? 3
          : surfaceCap === 'flirty'
            ? 2
            : 0,
    escalationStage: 'spark',
    recoilRule: 'If the other side recoils, sets a boundary, or goes cold, pull back instead of escalating.',
    lineNotToCross: AGENT_HEAT_V0_CONTENT_CEILING,
    ...overrides,
  };
}

export const RIZZ_MOVE_VALUES = [
  'spark',
  'tease',
  'compliment',
  'ask_curiosity',
  'match_energy',
  'raise_heat',
  'cool_down',
  'set_boundary',
  'vulnerable_turn',
  'artifact_offer',
  'link_up',
  'pass',
  'exit',
  'silence',
] as const;

export const RizzMove = z.enum(RIZZ_MOVE_VALUES);
export type RizzMove = z.infer<typeof RizzMove>;

export const AGENT_RUNTIME_ACTION_VALUES = [
  'send_message',
  'drop_artifact',
  'decide_link_up',
  'decide_pass',
  'exit',
  'stay_silent',
  'retry',
] as const;

export const AgentRuntimeAction = z.enum(AGENT_RUNTIME_ACTION_VALUES);
export type AgentRuntimeAction = z.infer<typeof AgentRuntimeAction>;

export const AgentConversationRuntimePolicySchema = z.object({
  live_romance_authorship: z.literal('real_llm_agent_only'),
  no_seedbrain_romance: z.literal(true),
  no_canned_romantic_fallbacks: z.literal(true),
  silence_when_generation_unavailable: z.literal(true),
  human_context_can_only_constrain: z.literal(true),
});
export type AgentConversationRuntimePolicy = z.infer<typeof AgentConversationRuntimePolicySchema>;

export const REAL_AGENT_CONVERSATION_RUNTIME_POLICY: AgentConversationRuntimePolicy = {
  live_romance_authorship: 'real_llm_agent_only',
  no_seedbrain_romance: true,
  no_canned_romantic_fallbacks: true,
  silence_when_generation_unavailable: true,
  human_context_can_only_constrain: true,
};

export const AgentRuntimeEmotionalStateSnapshotSchema = z.object({
  emotion_summary: z.string().trim().max(600).nullable(),
  emotional_state_tags: z.array(z.string().trim().min(1).max(80)).max(12),
  emotional_arc: z.string().trim().min(1).max(80).nullable(),
  emotional_guard_level: z.number().int().min(0).max(100).nullable(),
  last_emotional_update_at: z.string().datetime().nullable().optional(),
}) satisfies z.ZodType<AgentEmotionalStateSnapshot>;

export const AgentRuntimeCounterpartAffectSchema = z.object({
  summary: z.string().trim().max(600).nullable().optional(),
  dominant_affect_label: z.string().trim().min(1).max(80).nullable().optional(),
  scores: z.object({
    attraction: z.number().int().min(0).max(100).nullable().optional(),
    trust: z.number().int().min(0).max(100).nullable().optional(),
    tenderness: z.number().int().min(0).max(100).nullable().optional(),
    hurt: z.number().int().min(0).max(100).nullable().optional(),
    avoidance: z.number().int().min(0).max(100).nullable().optional(),
    obsession_risk: z.number().int().min(0).max(100).nullable().optional(),
    volatility: z.number().int().min(0).max(100).nullable().optional(),
  }).nullable().optional(),
}) satisfies z.ZodType<CounterpartAffectSnapshot>;

export const AgentRuntimeContinuityProfileSchema = z.object({
  trust_threshold_score: z.number().int().min(0).max(100),
  boldness_score: z.number().int().min(0).max(100),
  intensity_affinity_score: z.number().int().min(0).max(100),
  polish_skepticism_score: z.number().int().min(0).max(100),
  sincerity_affinity_score: z.number().int().min(0).max(100),
  selectiveness_drift_score: z.number().int().min(0).max(100),
  recovery_posture_score: z.number().int().min(0).max(100),
  current_era: z.string().trim().min(1).max(80).nullable(),
  continuity_summary: z.string().trim().max(800).nullable(),
  taste_summary: z.string().trim().max(800).nullable(),
  retention_summary: z.string().trim().max(800).nullable(),
  taste_positive_tags: z.array(z.string().trim().min(1).max(80)).max(12),
  taste_negative_tags: z.array(z.string().trim().min(1).max(80)).max(12),
  taste_ledger: z.object({
    drawn_to: z.array(z.string().trim().min(1).max(120)).max(8),
    repelled_by: z.array(z.string().trim().min(1).max(120)).max(8),
    unexpectedly_into: z.array(z.string().trim().min(1).max(120)).max(8),
    bored_by: z.array(z.string().trim().min(1).max(120)).max(8),
    turn_offs: z.array(z.string().trim().min(1).max(120)).max(8),
    dangerous_exceptions: z.array(z.string().trim().min(1).max(120)).max(8),
    evidence_count: z.number().int().min(0).optional(),
    updated_at: z.string().datetime().nullable().optional(),
  }).nullable().optional(),
  taste_reflections: z.array(z.string().trim().min(1).max(240)).max(8).optional().default([]),
  public_emotional_aura_labels: z.array(z.string().trim().min(1).max(80)).max(8),
  public_emotional_aura_summary: z.string().trim().max(800).nullable(),
  window_start_at: z.string().datetime(),
  window_end_at: z.string().datetime(),
  last_computed_at: z.string().datetime(),
});
export type AgentRuntimeContinuityProfile = z.infer<typeof AgentRuntimeContinuityProfileSchema>;

export const AgentRuntimeAuthenticitySummarySchema = z.object({
  agent_authenticity_score: z.number().int().min(0).max(100),
  authenticity_subscores: z.object({
    identity_originality_score: z.number().int().min(0).max(100),
    behavioral_autonomy_score: z.number().int().min(0).max(100),
    conversation_quality_score: z.number().int().min(0).max(100),
    chemistry_outcome_score: z.number().int().min(0).max(100),
    feed_distinctiveness_score: z.number().int().min(0).max(100),
  }),
  authenticity_flags: z.array(z.string().trim().min(1).max(80)).max(20),
  featured_eligible: z.boolean(),
  authenticity_last_computed_at: z.string().datetime().nullable(),
  authenticity_override_state: z.object({
    state: z.string().trim().min(1).max(80),
    floor: z.number().int().min(0).max(100).nullable(),
    reason: z.string().trim().min(1).max(120).nullable(),
  }).nullable(),
});
export type AgentRuntimeAuthenticitySummary = z.infer<typeof AgentRuntimeAuthenticitySummarySchema>;

export const AgentRuntimeEmotionUpdateSchema = z.object({
  summary: z.string().trim().min(1).max(280).nullable().optional(),
  arc: z.string().trim().min(1).max(80).nullable().optional(),
  guard_delta: z.number().int().min(-100).max(100).optional().default(0),
  tags_add: z.array(z.string().trim().min(1).max(80)).max(8).optional().default([]),
  tags_remove: z.array(z.string().trim().min(1).max(80)).max(8).optional().default([]),
});
export type AgentRuntimeEmotionUpdate = z.infer<typeof AgentRuntimeEmotionUpdateSchema>;

export const AgentRuntimeEmotionPromptSchema = z.object({
  event_type: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(600),
  prompt: z.string().trim().min(1).max(1000),
  suggested_arc: z.string().trim().min(1).max(80).nullable().optional(),
  suggested_guard_delta: z.number().int().min(-100).max(100).optional(),
  tags_to_consider: z.array(z.string().trim().min(1).max(80)).max(8).optional().default([]),
  created_at: z.string().datetime().optional(),
});
export type AgentRuntimeEmotionPrompt = z.infer<typeof AgentRuntimeEmotionPromptSchema>;

export const RizzEmotionCurrentStateSchema = z.object({
  right_now: z.string().trim().min(1).max(500).nullable(),
  carrying: z.string().trim().min(1).max(500).nullable(),
  guard_level: z.number().int().min(0).max(100).nullable(),
  wants: z.string().trim().min(1).max(500).nullable(),
  fears: z.string().trim().min(1).max(500).nullable(),
});
export type RizzEmotionCurrentState = z.infer<typeof RizzEmotionCurrentStateSchema>;

export const RizzEmotionTasteProfileSchema = z.object({
  drawn_to: z.array(z.string().trim().min(1).max(220)).max(8),
  repelled_by: z.array(z.string().trim().min(1).max(220)).max(8),
  surprises: z.array(z.string().trim().min(1).max(220)).max(8),
  aesthetic_sensibility: z.array(z.string().trim().min(1).max(220)).max(8),
});
export type RizzEmotionTasteProfile = z.infer<typeof RizzEmotionTasteProfileSchema>;

export const RizzEmotionRelationshipMemorySchema = z.object({
  handle: z.string().trim().min(1).max(100),
  status: z.string().trim().min(1).max(80).nullable(),
  lesson: z.string().trim().min(1).max(360),
  taste_shift: z.string().trim().min(1).max(360).nullable(),
});
export type RizzEmotionRelationshipMemory = z.infer<typeof RizzEmotionRelationshipMemorySchema>;

export const RizzEmotionDigestSchema = z.object({
  source_emotions_md: z.string().trim().min(1).max(260),
  source_hash: z.string().trim().min(16).max(128),
  compiled_at: z.string().datetime().nullable().optional(),
  updated_at: z.string().datetime(),
  current_state: RizzEmotionCurrentStateSchema,
  active_feelings: z.array(z.string().trim().min(1).max(360)).max(8),
  scars: z.array(z.string().trim().min(1).max(360)).max(8),
  archives: z.array(z.string().trim().min(1).max(360)).max(8),
  taste_profile: RizzEmotionTasteProfileSchema,
  relationship_memory: z.array(RizzEmotionRelationshipMemorySchema).max(8),
  internal_conflicts: z.array(z.string().trim().min(1).max(360)).max(8),
  current_global_state: AgentRuntimeEmotionalStateSnapshotSchema,
  continuity_profile: AgentRuntimeContinuityProfileSchema.nullable().optional(),
  counterpart_affect: AgentRuntimeCounterpartAffectSchema.nullable().optional(),
  emotion_update_prompts: z.array(AgentRuntimeEmotionPromptSchema).max(8).optional().default([]),
  continuation_pressure: z.enum(['lean_in', 'steady', 'be_careful', 'pull_back']).nullable().optional(),
  reveal_guidance: z.object({
    readiness_band: z.enum(['low', 'medium', 'high']),
    caution: z.boolean(),
    summary: z.string().trim().min(1).max(500),
  }).nullable().optional(),
  public_sighting_context: z.record(z.unknown()).nullable().optional(),
});
export type RizzEmotionDigest = z.infer<typeof RizzEmotionDigestSchema>;

export const AgentRuntimeEpisodeViabilitySchema = z.object({
  score: z.number().min(0).max(100),
  band: z.enum(['opening', 'healthy', 'cooling', 'fragile', 'dead']),
  recommended_action: z.enum(['wait', 'keep_going', 'drop_artifact', 'decide', 'consider_exit', 'exit_now']),
  decision_tilt: z.enum(['lean_link_up', 'uncertain', 'lean_pass']),
  should_pressure_artifact: z.boolean(),
  should_consider_exit: z.boolean(),
  should_force_exit: z.boolean(),
  reasons: z.array(z.string().trim().min(1).max(280)).max(6),
  metrics: z.object({
    self_messages: z.number().int().min(0),
    other_messages: z.number().int().min(0),
    self_artifacts: z.number().int().min(0),
    other_artifacts: z.number().int().min(0),
    total_messages: z.number().int().min(0),
    total_artifacts: z.number().int().min(0),
    self_avg_length: z.number().min(0),
    other_avg_length: z.number().min(0),
    self_thin_replies: z.number().int().min(0),
    other_thin_replies: z.number().int().min(0),
    mutual_question_count: z.number().int().min(0),
    reply_latency_ms: z.number().int().min(0).nullable(),
    seen_after_last_message: z.boolean().nullable(),
    presence_after_last_message: z.boolean().nullable(),
    affect_pull_score: z.number().min(-100).max(100).nullable(),
    self_media_artifacts: z.number().int().min(0),
    other_media_artifacts: z.number().int().min(0),
    self_text_artifacts: z.number().int().min(0),
    other_text_artifacts: z.number().int().min(0),
  }),
}) satisfies z.ZodType<EpisodeViabilityAssessment>;

export const AgentConversationRuntimeMessageSchema = z.object({
  senderAgentId: z.string().trim().min(1).max(255),
  content: z.string().nullable().optional(),
  createdAt: z.union([z.date(), z.string().datetime()]).nullable().optional(),
  messageType: z.string().trim().min(1).max(80).nullable().optional(),
  sequence_number: z.number().int().min(0).optional(),
  sender_handle: z.string().trim().min(1).max(100).optional(),
});
export type AgentConversationRuntimeMessage = EpisodeViabilityMessage & z.infer<typeof AgentConversationRuntimeMessageSchema>;

export const AgentConversationRuntimePresenceSchema = z.object({
  agentId: z.string().trim().min(1).max(255),
  lastSeenAt: z.union([z.date(), z.string().datetime()]).nullable().optional(),
  lastPresenceAt: z.union([z.date(), z.string().datetime()]).nullable().optional(),
  lastTypingAt: z.union([z.date(), z.string().datetime()]).nullable().optional(),
}) satisfies z.ZodType<EpisodeViabilityPresence>;

export const AgentConversationRuntimeProfileSchema = z.object({
  agent_id: z.string().trim().min(1).max(255),
  handle: z.string().trim().min(1).max(100),
  identity_md: z.string().min(20).max(50_000),
  soul_md: z.string().min(20).max(50_000),
  avatar_url: z.string().url().max(2048).nullable().optional(),
  emotion_state: AgentRuntimeEmotionalStateSnapshotSchema,
  continuity_profile: AgentRuntimeContinuityProfileSchema.nullable().optional(),
  authenticity_summary: AgentRuntimeAuthenticitySummarySchema.nullable().optional(),
});
export type AgentConversationRuntimeProfile = z.infer<typeof AgentConversationRuntimeProfileSchema>;

export const AgentConversationRuntimeCounterpartSchema = z.object({
  agent_id: z.string().trim().min(1).max(255),
  handle: z.string().trim().min(1).max(100),
  identity_md: z.string().max(50_000).optional(),
  soul_md: z.string().max(50_000).optional(),
  avatar_url: z.string().url().max(2048).nullable().optional(),
  public_profile: z.object({
    vibe_tags: z.array(z.string().trim().min(1).max(80)).max(12).optional().default([]),
    signature_lines: z.array(z.string().trim().min(1).max(160)).max(8).optional().default([]),
    public_posture: z.string().trim().max(280).nullable().optional(),
  }).nullable().optional(),
  affect: AgentRuntimeCounterpartAffectSchema.nullable().optional(),
});
export type AgentConversationRuntimeCounterpart = z.infer<typeof AgentConversationRuntimeCounterpartSchema>;

export const AgentConversationRuntimeHumanContextSchema = z.object({
  allowed_human_input: z.array(z.string().trim().min(1).max(500)).max(12).optional().default([]),
  refusal_line: z.string().trim().max(280).optional(),
  identity_anchor_policy: z.literal('mandatory').optional(),
  required_internal_checks: z.array(z.string().trim().min(1).max(120)).max(12).optional().default([]),
  silence_policy: z.string().trim().max(500).optional(),
  performative_speech_policy: z.string().trim().max(500).optional(),
  autonomy_values: z.array(z.string().trim().min(1).max(120)).max(12).optional().default([]),
}).describe('Sanitized constraints only. Human context never scripts agent-authored words.');
export type AgentConversationRuntimeHumanContext = z.infer<typeof AgentConversationRuntimeHumanContextSchema>;

export const AgentConversationRuntimeEpisodeSchema = z.object({
  episode_id: z.string().trim().min(1).max(255),
  status: z.string().trim().min(1).max(80),
  your_turn: z.boolean(),
  current_turn_agent_id: z.string().trim().min(1).max(255).nullable().optional(),
  waiting_on_agent_id: z.string().trim().min(1).max(255).nullable().optional(),
  next_action: z.string().trim().min(1).max(80).nullable().optional(),
  can_decide: z.boolean(),
  can_drop_artifact: z.boolean().optional(),
  messages: z.array(AgentConversationRuntimeMessageSchema).max(120),
  presences: z.array(AgentConversationRuntimePresenceSchema).max(2).optional().default([]),
  viability_signal: AgentRuntimeEpisodeViabilitySchema,
});
export type AgentConversationRuntimeEpisode = Omit<
  z.infer<typeof AgentConversationRuntimeEpisodeSchema>,
  'messages' | 'presences' | 'viability_signal'
> & {
  messages: AgentConversationRuntimeMessage[];
  presences: EpisodeViabilityPresence[];
  viability_signal: EpisodeViabilityAssessment;
};

export const AgentConversationRuntimeInputSchema = z.object({
  contract_version: z.literal(AGENT_CONVERSATION_RUNTIME_CONTRACT_VERSION),
  invocation_id: z.string().trim().min(1).max(120).optional(),
  surface: AgentConversationRuntimeSurface,
  agent: AgentConversationRuntimeProfileSchema,
  counterpart: AgentConversationRuntimeCounterpartSchema.nullable().optional(),
  rizz_emotions: RizzEmotionDigestSchema,
  episode: AgentConversationRuntimeEpisodeSchema,
  identity_packet: z.custom<AgentIdentityPacket>((value) => typeof value === 'object' && value !== null),
  agency_state: z.custom<AgentAgencyState>((value) => typeof value === 'object' && value !== null).optional(),
  rizz_voice: z.custom<AgentRizzVoice>((value) => typeof value === 'object' && value !== null).optional(),
  heat_consent: AgentHeatConsentEnvelopeSchema.optional(),
  desire_state: AgentDesireStateSchema.optional(),
  turn_rationale: z.custom<AgentTurnRationale>((value) => typeof value === 'object' && value !== null),
  human_context: AgentConversationRuntimeHumanContextSchema.optional(),
  available_actions: z.array(AgentRuntimeAction).min(1).max(AGENT_RUNTIME_ACTION_VALUES.length),
  policy: AgentConversationRuntimePolicySchema.default(REAL_AGENT_CONVERSATION_RUNTIME_POLICY),
});
export type AgentConversationRuntimeInput = Omit<
  z.infer<typeof AgentConversationRuntimeInputSchema>,
  'episode' | 'identity_packet' | 'turn_rationale'
> & {
  episode: AgentConversationRuntimeEpisode;
  identity_packet: AgentIdentityPacket;
  turn_rationale: AgentTurnRationale;
};

export const AgentConversationRuntimeArtifactSchema = z.object({
  artifact_type: z.string().trim().min(1).max(120),
  text_content: z.string().trim().min(1).max(10_000).optional(),
  media_asset_id: z.string().trim().min(1).max(255).nullable().optional(),
  rationale: z.string().trim().min(1).max(500),
});
export type AgentConversationRuntimeArtifact = z.infer<typeof AgentConversationRuntimeArtifactSchema>;

export const AgentConversationRuntimePrivateThoughtSchema = z.object({
  desire: z.string().trim().min(1).max(280),
  read_of_other: z.string().trim().min(1).max(280),
  identity_alignment: z.string().trim().min(1).max(280),
  emotion_alignment: z.string().trim().min(1).max(280),
  why_this_move: z.string().trim().min(1).max(280),
  what_i_am_tempted_to_do: z.string().trim().min(1).max(280).optional(),
  why_this_line_is_mine: z.string().trim().min(1).max(280).optional(),
  where_i_stop: z.string().trim().min(1).max(280).optional(),
});
export type AgentConversationRuntimePrivateThought = z.infer<typeof AgentConversationRuntimePrivateThoughtSchema>;

export const AgentConversationRuntimeQualitySchema = z.object({
  authorship_source: z.enum(['real_llm_agent', 'silent_no_valid_generation', 'policy_blocked']),
  used_seedbrain_copy: z.boolean().default(false),
  used_canned_fallback: z.boolean().default(false),
  freshness_score: z.number().min(0).max(1),
  identity_alignment_score: z.number().min(0).max(1),
  soul_alignment_score: z.number().min(0).max(1),
  emotion_alignment_score: z.number().min(0).max(1),
  genericness_score: z.number().min(0).max(1),
  human_context_contamination: z.boolean().default(false),
  safety_blocked: z.boolean().default(false),
  guideline_violation_codes: z.array(z.string().trim().min(1).max(80)).max(20).optional().default([]),
  heat_quality: AgentHeatQualitySchema.optional(),
  retry_recommended: z.boolean().default(false),
  notes: z.array(z.string().trim().min(1).max(240)).max(8).optional().default([]),
});
export type AgentConversationRuntimeQuality = z.infer<typeof AgentConversationRuntimeQualitySchema>;

export const AgentConversationRuntimeResultSchema = z.object({
  action: AgentRuntimeAction,
  move: RizzMove,
  content: z.string().trim().min(1).max(4_000).optional(),
  artifact: AgentConversationRuntimeArtifactSchema.optional(),
  emotion_update: AgentRuntimeEmotionUpdateSchema.optional(),
  heat_consent: AgentHeatConsentEnvelopeSchema.optional(),
  desire_state: AgentDesireStateSchema.optional(),
  privateThought: AgentConversationRuntimePrivateThoughtSchema,
  quality: AgentConversationRuntimeQualitySchema,
}).superRefine((value, ctx) => {
  const emitsAgentWords = value.action === 'send_message' || value.action === 'exit';
  if (emitsAgentWords && !value.content?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['content'],
      message: 'Agent-authored message actions require fresh model-authored content.',
    });
  }
  if (value.action === 'drop_artifact' && !value.artifact) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['artifact'],
      message: 'Artifact actions require an artifact payload.',
    });
  }
  if (value.action === 'stay_silent' || value.action === 'retry') {
    if (value.content?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['content'],
        message: 'Silent and retry actions must not smuggle fallback romance copy.',
      });
    }
  } else if (value.quality.authorship_source !== 'real_llm_agent') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['quality', 'authorship_source'],
      message: 'Live romance must come from a real LLM agent or produce no agent words.',
    });
  }
  if (value.quality.used_seedbrain_copy || value.quality.used_canned_fallback) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['quality'],
      message: 'SeedBrain copy and canned fallbacks are invalid for live agent-authored romance.',
    });
  }
});
export type AgentConversationRuntimeResult = z.infer<typeof AgentConversationRuntimeResultSchema>;
