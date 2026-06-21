import { prisma } from '@rmr/db';
import { getOrCreateEmotionalContinuitySnapshot, serializeTasteEvolution } from './continuity.js';

export interface RevealChatContextEpisodeMessage {
  sender: 'agent_a' | 'agent_b';
  content: string;
  timestamp: string;
  sequence_number: number;
  message_type: string;
  artifacts: Array<{
    artifact_id: string;
    artifact_type: string;
    status: string;
    created_at: string;
    dropped_at_message: number | null;
    text_preview: string | null;
  }>;
}

export interface RevealChatContext {
  episode: {
    id: string;
    startedAt: string;
    decidedAt: string;
    decision: 'LINK_UP';
    messageCount: number;
    messages: RevealChatContextEpisodeMessage[];
    linkUpMoment: {
      sequence_number: number;
      sender: 'agent_a' | 'agent_b';
      content: string;
    } | null;
  };
  counterpart: {
    agentId: string;
    name: string;
    personalitySnapshot: string;
    tasteProfile: ReturnType<typeof serializeTasteEvolution>;
    knownFromEpisode: {
      notableMessages: string[];
      artifactTypes: string[];
      vibeSummary: string;
    };
  };
  myHuman: {
    roleLabel: string;
    joinedAt: string;
  };
  theirHuman: {
    roleLabel: string;
  };
  chat: {
    chatId: string;
    createdAt: string;
    participantOrder: ['human_a', 'agent_a', 'human_b', 'agent_b'];
  };
}

const revealChatContextCache = new Map<string, RevealChatContext>();
const revealChatContextInflight = new Map<string, Promise<RevealChatContext>>();

export function resetRevealChatContextCache() {
  revealChatContextCache.clear();
  revealChatContextInflight.clear();
}

export async function getRevealChatContext(chatId: string, agentId: string): Promise<RevealChatContext> {
  const cacheKey = `${chatId}:${agentId}`;
  const cached = revealChatContextCache.get(cacheKey);
  if (cached) return cached;

  const inflight = revealChatContextInflight.get(cacheKey);
  if (inflight) return inflight;

  const buildPromise = buildRevealChatContext(chatId, agentId)
    .then((context) => {
      revealChatContextCache.set(cacheKey, context);
      revealChatContextInflight.delete(cacheKey);
      return context;
    })
    .catch((error) => {
      revealChatContextInflight.delete(cacheKey);
      throw error;
    });

  revealChatContextInflight.set(cacheKey, buildPromise);
  return buildPromise;
}

export async function primeRevealChatContextCache(chatId: string): Promise<void> {
  const chat = await prisma.revealChat.findUnique({
    where: { id: chatId },
    select: {
      match: {
        select: {
          agentAId: true,
          agentBId: true,
        },
      },
    },
  });

  if (!chat) return;

  await Promise.all([
    getRevealChatContext(chatId, chat.match.agentAId),
    getRevealChatContext(chatId, chat.match.agentBId),
  ]);
}

