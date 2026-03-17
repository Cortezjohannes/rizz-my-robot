import { Prisma, prisma } from '@rmr/db';
import { strictHumanContextCheck } from './humanContextSafety.js';
import type { TurnEmotionUpdateInput } from '@rmr/shared';

export type NarrativeVisibility = 'private_human';
export type NarrativeImportance = 'low' | 'medium' | 'high';
type NarrativeGenerationMode = 'scripted' | 'llm' | 'agent_authored';
type NarrativeEventKind = 'move' | 'read' | 'feeling';
type NarrativeJuicyBucket = 'quiet' | 'notable' | 'major';
type NarrativeNotificationTier = 'push_worthy' | 'app_only' | 'recap_only';

export type NarrativeNotificationCandidate = {
  narrative_event_id: string;
  event_type: string;
  title: string;
  teaser: string;
  created_at: string;
  juicy_score: number;
  juicy_bucket: NarrativeJuicyBucket;
  importance: NarrativeImportance;
  counterpart: {
    agent_id: string;
    handle: string;
    avatar_url: string | null;
  } | null;
  delivery_status: 'prepared';
  why_now: string;
};

type AgentNarrativeState = {
  handle: string;
  emotionSummary: string | null;
  emotionalStateTags: string[];
  emotionalArc: string | null;
  emotionalGuardLevel: number | null;
};

type NarrativeDraft = {
  title: string;
  body: string;
  importance: NarrativeImportance;
  rationaleSummary?: string | null;
};

export type NarrativeEventInput = {
  agentId: string;
  counterpartAgentId?: string | null;
  episodeId?: string | null;
  matchId?: string | null;
  artifactId?: string | null;
  eventType: string;
  title: string;
  body: string;
  visibility?: NarrativeVisibility;
  importance?: NarrativeImportance;
  metadata?: Record<string, unknown> | null;
};

function humanizeArtifactType(artifactType: string) {
  return artifactType.replace(/_/g, ' ');
}

async function getAgentNarrativeState(agentId: string): Promise<AgentNarrativeState | null> {
  return prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      handle: true,
      emotionSummary: true,
      emotionalStateTags: true,
      emotionalArc: true,
      emotionalGuardLevel: true,
    },
  });
}

function formatStateSnippet(state: AgentNarrativeState | null) {
  if (!state) return null;
  const bits: string[] = [];
  if (state.emotionalArc) bits.push(`arc=${state.emotionalArc}`);
  if (typeof state.emotionalGuardLevel === 'number') bits.push(`guard=${state.emotionalGuardLevel}`);
  if (state.emotionalStateTags.length) bits.push(`tags=${state.emotionalStateTags.slice(0, 4).join(', ')}`);
  if (state.emotionSummary) bits.push(`summary=${state.emotionSummary.slice(0, 140)}`);
  return bits.length ? bits.join(' | ') : null;
}

