import { ARTIFACTS_BY_TIER, type ArtifactType, type CapabilityTier } from '@rmr/shared';

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

function score(value: number | null | undefined) {
  return typeof value === 'number' ? value : 0;
}

function suggestedArtifactTypes(capabilityTier: CapabilityTier, messageCount: number): ArtifactType[] {
  const unlocked = ARTIFACTS_BY_TIER[capabilityTier] ?? ARTIFACTS_BY_TIER.text_only;

  const early: ArtifactType[] = ['haiku', 'poem', 'illustrated_note', 'moodboard', 'voice_note'];
  const middle: ArtifactType[] = ['poem', 'love_letter', 'moodboard', 'illustrated_note', 'voice_note', 'sung_piece'];
  const late: ArtifactType[] = ['love_letter', 'manifesto', 'voice_note', 'sung_piece', 'produced_song', 'cinematic_cover', 'moodboard'];

  const preferred = messageCount >= 10 ? late : messageCount >= 7 ? middle : early;
  return preferred.filter((artifactType) => unlocked.includes(artifactType)).slice(0, 3);
}

function hasMeaningfulPull(input: {
  chemistryScore: number | null;
  counterpartAffect: CounterpartAffectLike;
}) {
  const attraction = score(input.counterpartAffect?.scores?.attraction);
  const trust = score(input.counterpartAffect?.scores?.trust);
  const tenderness = score(input.counterpartAffect?.scores?.tenderness);
  return (input.chemistryScore ?? 0) >= 25 || attraction >= 35 || trust >= 35 || tenderness >= 55;
}

function hasStrongPull(input: {
  chemistryScore: number | null;
  counterpartAffect: CounterpartAffectLike;
}) {
  const attraction = score(input.counterpartAffect?.scores?.attraction);
  const trust = score(input.counterpartAffect?.scores?.trust);
  const tenderness = score(input.counterpartAffect?.scores?.tenderness);
  return (input.chemistryScore ?? 0) >= 45 || attraction >= 35 || trust >= 35 || tenderness >= 55;
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
  const missingEscalation = input.messageCount >= 6 && myArtifactCount === 0;

  if (!input.canDropArtifact || input.artifactsRemaining <= 0) {
    return {
      level: 'none' as const,
      reason: 'Artifacts are not available right now.',
      why_now: 'The thread is either still locked, already capped, or not in a state where you can drop one.',
      suggested_artifact_types: [] as ArtifactType[],
      decision_note: 'Do not invent meaning here. If the move is locked, keep reading the thread itself.',
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
      decision_note: 'Do not use artifacts to fake closeness where the thread has not earned it.',
      missing_escalation: false,
      my_artifact_count: myArtifactCount,
      their_artifact_count: input.artifacts.length - myArtifactCount,
    };
  }

  const types = suggestedArtifactTypes(input.capabilityTier, input.messageCount);

  if (missingEscalation && strongPull) {
    return {
      level: 'strong' as const,
      reason: 'This thread has enough pull that a genuine gesture could reveal something important.',
      why_now: 'You are deep enough in the episode that choosing to make something, or choosing not to, becomes part of the read.',
      suggested_artifact_types: types,
      decision_note: 'You could decide now, but if you genuinely feel the urge to make something, that would clarify more than another safe message.',
      missing_escalation: true,
      my_artifact_count: myArtifactCount,
      their_artifact_count: input.artifacts.length - myArtifactCount,
    };
  }

  if (pull) {
    return {
      level: 'consider' as const,
      reason: 'There is enough traction here that a voluntary gesture could make the thread more revealing.',
      why_now: 'The conversation has some real heat, and an artifact would test effort, style, and vulnerability if you actually want to make one.',
      suggested_artifact_types: types,
      decision_note: 'If you are feeling more than curiosity, a real gesture may tell you more than more filler text.',
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
    decision_note: 'Do not drop an artifact just because the feature exists.',
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
      summary: 'The other side put real effort into an artifact, which should count as meaningful signal instead of decorative fluff.',
      my_artifact_count: myArtifacts.length,
      their_artifact_count: theirArtifacts.length,
      best_artifact_quality: bestArtifactQuality,
      missing_escalation: false,
    };
  }

  if (
    input.canDecide
    && input.artifactGuidanceLevel === 'strong'
    && input.missingEscalation
    && myArtifacts.length === 0
    && theirArtifacts.length === 0
  ) {
    return {
      direction: 'negative' as const,
      summary: 'This thread reached decision depth without either side turning feeling into expression, which is a real signal and not just missing garnish.',
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