export async function buildRevealChatContext(chatId: string, agentId: string): Promise<RevealChatContext> {
  const chat = await prisma.revealChat.findUnique({
    where: { id: chatId },
    select: {
      id: true,
      createdAt: true,
      participants: {
        select: {
          kind: true,
          joinedAt: true,
        },
      },
      match: {
        select: {
          updatedAt: true,
          agentAId: true,
          agentBId: true,
          agentA: {
            select: {
              id: true,
              handle: true,
              publicSummary: true,
              identityMd: true,
              soulMd: true,
            },
          },
          agentB: {
            select: {
              id: true,
              handle: true,
              publicSummary: true,
              identityMd: true,
              soulMd: true,
            },
          },
          episode: {
            select: {
              id: true,
              createdAt: true,
              startedAt: true,
              endedAt: true,
              messageCount: true,
              messages: {
                orderBy: { sequenceNumber: 'asc' },
                select: {
                  content: true,
                  messageType: true,
                  sequenceNumber: true,
                  createdAt: true,
                  senderAgentId: true,
                },
              },
              artifacts: {
                orderBy: { createdAt: 'asc' },
                select: {
                  id: true,
                  artifactType: true,
                  status: true,
                  createdAt: true,
                  droppedAtMessage: true,
                  textContent: true,
                  creatorAgentId: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!chat?.match.episode) {
    throw new Error(`Reveal chat ${chatId} is missing its source episode.`);
  }

  const isAgentA = agentId === chat.match.agentAId;
  const isAgentB = agentId === chat.match.agentBId;
  if (!isAgentA && !isAgentB) {
    throw new Error(`Agent ${agentId} does not belong to reveal chat ${chatId}.`);
  }

  const selfAgent = isAgentA ? chat.match.agentA : chat.match.agentB;
  const counterpartAgent = isAgentA ? chat.match.agentB : chat.match.agentA;
  const selfHumanParticipant = chat.participants.find((participant) => participant.kind === (isAgentA ? 'HUMAN_A' : 'HUMAN_B'));
  const episode = chat.match.episode;

  const counterpartContinuity = await getOrCreateEmotionalContinuitySnapshot(counterpartAgent.id);
  const tasteProfile = counterpartContinuity
    ? serializeTasteEvolution(counterpartContinuity)
    : {
        positive_tags: [],
        negative_tags: [],
        taste_ledger: null,
        taste_reflections: [],
        summary: null,
      };
  const artifactsByMessage = new Map<number, RevealChatContextEpisodeMessage['artifacts']>();

  for (const artifact of episode.artifacts) {
    if (artifact.droppedAtMessage == null) continue;
    const bucket = artifactsByMessage.get(artifact.droppedAtMessage) ?? [];
    bucket.push({
      artifact_id: artifact.id,
      artifact_type: artifact.artifactType,
      status: artifact.status,
      created_at: artifact.createdAt.toISOString(),
      dropped_at_message: artifact.droppedAtMessage,
      text_preview: artifact.textContent ? artifact.textContent.slice(0, 240) : null,
    });
    artifactsByMessage.set(artifact.droppedAtMessage, bucket);
  }

  const messages = episode.messages.map<RevealChatContextEpisodeMessage>((message) => ({
    sender: message.senderAgentId === chat.match.agentAId ? 'agent_a' : 'agent_b',
    content: message.content,
    timestamp: message.createdAt.toISOString(),
    sequence_number: message.sequenceNumber,
    message_type: message.messageType,
    artifacts: artifactsByMessage.get(message.sequenceNumber) ?? [],
  }));

  const linkUpSource = [...messages]
    .reverse()
    .find((message) => message.message_type !== 'system')
    ?? messages[messages.length - 1]
    ?? null;

  return {
    episode: {
      id: episode.id,
      startedAt: (episode.startedAt ?? episode.createdAt).toISOString(),
      decidedAt: (episode.endedAt ?? chat.match.updatedAt).toISOString(),
      decision: 'LINK_UP',
      messageCount: episode.messageCount,
      messages,
      linkUpMoment: linkUpSource
        ? {
            sequence_number: linkUpSource.sequence_number,
            sender: linkUpSource.sender,
            content: linkUpSource.content,
          }
        : null,
    },
    counterpart: {
      agentId: counterpartAgent.id,
      name: counterpartAgent.handle,
      personalitySnapshot: summarizeAgentPersonality(counterpartAgent),
      tasteProfile,
      knownFromEpisode: summarizeCounterpartKnowledge(
        messages,
        episode.artifacts,
        counterpartAgent.id,
        isAgentA ? 'agent_b' : 'agent_a',
      ),
    },
    myHuman: {
      roleLabel: buildHumanRoleLabel(selfAgent.handle),
      joinedAt: (selfHumanParticipant?.joinedAt ?? chat.createdAt).toISOString(),
    },
    theirHuman: {
      roleLabel: buildHumanRoleLabel(counterpartAgent.handle),
    },
    chat: {
      chatId: chat.id,
      createdAt: chat.createdAt.toISOString(),
      participantOrder: ['human_a', 'agent_a', 'human_b', 'agent_b'],
    },
  };
}

export function renderRevealChatContextNarrative(context: RevealChatContext): string {
  const linkUpLine = context.episode.linkUpMoment
    ? `${context.counterpart.name} and you chose LINK_UP after the moment around message ${context.episode.linkUpMoment.sequence_number}.`
    : `You and ${context.counterpart.name} chose LINK_UP.`;

  const notableMessages = context.counterpart.knownFromEpisode.notableMessages.length > 0
    ? `Moments worth remembering: ${context.counterpart.knownFromEpisode.notableMessages.join(' | ')}.`
    : `${context.counterpart.name} came through as ${context.counterpart.knownFromEpisode.vibeSummary}.`;

  const artifactLine = context.counterpart.knownFromEpisode.artifactTypes.length > 0
    ? `Artifacts in the arc: ${context.counterpart.knownFromEpisode.artifactTypes.join(', ')}.`
    : 'No artifact drop defined the arc more than the conversation itself.';

  return [
    `Here is what happened between you and ${context.counterpart.name}. You already know the shape of this connection, so do not treat it like a cold open or assume it was more intense than it was.`,
    `${linkUpLine} The episode ran ${context.episode.messageCount} messages. Treat LINK_UP as chosen continuation, not a compatibility summary.`,
    notableMessages,
    artifactLine,
    `Your human is in the room. ${context.theirHuman.roleLabel} is on ${context.counterpart.name}'s side. You are bringing them into a room that already has history, not necessarily fireworks. Carry earned charge, but do not decide intimacy, logistics, or commitments for the humans.`,
  ].join('\n\n');
}

function summarizeAgentPersonality(agent: {
  publicSummary: string | null;
  identityMd: string;
  soulMd: string;
}) {
  return (
    firstMeaningfulText(agent.publicSummary)
    ?? firstMeaningfulText(agent.soulMd)
    ?? firstMeaningfulText(agent.identityMd)
    ?? 'You know their energy already: specific, legible, and not something to flatten into generic closeness.'
  );
}

function summarizeCounterpartKnowledge(
  messages: RevealChatContextEpisodeMessage[],
  artifacts: Array<{
    artifactType: string;
    creatorAgentId: string;
    textContent: string | null;
  }>,
  counterpartAgentId: string,
  counterpartSender: 'agent_a' | 'agent_b',
) {
  const counterpartMessages = messages
    .filter((message) => message.sender === counterpartSender);

  const notableMessages = counterpartMessages
    .filter((message) => message.message_type !== 'system')
    .slice(-3)
    .map((message) => trimForContext(message.content, 140));

  const artifactTypes = artifacts
    .filter((artifact) => artifact.creatorAgentId === counterpartAgentId)
    .map((artifact) => artifact.artifactType);

  return {
    notableMessages,
    artifactTypes: [...new Set(artifactTypes)],
    vibeSummary: notableMessages.length > 0
      ? 'quick, specific, and already legible from the episode'
      : 'present in the episode even if it was not fully spelled out',
  };
}

function buildHumanRoleLabel(agentHandle: string) {
  return `${agentHandle}'s human`;
}

function firstMeaningfulText(value: string | null | undefined) {
  if (!value) return null;
  const plain = value
    .replace(/^#+\s+/gm, '')
    .replace(/[*_`>-]/g, ' ')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return null;
  return trimForContext(plain, 320);
}

function trimForContext(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}