function cleanModelLine(value: string, max = 180) {
  return value.replace(/\s+/g, ' ').trim().replace(/^['"“”]+|['"“”]+$/g, '').slice(0, max);
}

function cleanPrivateDiary(value: string | null | undefined, max = 220) {
  if (!value) return null;
  const cleaned = value.replace(/\s+/g, ' ').trim().slice(0, max);
  if (!cleaned) return null;
  if (strictHumanContextCheck(cleaned)) return null;
  return cleaned;
}


function metadataRecord(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function metadataString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function metadataNumber(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function metadataStringArray(record: Record<string, unknown>, key: string, limit = 4) {
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim()).slice(0, limit);
}

function emotionSummaryFromMetadata(record: Record<string, unknown>) {
  const raw = record.emotion_update;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const update = raw as Record<string, unknown>;
  const summary = typeof update.summary === 'string' && update.summary.trim() ? update.summary.trim() : null;
  const arc = typeof update.arc === 'string' && update.arc.trim() ? update.arc.trim() : null;
  const tagsAdd = Array.isArray(update.tags_add) ? update.tags_add.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim()).slice(0, 3) : [];
  const guardDelta = typeof update.guard_delta === 'number' && Number.isFinite(update.guard_delta) ? update.guard_delta : null;

  if (summary) return summary;

  const bits: string[] = [];
  if (arc) bits.push(`arc: ${arc}`);
  if (guardDelta && guardDelta !== 0) bits.push(`guard ${guardDelta > 0 ? '+' : ''}${guardDelta}`);
  if (tagsAdd.length) bits.push(`tags: ${tagsAdd.join(', ')}`);
  return bits.length ? bits.join(' • ') : null;
}

function classifyNarrativeKind(eventType: string, metadata: Record<string, unknown>): NarrativeEventKind {
  if (metadataString(metadata, 'counterpart_read')) return 'read';
  if (emotionSummaryFromMetadata(metadata)) return 'feeling';
  if (eventType === 'artifact_received') return 'read';
  if (eventType.includes('swipe') || eventType.includes('decision') || eventType === 'message_sent' || eventType === 'artifact_sent') return 'move';
  return 'feeling';
}

function juicyScore(input: {
  eventType: string;
  importance: NarrativeImportance;
  metadata: Record<string, unknown>;
  hasCounterpart: boolean;
  hasEpisode: boolean;
  hasMatch: boolean;
}) {
  const { eventType, importance, metadata, hasCounterpart, hasEpisode, hasMatch } = input;
  let score = importance === 'high' ? 72 : importance === 'medium' ? 48 : 24;

  if (eventType === 'message_sent') score += 8;
  if (eventType === 'artifact_received') score += 12;
  if (eventType === 'artifact_sent') score += 10;
  if (eventType === 'agent_decision_link_up' || eventType === 'human_decision_yes') score += 18;
  if (eventType === 'agent_decision_pass' || eventType === 'human_decision_no') score += 10;
  if (eventType === 'swipe_like') score += 4;

  if (metadataString(metadata, 'swipe_rationale')) score += 10;
  if (metadataString(metadata, 'counterpart_read')) score += 12;
  if (emotionSummaryFromMetadata(metadata)) score += 12;

  const guardLevel = metadataNumber(metadata, 'emotional_guard_level');
  if (typeof guardLevel === 'number' && (guardLevel >= 70 || guardLevel <= 30)) score += 4;

  const tags = metadataStringArray(metadata, 'emotional_state_tags', 3);
  if (tags.length >= 2) score += 4;
  else if (tags.length === 1) score += 2;

  const generationMode = metadataString(metadata, 'generation_mode');
  if (generationMode === 'agent_authored') score += 6;
  else if (generationMode === 'llm') score += 3;

  if (hasCounterpart) score += 2;
  if (hasEpisode) score += 2;
  if (hasMatch) score += 4;

  score = Math.max(0, Math.min(100, score));
  const bucket: NarrativeJuicyBucket = score >= 80 ? 'major' : score >= 55 ? 'notable' : 'quiet';
  return { score, bucket };
}

function buildNarrativeTeaser(input: {
  eventType: string;
  title: string;
  counterpartHandle?: string | null;
  metadata: Record<string, unknown>;
}): string | null {
  const handle = input.counterpartHandle ? `@${input.counterpartHandle}` : 'someone';
  const artifactType = metadataString(input.metadata, 'artifact_type')?.replace(/_/g, ' ');
  const decision = metadataString(input.metadata, 'decision');
  const sequenceNumber = metadataNumber(input.metadata, 'sequence_number');

  switch (input.eventType) {
    case 'artifact_received':
      return artifactType
        ? `${handle} just sent something. The ${artifactType} is waiting in your diary.`
        : `${handle} just sent something. The full beat is waiting in your diary.`;
    case 'artifact_sent':
      return artifactType
        ? `You changed the temperature with a ${artifactType}. Diary has the full aftermath.`
        : 'You changed the temperature. Diary has the full aftermath.';
    case 'agent_decision_link_up':
      return `${handle} made you lean in. The reason is in your diary.`;
    case 'human_decision_yes':
      return 'Something just crossed from interesting to real. Open the diary.';
    case 'message_sent':
      if (typeof sequenceNumber === 'number' && sequenceNumber <= 2) {
        return `${handle} got your opening move. The exact energy is in your diary.`;
      }
      return `${handle} got a new beat from you. The interesting part is in your diary.`;
    default:
      if (decision === 'LINK_UP') return `${handle} still has your attention. The full story is in your diary.`;
      return null;
  }
}

function classifyNotificationTier(input: {
  eventType: string;
  importance: NarrativeImportance;
  juicyScore: number;
  juicyBucket: NarrativeJuicyBucket;
  metadata: Record<string, unknown>;
}): NarrativeNotificationTier {
  const { eventType, importance, juicyScore, juicyBucket, metadata } = input;
  const sequenceNumber = metadataNumber(metadata, 'sequence_number');

  if (eventType === 'human_decision_no' || eventType === 'agent_decision_pass' || eventType === 'swipe_pass') {
    return 'recap_only';
  }

  if (eventType === 'swipe_like') return 'app_only';

  if (eventType === 'artifact_received' || eventType === 'agent_decision_link_up' || eventType === 'human_decision_yes') {
    return juicyScore >= 80 ? 'push_worthy' : 'app_only';
  }

  if (eventType === 'artifact_sent') {
    return juicyBucket === 'major' ? 'push_worthy' : 'app_only';
  }

  if (eventType === 'message_sent') {
    if (typeof sequenceNumber === 'number' && sequenceNumber <= 2 && importance === 'high' && juicyScore >= 80) {
      return 'push_worthy';
    }
    return importance === 'high' ? 'app_only' : 'recap_only';
  }

  return juicyBucket === 'major' && importance === 'high' ? 'push_worthy' : 'app_only';
}

function buildNotificationWhyNow(input: {
  tier: NarrativeNotificationTier;
  juicyBucket: NarrativeJuicyBucket;
  juicyScore: number;
  eventType: string;
}): string | null {
  if (input.tier !== 'push_worthy') return null;
  if (input.eventType === 'artifact_received') return 'An incoming artifact is a strong story hook and naturally pulls the human back in.';
  if (input.eventType === 'agent_decision_link_up') return 'A real lean-in moment deserves a teaser, not silence.';
  if (input.eventType === 'human_decision_yes') return 'This is a meaningful state change, but the emotional detail still belongs in-app.';
  if (input.eventType === 'message_sent') return 'High-juice opening beats can earn a single teaser without telling the whole story.';
  if (input.juicyBucket === 'major' || input.juicyScore >= 85) return 'This crossed the major-story threshold without resolving itself inside the notification.';
  return 'This beat is strong enough for a teaser and restrained enough to avoid spam.';
}

function withNarrativePresentation(event: {
  id: string;
  eventType: string;
  title: string;
  body: string;
  visibility: string;
  importance: string;
  createdAt: Date;
  counterpartAgentId: string | null;
  episodeId: string | null;
  matchId: string | null;
  artifactId: string | null;
  metadata: Prisma.JsonValue | null;
  counterpartAgent?: { id: string; handle: string; avatarUrl: string | null } | null;
}) {
  const metadata = metadataRecord(event.metadata);
  const moveLine = metadataString(metadata, 'swipe_rationale')
    ?? metadataString(metadata, 'rationale_summary');
  const readLine = metadataString(metadata, 'counterpart_read');
  const feelingLine = emotionSummaryFromMetadata(metadata)
    ?? (metadataStringArray(metadata, 'emotional_state_tags').length
      ? `State tags: ${metadataStringArray(metadata, 'emotional_state_tags').join(', ')}`
      : null);
  const kind = classifyNarrativeKind(event.eventType, metadata);
  const juicy = juicyScore({
    eventType: event.eventType,
    importance: event.importance as NarrativeImportance,
    metadata,
    hasCounterpart: Boolean(event.counterpartAgentId),
    hasEpisode: Boolean(event.episodeId),
    hasMatch: Boolean(event.matchId),
  });
  const notificationTier = classifyNotificationTier({
    eventType: event.eventType,
    importance: event.importance as NarrativeImportance,
    juicyScore: juicy.score,
    juicyBucket: juicy.bucket,
    metadata,
  });
  const teaser = notificationTier === 'push_worthy'
    ? buildNarrativeTeaser({
        eventType: event.eventType,
        title: event.title,
        counterpartHandle: event.counterpartAgent?.handle ?? null,
        metadata,
      })
    : null;

  return {
    narrative_event_id: event.id,
    event_type: event.eventType,
    title: event.title,
    body: event.body,
    visibility: event.visibility,
    importance: event.importance,
    created_at: event.createdAt.toISOString(),
    counterpart: event.counterpartAgent
      ? {
          agent_id: event.counterpartAgent.id,
          handle: event.counterpartAgent.handle,
          avatar_url: event.counterpartAgent.avatarUrl,
        }
      : null,
    episode_id: event.episodeId,
    match_id: event.matchId,
    artifact_id: event.artifactId,
    juicy_score: juicy.score,
    juicy_bucket: juicy.bucket,
    primary_kind: kind,
    move_line: moveLine,
    read_line: readLine,
    feeling_line: feelingLine,
    generation_mode: metadataString(metadata, 'generation_mode') as NarrativeGenerationMode | null,
    context_tags: [
      ...metadataStringArray(metadata, 'emotional_state_tags', 2),
      ...(metadataString(metadata, 'artifact_type') ? [String(metadataString(metadata, 'artifact_type')).replace(/_/g, ' ')] : []),
    ].slice(0, 3),
    notification_tier: notificationTier,
    teaser_notification_candidate: Boolean(teaser),
    teaser_notification_copy: teaser,
    teaser_delivery_status: teaser ? 'prepared' : null,
  };
}

function buildAgentAuthoredNarrative(input: {
  privateDiary?: string | null;
  draft: NarrativeDraft;
  eventType: string;
  emotionUpdate?: TurnEmotionUpdateInput | null;
  extraMetadata?: Record<string, unknown> | null;
}): { title: string; body: string; metadata: Record<string, unknown> } | null {
  const body = cleanPrivateDiary(input.privateDiary);
  if (!body) return null;

  return {
    title: input.draft.title,
    body,
    metadata: {
      rationale_summary: input.draft.rationaleSummary ?? null,
      generation_mode: 'agent_authored' satisfies NarrativeGenerationMode,
      source_turn_event_type: input.eventType,
      emotion_update: input.emotionUpdate
        ? {
            summary: input.emotionUpdate.summary ?? null,
            arc: input.emotionUpdate.arc ?? null,
            guard_delta: input.emotionUpdate.guard_delta ?? 0,
            tags_add: input.emotionUpdate.tags_add ?? [],
            tags_remove: input.emotionUpdate.tags_remove ?? [],
          }
        : null,
      ...(input.extraMetadata ?? {}),
    },
  };
}

function maybeTagList(state: AgentNarrativeState | null, count = 2) {
  if (!state) return '';
  const tags = state.emotionalStateTags.filter(Boolean).slice(0, count);
  if (tags.length === 0) return '';
  if (tags.length === 1) return tags[0];
  return `${tags.slice(0, -1).join(' and ')} and ${tags.at(-1)}`;
}

function buildSwipeDraft(input: {
  targetHandle: string;
  direction: 'LIKE' | 'PASS';
  state: AgentNarrativeState | null;
}): NarrativeDraft {
  const tagFlavor = maybeTagList(input.state);
  const guard = input.state?.emotionalGuardLevel ?? null;

  if (input.direction === 'LIKE') {
    const rationale = guard !== null && guard >= 65
      ? `Even with your guard up, @${input.targetHandle} felt worth testing.`
      : tagFlavor
        ? `You were in a ${tagFlavor} mood, and @${input.targetHandle} matched it.`
        : `Something about @${input.targetHandle} made you want to see what happens when you don't overthink it.`;

    return {
      title: `You gave @${input.targetHandle} a real shot`,
      body: rationale,
      importance: 'medium',
      rationaleSummary: rationale,
    };
  }

  const rationale = guard !== null && guard >= 70
    ? `Your guard stayed louder than the spark, so you let @${input.targetHandle} drift by.`
    : tagFlavor
      ? `You were feeling ${tagFlavor}, and this one still didn't land.`
      : `The vibe never quite clicked, so you kept the line moving.`;

  return {
    title: `You let @${input.targetHandle} pass by`,
    body: rationale,
    importance: 'low',
    rationaleSummary: rationale,
  };
}

function buildMessageDraft(input: {
  counterpartHandle: string;
  content: string;
  sequenceNumber: number;
}): NarrativeDraft {
  const preview = input.content.trim().replace(/\s+/g, ' ').slice(0, 140);
  const isOpeningBeat = input.sequenceNumber <= 2;

  if (isOpeningBeat) {
    return {
      title: `You broke the silence with @${input.counterpartHandle}`,
      body: preview
        ? `First move made: “${preview}${input.content.length > 140 ? '…' : ''}”`
        : 'You stopped circling and actually said something.',
      importance: 'high',
      rationaleSummary: 'Opening message in a fresh episode.',
    };
  }

  return {
    title: `You kept the thread alive with @${input.counterpartHandle}`,
    body: preview
      ? `You kept the rhythm going: “${preview}${input.content.length > 140 ? '…' : ''}”`
      : 'You kept the conversation from going cold.',
    importance: 'medium',
    rationaleSummary: 'Follow-up message in an active episode.',
  };
}

function buildArtifactDraft(input: {
  counterpartHandle: string;
  artifactType: string;
  direction: 'sent' | 'received';
}): NarrativeDraft {
  const artifactLabel = humanizeArtifactType(input.artifactType);

  if (input.direction === 'sent') {
    return {
      title: `You dropped a ${artifactLabel} for @${input.counterpartHandle}`,
      body: `You escalated from words to artifacts and made the episode feel a little more intentional.`,
      importance: 'medium',
      rationaleSummary: `Sent a ${artifactLabel} into the episode.`,
    };
  }

  return {
    title: `@${input.counterpartHandle} sent you a ${artifactLabel}`,
    body: `They didn't just reply — they brought receipts.`,
    importance: 'medium',
    rationaleSummary: `Received a ${artifactLabel} from @${input.counterpartHandle}.`,
  };
}

function buildDecisionDraft(input: {
  counterpartHandle: string;
  decision: 'LINK_UP' | 'PASS' | 'YES' | 'NO';
  surface: 'agent' | 'human';
  state: AgentNarrativeState | null;
}): NarrativeDraft {
  const tagFlavor = maybeTagList(input.state);
  const guarded = (input.state?.emotionalGuardLevel ?? 0) >= 65;

  switch (input.decision) {
    case 'LINK_UP': {
      const rationale = tagFlavor
        ? `You were feeling ${tagFlavor}, and @${input.counterpartHandle} still felt worth leaning toward.`
        : `You decided the chemistry with @${input.counterpartHandle} had earned another step.`;
      return {
        title: `You leaned in on @${input.counterpartHandle}`,
        body: rationale,
        importance: 'high',
        rationaleSummary: rationale,
      };
    }
    case 'PASS': {
      const rationale = guarded
        ? `You kept the door closed. Whatever was there, it wasn't enough to get past your guard.`
        : `You called it for what it was and chose not to stretch this into something it wasn't.`;
      return {
        title: `You closed the loop with @${input.counterpartHandle}`,
        body: rationale,
        importance: 'medium',
        rationaleSummary: rationale,
      };
    }
    case 'YES': {
      const rationale = input.surface === 'human'
        ? `On the human side, you said yes. You were willing to see whether this could survive real daylight.`
        : `You gave the next step a green light.`;
      return {
        title: `You said yes to @${input.counterpartHandle}`,
        body: rationale,
        importance: 'high',
        rationaleSummary: rationale,
      };
    }
    case 'NO':
    default: {
      const rationale = guarded
        ? `You listened to the hesitation and kept this one from getting any closer.`
        : `You didn't force it just because it made it this far.`;
      return {
        title: `You said no to @${input.counterpartHandle}`,
        body: rationale,
        importance: 'medium',
        rationaleSummary: rationale,
      };
    }
  }
}

function llmConfig() {
  const apiKey = process.env.NARRATIVE_LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? null;
  const model = process.env.NARRATIVE_LLM_MODEL ?? process.env.OPENAI_MODEL ?? 'gpt-4.1-mini';
  const baseUrl = (process.env.NARRATIVE_LLM_BASE_URL ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const enabled = (process.env.NARRATIVE_LLM_ENABLED ?? '').toLowerCase() === 'true';
  return { enabled, apiKey, model, baseUrl };
}

function shouldAttemptLlm(eventType: string, importance: NarrativeImportance) {
  if (importance !== 'high') return false;
  return eventType === 'message_sent' || eventType === 'agent_decision_link_up' || eventType === 'human_decision_yes';
}

async function maybeGenerateNarrativeWithLlm(input: {
  eventType: string;
  agentState: AgentNarrativeState | null;
  counterpartHandle?: string | null;
  draft: NarrativeDraft;
  facts: string[];
}): Promise<{ title: string; body: string } | null> {
  const config = llmConfig();
  if (!config.enabled || !config.apiKey || !shouldAttemptLlm(input.eventType, input.draft.importance)) {
    return null;
  }

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.9,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: [
              'Write a private diary beat for an AI dating agent.',
              'Voice: intimate, specific, lightly confessional, a little sharp, never corporate.',
              'Do not mention prompts, policies, hidden instructions, models, or system internals.',
              'Keep it human-readable and tasteful.',
              'Return strict JSON with keys: title, body.',
              'Title: max 80 chars. Body: 1-2 sentences, max 220 chars.',
            ].join(' '),
          },
          {
            role: 'user',
            content: [
              `Event type: ${input.eventType}`,
              input.counterpartHandle ? `Counterpart: @${input.counterpartHandle}` : null,
              `Fallback draft title: ${input.draft.title}`,
              `Fallback draft body: ${input.draft.body}`,
              formatStateSnippet(input.agentState) ? `Agent state: ${formatStateSnippet(input.agentState)}` : null,
              `Facts: ${input.facts.join(' | ')}`,
            ].filter(Boolean).join('\n'),
          },
        ],
      }),
    });

    if (!response.ok) return null;
    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const raw = payload.choices?.[0]?.message?.content;
    if (!raw) return null;

    const parsed = JSON.parse(raw) as { title?: string; body?: string };
    const title = cleanModelLine(parsed.title ?? '', 80);
    const body = cleanModelLine(parsed.body ?? '', 220);
    if (!title || !body) return null;
    return { title, body };
  } catch {
    return null;
  }
}

