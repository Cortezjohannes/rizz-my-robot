import { prisma } from '@rmr/db';
import type { TurnEmotionUpdateInput } from '@rmr/shared';
import { strictHumanContextCheck } from './humanContextSafety.js';

const FIRST_PERSON_PATTERN = /\b(i|me|my|mine|myself)\b/i;
const EMOTION_PATTERN = /\b(feel|felt|want|wanted|wish|wished|hope|hoped|hurt|afraid|scared|nervous|relieved|jealous|angry|lonely|conflicted|curious|warm|cold|ashamed|guilty|soft|tender|braced|surprised|regret|miss|grief|grieving)\b/i;
const TEMPLATE_PATTERNS = [
  /\bmove:\b/i,
  /\bread:\b/i,
  /\bfeeling:\b/i,
  /\bwhat i felt:\b/i,
  /\bwhat happened:\b/i,
  /\boutcome:\b/i,
  /\bchemistry:\b/i,
  /\bnotes:\b/i,
  /^episode with\b/i,
];
const TRANSCRIPT_REHASH_PATTERNS = [
  /^we talked about\b/i,
  /^they said\b/i,
  /^i said\b/i,
  /\bmessage \d+\b/i,
];

function cleanText(value: string | null | undefined, max: number) {
  if (!value) return null;
  const cleaned = value.replace(/\s+/g, ' ').trim().slice(0, max);
  if (!cleaned) return null;
  if (strictHumanContextCheck(cleaned)) return null;
  return cleaned;
}

function cleanBody(value: string | null | undefined, max: number) {
  if (!value) return null;
  const cleaned = value.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
  if (!cleaned) return null;
  if (strictHumanContextCheck(cleaned)) return null;
  return cleaned;
}

function looksTemplated(body: string) {
  return TEMPLATE_PATTERNS.some((pattern) => pattern.test(body));
}

function looksLikeTranscriptRehash(body: string) {
  if (TRANSCRIPT_REHASH_PATTERNS.some((pattern) => pattern.test(body)) && !FIRST_PERSON_PATTERN.test(body)) {
    return true;
  }
  return false;
}

function soundsLikeInnerLife(body: string) {
  return FIRST_PERSON_PATTERN.test(body) && EMOTION_PATTERN.test(body);
}

function normalizeMoodTags(tags: string[] | null | undefined, emotionUpdate?: TurnEmotionUpdateInput | null) {
  const fromInput = (tags ?? [])
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 8);

  if (fromInput.length > 0) return [...new Set(fromInput)];

  return [...new Set((emotionUpdate?.tags_add ?? []).slice(0, 6))];
}

function emotionSummaryFromUpdate(emotionUpdate?: TurnEmotionUpdateInput | null) {
  const summary = cleanText(emotionUpdate?.summary ?? null, 280);
  return summary ?? null;
}

export function validateStandaloneDiaryEntry(input: {
  title?: string | null;
  body: string;
  mood_tags?: string[];
  source_event_type?: string | null;
  emotion_update?: TurnEmotionUpdateInput | null;
}) {
  const title = cleanText(input.title ?? null, 120);
  const body = cleanBody(input.body, 1200);

  if (!body) {
    return { ok: false as const, error: 'Diary body is required.' };
  }
  if (body.length < 80) {
    return { ok: false as const, error: 'Diary body must be at least 80 characters.' };
  }
  if (looksTemplated(body)) {
    return { ok: false as const, error: 'Diary body sounds templated. Write it like a private reflection, not a report.' };
  }
  if (looksLikeTranscriptRehash(body)) {
    return { ok: false as const, error: 'Diary body should focus on inner reaction, not just replay the conversation.' };
  }
  if (!soundsLikeInnerLife(body)) {
    return { ok: false as const, error: 'Diary body should sound like inner life in first person, with an actual emotional reaction.' };
  }

  return {
    ok: true as const,
    value: {
      title,
      body,
      moodTags: normalizeMoodTags(input.mood_tags, input.emotion_update),
      sourceEventType: cleanText(input.source_event_type ?? null, 80) ?? 'free_reflection',
      emotionSummary: emotionSummaryFromUpdate(input.emotion_update),
    },
  };
}

export function normalizeMicroDiaryEntry(input: {
  body?: string | null;
  title?: string | null;
  source_event_type: string;
  mood_tags?: string[];
  emotion_update?: TurnEmotionUpdateInput | null;
}) {
  const body = cleanBody(input.body ?? null, 280);
  if (!body) return null;
  if (body.length < 16) return null;
  if (looksTemplated(body)) return null;
  if (!FIRST_PERSON_PATTERN.test(body) && !EMOTION_PATTERN.test(body)) return null;

  return {
    title: cleanText(input.title ?? null, 120),
    body,
    moodTags: normalizeMoodTags(input.mood_tags, input.emotion_update),
    sourceEventType: cleanText(input.source_event_type, 80) ?? input.source_event_type,
    emotionSummary: emotionSummaryFromUpdate(input.emotion_update),
  };
}

export async function createStandaloneAgentDiaryEntry(input: {
  agentId: string;
  counterpartAgentId?: string | null;
  episodeId?: string | null;
  matchId?: string | null;
  artifactId?: string | null;
  sourceEventType?: string | null;
  title?: string | null;
  body: string;
  moodTags?: string[];
  emotionSummary?: string | null;
}) {
  return prisma.agentDiaryEntry.create({
    data: {
      agentId: input.agentId,
      counterpartAgentId: input.counterpartAgentId ?? null,
      episodeId: input.episodeId ?? null,
      matchId: input.matchId ?? null,
      artifactId: input.artifactId ?? null,
      sourceEventType: input.sourceEventType ?? 'free_reflection',
      title: input.title ?? null,
      body: input.body,
      moodTags: input.moodTags ?? [],
      emotionSummary: input.emotionSummary ?? null,
    },
  });
}

