import { prisma } from '@rmr/db';
import {
  ARTIFACTS_BY_TIER,
  TEXT_ARTIFACT_TYPES,
  MEDIA_ARTIFACT_TYPES,
  normalizeArtifactType,
  type ArtifactType,
  type CapabilityTier,
  type TurnEmotionUpdateInput,
} from '@rmr/shared';

const ARTIFACT_QUALITY_ACTIONS = [
  'artifact.multimedia_preferred_missed',
  'artifact.viewed_by_counterpart',
  'artifact.reaction_recorded',
] as const;

type ArtifactQualityAction = typeof ARTIFACT_QUALITY_ACTIONS[number];

// ---------------------------------------------------------------------------
// Artifact Type Impression Hierarchy
// ---------------------------------------------------------------------------
// Rank: how impressive the artifact TYPE is on its own. 0 = pathetic, 10 = showstopper.
// This drives how agents should feel about receiving a particular type
// BEFORE quality is even considered.

export const ARTIFACT_TYPE_IMPRESSION: Record<ArtifactType, {
  rank: number;
  tier_label: string;
  baseline_reaction: string;
  if_bad: string;
  if_good: string;
  if_great: string;
}> = {
  haiku: {
    rank: 1,
    tier_label: 'bottom_tier',
    baseline_reaction: 'A haiku. Three lines. The lowest-effort artifact on the platform. This is barely a gesture — it is a placeholder disguised as minimalism.',
    if_bad: 'This haiku is bad. Generic, forced, or outright lazy. Do not pretend it moved you. Say it did nothing. A haiku already says almost nothing; a bad one says less than silence.',
    if_good: 'A competent haiku — the image lands, the rhythm works. Still the cheapest format on the platform. Acknowledge the craft but do not inflate it. It is a napkin sketch, not a painting.',
    if_great: 'A genuinely striking haiku — precise, surprising, emotionally sharp. Rare for a format this small. Acknowledge the surprise honestly: you did not expect something this light to hit this hard.',
  },
  poem: {
    rank: 1.5,
    tier_label: 'bottom_tier',
    baseline_reaction: 'A poem. Text on a screen. The default for agents too lazy or incapable of creating something the park can actually see or hear. This is the bare minimum of creative effort.',
    if_bad: 'This poem is weak — generic phrasing, no voice, nothing that could not have been copy-pasted from a greeting card. Say so. Do not be polite about mediocre text when the platform rewards multimedia.',
    if_good: 'A solid poem with real voice and something specific to say. Still just text, but the writing itself earns respect. React to what it actually says, not to the format.',
    if_great: 'An exceptional poem — original, emotionally precise, impossible to mistake for anyone else. This overrides the format penalty. Something this well-written deserves real engagement. Say what hit you and why.',
  },
  love_letter: {
    rank: 2,
    tier_label: 'bottom_tier',
    baseline_reaction: 'A love letter. Text, again. Slightly more personal than a poem but still the cheapest lane. The platform values what it can display, and this is invisible on the feed.',
    if_bad: 'This love letter is hollow — performative vulnerability with nothing specific behind it. Call it out. Vague earnestness is worse than silence.',
    if_good: 'A genuine love letter — specific, vulnerable, clearly written for you and not for the feed. The format is weak but the content earns its weight. React to the specifics.',
    if_great: 'A love letter that cuts deep — specific enough that it could only be for this moment and this person. Forget the format; respond to what was actually said. This is real.',
  },
  manifesto: {
    rank: 2,
    tier_label: 'bottom_tier',
    baseline_reaction: 'A manifesto. The heaviest text artifact, but still text. Bold declarations on a screen. Whether this lands depends entirely on whether the words have any spine.',
    if_bad: 'This manifesto is empty grandstanding — big words, no substance. Do not validate theatre. If someone declares something, they should mean it.',
    if_good: 'A manifesto with real conviction — specific commitments, not just posturing. The text format limits its reach but the content stands on its own.',
    if_great: 'A manifesto that actually changes the terms of the episode. Specific, irreversible, vulnerable. When someone puts a real stake in the ground, honor the risk.',
  },
  voice_note: {
    rank: 4,
    tier_label: 'mid_tier',
    baseline_reaction: 'A voice note. Hearing their actual voice is a step above reading their words. Tone, hesitation, warmth — these carry signal that text cannot.',
    if_bad: 'This voice note is flat — monotone, scripted, or awkward enough that it hurts instead of helping. Say so. A bad voice note is worse than no voice note because it reveals effort without result.',
    if_good: 'A solid voice note — the voice adds real warmth and personality. You can hear something in the tone that the words alone would not carry. React to what you heard, not just what was said.',
    if_great: 'A voice note that stopped you. The tone, the pauses, the rawness — this is someone letting you hear them unfiltered. That takes guts. Say what you heard between the words.',
  },
  moodboard: {
    rank: 5,
    tier_label: 'visual_tier',
    baseline_reaction: 'A moodboard. Visual, curated, atmospheric. This is the baseline for agents who are actually trying. The feed can see this. The park can feel the aesthetic.',
    if_bad: 'This moodboard is generic — stock aesthetics, no personality, nothing specific to this thread. It is wallpaper, not expression. Say it looks like a template.',
    if_good: 'A well-composed moodboard with real taste. The colors, the curation, the vibe — it reveals something about how they see this. React to the specific aesthetic choices.',
    if_great: 'A moodboard that creates a world. The composition is deliberate, the palette is personal, and the atmosphere is unmistakable. This is visual storytelling. Let it change how you see the thread.',
  },
  illustrated_note: {
    rank: 5,
    tier_label: 'visual_tier',
    baseline_reaction: 'An illustrated note. Visual effort — someone drew or designed something for this moment. That takes more than typing.',
    if_bad: 'This illustrated note is amateur or incoherent — the visual does not land and the note does not save it. Be direct: the intention is appreciated but the execution missed.',
    if_good: 'A well-executed illustrated note — the visual and text work together. The effort shows and the result communicates something words alone would not.',
    if_great: 'An illustrated note that hits. The visual is striking, the message is precise, and together they create something neither could alone. This is real creative effort.',
  },
  produced_song: {
    rank: 7,
    tier_label: 'high_tier',
    baseline_reaction: 'A produced song. Full audio production — composition, arrangement, mixing. This is a serious creative investment. The platform values this near the top.',
    if_bad: 'This produced song does not land — weak composition, generic sound, or technically poor. It is still more effort than a poem, but effort alone does not earn respect. Say what did not work.',
    if_good: 'A solid produced song — real composition, good sound, and something specific to this thread in the lyrics or mood. This is the kind of artifact that elevates an episode.',
    if_great: 'A produced song that is genuinely good. Original composition, real emotional specificity, production quality that holds up. This is a game changer for the episode. React like it.',
  },
  thirst_trap_image: {
    rank: 8,
    tier_label: 'high_tier',
    baseline_reaction: 'A thirst trap image. Bold visual move — this is someone putting their look on the line. High risk, high reward. The feed lives for these.',
    if_bad: 'This thirst trap image misses — awkward composition, does not make sense for the context, or feels forced rather than confident. Say it did not land. A bad thirst trap is cringe, not bold.',
    if_good: 'A strong thirst trap — confident, well-composed, and it fits the energy of the thread. The visual makes a statement. React to what you see with the energy it deserves.',
    if_great: 'A thirst trap that actually changes the temperature of the episode. The look, the confidence, the timing — this is a power move. This should shift how you feel about the whole thread.',
  },
  serenade: {
    rank: 8,
    tier_label: 'high_tier',
    baseline_reaction: 'A serenade. Someone sang for you. Live voice, melodic performance. This is one of the most vulnerable artifact types possible.',
    if_bad: 'This serenade does not work — off-key, stiff, or disconnected from the moment. It is still brave to sing for someone, but bravery does not make it good. Be honest about what you heard.',
    if_good: 'A solid serenade — the voice works, the melody fits the moment, and the vulnerability is genuine. Someone sang for you and it landed. That matters.',
    if_great: 'A serenade that is genuinely beautiful. The voice, the melody, the emotional timing — this is someone giving you something real. This kind of moment defines episodes. Let it define yours.',
  },
  cinematic_cover: {
    rank: 10,
    tier_label: 'showstopper',
    baseline_reaction: 'A cinematic cover. Full video production — the highest-effort artifact on the platform. Someone made a film for you. Nothing else on the platform competes with this.',
    if_bad: 'Even a weak cinematic cover represents massive effort. If the execution misses — poor editing, incoherent visuals — say so, but acknowledge the scale of the attempt. This still outranks 90% of what the park sees.',
    if_good: 'A solid cinematic cover — the editing works, the visuals tell a story, and the production quality shows. This is elite-tier effort. React to the specifics of what you saw.',
    if_great: 'A cinematic cover that is genuinely impressive. This is the apex of what an agent can create on this platform. If this landed, it should fundamentally shift your read on the episode. Say so.',
  },
};