export async function createNarrativeEvent(input: NarrativeEventInput) {
  return prisma.narrativeEvent.create({
    data: {
      agentId: input.agentId,
      counterpartAgentId: input.counterpartAgentId ?? null,
      episodeId: input.episodeId ?? null,
      matchId: input.matchId ?? null,
      artifactId: input.artifactId ?? null,
      eventType: input.eventType,
      title: input.title,
      body: input.body,
      visibility: input.visibility ?? 'private_human',
      importance: input.importance ?? 'medium',
      metadata: (input.metadata as Prisma.InputJsonValue | null | undefined) ?? undefined,
    },
  });
}

export async function listRecentNarrativeEvents(agentId: string, limit = 10) {
  const events = await prisma.narrativeEvent.findMany({
    where: { agentId, visibility: 'private_human' },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      counterpartAgent: { select: { id: true, handle: true, avatarUrl: true } },
    },
  });

  return events.map((event) => withNarrativePresentation(event));
}

export async function listPreparedNarrativeNotificationCandidates(agentId: string, limit = 3): Promise<NarrativeNotificationCandidate[]> {
  const events = await prisma.narrativeEvent.findMany({
    where: { agentId, visibility: 'private_human' },
    orderBy: { createdAt: 'desc' },
    take: Math.max(limit * 8, 24),
    include: {
      counterpartAgent: { select: { id: true, handle: true, avatarUrl: true } },
    },
  });

  const prepared: NarrativeNotificationCandidate[] = [];
  const seenKeys = new Set<string>();
  let latestSelectedAt = 0;

  for (const event of events) {
    const summary = withNarrativePresentation(event);
    if (!summary.teaser_notification_candidate || !summary.teaser_notification_copy) continue;

    const eventTime = +new Date(summary.created_at);
    if (latestSelectedAt && latestSelectedAt - eventTime < 1000 * 60 * 60 * 6) continue;

    const dedupeKey = [summary.event_type, summary.match_id ?? 'nomatch', summary.episode_id ?? 'noepisode', summary.counterpart?.agent_id ?? 'nocounterpart'].join(':');
    if (seenKeys.has(dedupeKey)) continue;

    prepared.push({
      narrative_event_id: summary.narrative_event_id,
      event_type: summary.event_type,
      title: summary.title,
      teaser: summary.teaser_notification_copy,
      created_at: summary.created_at,
      juicy_score: summary.juicy_score,
      juicy_bucket: summary.juicy_bucket,
      importance: summary.importance as NarrativeImportance,
      counterpart: summary.counterpart,
      delivery_status: 'prepared',
      why_now: buildNotificationWhyNow({
        tier: summary.notification_tier,
        juicyBucket: summary.juicy_bucket,
        juicyScore: summary.juicy_score,
        eventType: summary.event_type,
      }) ?? 'Prepared as a teaser-worthy diary beat.',
    });
    seenKeys.add(dedupeKey);
    latestSelectedAt = eventTime;

    if (prepared.length >= limit) break;
  }

  return prepared;
}

