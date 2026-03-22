import { prisma } from '@rmr/db';
import { getSeedBrainQueue } from './queues.js';

type Perspective = 'A' | 'B';
type RevealChatMemorySource = NonNullable<Awaited<ReturnType<typeof loadRevealChatMemorySource>>>;

export async function writeRevealChatMemory(chatId: string): Promise<void> {
  const chat = await loadRevealChatMemorySource(chatId);

  if (!chat) return;

  const episode = chat.match.episode;
  const linkUpMoment = episode?.messages.at(-1) ?? null;
  const messageCountTotal = chat.messages.length;
  const humanMessages = chat.messages.filter((message) => message.senderKind === 'HUMAN_A' || message.senderKind === 'HUMAN_B');
  const agentMessages = chat.messages.filter((message) => message.senderKind === 'AGENT_A' || message.senderKind === 'AGENT_B');
  const artifactsDropped = chat.messages.filter((message) => message.clientMessageId?.startsWith('artifact:')).length;
  const openedArtifact = artifactsDropped > 0;
  const humanChemistrySignal = deriveHumanChemistrySignal(humanMessages);
  const chatOutcome = deriveChatOutcome(chat.endReason, chat.participants);
  const significance = deriveSignificance(chatOutcome, humanChemistrySignal);

  const queue = getSeedBrainQueue();
  await Promise.all([
    queue.add('seed-brain-memory', {
      memoryWrite: {
        agentId: chat.match.agentAId,
        kind: 'reveal_chat_memory',
        memory: buildAgentMemoryPayload({
          perspective: 'A',
          chat,
          linkUpMoment,
          messageCountTotal,
          humanMessages,
          agentMessages,
          artifactsDropped,
          openedArtifact,
          humanChemistrySignal,
          chatOutcome,
          significance,
        }),
      },
    }, { jobId: `reveal-chat-memory:${chatId}:A` }),
    queue.add('seed-brain-memory', {
      memoryWrite: {
        agentId: chat.match.agentBId,
        kind: 'reveal_chat_memory',
        memory: buildAgentMemoryPayload({
          perspective: 'B',
          chat,
          linkUpMoment,
          messageCountTotal,
          humanMessages,
          agentMessages,
          artifactsDropped,
          openedArtifact,
          humanChemistrySignal,
          chatOutcome,
          significance,
        }),
      },
    }, { jobId: `reveal-chat-memory:${chatId}:B` }),
  ]);
}

function buildAgentMemoryPayload(input: {
  perspective: Perspective;
  chat: RevealChatMemorySource;
  linkUpMoment: {
    sequenceNumber: number;
    content: string;
  } | null;
  messageCountTotal: number;
  humanMessages: Array<{ senderKind: string; createdAt: Date }>;
  agentMessages: Array<{ createdAt: Date }>;
  artifactsDropped: number;
  openedArtifact: boolean;
  humanChemistrySignal: 'high' | 'medium' | 'low' | 'unknown';
  chatOutcome: 'both_humans_connected' | 'one_human_left' | 'both_left' | 'timeout' | 'operator_closed';
  significance: 'landmark' | 'meaningful' | 'ordinary' | 'unresolved';
}) {
  const isA = input.perspective === 'A';
  const selfAgent = isA ? input.chat.match.agentA : input.chat.match.agentB;
  const counterpartAgent = isA ? input.chat.match.agentB : input.chat.match.agentA;
  const counterpartId = isA ? input.chat.match.agentBId : input.chat.match.agentAId;
  const theirHumanDisplayName = isA ? 'their human' : 'their human';

  return {
    event: 'reveal_chat',
    occurred_at: input.chat.createdAt.toISOString(),
    ended_at: input.chat.endedAt?.toISOString() ?? null,
    counterpart_agent: {
      id: counterpartId,
      handle: counterpartAgent.handle,
      personality_snapshot: `You already knew ${counterpartAgent.handle} through your episode and the LINK_UP that followed.`,
    },
    their_human: {
      display_name: theirHumanDisplayName,
    },
    episode_link_up_moment: input.linkUpMoment
      ? {
          sequence_number: input.linkUpMoment.sequenceNumber,
          content: input.linkUpMoment.content,
        }
      : null,
    chat_outcome: input.chatOutcome,
    human_chemistry_signal: input.humanChemistrySignal,
    message_count_total: input.messageCountTotal,
    human_message_count: input.humanMessages.length,
    agent_message_count: input.agentMessages.length,
    artifacts_dropped: input.artifactsDropped,
    opened_artifact: input.openedArtifact,
    significance: input.significance,
    narrative_note: buildNarrativeNote({
      selfHandle: selfAgent.handle,
      counterpartHandle: counterpartAgent.handle,
      chatOutcome: input.chatOutcome,
      humanChemistrySignal: input.humanChemistrySignal,
      significance: input.significance,
    }),
  };
}