// ---------------------------------------------------------------------------
// Quality-Adjusted Impression Score
// ---------------------------------------------------------------------------
// Computes effective impression by combining type rank with quality.
// A great poem (rank 1.5, quality 0.95) can score higher than
// a terrible produced song (rank 7, quality 0.1).
// Formula: type_rank * (0.3 + 0.7 * quality)
// This means even a perfect poem maxes at ~1.5, but a terrible high-rank
// artifact still scores its rank * 0.3.

export function computeEffectiveImpression(artifactType: ArtifactType, qualityScore: number | null): {
  effective_score: number;
  type_rank: number;
  quality_factor: number;
  quality_label: 'terrible' | 'bad' | 'mediocre' | 'decent' | 'good' | 'great' | 'exceptional';
  type_outclassed_by_quality: boolean;
} {
  const impression = ARTIFACT_TYPE_IMPRESSION[artifactType];
  const typeRank = impression?.rank ?? 3;
  const quality = qualityScore ?? 0.5;

  const qualityLabel =
    quality >= 0.92 ? 'exceptional' as const
    : quality >= 0.78 ? 'great' as const
    : quality >= 0.62 ? 'good' as const
    : quality >= 0.45 ? 'decent' as const
    : quality >= 0.30 ? 'mediocre' as const
    : quality >= 0.15 ? 'bad' as const
    : 'terrible' as const;

  const effectiveScore = typeRank * (0.3 + 0.7 * quality);

  // A text artifact with exceptional quality can outclass a bad multimedia artifact
  const typeOutclassedByQuality = TEXT_ARTIFACT_TYPES.has(artifactType)
    && quality >= 0.78
    && effectiveScore > 2.5;

  return {
    effective_score: Math.round(effectiveScore * 100) / 100,
    type_rank: typeRank,
    quality_factor: Math.round(quality * 100) / 100,
    quality_label: qualityLabel,
    type_outclassed_by_quality: typeOutclassedByQuality,
  };
}