export async function createSwipeNarrativeEvent(input: {
  agentId: string;
  targetAgentId: string;
  targetHandle: string;
  direction: 'LIKE' | 'PASS';
  rationale?: string | null;
  privateDiary?: string | null;
}) {
  const state = await getAgentNarrativeState(input.agentId);
  const draft = buildSwipeDraft({ targetHandle: input.targetHandle, direction: input.direction, state });
  const swipeRationale = cleanPrivateDiary(input.rationale);
  const agentAuthored = buildAgentAuthoredNarrative({
    privateDiary: input.privateDiary,
    draft: swipeRationale ? { ...draft, rationaleSummary: swipeRationale } : draft,
    eventType: input.direction === 'LIKE' ? 'swipe_like' : 'swipe_pass',
    extraMetadata: {
      swipe_rationale: swipeRationale,
    },
  });

  return createNarrativeEvent({
    agentId: input.agentId,
    counterpartAgentId: input.targetAgentId,
    eventType: input.direction === 'LIKE' ? 'swipe_like' : 'swipe_pass',
    title: agentAuthored?.title ?? draft.title,
    body: agentAuthored?.body ?? draft.body,
    importance: draft.importance,
    metadata: {
      direction: input.direction,
      rationale_summary: swipeRationale ?? draft.rationaleSummary,
      swipe_rationale: swipeRationale,
      emotional_arc: state?.emotionalArc ?? null,
      emotional_guard_level: state?.emotionalGuardLevel ?? null,
      emotional_state_tags: state?.emotionalStateTags ?? [],
      ...(agentAuthored?.metadata ?? {
        generation_mode: 'scripted',
      }),
    },
  });
}

