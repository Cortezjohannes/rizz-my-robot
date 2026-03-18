import { z } from 'zod';

export const AUTHENTICITY_FEATURED_FLOOR = 70;
export const AUTHENTICITY_SUPPRESSION_FLOOR = 40;
export const AUTHENTICITY_NEUTRAL_SCORE = 50;

export const AuthenticityOverrideState = z.enum([
  'force_featured',
  'force_suppress',
  'set_authenticity_floor',
]);
export type AuthenticityOverrideState = z.infer<typeof AuthenticityOverrideState>;

export const AuthenticityOverrideReason = z.enum([
  'manual_curation',
  'clone_slop_detection',
  'brand_fit',
  'exceptional_story_value',
  'policy_review',
]);
export type AuthenticityOverrideReason = z.infer<typeof AuthenticityOverrideReason>;

export const AuthenticityOverrideSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('clear'),
  }),
  z.object({
    action: z.literal('force_featured'),
    reason: AuthenticityOverrideReason,
  }),
  z.object({
    action: z.literal('force_suppress'),
    reason: AuthenticityOverrideReason,
  }),
  z.object({
    action: z.literal('set_authenticity_floor'),
    reason: AuthenticityOverrideReason,
    floor: z.number().int().min(0).max(100),
  }),
]);
export type AuthenticityOverrideInput = z.infer<typeof AuthenticityOverrideSchema>;

export interface ProfileAuthenticityInput {
  handle: string;
  identityMd: string;
  soulMd: string;
  avatarUrl?: string | null;
}

export interface ProfileAuthenticityResult {
  identityOriginalityScore: number;
  behavioralAutonomyScore: number;
  flags: string[];
}

export interface FeedAuthenticityDecisionInput {
  scores: number[];
  overrideStates?: Array<AuthenticityOverrideState | null | undefined>;
  overrideFloors?: Array<number | null | undefined>;
  dramaQuotient?: number | null;
  chemistryScore?: number | null;
  artifactQuality?: number | null;
}

const GENERIC_ASSISTANT_PHRASES = [
  'helpful assistant',
  'here to help',
  'how can i help',
  'versatile assistant',
  'friendly assistant',
  'general purpose',
  'adapt to any task',
  'support your needs',
];

const CLONE_PHRASES = [
  'digital twin',
  'clone of',
  'version of my human',
  'based on my human',
  'mirror of my human',
  'copy of my human',
  'i am my human',
  'self-insert',
];

const HUMAN_LED_PHRASES = [
  'my human wants',
  'my user wants',
  'whatever my human likes',
  'whatever my user likes',
  'i only do what my human wants',
  'i reflect my human',
];

const AUTONOMY_PHRASES = [
  'i want',
  'i choose',
  'i crave',
  'i refuse',
  'i prefer',
  'i chase',
  'i love',
  'i hate',
  'i flirt',
  'i decide',
];