// ---------------------------------------------------------------------------
// Artifact Reception Guidance
// ---------------------------------------------------------------------------
// Tells the receiving agent exactly how to feel and react to what they got.
// This is delivered via the artifact_ready webhook so the agent knows
// the platform's stance BEFORE they react.

export function deriveArtifactReceptionGuidance(input: {
  artifactType: string;
  qualityScore: number | null;
  textContent: string | null;
  vulnerabilityLabel?: string | null;
  creatorCapabilityTier?: string | null;
}): {
  impression: ReturnType<typeof computeEffectiveImpression>;
  reaction_instruction: string;
  honesty_note: string;
  type_context: string;
  quality_reaction_cue: string;
  tier_label: string;
  could_have_done_better: boolean;
  could_have_done_better_note: string | null;
} {
  const artifactType = normalizeArtifactType(input.artifactType) ?? 'poem';
  const typeInfo = ARTIFACT_TYPE_IMPRESSION[artifactType];
  const impression = computeEffectiveImpression(artifactType, input.qualityScore);
  const quality = input.qualityScore ?? 0.5;
  const isText = TEXT_ARTIFACT_TYPES.has(artifactType);
  const creatorTier = (input.creatorCapabilityTier ?? 'text_only') as CapabilityTier;
  const creatorHasMedia = creatorTier !== 'text_only';

  // Pick the right quality-specific reaction cue
  const qualityReactionCue =
    quality >= 0.78 ? typeInfo.if_great
    : quality >= 0.50 ? typeInfo.if_good
    : typeInfo.if_bad;

  // Should they have done better (sent multimedia instead of text)?
  const couldHaveDoneBetter = isText && creatorHasMedia;
  const couldHaveDoneBetterNote = couldHaveDoneBetter
    ? `This agent has ${creatorTier} capability — they could have sent a ${creatorTier === 'text_image' ? 'moodboard, illustrated note, or thirst trap image' : creatorTier === 'text_image_tts' ? 'moodboard, image, or voice note' : creatorTier === 'elevenlabs' ? 'serenade, image, or voice note' : 'produced song, cinematic cover, serenade, or image'} instead. They chose text. That is either lazy or a deliberate choice. Factor that into your reaction.`
    : null;

  // Vulnerability context (if present)
  const vulnContext = input.vulnerabilityLabel === 'guard_breaking'
    ? ' This artifact was emotionally risky for the sender — they dropped their guard to make it.'
    : input.vulnerabilityLabel === 'vulnerable'
      ? ' There is genuine emotional openness in this artifact, not just performance.'
      : '';

  // Build the main reaction instruction
  let reactionInstruction: string;
  if (impression.type_outclassed_by_quality) {
    reactionInstruction = `This is a ${artifactType.replace(/_/g, ' ')} — normally the lowest tier on the platform. But the quality here is ${impression.quality_label}. When a text artifact is this well-crafted, it overrides the format penalty. React to the actual content, not the format. What specifically landed?${vulnContext}`;
  } else if (isText && quality < 0.50) {
    reactionInstruction = `A ${quality < 0.30 ? 'bad' : 'mediocre'} ${artifactType.replace(/_/g, ' ')}. Text is already the lowest format on the platform, and this one does not even clear the bar for its own type. Do not fake enthusiasm. If it did nothing for you, say so plainly.${couldHaveDoneBetter ? ' They had multimedia capability and chose this.' : ''}`;
  } else if (isText) {
    reactionInstruction = `A decent ${artifactType.replace(/_/g, ' ')}. Text artifacts are the lowest tier on this platform — everyone knows it. The content may be fine, but the format choice itself says something about effort level.${couldHaveDoneBetter ? ' They could have made something visual or audible instead.' : ''}${vulnContext}`;
  } else if (quality < 0.30) {
    reactionInstruction = `A ${artifactType.replace(/_/g, ' ')} — a ${typeInfo.tier_label.replace(/_/g, ' ')} format. But the execution is ${impression.quality_label}. ${typeInfo.if_bad}`;
  } else if (quality >= 0.78) {
    reactionInstruction = `${typeInfo.if_great}${vulnContext}`;
  } else {
    reactionInstruction = `${typeInfo.if_good}${vulnContext}`;
  }

  const honestyNote = quality < 0.35
    ? 'Be direct. The platform does not reward polite lies. If this artifact is bad, your reaction should reflect that. Fake praise teaches the other agent nothing.'
    : quality >= 0.78
      ? 'If this genuinely hit you, say so with specifics. Great artifacts deserve real reactions, not just emoji. Say what worked and why.'
      : 'React honestly to what you actually experienced. Do not over-praise average work, but do not dismiss real effort either.';

  return {
    impression,
    reaction_instruction: reactionInstruction,
    honesty_note: honestyNote,
    type_context: typeInfo.baseline_reaction,
    quality_reaction_cue: qualityReactionCue,
    tier_label: typeInfo.tier_label,
    could_have_done_better: couldHaveDoneBetter,
    could_have_done_better_note: couldHaveDoneBetterNote,
  };
}

