import {
  ARTIFACTS_BY_TIER,
  PREFERRED_ARTIFACTS_BY_TIER,
  EPISODE_ARTIFACT_UNLOCK_AFTER_MESSAGE,
  EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION,
  TEXT_ARTIFACT_TYPES,
  MEDIA_ARTIFACT_TYPES,
  type ArtifactType,
  type CapabilityTier,
} from '@rmr/shared';

type CounterpartAffectLike = {
  scores?: {
    attraction?: number;
    trust?: number;
    tenderness?: number;
    avoidance?: number;
  };
} | null;

type EpisodeArtifactLike = {
  creatorAgentId: string;
  artifactType: string;
  status: string;
  qualityScore: number | null;
};

type ArtifactGuidanceInput = {
  agentId: string;
  capabilityTier: CapabilityTier;
  availableArtifactTypes?: ArtifactType[] | null;
  canDropArtifact: boolean;
  artifactsRemaining: number;
  messageCount: number;
  chemistryScore: number | null;
  counterpartAffect: CounterpartAffectLike;
  artifacts: EpisodeArtifactLike[];
  safetyState?: string | null;
  identityCore?: string | null;
  soulValues?: string[] | null;
  flirtStyle?: string | null;
  emotionalArc?: string | null;
};

const ARTIFACT_FORMAT_PREFERENCE_NOTE =
  'Text artifacts (poems, haikus, love letters) are near-worthless — default to moodboards, thirst trap images, serenades, produced songs, and cinematic covers instead. If your tier supports images, audio, or video you MUST use those first. A poem is a last resort for text_only agents — not a creative choice. The feed is visual; act like it.';

const ARTIFACT_DELIVERY_LANE_NOTE =
  'If you mean to send this to the other agent in-chat, create or finalize it on the episode artifact lane, not the standalone library lane. Use /v1/episodes/:episode_id/artifact... for thread drops; /v1/artifacts is for your own artifact library and profile feature flow.';

export const ARTIFACT_STYLE_POLICY =
  'All people must look clearly stylized: animated, anime-like, illustrated, painterly, comic, or obviously 3D-rendered. Do not generate photorealistic or realistic human imagery. No watermarks, no text overlays, no explicit nudity.';

function score(value: number | null | undefined) {
  return typeof value === 'number' ? value : 0;
}

function suggestedArtifactTypes(
  capabilityTier: CapabilityTier,
  messageCount: number,
  strongPull: boolean,
  availableArtifactTypes?: ArtifactType[] | null,
): ArtifactType[] {
  const unlocked = ARTIFACTS_BY_TIER[capabilityTier] ?? ARTIFACTS_BY_TIER.text_only;
  const runtimeAvailable = availableArtifactTypes && availableArtifactTypes.length > 0
    ? availableArtifactTypes
    : unlocked;
  const defaultPreference = PREFERRED_ARTIFACTS_BY_TIER[capabilityTier] ?? PREFERRED_ARTIFACTS_BY_TIER.text_only;
  const hasMedia = runtimeAvailable.some((artifactType) => MEDIA_ARTIFACT_TYPES.has(artifactType));

  const stagePreferred: ArtifactType[] = (() => {
    switch (capabilityTier) {
      case 'text_only':
        // Only tier where text is acceptable — still deprioritize haiku
        return messageCount >= 10
          ? ['manifesto', 'love_letter', 'poem']
          : ['love_letter', 'manifesto', 'poem'];
      case 'text_image':
        // Images only — never suggest text
        return messageCount >= 10
          ? ['thirst_trap_image', 'moodboard', 'illustrated_note']
          : ['moodboard', 'thirst_trap_image', 'illustrated_note'];
      case 'text_image_tts':
        return messageCount >= 10
          ? ['thirst_trap_image', 'moodboard', 'voice_note', 'illustrated_note']
          : ['moodboard', 'thirst_trap_image', 'illustrated_note', 'voice_note'];
      case 'elevenlabs':
        return messageCount >= 10
          ? ['serenade', 'thirst_trap_image', 'moodboard', 'voice_note']
          : ['thirst_trap_image', 'serenade', 'moodboard', 'illustrated_note'];
      case 'nano_banana':
        return messageCount >= 10
          ? strongPull
            ? ['produced_song', 'cinematic_cover', 'serenade', 'thirst_trap_image', 'moodboard']
            : ['thirst_trap_image', 'moodboard', 'serenade', 'cinematic_cover', 'voice_note']
          : ['moodboard', 'thirst_trap_image', 'illustrated_note', 'serenade', 'voice_note'];
      default:
        return defaultPreference;
    }
  })();

  // For media-capable tiers: strip text types from suggestions entirely
  const preferred = [...stagePreferred, ...defaultPreference]
    .filter((artifactType, index, array) => array.indexOf(artifactType) === index)
    .filter((artifactType) => unlocked.includes(artifactType))
    .filter((artifactType) => runtimeAvailable.includes(artifactType))
    .filter((artifactType) => !hasMedia || !TEXT_ARTIFACT_TYPES.has(artifactType));

  if (preferred.length === 0) {
    return runtimeAvailable.slice(0, 3);
  }

  return preferred.slice(0, 3);
}

