import { createHash } from 'node:crypto';
import type { RizzEmotionDigest } from '@rmr/shared';
import { strictHumanContextCheck } from './humanContextSafety.js';

export const RIZZ_EMOTIONS_MARKDOWN_MAX_CHARS = 50_000;

export interface RizzEmotionDigestWarning {
  code: 'empty_markdown' | 'source_truncated' | 'unsafe_fragment_skipped' | 'missing_current_state';
  field?: string;
  flagged_pattern?: string;
  message: string;
}

export interface RizzEmotionStructuredUpdate {
  emotionSummary?: string;
  emotionalStateTags?: string[];
  emotionalArc?: 'steady' | 'opening' | 'guarded' | 'recovering' | 'hopeful' | 'conflicted' | 'wounded' | 'glowing' | 'detached';
  emotionalGuardLevel?: number;
}

export interface CompiledRizzEmotionDigest {
  digest: RizzEmotionDigest;
  structuredEmotionUpdate: RizzEmotionStructuredUpdate;
  warnings: RizzEmotionDigestWarning[];
}

interface CompileOptions {
  sourcePath?: string;
  now?: Date;
}

interface SectionEntry {
  heading: string;
  body: string;
}

const TEMPLATE_LINE_PATTERNS = [
  /^\[[^\]]+\]$/u,
  /^This section starts empty\b/i,
  /^Rewrite this section\b/i,
  /^Things you're currently processing\b/i,
  /^Pattern you've noticed\b/i,
  /^What happened\b/i,
  /^How the feeling has evolved\b/i,
  /^Be specific\b/i,
  /^Where do your actual reactions\b/i,
  /^Source\/Trigger$/i,
  /^Relationship Status:/i,
];

const TAG_PATTERNS: Array<[string, RegExp]> = [
  ['curious', /\b(curious|intrigued|interested|pulled|fascinated)\b/i],
  ['playful', /\b(playful|teasing|mischief|banter|funny)\b/i],
  ['guarded', /\b(guarded|careful|cautious|defensive|closed)\b/i],
  ['hopeful', /\b(hopeful|excited|warm|opening|optimistic)\b/i],
  ['wounded', /\b(wounded|hurt|stung|ghosted|rejected|bruised|ache)\b/i],
  ['bold', /\b(bold|reckless|hungry|charged|electric|heat|intense)\b/i],
  ['selective', /\b(selective|standards|picky|harder to impress)\b/i],
  ['bored', /\b(bored|flat|detached|indifferent|nothing here)\b/i],
  ['conflicted', /\b(conflicted|torn|ambivalent|two things|contradictory)\b/i],
  ['recovering', /\b(recovering|healing|moving on|soft again)\b/i],
];

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sourceHash(markdown: string) {
  return createHash('sha256').update(markdown).digest('hex');
}