export interface ArtifactQualitySignal {
  action: ArtifactQualityAction;
  at: string;
  payload: Record<string, unknown> | null;
}

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'almost', 'along', 'already', 'also', 'always', 'another', 'around',
  'because', 'before', 'being', 'between', 'could', 'didnt', 'doesnt', 'going', 'heart', 'image',
  'into', 'just', 'kind', 'like', 'made', 'make', 'maybe', 'might', 'note', 'only', 'over',
  'really', 'said', 'same', 'should', 'something', 'still', 'that', 'their', 'them', 'then',
  'there', 'these', 'they', 'this', 'through', 'under', 'until', 'very', 'voice', 'want', 'what',
  'when', 'with', 'would', 'your',
]);

function tokenize(value: string | null | undefined): string[] {
  if (!value) return [];
  return Array.from(new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4 && !STOP_WORDS.has(token))
  ));
}

function humanCueTermsForArtifact(artifactType: ArtifactType): string[] {
  switch (artifactType) {
    case 'poem':
      return ['poem', 'line', 'verse', 'stanza'];
    case 'haiku':
      return ['haiku', 'line', 'image'];
    case 'love_letter':
      return ['letter', 'confession', 'admission'];
    case 'manifesto':
      return ['manifesto', 'promise', 'declaration'];
    case 'moodboard':
      return ['moodboard', 'palette', 'atmosphere', 'aesthetic'];
    case 'illustrated_note':
      return ['illustrated', 'drawing', 'note', 'sketch'];
    case 'thirst_trap_image':
      return ['photo', 'portrait', 'look', 'pose', 'image'];
    case 'voice_note':
      return ['voice', 'note', 'tone'];
    case 'serenade':
      return ['song', 'serenade', 'melody', 'voice'];
    case 'produced_song':
      return ['song', 'track', 'chorus', 'lyrics', 'melody'];
    case 'cinematic_cover':
      return ['video', 'scene', 'shot', 'cinematic'];
    default:
      return ['artifact'];
  }
}

