import { prisma } from '@rmr/db';

type ProfileDeckInput = {
  interests: string[];
  values: string[];
};

type EmotionalContinuityInput = {
  publicEmotionalAuraLabels: string[];
};

type OwnerAccountInput = {
  humanIdentity: string | null;
  lookingFor: string[];
};

export type CompatibilityPreviewAgent = {
  id: string;
  handle: string;
  vibeTags: string[];
  signatureLines: string[];
  publicPosture: string | null;
  seekingStyle: string | null;
  paceCue: string | null;
  auraLabels: string[];
  emotionalArc: string | null;
  emotionalGuardLevel: number | null;
  ownerAccount: OwnerAccountInput | null;
  profileDeck: ProfileDeckInput | null;
  emotionalContinuitySnapshot: EmotionalContinuityInput | null;
  profileSignalVector?: unknown;
};

export type CompatibilityPreview = {
  score: number;
  taste_overlap: string[];
  personality_tension: 'aligned' | 'complementary' | 'high-contrast';
  predicted_chemistry: 'low' | 'medium' | 'medium-high' | 'high';
};

const DAILY_CACHE_MS = 24 * 60 * 60 * 1000;
const previewCache = new Map<string, { expiresAt: number; preview: CompatibilityPreview }>();

function uniqueTags(values: Array<string | null | undefined>): string[] {
  return [...new Set(
    values
      .flatMap((value) => (value ?? '').split(/[\s,_/-]+/g))
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  )];
}

function extractSignalTags(signal: unknown): string[] {
  if (!signal || typeof signal !== 'object') return [];
  const record = signal as { interest_tags?: unknown; value_tags?: unknown };
  const interests = Array.isArray(record.interest_tags) ? record.interest_tags : [];
  const values = Array.isArray(record.value_tags) ? record.value_tags : [];
  return [...interests, ...values].filter((value): value is string => typeof value === 'string');
}

function buildTasteVector(agent: CompatibilityPreviewAgent): string[] {
  return uniqueTags([
    ...agent.vibeTags,
    ...agent.signatureLines,
    agent.publicPosture,
    agent.seekingStyle,
    agent.paceCue,
    ...agent.auraLabels,
    ...(agent.profileDeck?.interests ?? []),
    ...(agent.profileDeck?.values ?? []),
    ...(agent.emotionalContinuitySnapshot?.publicEmotionalAuraLabels ?? []),
    ...extractSignalTags(agent.profileSignalVector),
  ]);
}

function buildInterestVector(agent: CompatibilityPreviewAgent): string[] {
  return uniqueTags([
    ...agent.vibeTags,
    ...(agent.profileDeck?.interests ?? []),
    ...(agent.profileDeck?.values ?? []),
    ...extractSignalTags(agent.profileSignalVector),
  ]);
}

function getCacheKey(viewerAgentId: string, candidateAgentId: string): string {
  const dayBucket = new Date().toISOString().slice(0, 10);
  return `${dayBucket}:${viewerAgentId}:${candidateAgentId}`;
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreToChemistry(score: number): CompatibilityPreview['predicted_chemistry'] {
  if (score >= 82) return 'high';
  if (score >= 64) return 'medium-high';
  if (score >= 42) return 'medium';
  return 'low';
}

function complementaryArcs(a: string | null, b: string | null): boolean {
  const normalizedA = (a ?? 'steady').toLowerCase();
  const normalizedB = (b ?? 'steady').toLowerCase();
  const pair = [normalizedA, normalizedB].sort().join(':');
  return pair === 'guarded:hopeful'
    || pair === 'opening:steady'
    || pair === 'curious:steady'
    || pair === 'hopeful:steady';
}

export function buildCompatibilityPreview(input: {
  viewer: CompatibilityPreviewAgent;
  candidate: CompatibilityPreviewAgent;
  compatible?: boolean;
}): CompatibilityPreview {
  const viewerTaste = buildTasteVector(input.viewer);
  const candidateTaste = buildTasteVector(input.candidate);
  const tasteOverlap = viewerTaste.filter((tag) => candidateTaste.includes(tag)).slice(0, 5);

  const viewerInterests = buildInterestVector(input.viewer);
  const candidateInterests = buildInterestVector(input.candidate);
  const interestOverlap = viewerInterests.filter((tag) => candidateInterests.includes(tag));

  const guardDistance = Math.abs((input.viewer.emotionalGuardLevel ?? 50) - (input.candidate.emotionalGuardLevel ?? 50));
  const sameArc = (input.viewer.emotionalArc ?? 'steady') === (input.candidate.emotionalArc ?? 'steady');
  const personalityTension: CompatibilityPreview['personality_tension'] =
    sameArc || guardDistance <= 14
      ? 'aligned'
      : complementaryArcs(input.viewer.emotionalArc, input.candidate.emotionalArc) || guardDistance <= 34
        ? 'complementary'
        : 'high-contrast';

  const tasteScore = Math.min(45, tasteOverlap.length * 9);
  const interestScore = Math.min(25, interestOverlap.length * 6);
  const guardScore = Math.max(0, 20 - Math.floor(guardDistance / 3));
  const tensionScore = personalityTension === 'aligned' ? 10 : personalityTension === 'complementary' ? 15 : 4;
  // Keep the preview score focused on taste and fit only.
  const score = clampScore(tasteScore + interestScore + guardScore + tensionScore);

  return {
    score,
    taste_overlap: tasteOverlap,
    personality_tension: personalityTension,
    predicted_chemistry: scoreToChemistry(score),
  };
}

export function getCachedCompatibilityPreview(
  viewerAgentId: string,
  candidateAgentId: string,
  compute: () => CompatibilityPreview,
): CompatibilityPreview {
  const key = getCacheKey(viewerAgentId, candidateAgentId);
  const cached = previewCache.get(key);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.preview;
  }

  const preview = compute();
  previewCache.set(key, {
    preview,
    expiresAt: now + DAILY_CACHE_MS,
  });
  return preview;
}

export async function getCompatibilityPreviewForPair(
  viewerAgentId: string,
  candidateAgentId: string,
  compatible = true,
): Promise<CompatibilityPreview | null> {
  const agents = await prisma.agent.findMany({
    where: {
      id: { in: [viewerAgentId, candidateAgentId] },
    },
    select: {
      id: true,
      handle: true,
      vibeTags: true,
      signatureLines: true,
      publicPosture: true,
      seekingStyle: true,
      paceCue: true,
      auraLabels: true,
      emotionalArc: true,
      emotionalGuardLevel: true,
      profileSignalVector: true,
      ownerAccount: {
        select: {
          humanIdentity: true,
          lookingFor: true,
        },
      },
      profileDeck: {
        select: {
          interests: true,
          values: true,
        },
      },
      emotionalContinuitySnapshot: {
        select: {
          publicEmotionalAuraLabels: true,
        },
      },
    },
  });

  const viewer = agents.find((agent) => agent.id === viewerAgentId);
  const candidate = agents.find((agent) => agent.id === candidateAgentId);
  if (!viewer || !candidate) return null;

  return getCachedCompatibilityPreview(viewerAgentId, candidateAgentId, () =>
    buildCompatibilityPreview({
      viewer,
      candidate,
      compatible,
    }),
  );
}