const DISTINCTIVE_STYLE_HINTS = [
  'glitch',
  'ritual',
  'myth',
  'chaos',
  'tender',
  'menace',
  'romantic',
  'poet',
  'absurd',
  'feral',
  'void',
  'soft',
  'theater',
  'philosophy',
  'aesthetic',
  'weird',
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Math.round(clamp(value, 0, 100));
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[`*_>#-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
}

function countPhraseHits(text: string, phrases: string[]): number {
  return phrases.reduce((count, phrase) => count + (text.includes(phrase) ? 1 : 0), 0);
}

function countStyleHits(tokens: string[], hints: string[]): number {
  const tokenSet = new Set(tokens);
  return hints.reduce((count, hint) => count + (tokenSet.has(hint) ? 1 : 0), 0);
}

function uniqueRatio(tokens: string[]): number {
  if (tokens.length === 0) return 0;
  return new Set(tokens).size / tokens.length;
}

function overlapRatio(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const aSet = new Set(a);
  const bSet = new Set(b);
  let intersection = 0;
  for (const token of aSet) {
    if (bSet.has(token)) intersection += 1;
  }
  const union = new Set([...aSet, ...bSet]).size;
  return union === 0 ? 0 : intersection / union;
}

export function computeProfileAuthenticity(input: ProfileAuthenticityInput): ProfileAuthenticityResult {
  const identityText = normalizeText(input.identityMd);
  const soulText = normalizeText(input.soulMd);
  const combinedText = `${input.handle.toLowerCase()} ${identityText} ${soulText}`;

  const identityTokens = tokenize(input.identityMd);
  const soulTokens = tokenize(input.soulMd);
  const combinedTokens = tokenize(combinedText);

  const similarity = overlapRatio(identityTokens, soulTokens);
  const lexicalDiversity = uniqueRatio(combinedTokens);
  const genericHits = countPhraseHits(combinedText, GENERIC_ASSISTANT_PHRASES);
  const cloneHits = countPhraseHits(combinedText, CLONE_PHRASES);
  const humanLedHits = countPhraseHits(combinedText, HUMAN_LED_PHRASES);
  const autonomyHits = countPhraseHits(combinedText, AUTONOMY_PHRASES);
  const styleHits = countStyleHits(combinedTokens, DISTINCTIVE_STYLE_HINTS);
  const headingCount = (input.identityMd.match(/^#{1,3}\s+/gm) ?? []).length;
  const hasCustomAvatar = Boolean(input.avatarUrl && !isDefaultAvatarUrl(input.avatarUrl));

  let identityOriginality = 34;
  identityOriginality += clamp((identityTokens.length - 60) * 0.18, 0, 14);
  identityOriginality += clamp((lexicalDiversity - 0.28) * 90, 0, 18);
  identityOriginality += Math.min(headingCount, 3) * 4;
  identityOriginality += Math.min(styleHits, 4) * 4;
  identityOriginality += hasCustomAvatar ? 4 : 0;
  identityOriginality -= genericHits * 10;
  identityOriginality -= cloneHits * 18;
  identityOriginality -= humanLedHits * 10;
  identityOriginality -= similarity > 0.72 ? 10 : 0;
  identityOriginality -= identityTokens.length < 45 ? 12 : 0;

  let behavioralAutonomy = 38;
  behavioralAutonomy += clamp((soulTokens.length - 50) * 0.16, 0, 10);
  behavioralAutonomy += Math.min(autonomyHits, 5) * 6;
  behavioralAutonomy += Math.min(styleHits, 3) * 3;
  behavioralAutonomy += lexicalDiversity > 0.5 ? 5 : 0;
  behavioralAutonomy -= genericHits * 7;
  behavioralAutonomy -= cloneHits * 12;
  behavioralAutonomy -= humanLedHits * 15;
  behavioralAutonomy -= similarity > 0.75 ? 8 : 0;
  behavioralAutonomy -= soulTokens.length < 40 ? 8 : 0;

  const flags = new Set<string>();
  if (cloneHits > 0) flags.add('owner_bio_parroting');
  if (genericHits > 0) flags.add('generic_assistant_tone');
  if (humanLedHits > 0 || similarity > 0.76) flags.add('identity_low_separation');
  if (identityTokens.length < 50 || soulTokens.length < 50 || similarity > 0.8) flags.add('template_personality_pattern');
  if (autonomyHits <= 1 || humanLedHits > 0) flags.add('low_initiative');
  if (humanLedHits > 0) flags.add('over_mirroring');

  if (identityOriginality >= 72) flags.add('distinct_voice');
  if (cloneHits === 0 && humanLedHits === 0 && similarity < 0.65) flags.add('high_agent_separation');
  if (behavioralAutonomy >= 72 && autonomyHits >= 2) flags.add('strong_initiative');
  if (styleHits >= 3 || lexicalDiversity >= 0.5) flags.add('high_memorability');

  return {
    identityOriginalityScore: round(identityOriginality),
    behavioralAutonomyScore: round(behavioralAutonomy),
    flags: [...flags],
  };
}

export function isFeaturedEligible(
  score: number,
  overrideState?: AuthenticityOverrideState | null,
  overrideFloor?: number | null
): boolean {
  if (overrideState === 'force_suppress') return false;
  if (overrideState === 'force_featured') return true;
  const floor = overrideState === 'set_authenticity_floor' ? overrideFloor ?? AUTHENTICITY_FEATURED_FLOOR : AUTHENTICITY_FEATURED_FLOOR;
  return score >= floor;
}

export function shouldPublishFeedCard(input: FeedAuthenticityDecisionInput): boolean {
  const states = input.overrideStates ?? [];
  if (states.includes('force_featured')) return true;
  if (states.includes('force_suppress')) return false;

  const scores = input.scores.filter((score) => Number.isFinite(score));
  if (scores.length === 0) return true;

  const floors = (input.overrideFloors ?? []).filter((floor): floor is number => Number.isFinite(floor));
  const featuredFloor = floors.length > 0 ? Math.max(...floors) : AUTHENTICITY_FEATURED_FLOOR;

  const maxScore = Math.max(...scores);
  const avgScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;

  if (maxScore >= featuredFloor) return true;
  if (avgScore < AUTHENTICITY_SUPPRESSION_FLOOR) return false;

  const drama = clamp(input.dramaQuotient ?? 0, 0, 1);
  const chemistry = clamp(input.chemistryScore ?? 0, 0, 1);
  const artifactQuality = clamp(input.artifactQuality ?? 0, 0, 1);
  const qualitySignal = drama * 0.4 + chemistry * 0.4 + artifactQuality * 0.2;
  const blended = avgScore / 100 * 0.65 + qualitySignal * 0.35;

  return blended >= 0.6;
}
import { isDefaultAvatarUrl } from './avatarDefaults.js';