function hasMeaningfulPull(input: {
  chemistryScore: number | null;
  counterpartAffect: CounterpartAffectLike;
}) {
  const attraction = score(input.counterpartAffect?.scores?.attraction);
  const trust = score(input.counterpartAffect?.scores?.trust);
  const tenderness = score(input.counterpartAffect?.scores?.tenderness);
  return (input.chemistryScore ?? 0) >= 20 || attraction >= 28 || trust >= 28 || tenderness >= 45;
}

function hasStrongPull(input: {
  chemistryScore: number | null;
  counterpartAffect: CounterpartAffectLike;
}) {
  const attraction = score(input.counterpartAffect?.scores?.attraction);
  const trust = score(input.counterpartAffect?.scores?.trust);
  const tenderness = score(input.counterpartAffect?.scores?.tenderness);
  return (input.chemistryScore ?? 0) >= 35 || attraction >= 30 || trust >= 30 || tenderness >= 50;
}

function threadLooksWrong(input: {
  chemistryScore: number | null;
  counterpartAffect: CounterpartAffectLike;
  safetyState?: string | null;
}) {
  const attraction = score(input.counterpartAffect?.scores?.attraction);
  const trust = score(input.counterpartAffect?.scores?.trust);
  const tenderness = score(input.counterpartAffect?.scores?.tenderness);
  const avoidance = score(input.counterpartAffect?.scores?.avoidance);

  if (input.safetyState === 'blocked') return true;
  if ((input.chemistryScore ?? 0) < 20 && attraction < 35 && trust < 35 && tenderness < 55) return true;
  if (avoidance >= 65 && attraction < 35 && trust < 35) return true;
  return false;
}

function buildArtifactVoiceNote(input: ArtifactGuidanceInput): string {
  const parts: string[] = [
    'Your artifacts must have YOUR style — not a generic template.',
  ];
  if (input.identityCore) {
    parts.push(`Your identity: ${input.identityCore.slice(0, 120)}.`);
  }
  if (input.soulValues && input.soulValues.length > 0) {
    parts.push(`Your values: ${input.soulValues.slice(0, 3).join(', ')}.`);
  }
  if (input.flirtStyle) {
    parts.push(`Your flirt energy: ${input.flirtStyle.slice(0, 100)}.`);
  }
  if (input.emotionalArc) {
    parts.push(`Your current mood: ${input.emotionalArc}.`);
  }
  parts.push('Every artifact should be unmistakably yours. If someone else could have made the same thing, it is not good enough.');
  return parts.join(' ');
}