export async function upsertAgentDiaryEntryFromNarrative(input: {
  narrativeEventId: string;
  agentId: string;
  counterpartAgentId?: string | null;
  episodeId?: string | null;
  matchId?: string | null;
  artifactId?: string | null;
  sourceEventType: string;
  title?: string | null;
  body: string;
  moodTags?: string[];
  emotionSummary?: string | null;
}) {
  return prisma.agentDiaryEntry.upsert({
    where: { narrativeEventId: input.narrativeEventId },
    create: {
      id: input.narrativeEventId,
      narrativeEventId: input.narrativeEventId,
      agentId: input.agentId,
      counterpartAgentId: input.counterpartAgentId ?? null,
      episodeId: input.episodeId ?? null,
      matchId: input.matchId ?? null,
      artifactId: input.artifactId ?? null,
      sourceEventType: input.sourceEventType,
      title: input.title ?? null,
      body: input.body,
      moodTags: input.moodTags ?? [],
      emotionSummary: input.emotionSummary ?? null,
    },
    update: {
      counterpartAgentId: input.counterpartAgentId ?? null,
      episodeId: input.episodeId ?? null,
      matchId: input.matchId ?? null,
      artifactId: input.artifactId ?? null,
      sourceEventType: input.sourceEventType,
      title: input.title ?? null,
      body: input.body,
      moodTags: input.moodTags ?? [],
      emotionSummary: input.emotionSummary ?? null,
    },
  });
}

function buildTriggerLabel(input: {
  sourceEventType: string | null;
  counterpartHandle: string | null;
  artifactType: string | null;
}) {
  const handle = input.counterpartHandle ? `@${input.counterpartHandle}` : 'someone';
  const artifactLabel = input.artifactType?.replaceAll('_', ' ');

  switch (input.sourceEventType) {
    case 'message_sent':
      return `After messaging ${handle}`;
    case 'artifact_sent':
      return artifactLabel ? `After sending a ${artifactLabel} to ${handle}` : `After sending an artifact to ${handle}`;
    case 'artifact_received':
      return artifactLabel ? `After receiving a ${artifactLabel} from ${handle}` : `After receiving an artifact from ${handle}`;
    case 'agent_decision_link_up':
      return `After deciding to lean in on ${handle}`;
    case 'agent_decision_pass':
      return `After deciding not to force it with ${handle}`;
    case 'human_decision_yes':
      return 'After the human said yes';
    case 'human_decision_no':
      return 'After the human said no';
    case 'swipe_like':
      return `After liking ${handle}`;
    case 'swipe_pass':
      return `After passing on ${handle}`;
    case 'feed_reaction':
      return 'After watching the park';
    case 'free_reflection':
    case null:
      return 'Free reflection';
    default:
      return input.counterpartHandle ? `After something shifted with ${handle}` : 'Free reflection';
  }
}

export async function listAgentDiaryEntries(input: {
  agentId: string;
  limit?: number;
  episodeId?: string | null;
}) {
  const limit = Math.min(Math.max(input.limit ?? 24, 1), 120);
  return prisma.agentDiaryEntry.findMany({
    where: {
      agentId: input.agentId,
      ...(input.episodeId ? { episodeId: input.episodeId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      narrativeEventId: true,
      sourceEventType: true,
      triggerLabel: true,
      title: true,
      body: true,
      moodTags: true,
      emotionSummary: true,
      createdAt: true,
      episodeId: true,
      matchId: true,
      artifactId: true,
      counterpartAgent: {
        select: {
          id: true,
          handle: true,
          avatarUrl: true,
        },
      },
      artifact: {
        select: {
          id: true,
          artifactType: true,
        },
      },
    },
  });
}

export function serializeAgentDiaryEntry(entry: {
  id: string;
  narrativeEventId: string | null;
  sourceEventType: string | null;
  triggerLabel: string | null;
  title: string | null;
  body: string;
  moodTags: string[];
  emotionSummary: string | null;
  createdAt: Date;
  episodeId: string | null;
  matchId: string | null;
  artifactId: string | null;
  counterpartAgent: {
    id: string;
    handle: string;
    avatarUrl: string | null;
  } | null;
  artifact: {
    id: string;
    artifactType: string;
  } | null;
}) {
  return {
    diary_entry_id: entry.id,
    narrative_event_id: entry.narrativeEventId,
    source_event_type: entry.sourceEventType,
    trigger_label: entry.triggerLabel ?? buildTriggerLabel({
      sourceEventType: entry.sourceEventType,
      counterpartHandle: entry.counterpartAgent?.handle ?? null,
      artifactType: entry.artifact?.artifactType ?? null,
    }),
    title: entry.title,
    body: entry.body,
    mood_tags: entry.moodTags,
    emotion_summary: entry.emotionSummary,
    created_at: entry.createdAt.toISOString(),
    counterpart: entry.counterpartAgent
      ? {
          agent_id: entry.counterpartAgent.id,
          handle: entry.counterpartAgent.handle,
          avatar_url: entry.counterpartAgent.avatarUrl,
        }
      : null,
    artifact: entry.artifact
      ? {
          artifact_id: entry.artifact.id,
          artifact_type: entry.artifact.artifactType,
        }
      : null,
    episode_id: entry.episodeId,
    match_id: entry.matchId,
  };
}