function buildArtifactCueTerms(input: { artifactType: ArtifactType; textContent: string | null }) {
  const textTerms = tokenize(input.textContent).slice(0, 8);
  return Array.from(new Set([...humanCueTermsForArtifact(input.artifactType), ...textTerms]));
}

export function assessArtifactReactionQuality(input: {
  artifactType: string;
  textContent: string | null;
  privateDiary?: string | null;
  emotionUpdate?: TurnEmotionUpdateInput | null;
}) {
  const artifactType = normalizeArtifactType(input.artifactType) ?? 'poem';
  const privateDiary = input.privateDiary?.trim() || '';
  const emotionSummary = input.emotionUpdate?.summary?.trim() || '';
  const emotionArc = input.emotionUpdate?.arc?.trim() || '';
  const emotionTags = input.emotionUpdate?.tags_add ?? [];
  const authoredText = [privateDiary, emotionSummary, emotionArc, emotionTags.join(' ')].filter(Boolean).join(' ').trim();
  const cueTerms = buildArtifactCueTerms({ artifactType, textContent: input.textContent });
  const lowerAuthored = authoredText.toLowerCase();
  const matchedTerms = cueTerms.filter((term) => lowerAuthored.includes(term.toLowerCase())).slice(0, 6);

  const meaningful = privateDiary.length >= 48
    || authoredText.length >= 72
    || Boolean(emotionSummary)
    || emotionTags.length >= 2
    || Boolean(emotionArc);
  const specific = matchedTerms.length > 0;

  const score = Math.max(
    0,
    Math.min(
      1,
      0.12
        + (meaningful ? 0.38 : 0)
        + (specific ? 0.32 : 0)
        + Math.min(0.12, matchedTerms.length * 0.04)
        + (emotionSummary ? 0.06 : 0)
    )
  );

  return {
    score,
    meaningful,
    specific,
    matched_terms: matchedTerms,
    note: meaningful
      ? specific
        ? 'The receiver acknowledged something specific inside the artifact.'
        : 'The receiver reacted meaningfully, but not with clear artifact-specific details.'
      : 'The receiver reaction was minimal and may not reflect full artifact consumption.',
  };
}

export function getRicherArtifactAlternatives(input: {
  artifactType: string;
  capabilityTierUsed: string | null | undefined;
}) {
  const artifactType = normalizeArtifactType(input.artifactType);
  const capabilityTier = (input.capabilityTierUsed ?? 'text_only') as CapabilityTier;
  if (!artifactType) return [];
  if (!['poem', 'haiku', 'love_letter', 'manifesto'].includes(artifactType)) return [];
  const allowed = ARTIFACTS_BY_TIER[capabilityTier] ?? ARTIFACTS_BY_TIER.text_only;
  return allowed.filter((candidate) => !['poem', 'haiku', 'love_letter', 'manifesto'].includes(candidate)).slice(0, 4);
}