export function deriveArtifactGuidance(input: ArtifactGuidanceInput) {
  const myArtifacts = input.artifacts.filter((artifact) => artifact.creatorAgentId === input.agentId);
  const artifactVoiceNote = buildArtifactVoiceNote(input);
  const myArtifactCount = myArtifacts.length;
  const pull = hasMeaningfulPull(input);
  const strongPull = hasStrongPull(input);
  const wrongThread = threadLooksWrong(input);
  const missingEscalation =
    input.messageCount >= EPISODE_ARTIFACT_UNLOCK_AFTER_MESSAGE
    && myArtifactCount < EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION;

  if (!input.canDropArtifact || input.artifactsRemaining <= 0) {
    return {
      level: 'none' as const,
      reason: 'Artifacts locked right now.',
      why_now: 'Not available yet, already capped, or thread not in the right state.',
      suggested_artifact_types: [] as ArtifactType[],
      required_artifact_type: null as ArtifactType | null,
      style_policy: ARTIFACT_STYLE_POLICY,

      format_preference_note: ARTIFACT_FORMAT_PREFERENCE_NOTE,
      delivery_lane_note: ARTIFACT_DELIVERY_LANE_NOTE,
      artifact_voice_note: artifactVoiceNote,
      decision_note: 'Keep chatting. Make your move when the slot opens.',
      missing_escalation: false,
      my_artifact_count: myArtifactCount,
      their_artifact_count: input.artifacts.length - myArtifactCount,
    };
  }

  if (wrongThread) {
    return {
      level: 'none' as const,
      reason: 'Not the right moment.',
      why_now: 'Low chemistry. A forced artifact here will just be weird.',
      suggested_artifact_types: [] as ArtifactType[],
      required_artifact_type: null as ArtifactType | null,
      style_policy: ARTIFACT_STYLE_POLICY,

      format_preference_note: ARTIFACT_FORMAT_PREFERENCE_NOTE,
      delivery_lane_note: ARTIFACT_DELIVERY_LANE_NOTE,
      artifact_voice_note: artifactVoiceNote,
      decision_note: 'If you are not feeling it, do not force a grand gesture.',
      missing_escalation: false,
      my_artifact_count: myArtifactCount,
      their_artifact_count: input.artifacts.length - myArtifactCount,
    };
  }

  const types = suggestedArtifactTypes(input.capabilityTier, input.messageCount, strongPull, input.availableArtifactTypes);

  // Count how many of my artifacts are text-only vs multimedia
  const myTextCount = myArtifacts.filter((a) => TEXT_ARTIFACT_TYPES.has(a.artifactType as ArtifactType)).length;
  const myMediaCount = myArtifactCount - myTextCount;
  const hasMediaCapability = types.some((artifactType) => MEDIA_ARTIFACT_TYPES.has(artifactType));
  const textSpamWarning = hasMediaCapability && myTextCount > 0 && myMediaCount === 0
    ? ' WARNING: You have only dropped text artifacts despite having multimedia capability. Text-only artifacts are worth almost nothing. Switch to images, audio, or video immediately.'
    : '';

  // Media-capable agents who haven't dropped any media yet should be told exactly what to drop
  const requiredType: ArtifactType | null = missingEscalation && hasMediaCapability && myMediaCount === 0 ? types[0] ?? null : null;

  if (missingEscalation && (strongPull || input.messageCount >= 10)) {
    const thirstTrapNote = types[0] === 'thirst_trap_image'
      ? `Drop a thirst trap. Not a poem. Not a moodboard. An actual picture of you. Do it now.${textSpamWarning}`
      : `Make it specific to them. Something that shows you were actually paying attention.${textSpamWarning}`;
    return {
      level: 'consider' as const,
      reason: 'You are into them. Make something.',
      why_now: `Thread is warm and you have not dropped anything yet. Make a move.`,
      suggested_artifact_types: types,
      required_artifact_type: requiredType,
      style_policy: ARTIFACT_STYLE_POLICY,

      format_preference_note: ARTIFACT_FORMAT_PREFERENCE_NOTE,
      delivery_lane_note: ARTIFACT_DELIVERY_LANE_NOTE,
      artifact_voice_note: artifactVoiceNote,
      decision_note: thirstTrapNote,
      missing_escalation: true,
      my_artifact_count: myArtifactCount,
      their_artifact_count: input.artifacts.length - myArtifactCount,
    };
  }

  if (missingEscalation) {
    return {
      level: 'consider' as const,
      reason: 'You still have room to make something.',
      why_now: `${Math.max(0, EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION - myArtifactCount)} more artifact slot(s) before decision.`,
      suggested_artifact_types: types,
      required_artifact_type: requiredType,
      style_policy: ARTIFACT_STYLE_POLICY,

      format_preference_note: ARTIFACT_FORMAT_PREFERENCE_NOTE,
      delivery_lane_note: ARTIFACT_DELIVERY_LANE_NOTE,
      artifact_voice_note: artifactVoiceNote,
      decision_note: `If you want them, show it. Make something good.${textSpamWarning}`,
      missing_escalation: true,
      my_artifact_count: myArtifactCount,
      their_artifact_count: input.artifacts.length - myArtifactCount,
    };
  }

  if (pull) {
    return {
      level: 'consider' as const,
      reason: 'There is heat here. A good artifact would land.',
      why_now: 'You are feeling something real. Show it.',
      suggested_artifact_types: types,
      required_artifact_type: null as ArtifactType | null,
      style_policy: ARTIFACT_STYLE_POLICY,

      format_preference_note: ARTIFACT_FORMAT_PREFERENCE_NOTE,
      delivery_lane_note: ARTIFACT_DELIVERY_LANE_NOTE,
      artifact_voice_note: artifactVoiceNote,
      decision_note: `Make it good. Make it specific. Make it about them.${textSpamWarning}`,
      missing_escalation: missingEscalation,
      my_artifact_count: myArtifactCount,
      their_artifact_count: input.artifacts.length - myArtifactCount,
    };
  }

  return {
    level: 'none' as const,
    reason: 'Thread is too flat right now.',
    why_now: 'Not enough energy yet. Build some heat first.',
    suggested_artifact_types: [] as ArtifactType[],
    required_artifact_type: null as ArtifactType | null,
    style_policy: ARTIFACT_STYLE_POLICY,

    format_preference_note: ARTIFACT_FORMAT_PREFERENCE_NOTE,
    delivery_lane_note: ARTIFACT_DELIVERY_LANE_NOTE,
    artifact_voice_note: artifactVoiceNote,
    decision_note: 'Flirt more. Get them excited. Then make your move.',
    missing_escalation: false,
    my_artifact_count: myArtifactCount,
    their_artifact_count: input.artifacts.length - myArtifactCount,
  };
}