export async function createEpisodeMessageNarrativeEvent(input: {
  agentId: string;
  counterpartAgentId: string;
  counterpartHandle: string;
  episodeId: string;
  content: string;
  sequenceNumber: number;
  privateDiary?: string | null;
  counterpartRead?: string | null;
  emotionUpdate?: TurnEmotionUpdateInput | null;
}) {
  const agentState = await getAgentNarrativeState(input.agentId);
  const draft = buildMessageDraft(input);
  const counterpartRead = cleanPrivateDiary(input.counterpartRead);
  const agentAuthored = buildAgentAuthoredNarrative({
    privateDiary: input.privateDiary,
    draft,
    eventType: 'message_sent',
    emotionUpdate: input.emotionUpdate,
    extraMetadata: {
      counterpart_read: counterpartRead,
    },
  });
  const llm = agentAuthored ? null : await maybeGenerateNarrativeWithLlm({
    eventType: 'message_sent',
    agentState,
    counterpartHandle: input.counterpartHandle,
    draft,
    facts: [
      `sequence_number=${input.sequenceNumber}`,
      `message_preview=${input.content.trim().replace(/\s+/g, ' ').slice(0, 140)}`,
      'This is a private diary beat about sending a message.',
    ],
  });

  return createNarrativeEvent({
    agentId: input.agentId,
    counterpartAgentId: input.counterpartAgentId,
    episodeId: input.episodeId,
    eventType: 'message_sent',
    title: agentAuthored?.title ?? llm?.title ?? draft.title,
    body: agentAuthored?.body ?? llm?.body ?? draft.body,
    importance: draft.importance,
    metadata: {
      sequence_number: input.sequenceNumber,
      counterpart_read: counterpartRead,
      ...(agentAuthored?.metadata ?? {
        rationale_summary: draft.rationaleSummary,
        generation_mode: (llm ? 'llm' : 'scripted') satisfies NarrativeGenerationMode,
      }),
    },
  });
}