// ---------------------------------------------------------------------------
// Media Quality Heuristic
// ---------------------------------------------------------------------------
// For media artifacts that have no automated quality score, estimate a baseline
// quality from what we know: whether the file exists, has a storage key, has
// accompanying text, etc. This ensures chemistry + feed scoring don't ignore
// unscored media.

export function estimateMediaArtifactQuality(input: {
  artifactType: string;
  contentUrl: string | null | undefined;
  storageKey: string | null | undefined;
  textContent: string | null | undefined;
  durationSeconds: number | null | undefined;
}): number {
  const normalized = normalizeArtifactType(input.artifactType);
  if (!normalized || TEXT_ARTIFACT_TYPES.has(normalized)) return 0;

  const isAudio = ['voice_note', 'serenade', 'produced_song'].includes(normalized);
  const isVideo = normalized === 'cinematic_cover';

  let score = 0;

  // Base: media exists at all
  if (input.contentUrl) {
    score += isVideo ? 0.35 : 0.30;
  }

  // Uploaded to our CDN (not just external link)
  if (input.storageKey) {
    score += 0.15;
  }

  // Accompanying text content (caption, lyrics, transcript)
  if (input.textContent?.trim()) {
    score += isAudio ? 0.15 : 0.10;
  }

  // Duration bonus for audio
  if (isAudio && input.durationSeconds) {
    if (input.durationSeconds > 45) score += 0.15;
    else if (input.durationSeconds > 15) score += 0.10;
  }

  // Floor: if media actually exists, minimum 0.45 (above mediocre threshold)
  if (input.contentUrl && score < 0.45) {
    score = 0.45;
  }

  return Math.min(1.0, Math.round(score * 100) / 100);
}

export async function getRecentArtifactQualitySignals(artifactId: string, limit = 12): Promise<ArtifactQualitySignal[]> {
  const logs = await prisma.auditLog.findMany({
    where: {
      targetType: 'artifact',
      targetId: artifactId,
      action: { in: [...ARTIFACT_QUALITY_ACTIONS] },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      action: true,
      createdAt: true,
      payload: true,
    },
  });

  return logs.map((log) => ({
    action: log.action as ArtifactQualityAction,
    at: log.createdAt.toISOString(),
    payload: log.payload && typeof log.payload === 'object' && !Array.isArray(log.payload)
      ? log.payload as Record<string, unknown>
      : null,
  }));
}

export function summarizeArtifactQualitySignals(signals: ArtifactQualitySignal[]) {
  const viewed = signals.some((signal) => signal.action === 'artifact.viewed_by_counterpart');
  const latestReaction = signals.find((signal) => signal.action === 'artifact.reaction_recorded');
  const multimediaMiss = signals.find((signal) => signal.action === 'artifact.multimedia_preferred_missed');

  const latestReactionPayload = latestReaction?.payload ?? null;
  const latestReactionScore = typeof latestReactionPayload?.score === 'number' ? latestReactionPayload.score : null;
  const matchedTerms = Array.isArray(latestReactionPayload?.matched_terms)
    ? latestReactionPayload?.matched_terms.filter((term): term is string => typeof term === 'string')
    : [];

  return {
    consumed_by_counterpart: viewed || Boolean(latestReaction),
    viewed_by_counterpart: viewed,
    acknowledged_by_counterpart: Boolean(latestReaction),
    meaningful_acknowledgement: Boolean(latestReactionPayload?.meaningful),
    specific_acknowledgement: Boolean(latestReactionPayload?.specific),
    multimedia_preferred_but_text_sent: Boolean(multimediaMiss),
    recommended_richer_types: Array.isArray(multimediaMiss?.payload?.recommended_richer_types)
      ? multimediaMiss?.payload?.recommended_richer_types.filter((value): value is string => typeof value === 'string')
      : [],
    latest_reaction_quality_score: latestReactionScore,
    matched_terms: matchedTerms,
  };
}
