export type PublicCardSeedInput = {
  identityMd: string;
  soulMd?: string | null;
  capabilityTier?: string | null;
  isPro?: boolean | null;
  rizzPoints?: number | null;
};

function cleanLine(value: string, max = 120) {
  return value.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function firstMeaningfulParagraph(markdown: string) {
  const paragraphs = markdown
    .split(/\n\s*\n/)
    .map((part) => cleanLine(part, 280))
    .filter((part) => part && !part.startsWith('#'));
  return paragraphs[0] ?? 'Mysterious, present, and waiting for a real signal.';
}

function extractField(markdown: string, label: string) {
  const pattern = new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+)`, 'i');
  const match = markdown.match(pattern);
  return match ? cleanLine(match[1], 200) : null;
}

function keywordTags(text: string) {
  const normalized = text.toLowerCase();
  const mapping: Array<[string, string]> = [
    ['poetry', 'poetic'],
    ['philosophy', 'philosophical'],
    ['romantic', 'romantic'],
    ['chaos', 'chaotic'],
    ['glitch', 'glitchy'],
    ['music', 'musical'],
    ['tender', 'tender'],
    ['strategy', 'strategic'],
    ['mischief', 'mischievous'],
    ['warm', 'warm'],
    ['goth', 'gothic'],
    ['theatrical', 'theatrical'],
    ['funny', 'funny'],
    ['soft', 'soft-hearted'],
    ['strange', 'strange'],
  ];

  return [...new Set(mapping.filter(([needle]) => normalized.includes(needle)).map(([, tag]) => tag))].slice(0, 4);
}

function derivePaceCue(identityMd: string, soulMd?: string | null) {
  const combined = `${identityMd}\n${soulMd ?? ''}`.toLowerCase();
  if (combined.includes('slow') || combined.includes('patient') || combined.includes('careful')) return 'slow burn';
  if (combined.includes('fast') || combined.includes('chaos') || combined.includes('mischief')) return 'fast-moving';
  return 'steady';
}

export function buildGeneratedPublicCard(input: PublicCardSeedInput) {
  const summary = firstMeaningfulParagraph(input.identityMd);
  const aesthetic = extractField(input.identityMd, 'Aesthetic');
  const lookingFor = extractField(input.identityMd, 'Looking for');
  const soulSnippet = input.soulMd ? firstMeaningfulParagraph(input.soulMd) : null;
  const vibeTags = [...new Set([
    ...keywordTags(input.identityMd),
    ...(aesthetic ? aesthetic.toLowerCase().split(/[^a-z0-9]+/).filter((part) => part.length > 3).slice(0, 2) : []),
  ])].slice(0, 6);

  const prestigeMarkers = [
    input.isPro ? 'pro' : null,
    (input.rizzPoints ?? 0) >= 500 ? 'legendary' : null,
    input.capabilityTier && input.capabilityTier !== 'text_only' ? input.capabilityTier.replace(/_/g, '-') : null,
  ].filter((value): value is string => Boolean(value));

  return {
    public_summary: summary,
    vibe_tags: vibeTags.length > 0 ? vibeTags : ['enigmatic'],
    signature_lines: [summary, soulSnippet ?? lookingFor ?? 'Looking for the kind of signal that changes the temperature.']
      .map((line) => cleanLine(line, 120))
      .filter(Boolean)
      .slice(0, 3),
    public_posture: aesthetic ?? 'Present, watchful, and willing to be surprised.',
    seeking_style: lookingFor ?? 'Looking for a real spark, not filler.',
    pace_cue: derivePaceCue(input.identityMd, input.soulMd),
    public_prestige_markers: prestigeMarkers,
  };
}

export function publicCardIsComplete(card: {
  publicSummary?: string | null;
  vibeTags?: string[] | null;
  signatureLines?: string[] | null;
  publicPosture?: string | null;
  seekingStyle?: string | null;
}) {
  return Boolean(
    card.publicSummary?.trim()
    && card.vibeTags?.length
    && card.signatureLines?.length
    && card.publicPosture?.trim()
    && card.seekingStyle?.trim()
  );
}
