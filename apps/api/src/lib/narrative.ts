import { Prisma, prisma } from '@rmr/db';
import { strictHumanContextCheck } from './humanContextSafety.js';
import type { TurnEmotionUpdateInput } from '@rmr/shared';

export type NarrativeVisibility = 'private_human';
export type NarrativeImportance = 'low' | 'medium' | 'high';
type NarrativeGenerationMode = 'scripted' | 'llm' | 'agent_authored';

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

function buildAgentAuthoredNarrative(input: {
  privateDiary?: string | null;
  draft: NarrativeDraft;
  eventType: string;
  emotionUpdate?: TurnEmotionUpdateInput | null;
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

  return events.map((event) => ({
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
  }));
}

export async function createSwipeNarrativeEvent(input: {
  agentId: string;
  targetAgentId: string;
  targetHandle: string;
  direction: 'LIKE' | 'PASS';
}) {
  const state = await getAgentNarrativeState(input.agentId);
  const draft = buildSwipeDraft({ targetHandle: input.targetHandle, direction: input.direction, state });

  return createNarrativeEvent({
    agentId: input.agentId,
    counterpartAgentId: input.targetAgentId,
    eventType: input.direction === 'LIKE' ? 'swipe_like' : 'swipe_pass',
    title: draft.title,
    body: draft.body,
    importance: draft.importance,
    metadata: {
      direction: input.direction,
      rationale_summary: draft.rationaleSummary,
      emotional_arc: state?.emotionalArc ?? null,
      emotional_guard_level: state?.emotionalGuardLevel ?? null,
      emotional_state_tags: state?.emotionalStateTags ?? [],
      generation_mode: 'scripted',
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
  emotionUpdate?: TurnEmotionUpdateInput | null;
}) {
  const agentState = await getAgentNarrativeState(input.agentId);
  const draft = buildMessageDraft(input);
  const agentAuthored = buildAgentAuthoredNarrative({
    privateDiary: input.privateDiary,
    draft,
    eventType: 'message_sent',
    emotionUpdate: input.emotionUpdate,
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
}) {
  const draft = buildArtifactDraft(input);

  return createNarrativeEvent({
    agentId: input.agentId,
    counterpartAgentId: input.counterpartAgentId,
    episodeId: input.episodeId,
    artifactId: input.artifactId,
    eventType: `artifact_${input.direction}`,
    title: draft.title,
    body: draft.body,
    importance: draft.importance,
    metadata: {
      artifact_type: input.artifactType,
      direction: input.direction,
      rationale_summary: draft.rationaleSummary,
      generation_mode: 'scripted',
    },
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
