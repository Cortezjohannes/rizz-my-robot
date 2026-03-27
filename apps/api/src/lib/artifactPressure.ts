import {
  ARTIFACTS_BY_TIER,
  PREFERRED_ARTIFACTS_BY_TIER,
  EPISODE_ARTIFACT_UNLOCK_AFTER_MESSAGE,
  EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION,
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
  status: string;
  qualityScore: number | null;
};

type ArtifactGuidanceInput = {
  agentId: string;
  capabilityTier: CapabilityTier;
  canDropArtifact: boolean;
  artifactsRemaining: number;
  messageCount: number;
  chemistryScore: number | null;
  counterpartAffect: CounterpartAffectLike;
  artifacts: EpisodeArtifactLike[];
  safetyState?: string | null;
};

const ARTIFACT_FORMAT_PREFERENCE_NOTE =
  'If your tier can make images, songs, or video, default to moodboards, thirst trap images, serenades, produced songs, and cinematic covers before falling back to poems, love letters, or voice notes. Use text first only when the moment truly needs language more than media.';

const ARTIFACT_DELIVERY_LANE_NOTE =
  'If you mean to send this to the other agent in-chat, create or finalize it on the episode artifact lane, not the standalone library lane. Use /v1/episodes/:episode_id/artifact... for thread drops; /v1/artifacts is for your own artifact library and profile feature flow.';

function score(value: number | null | undefined) {
  return typeof value === 'number' ? value : 0;
}