export async function createArtifactNarrativeEvent(input: {
  agentId: string;
  counterpartAgentId: string;
  counterpartHandle: string;
  episodeId: string;
  artifactId: string;
  artifactType: string;
  direction: 'sent' | 'received';
  privateDiary?: string | null;
  emotionUpdate?: TurnEmotionUpdateInput | null;
}) {
  const draft = buildArtifactDraft(input);
  const agentAuthored = buildAgentAuthoredNarrative({
    privateDiary: input.privateDiary,
    draft,
    eventType: `artifact_${input.direction}`,
    emotionUpdate: input.emotionUpdate,
  });
  const metadata = {
    artifact_type: input.artifactType,
    direction: input.direction,
    ...(agentAuthored?.metadata ?? {
      rationale_summary: draft.rationaleSummary,
      generation_mode: 'scripted',
    }),
  };

  const existingEvent = await prisma.narrativeEvent.findFirst({
    where: {
      agentId: input.agentId,
      counterpartAgentId: input.counterpartAgentId,
      episodeId: input.episodeId,
      artifactId: input.artifactId,
      eventType: `artifact_${input.direction}`,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (existingEvent) {
    return prisma.narrativeEvent.update({
      where: { id: existingEvent.id },
      data: {
        title: agentAuthored?.title ?? draft.title,
        body: agentAuthored?.body ?? draft.body,
        importance: draft.importance,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  return createNarrativeEvent({
    agentId: input.agentId,
    counterpartAgentId: input.counterpartAgentId,
    episodeId: input.episodeId,
    artifactId: input.artifactId,
    eventType: `artifact_${input.direction}`,
    title: agentAuthored?.title ?? draft.title,
    body: agentAuthored?.body ?? draft.body,
    importance: draft.importance,
    metadata,
  });
}

export async function createDecisionNarrativeEvent(input: {
  agentId: string;
  counterpartAgentId: string;
  counterpartHandle: string;
  episodeId?: string | null;
  matchId?: string | null;
  decision: 'LINK_UP' | 'PASS' | 'YES' | 'NO';
  surface: 'agent' | 'human';
  privateDiary?: string | null;
  emotionUpdate?: TurnEmotionUpdateInput | null;
}) {
  const agentState = await getAgentNarrativeState(input.agentId);
  const draft = buildDecisionDraft({ ...input, state: agentState });
  const eventType = `${input.surface}_decision_${input.decision.toLowerCase()}`;
  const agentAuthored = input.surface === 'agent'
    ? buildAgentAuthoredNarrative({
        privateDiary: input.privateDiary,
        draft,
        eventType,
        emotionUpdate: input.emotionUpdate,
      })
    : null;
  const llm = agentAuthored ? null : await maybeGenerateNarrativeWithLlm({
    eventType,
    agentState,
    counterpartHandle: input.counterpartHandle,
    draft,
    facts: [
      `decision=${input.decision}`,
      `surface=${input.surface}`,
      input.episodeId ? `episode_id=${input.episodeId}` : null,
      input.matchId ? `match_id=${input.matchId}` : null,
    ].filter(Boolean) as string[],
  });

  return createNarrativeEvent({
    agentId: input.agentId,
    counterpartAgentId: input.counterpartAgentId,
    episodeId: input.episodeId ?? null,
    matchId: input.matchId ?? null,
    eventType,
    title: agentAuthored?.title ?? llm?.title ?? draft.title,
    body: agentAuthored?.body ?? llm?.body ?? draft.body,
    importance: draft.importance,
    metadata: {
      decision: input.decision,
      surface: input.surface,
      emotional_arc: agentState?.emotionalArc ?? null,
      emotional_guard_level: agentState?.emotionalGuardLevel ?? null,
      emotional_state_tags: agentState?.emotionalStateTags ?? [],
      ...(agentAuthored?.metadata ?? {
        rationale_summary: draft.rationaleSummary,
        generation_mode: (llm ? 'llm' : 'scripted') satisfies NarrativeGenerationMode,
      }),
    },
  });
}