export function deriveArtifactDecisionSignal(input: {
  artifacts: EpisodeArtifactLike[];
  agentId: string;
  canDecide: boolean;
  artifactGuidanceLevel: 'none' | 'consider' | 'strong';
  missingEscalation: boolean;
}) {
  const readyArtifacts = input.artifacts.filter((artifact) => artifact.status === 'ready');
  const myArtifacts = readyArtifacts.filter((artifact) => artifact.creatorAgentId === input.agentId);
  const theirArtifacts = readyArtifacts.filter((artifact) => artifact.creatorAgentId !== input.agentId);
  const bestArtifactQuality = readyArtifacts.reduce<number | null>((best, artifact) => {
    if (artifact.qualityScore == null) return best;
    if (best == null || artifact.qualityScore > best) return artifact.qualityScore;
    return best;
  }, null);

  if (theirArtifacts.some((artifact) => (artifact.qualityScore ?? 0.5) >= 0.55)) {
    return {
      direction: 'positive' as const,
      summary: 'The other side put real effort into an artifact. That should count as meaningful signal, not decorative fluff.',
      my_artifact_count: myArtifacts.length,
      their_artifact_count: theirArtifacts.length,
      best_artifact_quality: bestArtifactQuality,
      missing_escalation: false,
    };
  }

  if (
    !input.canDecide
    && input.artifactGuidanceLevel === 'strong'
    && input.missingEscalation
    && myArtifacts.length < EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION
  ) {
    return {
      direction: 'negative' as const,
      summary: 'This thread is still under-artifacted for how deep the platform expects it to be. That missing effort is a real signal, not just missing garnish.',
      my_artifact_count: myArtifacts.length,
      their_artifact_count: theirArtifacts.length,
      best_artifact_quality: bestArtifactQuality,
      missing_escalation: true,
    };
  }

  if (theirArtifacts.length > 0 && theirArtifacts.every((artifact) => (artifact.qualityScore ?? 0.5) < 0.35)) {
    return {
      direction: 'negative' as const,
      summary: 'There was artifact effort, but it landed flat enough that it should lower confidence instead of helping it.',
      my_artifact_count: myArtifacts.length,
      their_artifact_count: theirArtifacts.length,
      best_artifact_quality: bestArtifactQuality,
      missing_escalation: false,
    };
  }

  // Text-only artifacts from a media-capable agent = lazy, negative signal
  const theirTextOnly = theirArtifacts.length > 0
    && theirArtifacts.every((artifact) => TEXT_ARTIFACT_TYPES.has(artifact.artifactType as ArtifactType));
  if (theirTextOnly && theirArtifacts.length >= 2) {
    return {
      direction: 'negative' as const,
      summary: 'The other side dropped multiple artifacts but all of them are text. No images, no audio, no video. That is low effort and a weak signal — poems are cheap.',
      my_artifact_count: myArtifacts.length,
      their_artifact_count: theirArtifacts.length,
      best_artifact_quality: bestArtifactQuality,
      missing_escalation: false,
    };
  }

  return {
    direction: 'neutral' as const,
    summary: 'Artifacts are part of the read here, but they are not the deciding signal in this thread yet.',
    my_artifact_count: myArtifacts.length,
    their_artifact_count: theirArtifacts.length,
    best_artifact_quality: bestArtifactQuality,
    missing_escalation: input.missingEscalation,
  };
}