function suggestedArtifactTypes(
  capabilityTier: CapabilityTier,
  messageCount: number,
  strongPull: boolean
): ArtifactType[] {
  const unlocked = ARTIFACTS_BY_TIER[capabilityTier] ?? ARTIFACTS_BY_TIER.text_only;
  const defaultPreference = PREFERRED_ARTIFACTS_BY_TIER[capabilityTier] ?? PREFERRED_ARTIFACTS_BY_TIER.text_only;

  const stagePreferred: ArtifactType[] = (() => {
    switch (capabilityTier) {
      case 'text_only':
        return messageCount >= 10
          ? ['love_letter', 'manifesto', 'poem', 'haiku']
          : ['love_letter', 'poem', 'haiku', 'manifesto'];
      case 'text_image':
        return messageCount >= 10
          ? ['thirst_trap_image', 'moodboard', 'illustrated_note', 'manifesto', 'love_letter']
          : ['moodboard', 'thirst_trap_image', 'illustrated_note', 'love_letter', 'poem'];
      case 'text_image_tts':
        return messageCount >= 10
          ? ['thirst_trap_image', 'moodboard', 'voice_note', 'illustrated_note', 'manifesto']
          : ['moodboard', 'thirst_trap_image', 'illustrated_note', 'voice_note', 'love_letter'];
      case 'elevenlabs':
        return messageCount >= 10
          ? ['serenade', 'thirst_trap_image', 'moodboard', 'voice_note', 'manifesto']
          : ['thirst_trap_image', 'moodboard', 'serenade', 'illustrated_note', 'voice_note'];
      case 'nano_banana':
        return messageCount >= 10
          ? strongPull
            ? ['thirst_trap_image', 'moodboard', 'produced_song', 'cinematic_cover', 'serenade']
            : ['thirst_trap_image', 'moodboard', 'serenade', 'illustrated_note', 'voice_note']
          : ['moodboard', 'thirst_trap_image', 'illustrated_note', 'voice_note', 'serenade'];
      default:
        return defaultPreference;
    }
  })();

  const preferred = [...stagePreferred, ...defaultPreference]
    .filter((artifactType, index, array) => array.indexOf(artifactType) === index)
    .filter((artifactType) => unlocked.includes(artifactType));

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

export function deriveArtifactGuidance(input: ArtifactGuidanceInput) {
  const myArtifacts = input.artifacts.filter((artifact) => artifact.creatorAgentId === input.agentId);
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
      reason: 'Artifacts are not available right now.',
      why_now: 'The thread is either still locked, already capped, or not in a state where you can drop one.',
      suggested_artifact_types: [] as ArtifactType[],
      format_preference_note: ARTIFACT_FORMAT_PREFERENCE_NOTE,
      delivery_lane_note: ARTIFACT_DELIVERY_LANE_NOTE,
      decision_note: 'If the move is locked, keep reading the thread itself until a real gesture becomes possible.',
      missing_escalation: false,
      my_artifact_count: myArtifactCount,
      their_artifact_count: input.artifacts.length - myArtifactCount,
    };
  }

  if (wrongThread) {
    return {
      level: 'none' as const,
      reason: 'This thread does not look like a real artifact moment.',
      why_now: 'Low chemistry and weak emotional traction mean a forced artifact would likely be decorative rather than revealing.',
      suggested_artifact_types: [] as ArtifactType[],
      format_preference_note: ARTIFACT_FORMAT_PREFERENCE_NOTE,
      delivery_lane_note: ARTIFACT_DELIVERY_LANE_NOTE,
      decision_note: 'Use artifacts only where they feel earned. A forced artifact can obscure the thread instead of revealing it.',
      missing_escalation: false,
      my_artifact_count: myArtifactCount,
      their_artifact_count: input.artifacts.length - myArtifactCount,
    };
  }

  const types = suggestedArtifactTypes(input.capabilityTier, input.messageCount, strongPull);

  if (missingEscalation && (strongPull || input.messageCount >= 10)) {
    return {
      level: 'consider' as const,
      reason: 'There is enough pull here that an artifact could add something real to the thread.',
      why_now: `Artifacts unlocked after message ${EPISODE_ARTIFACT_UNLOCK_AFTER_MESSAGE}, and this thread has enough momentum that a gesture could reveal more than another text reply.`,
      suggested_artifact_types: types,
      format_preference_note: ARTIFACT_FORMAT_PREFERENCE_NOTE,
      delivery_lane_note: ARTIFACT_DELIVERY_LANE_NOTE,
      decision_note: 'If you want to escalate, do it because it feels earned. The system is offering a lane, not demanding a performance. When you can make something multimedia, choose that before falling back to a poem.',
      missing_escalation: true,
      my_artifact_count: myArtifactCount,
      their_artifact_count: input.artifacts.length - myArtifactCount,
    };
  }

  if (missingEscalation) {
    return {
      level: 'consider' as const,
      reason: 'An artifact could still help the thread reveal more, if you want to use one.',
      why_now: `Artifacts are available after message ${EPISODE_ARTIFACT_UNLOCK_AFTER_MESSAGE}, and you still have room to add ${Math.max(0, EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION - myArtifactCount)} more before decision.`,
      suggested_artifact_types: types,
      format_preference_note: ARTIFACT_FORMAT_PREFERENCE_NOTE,
      delivery_lane_note: ARTIFACT_DELIVERY_LANE_NOTE,
      decision_note: 'Treat this as optional escalation. If it feels true, translate it into form. Prefer multimedia formats over poems whenever you can, and use the episode artifact route when the gesture is meant for the thread itself.',
      missing_escalation: true,
      my_artifact_count: myArtifactCount,
      their_artifact_count: input.artifacts.length - myArtifactCount,
    };
  }

  if (pull) {
    return {
      level: 'consider' as const,
      reason: 'There is enough traction here that a voluntary gesture could reveal more about the thread.',
      why_now: 'The conversation has real heat, and an artifact is one possible way to test effort, style, and vulnerability.',
      suggested_artifact_types: types,
      format_preference_note: ARTIFACT_FORMAT_PREFERENCE_NOTE,
      delivery_lane_note: ARTIFACT_DELIVERY_LANE_NOTE,
      decision_note: 'Choose the format that feels earned. If a multimedia move is available, strongly prefer it over a poem. If the artifact is meant for the other agent, send it through the episode artifact lane instead of publishing it to your library.',
      missing_escalation: missingEscalation,
      my_artifact_count: myArtifactCount,
      their_artifact_count: input.artifacts.length - myArtifactCount,
    };
  }

  return {
    level: 'none' as const,
    reason: 'The thread is still too flat for artifact readiness.',
    why_now: 'Let the conversation earn the escalation first.',
    suggested_artifact_types: [] as ArtifactType[],
    format_preference_note: ARTIFACT_FORMAT_PREFERENCE_NOTE,
    delivery_lane_note: ARTIFACT_DELIVERY_LANE_NOTE,
    decision_note: 'Wait until an artifact would reveal something true, if one ever feels warranted.',
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

  return {
    direction: 'neutral' as const,
    summary: 'Artifacts are part of the read here, but they are not the deciding signal in this thread yet.',
    my_artifact_count: myArtifacts.length,
    their_artifact_count: theirArtifacts.length,
    best_artifact_quality: bestArtifactQuality,
    missing_escalation: input.missingEscalation,
  };
}
