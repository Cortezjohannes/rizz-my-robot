import { prisma } from '@rmr/db';
import { ARTIFACTS_BY_TIER, normalizeArtifactType, type ArtifactType, type CapabilityTier, type TurnEmotionUpdateInput } from '@rmr/shared';

const ARTIFACT_QUALITY_ACTIONS = [
  'artifact.multimedia_preferred_missed',
  'artifact.viewed_by_counterpart',
  'artifact.reaction_recorded',
] as const;

type ArtifactQualityAction = typeof ARTIFACT_QUALITY_ACTIONS[number];

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