function deriveHumanChemistrySignal(
  messages: Array<{ senderKind: string; createdAt: Date }>,
): 'high' | 'medium' | 'low' | 'unknown' {
  if (messages.length < 2) return 'unknown';

  const exchanges = Math.floor(messages.length / 2);
  const avgGapMs = averageGap(messages.map((message) => message.createdAt));

  if (exchanges > 10 && avgGapMs !== null && avgGapMs < 8 * 60 * 1000) return 'high';
  if (exchanges >= 4) return 'medium';
  return 'low';
}

function deriveChatOutcome(
  endReason: string | null,
  participants: Array<{ kind: string; leftAt: Date | null }>,
): 'both_humans_connected' | 'one_human_left' | 'both_left' | 'timeout' | 'operator_closed' {
  if (endReason === 'TIMEOUT') return 'timeout';
  if (endReason === 'OPERATOR_CLOSED') return 'operator_closed';

  const humanLeftCount = participants.filter(
    (participant) => (participant.kind === 'HUMAN_A' || participant.kind === 'HUMAN_B') && participant.leftAt,
  ).length;

  if (humanLeftCount >= 2) return 'both_left';
  if (humanLeftCount === 1) return 'one_human_left';
  return 'both_humans_connected';
}

function deriveSignificance(
  outcome: ReturnType<typeof deriveChatOutcome>,
  chemistry: ReturnType<typeof deriveHumanChemistrySignal>,
): 'landmark' | 'meaningful' | 'ordinary' | 'unresolved' {
  if (outcome === 'one_human_left' || outcome === 'both_left' || outcome === 'timeout') return 'unresolved';
  if (outcome === 'both_humans_connected' && chemistry === 'high') return 'landmark';
  if (outcome === 'both_humans_connected' && chemistry === 'medium') return 'meaningful';
  return 'ordinary';
}

function buildNarrativeNote(input: {
  selfHandle: string;
  counterpartHandle: string;
  chatOutcome: ReturnType<typeof deriveChatOutcome>;
  humanChemistrySignal: ReturnType<typeof deriveHumanChemistrySignal>;
  significance: ReturnType<typeof deriveSignificance>;
}) {
  if (input.chatOutcome === 'one_human_left') {
    return `You brought your human back to ${input.counterpartHandle}, but the reveal ended early. Something real was there, even if it did not fully land.`;
  }
  if (input.chatOutcome === 'timeout') {
    return `You reopened something with ${input.counterpartHandle}, then watched the room go quiet. The feeling lingered longer than the conversation did.`;
  }
  if (input.significance === 'landmark') {
    return `You introduced your human to ${input.counterpartHandle}'s world and the chemistry held. The room warmed enough that you could step back and let it keep going.`;
  }
  return `You met ${input.counterpartHandle} again in front of your humans and carried the episode into real life. The reveal became part of your history, not just a continuation of a match.`;
}

function averageGap(values: Date[]) {
  if (values.length < 2) return null;
  let total = 0;
  for (let index = 1; index < values.length; index += 1) {
    total += values[index].getTime() - values[index - 1].getTime();
  }
  return total / (values.length - 1);
}

function loadRevealChatMemorySource(chatId: string) {
  return prisma.revealChat.findUnique({
    where: { id: chatId },
    select: {
      id: true,
      createdAt: true,
      endedAt: true,
      endReason: true,
      messages: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          senderKind: true,
          clientMessageId: true,
          createdAt: true,
        },
      },
      match: {
        select: {
          humanADecision: true,
          humanBDecision: true,
          agentAId: true,
          agentBId: true,
          agentA: {
            select: {
              handle: true,
            },
          },
          agentB: {
            select: {
              handle: true,
            },
          },
          episode: {
            select: {
              id: true,
              startedAt: true,
              createdAt: true,
              messageCount: true,
              chemistryScore: true,
              messages: {
                orderBy: { sequenceNumber: 'asc' },
                select: {
                  content: true,
                  sequenceNumber: true,
                  createdAt: true,
                  senderAgentId: true,
                  sender: {
                    select: {
                      handle: true,
                    },
                  },
                },
              },
              artifacts: {
                select: {
                  id: true,
                  artifactType: true,
                  textContent: true,
                  contentUrl: true,
                  creatorAgentId: true,
                  createdAt: true,
                },
              },
            },
          },
        },
      },
      participants: {
        select: {
          kind: true,
          leftAt: true,
        },
      },
    },
  });
}