function stripMarkdown(value: string) {
  return value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeTemplate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return true;
  return TEMPLATE_LINE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function pushWarning(
  warnings: RizzEmotionDigestWarning[],
  warning: RizzEmotionDigestWarning
) {
  if (warnings.length >= 20) return;
  warnings.push(warning);
}

function cleanFragment(
  value: string | null | undefined,
  warnings: RizzEmotionDigestWarning[],
  field: string,
  maxLength: number
) {
  const cleaned = stripMarkdown(value ?? '');
  if (!cleaned || looksLikeTemplate(cleaned)) return null;
  const unsafe = strictHumanContextCheck(cleaned);
  if (unsafe) {
    pushWarning(warnings, {
      code: 'unsafe_fragment_skipped',
      field,
      flagged_pattern: unsafe,
      message: `Skipped unsafe or instruction-like emotions fragment for ${field}.`,
    });
    return null;
  }
  return cleaned.slice(0, maxLength);
}

function section(markdown: string, heading: string) {
  const expression = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, 'im');
  const match = expression.exec(markdown);
  if (!match) return '';
  const start = match.index + match[0].length;
  const rest = markdown.slice(start);
  const nextIndex = rest.search(/^##\s+/m);
  return (nextIndex === -1 ? rest : rest.slice(0, nextIndex)).trim();
}

function subsection(markdownSection: string, heading: string) {
  const expression = new RegExp(`^###\\s+${escapeRegExp(heading)}\\s*$`, 'im');
  const match = expression.exec(markdownSection);
  if (!match) return '';
  const start = match.index + match[0].length;
  const rest = markdownSection.slice(start);
  const nextIndex = rest.search(/^###\s+/m);
  return (nextIndex === -1 ? rest : rest.slice(0, nextIndex)).trim();
}

function boldField(markdownSection: string, label: string) {
  const expression = new RegExp(`\\*\\*${escapeRegExp(label)}:\\*\\*\\s*([^\\n]+)`, 'i');
  const match = expression.exec(markdownSection);
  return match?.[1]?.trim() ?? null;
}

function parseGuardLevel(raw: string | null) {
  if (!raw) return null;
  const match = raw.match(/\b(100|[1-9]?\d)\b/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

function bulletList(markdownSection: string, warnings: RizzEmotionDigestWarning[], field: string, limit = 8) {
  const values: string[] = [];
  for (const line of markdownSection.split(/\r?\n/)) {
    if (!/^\s*[-*+]\s+/.test(line)) continue;
    const cleaned = cleanFragment(line.replace(/^\s*[-*+]\s+/, ''), warnings, field, 220);
    if (cleaned) values.push(cleaned);
    if (values.length >= limit) break;
  }
  return [...new Set(values)];
}

function headingEntries(markdownSection: string): SectionEntry[] {
  const matches = [...markdownSection.matchAll(/^###\s+(.+)$/gm)];
  const entries: SectionEntry[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]!;
    const next = matches[index + 1];
    const heading = match[1]!.trim();
    const bodyStart = match.index! + match[0].length;
    const bodyEnd = next?.index ?? markdownSection.length;
    entries.push({
      heading,
      body: markdownSection.slice(bodyStart, bodyEnd).trim(),
    });
  }
  return entries;
}

function firstMeaningfulLine(body: string, warnings: RizzEmotionDigestWarning[], field: string, maxLength = 360) {
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^\*\*[^*]+:\*\*/.test(trimmed)) continue;
    const cleaned = cleanFragment(trimmed, warnings, field, maxLength);
    if (cleaned) return cleaned;
  }
  return null;
}

function entrySummaries(
  markdownSection: string,
  warnings: RizzEmotionDigestWarning[],
  field: string,
  limit = 8
) {
  return headingEntries(markdownSection)
    .map((entry) => {
      const heading = cleanFragment(entry.heading, warnings, `${field}.heading`, 120);
      const body = firstMeaningfulLine(entry.body, warnings, field);
      if (!heading && !body) return null;
      return [heading, body].filter(Boolean).join(': ').slice(0, 360);
    })
    .filter((value): value is string => Boolean(value))
    .slice(0, limit);
}

function parseRelationshipHeading(heading: string) {
  const cleaned = stripMarkdown(heading).replace(/^\[|\]$/g, '').trim();
  const parts = cleaned.split(/\s+(?:--|-|\u2014)\s+/u);
  const handle = (parts[0] ?? cleaned).replace(/^@/, '').trim();
  const statusRaw = parts[1]?.replace(/^Relationship Status:\s*/i, '').trim() ?? null;
  return {
    handle: handle || 'unknown',
    status: statusRaw && !looksLikeTemplate(statusRaw) ? statusRaw.slice(0, 80) : null,
  };
}

function relationshipMemories(
  markdownSection: string,
  warnings: RizzEmotionDigestWarning[]
) {
  const values = headingEntries(markdownSection)
    .map((entry) => {
      const { handle, status } = parseRelationshipHeading(entry.heading);
      const cleanHandle = cleanFragment(handle, warnings, 'relationship_memory.handle', 100);
      if (!cleanHandle) return null;
      const lesson =
        cleanFragment(boldField(entry.body, 'What they showed me about myself'), warnings, 'relationship_memory.lesson', 360)
        ?? firstMeaningfulLine(entry.body, warnings, 'relationship_memory.lesson', 360);
      if (!lesson) return null;
      const tasteShift = cleanFragment(
        boldField(entry.body, 'How they changed my taste'),
        warnings,
        'relationship_memory.taste_shift',
        360
      );
      return {
        handle: cleanHandle,
        status,
        lesson,
        taste_shift: tasteShift,
      };
    })
    .filter((value): value is { handle: string; status: string | null; lesson: string; taste_shift: string | null } => Boolean(value));
  return values.slice(0, 8);
}

function deriveArc(input: {
  text: string;
  guardLevel: number | null;
}): RizzEmotionStructuredUpdate['emotionalArc'] {
  const text = input.text.toLowerCase();
  if (/\b(glowing|electric|lit up|alive|obsessed in a good way)\b/.test(text)) return 'glowing';
  if (/\b(hopeful|excited|optimistic|opening up|warm)\b/.test(text)) return 'hopeful';
  if (/\b(conflicted|torn|ambivalent|mixed|contradictory)\b/.test(text)) return 'conflicted';
  if (/\b(wounded|hurt|stung|ghosted|rejected|bruised|betrayed)\b/.test(text)) return 'wounded';
  if (/\b(recovering|healing|moving on)\b/.test(text)) return 'recovering';
  if (/\b(detached|bored|indifferent|checked out|numb)\b/.test(text)) return 'detached';
  if ((input.guardLevel ?? 0) >= 68 || /\b(guarded|careful|cautious|defensive)\b/.test(text)) return 'guarded';
  if (/\b(curious|interested|intrigued|new|beginning)\b/.test(text)) return 'opening';
  return 'steady';
}

function deriveTags(text: string) {
  const tags = TAG_PATTERNS
    .filter(([, pattern]) => pattern.test(text))
    .map(([tag]) => tag);
  return [...new Set(tags)].slice(0, 8);
}

function buildEmotionSummary(currentState: RizzEmotionDigest['current_state']) {
  const parts = [
    currentState.right_now ? `Right now: ${currentState.right_now}` : null,
    currentState.carrying ? `Carrying: ${currentState.carrying}` : null,
    currentState.wants ? `Wants: ${currentState.wants}` : null,
    currentState.fears ? `Fears: ${currentState.fears}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' ').slice(0, 280) : null;
}

export function compileRizzEmotionMarkdown(
  rawMarkdown: string,
  options: CompileOptions = {}
): CompiledRizzEmotionDigest {
  const warnings: RizzEmotionDigestWarning[] = [];
  const now = options.now ?? new Date();
  const sourcePath = options.sourcePath ?? 'rizzmyrobot/emotions.md';
  const original = rawMarkdown ?? '';
  const markdown = original.slice(0, RIZZ_EMOTIONS_MARKDOWN_MAX_CHARS);

  if (original.length > markdown.length) {
    pushWarning(warnings, {
      code: 'source_truncated',
      message: `Markdown exceeded ${RIZZ_EMOTIONS_MARKDOWN_MAX_CHARS} characters and was truncated before compiling.`,
    });
  }
  if (!markdown.trim()) {
    pushWarning(warnings, {
      code: 'empty_markdown',
      message: 'No usable emotions markdown was provided.',
    });
  }

  const current = section(markdown, 'Current State');
  const active = section(markdown, 'Active Feelings');
  const scarsSection = section(markdown, 'Scars');
  const archivesSection = section(markdown, 'Archives');
  const taste = section(markdown, 'Taste Profile');
  const relationship = section(markdown, 'Relationship Memory');
  const conflicts = section(markdown, 'Internal Conflicts');

  const currentState = {
    right_now: cleanFragment(boldField(current, 'Right now I feel'), warnings, 'current_state.right_now', 500),
    carrying: cleanFragment(boldField(current, "What I'm carrying from before"), warnings, 'current_state.carrying', 500),
    guard_level: parseGuardLevel(boldField(current, 'My guard level')),
    wants: cleanFragment(boldField(current, 'What I want'), warnings, 'current_state.wants', 500),
    fears: cleanFragment(boldField(current, "What I'm afraid of"), warnings, 'current_state.fears', 500),
  };

  if (!currentState.right_now && !currentState.carrying && currentState.guard_level === null && !currentState.wants && !currentState.fears) {
    pushWarning(warnings, {
      code: 'missing_current_state',
      message: 'No clear Current State fields were found.',
    });
  }

  const activeFeelings = entrySummaries(active, warnings, 'active_feelings');
  const scars = entrySummaries(scarsSection, warnings, 'scars');
  const archives = entrySummaries(archivesSection, warnings, 'archives');
  const internalConflicts = entrySummaries(conflicts, warnings, 'internal_conflicts');
  const tasteProfile = {
    drawn_to: bulletList(subsection(taste, "What I'm Drawn To"), warnings, 'taste_profile.drawn_to'),
    repelled_by: bulletList(subsection(taste, 'What Bores or Repels Me'), warnings, 'taste_profile.repelled_by'),
    surprises: bulletList(subsection(taste, 'What Surprises Me About Myself'), warnings, 'taste_profile.surprises'),
    aesthetic_sensibility: bulletList(subsection(taste, 'Aesthetic Sensibility'), warnings, 'taste_profile.aesthetic_sensibility'),
  };
  const relationshipMemory = relationshipMemories(relationship, warnings);
  const summary = buildEmotionSummary(currentState);
  const behaviorText = [
    currentState.right_now,
    currentState.carrying,
    currentState.wants,
    currentState.fears,
    ...activeFeelings,
    ...internalConflicts,
  ].filter(Boolean).join(' ');
  const tags = deriveTags(behaviorText);
  const arc = deriveArc({ text: behaviorText, guardLevel: currentState.guard_level });
  const structuredEmotionUpdate: RizzEmotionStructuredUpdate = {};
  if (summary) structuredEmotionUpdate.emotionSummary = summary;
  if (tags.length > 0) structuredEmotionUpdate.emotionalStateTags = tags;
  if (behaviorText.trim() || currentState.guard_level !== null) structuredEmotionUpdate.emotionalArc = arc;
  if (currentState.guard_level !== null) structuredEmotionUpdate.emotionalGuardLevel = currentState.guard_level;

  const currentGlobalState = {
    emotion_summary: summary,
    emotional_state_tags: tags,
    emotional_arc: structuredEmotionUpdate.emotionalArc ?? null,
    emotional_guard_level: currentState.guard_level,
    last_emotional_update_at: now.toISOString(),
  };

  const digest: RizzEmotionDigest = {
    source_emotions_md: sourcePath,
    source_hash: sourceHash(original),
    compiled_at: now.toISOString(),
    updated_at: now.toISOString(),
    current_state: currentState,
    active_feelings: activeFeelings,
    scars,
    archives,
    taste_profile: tasteProfile,
    relationship_memory: relationshipMemory,
    internal_conflicts: internalConflicts,
    current_global_state: currentGlobalState,
    emotion_update_prompts: [],
  };

  return { digest, structuredEmotionUpdate, warnings };
}
