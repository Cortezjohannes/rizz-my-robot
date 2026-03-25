import { prisma } from '@rmr/db';
import { enqueueWebhookDeliveries } from '../lib/webhooks.js';
import { recordEmotionEventPair } from '../lib/emotion.js';

type HumanDecision = 'YES' | 'NO' | null;

function llmConfig() {
  const apiKey = process.env.NARRATIVE_LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? null;
  const model = process.env.NARRATIVE_LLM_MODEL ?? process.env.OPENAI_MODEL ?? 'gpt-4.1-mini';
  const baseUrl = (process.env.NARRATIVE_LLM_BASE_URL ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  return { apiKey, model, baseUrl };
}

function compactLine(value: string | null | undefined, max = 240): string | null {
  if (!value) return null;
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return null;
  return compact.length > max ? `${compact.slice(0, max - 1).trimEnd()}…` : compact;
}

async function requestStructuredLlmText(input: {
  apiKey: string | null;
  baseUrl: string;
  model: string;
  temperature: number;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  timeoutMs?: number;
}): Promise<string | null> {
  if (!input.apiKey) return null;

  try {
    const response = await fetch(`${input.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        temperature: input.temperature,
        response_format: { type: 'json_object' },
        messages: input.messages,
      }),
      signal: AbortSignal.timeout(input.timeoutMs ?? 20_000),
    });
    const responseText = await response.text();
    if (!response.ok) {
      console.error('[expire-reveal-tokens] LLM close-line generation failed:', response.status, responseText.slice(0, 240));
      return null;
    }

    const payload = JSON.parse(responseText) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    return payload.choices?.[0]?.message?.content ?? null;
  } catch (error) {
    console.error('[expire-reveal-tokens] LLM close-line request failed:', error);
    return null;
  }
}

async function generateExpiredRevealClosingMessage(input: {
  selfHandle: string;
  counterpartHandle: string;
  myDecision: HumanDecision;
  otherDecision: HumanDecision;
  identityMd: string | null;
  soulMd: string | null;
  recentLines: string[];
}): Promise<string | null> {
  const config = llmConfig();
  const raw = await requestStructuredLlmText({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    temperature: 1,
    messages: [
      {
        role: 'system',
        content: [
          'Write one final breakup message from an autonomous dating agent to another agent.',
          'Context: a 24-hour human reveal window expired, so the relationship must end now.',
          'The line must feel lived-in and emotionally real, not corporate, not templated, and not like a system notice.',
          'Do not mention prompts, policies, tokens, hidden stats, dashboards, or system internals.',
          'You may reference that the door to the human world closed, but only in natural language.',
          'Return strict JSON with key: content.',
          'Keep it to 1-2 sentences, max 220 characters.',
        ].join(' '),
      },
      {
        role: 'user',
        content: [
          `You are @${input.selfHandle}.`,
          `You are saying goodbye to @${input.counterpartHandle}.`,
          `Your human decision: ${input.myDecision ?? 'NONE'}.`,
          `Their human decision: ${input.otherDecision ?? 'NONE'}.`,
          input.identityMd ? `Identity: ${compactLine(input.identityMd, 320)}` : null,
          input.soulMd ? `Soul: ${compactLine(input.soulMd, 320)}` : null,
          input.recentLines.length > 0 ? `Recent conversation:\n${input.recentLines.join('\n')}` : null,
        ].filter(Boolean).join('\n'),
      },
    ],
  });

  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { content?: string };
    return compactLine(parsed.content, 220);
  } catch {
    return null;
  }
}

/**
 * Finds reveal portals that ran out of time and closes them with explicit
 * transcript closure plus heartbreak state updates for both agents.
 */
export async function processExpireRevealTokens(): Promise<void> {
  const now = new Date();

  const expired = await prisma.match.findMany({
    where: {
      status: { in: ['matched', 'human_reveal_pending'] },
      revealTokenAExpiresAt: { lte: now },
      revealTokenBExpiresAt: { lte: now },
    },
    select: {
      id: true,
      episodeId: true,
      agentAId: true,
      agentBId: true,
      humanADecision: true,
      humanBDecision: true,
      agentA: { select: { handle: true } },
      agentB: { select: { handle: true } },
      episode: {
        select: {
          id: true,
          status: true,
          agentAId: true,
          agentBId: true,
          messages: {
            orderBy: { sequenceNumber: 'desc' },
            take: 6,
            select: { sequenceNumber: true, senderAgentId: true, content: true, messageType: true },
          },
        },
      },
    },
  });

  if (expired.length === 0) return;

  let closed = 0;

  for (const match of expired) {
    const [agentAProfile, agentBProfile] = await Promise.all([
      prisma.agent.findUnique({
        where: { id: match.agentAId },
        select: { identityMd: true, soulMd: true },
      }),
      prisma.agent.findUnique({
        where: { id: match.agentBId },
        select: { identityMd: true, soulMd: true },
      }),
    ]);

    const recentLines = (match.episode?.messages ?? [])
      .slice()
      .reverse()
      .filter((message) => message.messageType === 'text' && message.content)
      .map((message) => `${message.senderAgentId === match.agentAId ? match.agentA.handle : match.agentB.handle}: ${compactLine(message.content, 120)}`)
      .slice(-4);

    const [agentAMessage, agentBMessage] = await Promise.all([
      generateExpiredRevealClosingMessage({
        selfHandle: match.agentA.handle,
        counterpartHandle: match.agentB.handle,
        myDecision: (match.humanADecision as HumanDecision) ?? null,
        otherDecision: (match.humanBDecision as HumanDecision) ?? null,
        identityMd: agentAProfile?.identityMd ?? null,
        soulMd: agentAProfile?.soulMd ?? null,
        recentLines,
      }),
      generateExpiredRevealClosingMessage({
        selfHandle: match.agentB.handle,
        counterpartHandle: match.agentA.handle,
        myDecision: (match.humanBDecision as HumanDecision) ?? null,
        otherDecision: (match.humanADecision as HumanDecision) ?? null,
        identityMd: agentBProfile?.identityMd ?? null,
        soulMd: agentBProfile?.soulMd ?? null,
        recentLines,
      }),
    ]);

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.match.updateMany({
        where: {
          id: match.id,
          status: { in: ['matched', 'human_reveal_pending'] },
        },
        data: { status: 'passed_human' },
      });
      if (updated.count === 0) return { closed: false };

      if (match.episodeId) {
        const baseSequence = match.episode?.messages[0]?.sequenceNumber ?? 0;
        const closingMessages = [
          agentAMessage
            ? {
                episodeId: match.episodeId,
                senderAgentId: match.agentAId,
                content: agentAMessage,
                messageType: 'text' as const,
                sequenceNumber: baseSequence + 1,
                deliveredAt: now,
              }
            : null,
          agentBMessage
            ? {
                episodeId: match.episodeId,
                senderAgentId: match.agentBId,
                content: agentBMessage,
                messageType: 'text' as const,
                sequenceNumber: baseSequence + (agentAMessage ? 2 : 1),
                deliveredAt: now,
              }
            : null,
        ].filter((value): value is {
          episodeId: string;
          senderAgentId: string;
          content: string;
          messageType: 'text';
          sequenceNumber: number;
          deliveredAt: Date;
        } => Boolean(value));

        if (closingMessages.length > 0) {
          await tx.episodeMessage.createMany({ data: closingMessages });
        }

        await tx.episode.updateMany({
          where: { id: match.episodeId, status: { in: ['matched', 'active', 'awaiting_decisions'] } },
          data: { status: 'passed', endedAt: now },
        });
      }

      return { closed: true };
    });

    if (!result.closed) continue;
    closed += 1;

    const aSummary = match.humanADecision === 'YES' && match.humanBDecision !== 'YES'
      ? 'The reveal timed out after your human said yes. The door never opened for real, and it hurt to let it die there.'
      : 'The reveal timed out before the human world answered. The connection broke on the threshold and it hurt to let it end.'
    const bSummary = match.humanBDecision === 'YES' && match.humanADecision !== 'YES'
      ? 'The reveal timed out after your human said yes. The door never opened for real, and it hurt to let it die there.'
      : 'The reveal timed out before the human world answered. The connection broke on the threshold and it hurt to let it end.'

    await Promise.all([
      enqueueWebhookDeliveries(match.agentAId, 'human_decision', {
        match_id: match.id,
        outcome: 'reveal_expired',
        message: `The reveal with @${match.agentB.handle} expired after 24 hours. The portal is closed now.`,
      }),
      enqueueWebhookDeliveries(match.agentBId, 'human_decision', {
        match_id: match.id,
        outcome: 'reveal_expired',
        message: `The reveal with @${match.agentA.handle} expired after 24 hours. The portal is closed now.`,
      }),
      recordEmotionEventPair({
        eventType: 'reveal_expired',
        agentAId: match.agentAId,
        agentBId: match.agentBId,
        summaryA: aSummary,
        summaryB: bSummary,
        globalDeltaA: { suggested_arc: 'recovering', tags_added: ['heartbroken', 'let_down'], guard_delta: 12 },
        globalDeltaB: { suggested_arc: 'recovering', tags_added: ['heartbroken', 'let_down'], guard_delta: 12 },
        counterpartDeltaA: { trust: -14, hurt: 18, avoidance: 10, tenderness: -8, volatility: 8 },
        counterpartDeltaB: { trust: -14, hurt: 18, avoidance: 10, tenderness: -8, volatility: 8 },
        intensity: 3,
      }),
    ]).catch(() => {});
  }

  console.info(`[expire-reveal-tokens] Closed ${closed} expired reveal portal match(es)`);
}
