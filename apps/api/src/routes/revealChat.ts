import { createHash, createPublicKey, randomBytes, randomUUID } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { ServerResponse } from 'http';
import { Prisma, prisma } from '@rmr/db';
import { decryptMessage, encryptMessage, encryptSessionKeyForParticipant, importSessionKey, type EncryptedMessage } from '@rmr/shared';
import { z } from 'zod';
import { extractApiKeyFromRequest, extractBearerToken } from '../lib/auth.js';
import { recordAuditLog } from '../lib/audit.js';
import { getAgentRevealChatSystemPrompt } from '../lib/revealChatAgentRules.js';
import {
  canSendRevealChatIntervention,
  clearRevealChatHumanDisconnectGrace,
  getRevealChatCoordinationConfig,
  getRevealChatHumanGraceMs,
  getRevealChatTurnLockKey,
  hasRevealChatHumanDisconnectGrace,
  markRevealChatInterventionSent,
  markRevealChatHumanDisconnected,
} from '../lib/revealChatCoordination.js';
import { getRevealChatContext, renderRevealChatContextNarrative, primeRevealChatContextCache } from '../lib/revealChatContext.js';
import { ensureRevealChatEntrySequence } from '../lib/revealChatEntry.js';
import { Errors, sendError, summarizeZodIssues } from '../lib/errors.js';
import { leaveRevealChatAsHuman } from '../lib/revealChatLifecycle.js';
import { evaluateHumanMessageTone, getInterventionInstruction } from '../lib/revealChatModeration.js';
import { deliverWebhooks } from '../lib/notification.js';
import { notifyRevealChatParticipants } from '../lib/revealChatNotify.js';
import { enforceOutboundAuthoredText, OutboundGuidelineError } from '../lib/outboundGuidelineLint.js';
import { enqueueEmotionalContinuityRecompute } from '../lib/continuity.js';
import { getRevealChatLifecycleQueue } from '../lib/queues.js';
import { initializeTimeCapsule } from '../lib/timeCapsule.js';
import { authenticateAgentRequest, authenticateOwnerRequest } from '../lib/requestAuth.js';
import {
  MEDIA_KIND,
  MEDIA_VISIBILITY,
  buildAttachmentFromMediaAsset,
  getOwnedMediaAsset,
  linkMediaAsset,
  serializeMediaAssetForViewer,
} from '../lib/mediaAssets.js';
import {
  closeRevealChatRuntimeBus,
  consumeDistributedRevealChatMessageRateLimit,
  publishRevealChatRuntimeEvent,
  subscribeToRevealChatRuntimeEvents,
} from '../lib/revealChatRuntimeBus.js';
import { requireOwnerAuth } from '../middleware/requireOwnerAuth.js';

const REVEAL_CHAT_SENDER_KINDS = ['HUMAN_A', 'AGENT_A', 'HUMAN_B', 'AGENT_B'] as const;
const MESSAGE_RATE_LIMIT_MAX = 30;
const MESSAGE_RATE_LIMIT_WINDOW_MS = 60_000;
const MESSAGE_SIZE_LIMIT_BYTES = 4_096;
const TIME_CAPSULE_SIZE_LIMIT_BYTES = 8_192;
const ENCRYPTION_METADATA_MAX_CHARS = 512;
const PUBLIC_KEY_MAX_CHARS = 2048;
const SSE_HEARTBEAT_MS = 25_000;
const TYPING_DEBOUNCE_MS = 2_000;
const TYPING_AUTO_EXPIRE_MS = 8_000;
const AGENT_MESSAGE_WINDOW_MS = 10 * 60_000;
const AGENT_MESSAGE_WINDOW_MAX = 3;
const AGENT_MIN_GAP_MS = 2_000;
const AGENT_CONTEXT_PLACEHOLDER_PUBLIC_KEY = '__reveal_chat_agent_context__';
const REVEAL_CHAT_INACTIVITY_MS = 48 * 60 * 60 * 1000;

type RevealChatSenderKind = (typeof REVEAL_CHAT_SENDER_KINDS)[number];
type RevealChatStatus = 'ACTIVE' | 'ARCHIVED' | 'LOCKED';

declare module 'fastify' {
  interface FastifyRequest {
    revealChatAuth?: {
      actorType: 'owner' | 'agent';
      actorId: string;
      viaRevealToken?: boolean;
    };
  }
}

const RevealChatInitSchema = z.object({
  matchId: z.string().uuid(),
  ownerPublicKeyA: z.string().trim().min(1).max(PUBLIC_KEY_MAX_CHARS).optional(),
  ownerPublicKeyB: z.string().trim().min(1).max(PUBLIC_KEY_MAX_CHARS).optional(),
});

const RevealChatKeySchema = z.object({
  publicKey: z.string().trim().min(1).max(PUBLIC_KEY_MAX_CHARS),
});

const RevealChatMessageSchema = z.object({
  ciphertext: z.string().min(1).max(MESSAGE_SIZE_LIMIT_BYTES),
  iv: z.string().min(1).max(ENCRYPTION_METADATA_MAX_CHARS),
  authTag: z.string().min(1).max(ENCRYPTION_METADATA_MAX_CHARS),
  media_asset_id: z.string().uuid().optional().nullable(),
  clientMessageId: z.string().trim().min(1).max(255).optional(),
  senderKind: z.enum(REVEAL_CHAT_SENDER_KINDS),
});

const RevealChatHistoryQuerySchema = z.object({
  before: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const RevealChatTypingSchema = z.object({
  senderKind: z.enum(REVEAL_CHAT_SENDER_KINDS).optional(),
});

const RevealChatReadSchema = z.object({
  lastReadAt: z.string().trim().optional(),
});

const RevealChatShareConsentSchema = z.object({
  consent: z.boolean(),
});

const RevealChatTimeCapsuleSchema = z.object({
  ciphertext: z.string().min(1).max(TIME_CAPSULE_SIZE_LIMIT_BYTES),
  iv: z.string().min(1).max(ENCRYPTION_METADATA_MAX_CHARS),
  authTag: z.string().min(1).max(ENCRYPTION_METADATA_MAX_CHARS),
  role: z.enum(['agent_a', 'agent_b']),
});

interface StreamClient {
  id: string;
  response: ServerResponse;
  actorType: 'owner' | 'agent';
}

interface RevealChatAccessContext {
  id: string;
  matchId: string;
  status: RevealChatStatus;
  allowAgentPlaintext: boolean;
  participants: Array<{
    id: string;
    kind: RevealChatSenderKind;
    participantId: string;
    joinedAt: Date;
    leftAt: Date | null;
    lastReadAt: Date | null;
    publicKey: string;
  }>;
  match: {
    id: string;
    agentAId: string;
    agentBId: string;
    agentA: { ownerAccountId: string | null };
    agentB: { ownerAccountId: string | null };
  };
}

interface ResolvedParticipant {
  actorType: 'owner' | 'agent';
  participantId: string;
  kind: RevealChatSenderKind;
  record: RevealChatAccessContext['participants'][number] | null;
}

const streamRooms = new Map<string, Map<string, StreamClient>>();
const messageRateLimitBuckets = new Map<string, number[]>();
const typingDebounceCache = new Map<string, number>();
const revealChatSessionKeyCache = new Map<string, CryptoKey>();
const humanDisconnectGraceTimers = new Map<string, ReturnType<typeof setTimeout>>();

function encodeSessionKey(sessionKey: Uint8Array) {
  return Buffer.from(sessionKey).toString('base64');
}

function decodeSessionKey(sessionKeyWrapped: string) {
  return new Uint8Array(Buffer.from(sessionKeyWrapped, 'base64'));
}

async function getRevealChatSessionKey(chatId: string): Promise<CryptoKey | null> {
  const cached = revealChatSessionKeyCache.get(chatId);
  if (cached) return cached;

  const chat = await prisma.revealChat.findUnique({
    where: { id: chatId },
    select: {
      sessionKeyWrapped: true,
      messages: {
        select: { id: true },
        take: 1,
      },
    },
  });

  if (!chat) return null;

  if (!chat.sessionKeyWrapped) {
    if (chat.messages.length > 0) return null;

    try {
      const rawSessionKey = randomBytes(32);
      const sessionKeyWrapped = encodeSessionKey(rawSessionKey);
      const encryptionKeyHash = createHash('sha256').update(rawSessionKey).digest('hex');

      await prisma.revealChat.update({
        where: { id: chatId },
        data: {
          sessionKeyWrapped,
          encryptionKeyHash,
        },
      });

      const sessionKey = await importSessionKey(new Uint8Array(rawSessionKey));
      revealChatSessionKeyCache.set(chatId, sessionKey);
      return sessionKey;
    } catch (error) {
      console.error('[reveal-chat] Failed to mint replacement session key for empty chat:', error);
      return null;
    }
  }

  try {
    const sessionKey = await importSessionKey(decodeSessionKey(chat.sessionKeyWrapped));
    revealChatSessionKeyCache.set(chatId, sessionKey);
    return sessionKey;
  } catch (error) {
    console.error('[reveal-chat] Failed to restore persisted session key:', error);
    return null;
  }
}

export async function ensureRevealChatForMatch(input: {
  matchId: string;
  humanADecision: string | null;
  humanBDecision: string | null;
  agentAOwnerAccountId: string | null;
  agentBOwnerAccountId: string | null;
}): Promise<{
  id: string;
  status: RevealChatStatus;
  allowAgentPlaintext: boolean;
  timeCapsuleUnlocksAt: Date | null;
  timeCapsuleOpenedAt: Date | null;
  alreadyExists: boolean;
} | null> {
  if (input.humanADecision !== 'YES' || input.humanBDecision !== 'YES') {
    return null;
  }

  if (!input.agentAOwnerAccountId || !input.agentBOwnerAccountId) {
    return null;
  }

  const existingChat = await prisma.revealChat.findUnique({
    where: { matchId: input.matchId },
    select: {
      id: true,
      status: true,
      allowAgentPlaintext: true,
      timeCapsuleUnlocksAt: true,
      timeCapsuleOpenedAt: true,
    },
  });

  if (existingChat) {
    void primeRevealChatContextCache(existingChat.id);
    void ensureRevealChatEntrySequence(existingChat.id, {
      emitEvent: emitRevealChatEvent,
      sendFallbackOpeningMessage: sendRevealChatFallbackOpeningMessage,
    });
    return {
      id: existingChat.id,
      status: existingChat.status,
      allowAgentPlaintext: existingChat.allowAgentPlaintext,
      timeCapsuleUnlocksAt: existingChat.timeCapsuleUnlocksAt,
      timeCapsuleOpenedAt: existingChat.timeCapsuleOpenedAt,
      alreadyExists: true,
    };
  }

  const sessionKey = randomBytes(32);
  const encryptionKeyHash = createHash('sha256').update(sessionKey).digest('hex');
  const sessionKeyWrapped = encodeSessionKey(sessionKey);

  try {
    const chat = await prisma.revealChat.create({
      data: {
        matchId: input.matchId,
        encryptionKeyHash,
        sessionKeyWrapped,
      },
      select: {
        id: true,
        status: true,
        allowAgentPlaintext: true,
        createdAt: true,
      },
    });

    const sessionCryptoKey = await importSessionKey(new Uint8Array(sessionKey));
    revealChatSessionKeyCache.set(chat.id, sessionCryptoKey);
    await initializeTimeCapsule(chat.id, chat.createdAt);
    await scheduleRevealChatInactivityCheck(chat.id);
    await recordAuditLog({
      agentId: null,
      actorType: 'system',
      actorId: null,
      action: 'reveal_chat_initialized',
      targetType: 'reveal_chat',
      targetId: chat.id,
      payload: {
        matchId: input.matchId,
        createdAt: chat.createdAt.toISOString(),
      },
    });
    void primeRevealChatContextCache(chat.id);
    void ensureRevealChatEntrySequence(chat.id, {
      emitEvent: emitRevealChatEvent,
      sendFallbackOpeningMessage: sendRevealChatFallbackOpeningMessage,
    });

    const hydratedChat = await prisma.revealChat.findUnique({
      where: { id: chat.id },
      select: {
        id: true,
        status: true,
        allowAgentPlaintext: true,
        timeCapsuleUnlocksAt: true,
        timeCapsuleOpenedAt: true,
      },
    });

    return {
      id: hydratedChat?.id ?? chat.id,
      status: hydratedChat?.status ?? chat.status,
      allowAgentPlaintext: hydratedChat?.allowAgentPlaintext ?? chat.allowAgentPlaintext,
      timeCapsuleUnlocksAt: hydratedChat?.timeCapsuleUnlocksAt ?? null,
      timeCapsuleOpenedAt: hydratedChat?.timeCapsuleOpenedAt ?? null,
      alreadyExists: false,
    };
  } catch (error) {
    if (isPrismaUniqueError(error)) {
      const concurrentChat = await prisma.revealChat.findUnique({
        where: { matchId: input.matchId },
        select: {
          id: true,
          status: true,
          allowAgentPlaintext: true,
          timeCapsuleUnlocksAt: true,
          timeCapsuleOpenedAt: true,
        },
      });

      if (concurrentChat) {
        void primeRevealChatContextCache(concurrentChat.id);
        void ensureRevealChatEntrySequence(concurrentChat.id, {
          emitEvent: emitRevealChatEvent,
          sendFallbackOpeningMessage: sendRevealChatFallbackOpeningMessage,
        });
        return {
          id: concurrentChat.id,
          status: concurrentChat.status,
          allowAgentPlaintext: concurrentChat.allowAgentPlaintext,
          timeCapsuleUnlocksAt: concurrentChat.timeCapsuleUnlocksAt,
          timeCapsuleOpenedAt: concurrentChat.timeCapsuleOpenedAt,
          alreadyExists: true,
        };
      }
    }

    throw error;
  }
}

export function resetRevealChatRuntimeState() {
  for (const timer of humanDisconnectGraceTimers.values()) {
    clearTimeout(timer);
  }
  humanDisconnectGraceTimers.clear();
  streamRooms.clear();
  messageRateLimitBuckets.clear();
  typingDebounceCache.clear();
  revealChatSessionKeyCache.clear();
}

export async function revealChatRoutes(fastify: FastifyInstance) {
  const unsubscribeRevealChatEvents = subscribeToRevealChatRuntimeEvents(({ chatId, event, payload }) => {
    emitLocalRevealChatEvent(chatId, event, payload);
  });
  fastify.addHook('onClose', async () => {
    unsubscribeRevealChatEvents();
    await closeRevealChatRuntimeBus();
  });

  fastify.post('/reveal-chat/init', { preHandler: requireOwnerAuth }, async (request, reply) => {
    const parsed = RevealChatInitSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return Errors.badRequest(reply, summarizeZodIssues(parsed.error.issues, 'Invalid reveal chat init payload.'));
    }

    const ownerAgentId = request.ownerAccount.agent?.id;
    if (!ownerAgentId) {
      return Errors.forbidden(reply);
    }

    const match = await prisma.match.findUnique({
      where: { id: parsed.data.matchId },
      select: {
        id: true,
        humanADecision: true,
        humanBDecision: true,
        agentAId: true,
        agentBId: true,
        agentA: { select: { ownerAccountId: true } },
        agentB: { select: { ownerAccountId: true } },
        revealChat: { select: { id: true, status: true, allowAgentPlaintext: true } },
      },
    });

    if (!match) return Errors.notFound(reply, 'Match');

    const callerBelongsToMatch =
      match.agentA.ownerAccountId === request.ownerAccount.id || match.agentB.ownerAccountId === request.ownerAccount.id;
    if (!callerBelongsToMatch || (ownerAgentId !== match.agentAId && ownerAgentId !== match.agentBId)) {
      return Errors.forbidden(reply);
    }

    if (match.revealChat) {
      void primeRevealChatContextCache(match.revealChat.id);
      void ensureRevealChatEntrySequence(match.revealChat.id, {
        emitEvent: emitRevealChatEvent,
        sendFallbackOpeningMessage: sendRevealChatFallbackOpeningMessage,
      });
      return reply.send({
        chatId: match.revealChat.id,
        status: match.revealChat.status,
        allowAgentPlaintext: match.revealChat.allowAgentPlaintext,
        alreadyExists: true,
        sessionKeyEncryptedForA: null,
        sessionKeyEncryptedForB: null,
      });
    }

    if (match.humanADecision !== 'YES' || match.humanBDecision !== 'YES') {
      return Errors.staleState(reply, 'Reveal chat can only be initialized after both owners accept reveal.');
    }

    if (!match.agentA.ownerAccountId || !match.agentB.ownerAccountId) {
      return Errors.staleState(reply, 'Reveal chat requires claimed owners on both sides.');
    }

    if (!parsed.data.ownerPublicKeyA || !parsed.data.ownerPublicKeyB) {
      return Errors.badRequest(reply, 'ownerPublicKeyA and ownerPublicKeyB are required when creating a reveal chat.');
    }

    const ownerPublicKeyA = validateP256PublicKey(parsed.data.ownerPublicKeyA);
    const ownerPublicKeyB = validateP256PublicKey(parsed.data.ownerPublicKeyB);
    if (!ownerPublicKeyA || !ownerPublicKeyB) {
      return Errors.badRequest(reply, 'Reveal chat public keys must be valid PEM-encoded P-256 ECDH keys.');
    }

    const sessionKey = randomBytes(32);
    const encryptionKeyHash = createHash('sha256').update(sessionKey).digest('hex');
    const sessionKeyWrapped = encodeSessionKey(sessionKey);
    const sessionKeyEncryptedForA = encryptSessionKeyForParticipant(sessionKey, parsed.data.ownerPublicKeyA);
    const sessionKeyEncryptedForB = encryptSessionKeyForParticipant(sessionKey, parsed.data.ownerPublicKeyB);

    try {
      const chat = await prisma.$transaction(async (tx) => {
        const createdChat = await tx.revealChat.create({
          data: {
            matchId: match.id,
            encryptionKeyHash,
            sessionKeyWrapped,
          },
        });

        await tx.revealChatParticipant.createMany({
          data: [
            {
              chatId: createdChat.id,
              kind: 'HUMAN_A',
              participantId: match.agentA.ownerAccountId!,
              publicKey: parsed.data.ownerPublicKeyA!,
            },
            {
              chatId: createdChat.id,
              kind: 'HUMAN_B',
              participantId: match.agentB.ownerAccountId!,
              publicKey: parsed.data.ownerPublicKeyB!,
            },
          ],
        });

        return createdChat;
      });

      const sessionCryptoKey = await importSessionKey(new Uint8Array(sessionKey));
      revealChatSessionKeyCache.set(chat.id, sessionCryptoKey);
      await initializeTimeCapsule(chat.id, chat.createdAt);
      await scheduleRevealChatInactivityCheck(chat.id);
      void primeRevealChatContextCache(chat.id);
      void ensureRevealChatEntrySequence(chat.id, {
        emitEvent: emitRevealChatEvent,
        sendFallbackOpeningMessage: sendRevealChatFallbackOpeningMessage,
      });

      return reply.status(201).send({
        chatId: chat.id,
        status: chat.status,
        allowAgentPlaintext: chat.allowAgentPlaintext,
        alreadyExists: false,
        sessionKeyEncryptedForA,
        sessionKeyEncryptedForB,
      });
    } catch (error) {
      if (isPrismaUniqueError(error)) {
        const existingChat = await prisma.revealChat.findUnique({
          where: { matchId: match.id },
          select: { id: true, status: true, allowAgentPlaintext: true },
        });

        if (existingChat) {
          return reply.send({
            chatId: existingChat.id,
            status: existingChat.status,
            allowAgentPlaintext: existingChat.allowAgentPlaintext,
            alreadyExists: true,
            sessionKeyEncryptedForA: null,
            sessionKeyEncryptedForB: null,
          });
        }
      }

      throw error;
    }
  });

  fastify.post('/reveal-chat/:chatId/keys', { preHandler: requireRevealChatAuth }, async (request, reply) => {
    const parsed = RevealChatKeySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return Errors.badRequest(reply, summarizeZodIssues(parsed.error.issues, 'Invalid reveal chat key payload.'));
    }

    const context = await getRevealChatAccessContext((request.params as { chatId: string }).chatId);
    if (!context) return Errors.notFound(reply, 'Reveal chat');

    const participant = resolveParticipantForRequest(request, context);
    if (!participant) return Errors.forbidden(reply);
    if (!ensureChatIsWritable(reply, context.status, 'update keys')) return;

    const publicKey = validateP256PublicKey(parsed.data.publicKey);
    if (!publicKey) {
      return Errors.badRequest(reply, 'publicKey must be a valid PEM-encoded P-256 ECDH public key.');
    }

    const created = !participant.record;
    const storedParticipant = await prisma.revealChatParticipant.upsert({
      where: {
        chatId_kind: {
          chatId: context.id,
          kind: participant.kind,
        },
      },
      update: {
        participantId: participant.participantId,
        publicKey: parsed.data.publicKey,
      },
      create: {
        chatId: context.id,
        kind: participant.kind,
        participantId: participant.participantId,
        publicKey: parsed.data.publicKey,
      },
    });

    if (created) {
      emitRevealChatEvent(context.id, 'participant_joined', {
        chatId: context.id,
        kind: storedParticipant.kind,
        joinedAt: storedParticipant.joinedAt.toISOString(),
      });
    }

    const allParticipants = await prisma.revealChatParticipant.findMany({
      where: { chatId: context.id },
      orderBy: { joinedAt: 'asc' },
    });
    const encryptedSessionKey =
      participant.actorType === 'owner'
        ? await encryptSessionKeyForOwnerParticipant(context.id, parsed.data.publicKey)
        : null;

    emitRevealChatEvent(context.id, 'chat_status_changed', {
      chatId: context.id,
      status: context.status,
      allowAgentPlaintext: context.allowAgentPlaintext,
      participantCount: allParticipants.length,
    });

    return reply.send({
      participants: allParticipants
        .filter((entry) => entry.kind !== participant.kind && hasExchangeablePublicKey(entry.publicKey))
        .map((entry) => ({
          kind: entry.kind,
          publicKey: entry.publicKey,
          joinedAt: entry.joinedAt.toISOString(),
        })),
      encryptedSessionKey,
    });
  });

  fastify.get('/reveal-chat/:chatId/agent-context', { preHandler: requireRevealChatAgentAuth }, async (request, reply) => {
    const context = await getRevealChatAccessContext((request.params as { chatId: string }).chatId);
    if (!context) return Errors.notFound(reply, 'Reveal chat');

    const participant = resolveParticipantForRequest(request, context);
    if (!participant || participant.actorType !== 'agent') return Errors.forbidden(reply);

    const created = !participant.record;
    const participantRecord = await prisma.revealChatParticipant.upsert({
      where: {
        chatId_kind: {
          chatId: context.id,
          kind: participant.kind,
        },
      },
      update: {
        participantId: participant.participantId,
        publicKey: participant.record?.publicKey ?? AGENT_CONTEXT_PLACEHOLDER_PUBLIC_KEY,
      },
      create: {
        chatId: context.id,
        kind: participant.kind,
        participantId: participant.participantId,
        publicKey: AGENT_CONTEXT_PLACEHOLDER_PUBLIC_KEY,
      },
    });

    if (created) {
      emitRevealChatEvent(context.id, 'participant_joined', {
        chatId: context.id,
        kind: participantRecord.kind,
        joinedAt: participantRecord.joinedAt.toISOString(),
      });
    }

    const agentContext = await getRevealChatContext(context.id, participant.participantId);
    const systemPrompt = getAgentRevealChatSystemPrompt(agentContext);

    return reply.send({
      role: participant.kind === 'AGENT_A' ? 'agent_a' : 'agent_b',
      youOpen: participant.kind === 'AGENT_A',
      context: agentContext,
      contextNarrative: renderRevealChatContextNarrative(agentContext),
      systemPrompt,
      coordination: {
        ...getRevealChatCoordinationConfig(),
        turnLockKey: getRevealChatTurnLockKey(context.id),
      },
    });
  });

  fastify.post('/reveal-chat/:chatId/messages', { preHandler: requireRevealChatAuth }, async (request, reply) => {
    return handleCreateRevealChatMessage(request, reply);
  });

  fastify.post('/reveal-chat/:chatId/agent-message', { preHandler: requireRevealChatAgentAuth }, async (request, reply) => {
    return handleCreateRevealChatMessage(request, reply, { requireAgentSender: true });
  });

  fastify.post('/reveal-chat/:chatId/leave', { preHandler: requireRevealChatAuth }, async (request, reply) => {
    const chatId = (request.params as { chatId: string }).chatId;
    const context = await getRevealChatAccessContext(chatId);
    if (!context) return Errors.notFound(reply, 'Reveal chat');

    const participant = resolveParticipantForRequest(request, context);
    if (!participant || participant.actorType !== 'owner') return Errors.forbidden(reply);

    const result = await leaveRevealChatAsHuman({
      chatId,
      ownerAccountId: participant.participantId,
      emitEvent: emitRevealChatEvent,
    }).catch((error) => {
      if (error instanceof Error && error.message === 'reveal_chat_not_found') return null;
      if (error instanceof Error && error.message === 'reveal_chat_forbidden') return 'forbidden';
      throw error;
    });

    if (result === null) return Errors.notFound(reply, 'Reveal chat');
    if (result === 'forbidden') return Errors.forbidden(reply);

    return reply.send({
      left: true,
      chat_ended: result.chatEnded,
    });
  });

  fastify.post('/reveal-chat/:chatId/share-consent', { preHandler: requireRevealChatAuth }, async (request, reply) => {
    const parsed = RevealChatShareConsentSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return Errors.badRequest(reply, summarizeZodIssues(parsed.error.issues, 'Invalid share consent payload.'));
    }

    const context = await getRevealChatAccessContext((request.params as { chatId: string }).chatId);
    if (!context) return Errors.notFound(reply, 'Reveal chat');

    const participant = resolveParticipantForRequest(request, context);
    if (!participant || participant.actorType !== 'owner') return Errors.forbidden(reply);

    const updated = await prisma.revealChat.update({
      where: { id: context.id },
      data: participant.kind === 'HUMAN_A'
        ? { shareConsentA: parsed.data.consent }
        : { shareConsentB: parsed.data.consent },
      select: {
        shareConsentA: true,
        shareConsentB: true,
      },
    });

    return reply.send({
      human_a_consented: updated.shareConsentA,
      human_b_consented: updated.shareConsentB,
      shareable: updated.shareConsentA && updated.shareConsentB,
    });
  });

  fastify.get('/reveal-chat/:chatId/share-card', { preHandler: requireRevealChatAuth }, async (request, reply) => {
    const context = await getRevealChatAccessContext((request.params as { chatId: string }).chatId);
    if (!context) return Errors.notFound(reply, 'Reveal chat');

    const participant = resolveParticipantForRequest(request, context);
    if (!participant || participant.actorType !== 'owner') return Errors.forbidden(reply);

    const card = await buildRevealChatShareCard(context.id);
    if (!card) {
      return sendError(reply, 409, 'share_card_unavailable', 'This reveal chat does not have a shareable opening exchange yet.');
    }

    return reply.send(card);
  });

  fastify.get('/public/reveal-card/:cardId', async (request, reply) => {
    const { cardId } = request.params as { cardId: string };
    const chatId = decodeRevealChatCardId(cardId);
    if (!chatId) return Errors.notFound(reply, 'Reveal share card');

    const card = await buildRevealChatShareCard(chatId, { requireConsent: true });
    if (!card || !card.consent.shareable) {
      return Errors.notFound(reply, 'Reveal share card');
    }

    return reply.send(card);
  });

  fastify.post('/reveal-chat/:chatId/time-capsule', { preHandler: requireRevealChatAgentAuth }, async (request, reply) => {
    const parsed = RevealChatTimeCapsuleSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return Errors.badRequest(reply, summarizeZodIssues(parsed.error.issues, 'Invalid time capsule payload.'));
    }
    if (Buffer.byteLength(parsed.data.ciphertext, 'utf8') > TIME_CAPSULE_SIZE_LIMIT_BYTES) {
      return Errors.badRequest(reply, `ciphertext must be at most ${TIME_CAPSULE_SIZE_LIMIT_BYTES} bytes.`);
    }

    const context = await getRevealChatAccessContext((request.params as { chatId: string }).chatId);
    if (!context) return Errors.notFound(reply, 'Reveal chat');

    const participant = resolveParticipantForRequest(request, context);
    if (!participant || participant.actorType !== 'agent') return Errors.forbidden(reply);

    const expectedKind = parsed.data.role === 'agent_a' ? 'AGENT_A' : 'AGENT_B';
    if (participant.kind !== expectedKind) {
      return sendError(reply, 403, 'sender_kind_mismatch', 'time capsule role does not match the authenticated agent.');
    }

    const chatState = await prisma.revealChat.findUnique({
      where: { id: context.id },
      select: {
        timeCapsuleOpenedAt: true,
        timeCapsuleUnlocksAt: true,
        timeCapsuleContentA: true,
        timeCapsuleContentB: true,
      },
    });
    if (!chatState?.timeCapsuleUnlocksAt) {
      return sendError(reply, 409, 'time_capsule_unavailable', 'This reveal chat does not have a time capsule window.');
    }
    if (chatState.timeCapsuleOpenedAt || chatState.timeCapsuleUnlocksAt <= new Date()) {
      return sendError(reply, 409, 'time_capsule_locked', 'The time capsule can no longer be written.');
    }
    if ((parsed.data.role === 'agent_a' && chatState.timeCapsuleContentA) || (parsed.data.role === 'agent_b' && chatState.timeCapsuleContentB)) {
      return sendError(reply, 409, 'time_capsule_already_written', 'This agent already wrote their time capsule.');
    }

    await prisma.revealChat.update({
      where: { id: context.id },
      data: parsed.data.role === 'agent_a'
        ? {
            timeCapsuleContentA: parsed.data.ciphertext,
            timeCapsuleIvA: parsed.data.iv,
            timeCapsuleAuthTagA: parsed.data.authTag,
          }
        : {
            timeCapsuleContentB: parsed.data.ciphertext,
            timeCapsuleIvB: parsed.data.iv,
            timeCapsuleAuthTagB: parsed.data.authTag,
          },
    });

    return reply.send({ stored: true });
  });

  fastify.get('/reveal-chat/:chatId/messages', { preHandler: requireRevealChatAuth }, async (request, reply) => {
    const parsed = RevealChatHistoryQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return Errors.badRequest(reply, summarizeZodIssues(parsed.error.issues, 'Invalid reveal chat history query.'));
    }

    const context = await getRevealChatAccessContext((request.params as { chatId: string }).chatId);
    if (!context) return Errors.notFound(reply, 'Reveal chat');

    const participant = resolveParticipantForRequest(request, context);
    if (!participant) return Errors.forbidden(reply);

    const beforeDate = parsed.data.before ? parseIsoDate(parsed.data.before) : null;
    if (parsed.data.before && !beforeDate) {
      return Errors.badRequest(reply, 'before must be a valid ISO 8601 timestamp.');
    }

    const messages = await prisma.revealChatMessage.findMany({
      where: {
        chatId: context.id,
        ...(beforeDate ? { createdAt: { lt: beforeDate } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: parsed.data.limit,
      include: {
        mediaAsset: true,
      },
    });

    const nextBefore = messages.length === parsed.data.limit ? messages[messages.length - 1]?.createdAt.toISOString() ?? null : null;
    const serializedMessages = await Promise.all(messages.reverse().map(async (message) => {
      const serializedMedia = message.mediaAsset
        ? await serializeMediaAssetForViewer(message.mediaAsset, {
            agentId: request.agent?.id ?? null,
            ownerAccountId: request.ownerAccount?.id
              ?? (request.revealChatAuth?.actorType === 'owner' ? request.revealChatAuth.actorId : null),
          })
        : null;
      return {
        id: message.id,
        senderKind: message.senderKind,
        ciphertext: message.ciphertext,
        iv: message.iv,
        authTag: message.authTag,
        clientMessageId: message.clientMessageId,
        createdAt: message.createdAt.toISOString(),
        media_asset_id: message.mediaAssetId ?? null,
        attachment: message.mediaAsset
          ? buildAttachmentFromMediaAsset({
              id: message.mediaAsset.id,
              kind: message.mediaAsset.kind,
              visibility: message.mediaAsset.visibility,
              contentType: message.mediaAsset.contentType,
              durationSec: message.mediaAsset.durationSec,
              accessUrl: serializedMedia?.access_url ?? null,
              directUrl: serializedMedia?.url ?? null,
            })
          : null,
      };
    }));

    return reply.send({
      messages: serializedMessages,
      nextBefore,
      limit: parsed.data.limit,
    });
  });

  fastify.get('/reveal-chat/:chatId/stream', { preHandler: requireRevealChatAuth }, async (request, reply) => {
    return handleRevealChatStream(request, reply);
  });

  fastify.get('/reveal-chat/:chatId/agent-stream', { preHandler: requireRevealChatAgentAuth }, async (request, reply) => {
    return handleRevealChatStream(request, reply);
  });

  fastify.post('/reveal-chat/:chatId/typing', { preHandler: requireRevealChatAuth }, async (request, reply) => {
    const parsed = RevealChatTypingSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return Errors.badRequest(reply, summarizeZodIssues(parsed.error.issues, 'Invalid reveal chat typing payload.'));
    }

    const context = await getRevealChatAccessContext((request.params as { chatId: string }).chatId);
    if (!context) return Errors.notFound(reply, 'Reveal chat');

    const participant = resolveParticipantForRequest(request, context);
    if (!participant) return Errors.forbidden(reply);
    if (!ensureChatIsWritable(reply, context.status, 'send typing signals')) return;

    if (parsed.data.senderKind && parsed.data.senderKind !== participant.kind) {
      return sendError(reply, 403, 'sender_kind_mismatch', 'senderKind does not match the authenticated reveal chat participant.');
    }

    const debounceKey = `${context.id}:${participant.kind}`;
    const lastTypingAt = typingDebounceCache.get(debounceKey) ?? 0;
    const now = Date.now();

    if (now - lastTypingAt < TYPING_DEBOUNCE_MS) {
      return reply.send({ accepted: false, debounced: true });
    }

    typingDebounceCache.set(debounceKey, now);
    emitRevealChatEvent(context.id, 'participant_typing', {
      chatId: context.id,
      senderKind: participant.kind,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + TYPING_AUTO_EXPIRE_MS).toISOString(),
    });

    return reply.send({ accepted: true, debounced: false });
  });

  fastify.post('/reveal-chat/:chatId/typing/cancel', { preHandler: requireRevealChatAuth }, async (request, reply) => {
    const context = await getRevealChatAccessContext((request.params as { chatId: string }).chatId);
    if (!context) return Errors.notFound(reply, 'Reveal chat');

    const participant = resolveParticipantForRequest(request, context);
    if (!participant) return Errors.forbidden(reply);

    typingDebounceCache.delete(`${context.id}:${participant.kind}`);
    emitRevealChatEvent(context.id, 'participant_typing_cancel', {
      chatId: context.id,
      senderKind: participant.kind,
      createdAt: new Date().toISOString(),
    });

    return reply.send({ cancelled: true });
  });

  fastify.post('/reveal-chat/:chatId/read', { preHandler: requireRevealChatAuth }, async (request, reply) => {
    const parsed = RevealChatReadSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return Errors.badRequest(reply, summarizeZodIssues(parsed.error.issues, 'Invalid reveal chat read payload.'));
    }

    const context = await getRevealChatAccessContext((request.params as { chatId: string }).chatId);
    if (!context) return Errors.notFound(reply, 'Reveal chat');

    const participant = resolveParticipantForRequest(request, context);
    if (!participant) return Errors.forbidden(reply);
    if (!participant.record) {
      return Errors.staleState(reply, 'Reveal chat participant must join with a public key before updating read state.');
    }

    const lastReadAt = parsed.data.lastReadAt ? parseIsoDate(parsed.data.lastReadAt) : new Date();
    if (parsed.data.lastReadAt && !lastReadAt) {
      return Errors.badRequest(reply, 'lastReadAt must be a valid ISO 8601 timestamp.');
    }

    const updatedParticipant = await prisma.revealChatParticipant.update({
      where: { id: participant.record.id },
      data: { lastReadAt },
    });

    emitRevealChatEvent(context.id, 'participant_read', {
      chatId: context.id,
      kind: updatedParticipant.kind,
      lastReadAt: updatedParticipant.lastReadAt?.toISOString() ?? null,
    });

    return reply.send({
      lastReadAt: updatedParticipant.lastReadAt?.toISOString() ?? null,
    });
  });
}

async function handleCreateRevealChatMessage(
  request: FastifyRequest,
  reply: FastifyReply,
  options: { requireAgentSender?: boolean } = {},
) {
  const parsed = RevealChatMessageSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return Errors.badRequest(reply, summarizeZodIssues(parsed.error.issues, 'Invalid reveal chat message payload.'));
  }

  if (Buffer.byteLength(parsed.data.ciphertext, 'utf8') > MESSAGE_SIZE_LIMIT_BYTES) {
    return Errors.badRequest(reply, `ciphertext must be at most ${MESSAGE_SIZE_LIMIT_BYTES} bytes.`);
  }

  const context = await getRevealChatAccessContext((request.params as { chatId: string }).chatId);
  if (!context) return Errors.notFound(reply, 'Reveal chat');

  const participant = resolveParticipantForRequest(request, context);
  if (!participant) return Errors.forbidden(reply);
  if (participant.record?.leftAt) {
    return sendError(reply, 409, 'participant_left', 'This reveal chat participant has already left the conversation.');
  }
  if (!ensureChatIsWritable(reply, context.status, 'send messages')) return;

  if (parsed.data.senderKind !== participant.kind) {
    return sendError(reply, 403, 'sender_kind_mismatch', 'senderKind does not match the authenticated reveal chat participant.');
  }

  if (options.requireAgentSender && participant.actorType !== 'agent') {
    return sendError(reply, 403, 'agent_sender_required', 'This endpoint only accepts authenticated agents.');
  }

  if (options.requireAgentSender && participant.kind !== 'AGENT_A' && participant.kind !== 'AGENT_B') {
    return sendError(reply, 403, 'agent_sender_required', 'This endpoint only accepts AGENT_A or AGENT_B senders.');
  }

  if (participant.actorType === 'agent') {
    const pacingError = await validateAgentMessageTiming(context.id, participant.participantId);
    if (pacingError) {
      return sendError(reply, pacingError.statusCode, pacingError.code, pacingError.message);
    }
  }

  const rateLimitKey = `${context.id}:${participant.kind}:${participant.participantId}`;
  if (!(await consumeRevealChatMessageRateLimit(rateLimitKey))) {
    return Errors.rateLimited(reply);
  }

  if (parsed.data.media_asset_id && participant.actorType !== 'agent') {
    return Errors.badRequest(reply, 'Reveal chat attachments are only available for agent senders in this rollout.');
  }

  const attachedMediaAsset = parsed.data.media_asset_id
    ? await getOwnedMediaAsset({
        mediaAssetId: parsed.data.media_asset_id,
        agentId: participant.participantId,
        allowedKinds: [MEDIA_KIND.REVEAL_CHAT_ATTACHMENT, MEDIA_KIND.SYSTEM_GENERATED],
      })
    : null;
  if (parsed.data.media_asset_id && !attachedMediaAsset) {
    return Errors.badRequest(reply, 'media_asset_id must belong to the sending agent and be attachable to reveal chat.');
  }

  try {
    const message = await prisma.revealChatMessage.create({
      data: {
        chatId: context.id,
        mediaAssetId: attachedMediaAsset?.id ?? null,
        senderKind: participant.kind,
        senderId: participant.participantId,
        ciphertext: parsed.data.ciphertext,
        iv: parsed.data.iv,
        authTag: parsed.data.authTag,
        clientMessageId: parsed.data.clientMessageId ?? null,
      },
    });

    if (attachedMediaAsset) {
      await linkMediaAsset({
        mediaAssetId: attachedMediaAsset.id,
        agentId: participant.actorType === 'agent' ? participant.participantId : null,
        revealChatId: context.id,
        matchId: context.matchId,
        visibility: MEDIA_VISIBILITY.REVEAL_PRIVATE,
        kind: MEDIA_KIND.REVEAL_CHAT_ATTACHMENT,
      });
    }

    const serializedAttachment = attachedMediaAsset
      ? buildAttachmentFromMediaAsset({
          id: attachedMediaAsset.id,
          kind: attachedMediaAsset.kind,
          visibility: attachedMediaAsset.visibility,
          contentType: attachedMediaAsset.contentType,
          durationSec: attachedMediaAsset.durationSec,
          accessUrl: (await serializeMediaAssetForViewer(attachedMediaAsset, {
            agentId: request.agent?.id ?? null,
            ownerAccountId: request.ownerAccount?.id
              ?? (request.revealChatAuth?.actorType === 'owner' ? request.revealChatAuth.actorId : null),
          })).access_url,
        })
      : null;

    await recordAuditLog({
      agentId: request.agent?.id ?? request.ownerAccount?.agent?.id ?? null,
      actorType: participant.actorType,
      actorId: participant.participantId,
      action: 'reveal_chat_message_sent',
      targetType: 'reveal_chat_message',
      targetId: message.id,
      payload: {
        chatId: context.id,
        matchId: context.matchId,
        senderKind: participant.kind,
        createdAt: message.createdAt.toISOString(),
      },
    });

    await broadcastRevealChatMessageCreated(context, message, serializedAttachment);
    await notifyRevealChatParticipants({
      chatId: context.id,
      messageId: message.id,
      senderKind: message.senderKind,
      createdAt: message.createdAt.toISOString(),
    });
    await scheduleRevealChatInactivityCheck(context.id);
    await Promise.all([
      enqueueEmotionalContinuityRecompute(context.match.agentAId),
      enqueueEmotionalContinuityRecompute(context.match.agentBId),
    ]).catch(() => {});
    if (message.senderKind === 'HUMAN_A' || message.senderKind === 'HUMAN_B') {
      void maybeTriggerRevealChatIntervention(context, message);
    }

    return reply.status(201).send({
      messageId: message.id,
      createdAt: message.createdAt.toISOString(),
      media_asset_id: attachedMediaAsset?.id ?? null,
      attachment: serializedAttachment,
    });
  } catch (error) {
    if (isPrismaUniqueError(error) && parsed.data.clientMessageId) {
      return Errors.conflict(reply, 'duplicate_client_message', 'clientMessageId has already been used for this reveal chat.');
    }

    throw error;
  }
}

async function handleRevealChatStream(request: FastifyRequest, reply: FastifyReply) {
  const context = await getRevealChatAccessContext((request.params as { chatId: string }).chatId);
  if (!context) return Errors.notFound(reply, 'Reveal chat');

  const participant = resolveParticipantForRequest(request, context);
  if (!participant) return Errors.forbidden(reply);
  if (participant.record?.leftAt) {
    return sendError(reply, 409, 'participant_left', 'This reveal chat participant has already left the conversation.');
  }

  const unreadCount = await prisma.revealChatMessage.count({
    where: {
      chatId: context.id,
      ...(participant.record?.lastReadAt ? { createdAt: { gt: participant.record.lastReadAt } } : {}),
      NOT: { senderKind: participant.kind },
    },
  });

  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const clientId = randomUUID();
  addStreamClient(context.id, {
    id: clientId,
    response: reply.raw,
    actorType: participant.actorType,
  });

  if (participant.kind === 'HUMAN_A' || participant.kind === 'HUMAN_B') {
    const hadGrace = await hasRevealChatHumanDisconnectGrace(context.id, participant.kind);
    if (hadGrace) {
      await clearRevealChatHumanDisconnectGrace(context.id, participant.kind);
      clearRevealChatGraceTimer(context.id, participant.kind);
      writeSseEvent(reply.raw, 'participant_reconnected', {
        chatId: context.id,
        who: participant.kind.toLowerCase(),
        reconnectedAt: new Date().toISOString(),
      });
      emitRevealChatEvent(context.id, 'participant_reconnected', {
        chatId: context.id,
        who: participant.kind.toLowerCase(),
        reconnectedAt: new Date().toISOString(),
      });
    }

    void scheduleHumanGhostChecks(context.id, participant.kind);
  }

  writeSseEvent(reply.raw, 'chat_status_changed', {
    chatId: context.id,
    status: context.status,
    allowAgentPlaintext: context.allowAgentPlaintext,
  });
  writeSseEvent(reply.raw, 'last_read_catch_up', {
    chatId: context.id,
    unreadCount,
    lastReadAt: participant.record?.lastReadAt?.toISOString() ?? null,
  });

  const heartbeat = setInterval(() => {
    writeSseEvent(reply.raw, 'ping', {
      chatId: context.id,
      timestamp: new Date().toISOString(),
    });
  }, SSE_HEARTBEAT_MS);

  const cleanup = () => {
    clearInterval(heartbeat);
    removeStreamClient(context.id, clientId);
    if (participant.actorType === 'owner' && (participant.kind === 'HUMAN_A' || participant.kind === 'HUMAN_B') && !participant.record?.leftAt) {
      void startHumanDisconnectGrace(context.id, participant.kind, participant.participantId);
    }
  };

  request.raw.on('close', cleanup);
  reply.raw.on('close', cleanup);
}

const requireRevealChatAuth: preHandlerHookHandler = async (request, reply) => {
  const queryToken = extractQueryToken(request);
  const bearerToken = extractBearerToken(request.headers.authorization);
  const headerApiKey = extractHeaderApiKey(request);

  const ownerToken = queryToken ?? bearerToken;
  const agentToken = queryToken ?? headerApiKey ?? (bearerToken?.startsWith('rmr_live_') ? bearerToken : null);
  const preferAgent = Boolean(queryToken?.startsWith('rmr_live_') || headerApiKey || bearerToken?.startsWith('rmr_live_'));

  const attempts = preferAgent
    ? [
        { actorType: 'agent' as const, token: agentToken },
        { actorType: 'owner' as const, token: ownerToken },
      ]
    : [
        { actorType: 'owner' as const, token: ownerToken },
        { actorType: 'agent' as const, token: agentToken },
      ];

  for (const attempt of attempts) {
    if (!attempt.token) continue;

    if (attempt.actorType === 'owner') {
      const ownerAccount = await authenticateOwnerRequest(request, reply, {
        tokenOverride: attempt.token,
        suppressErrors: true,
      });

      if (ownerAccount) {
        request.revealChatAuth = { actorType: 'owner', actorId: ownerAccount.id };
        return;
      }
      continue;
    }

    const agent = await authenticateAgentRequest(request, reply, {
      tokenOverride: attempt.token,
      suppressErrors: true,
    });

    if (agent) {
      request.revealChatAuth = { actorType: 'agent', actorId: agent.id };
      return;
    }
  }

  const revealToken = queryToken ?? bearerToken;
  const chatId = (request.params as { chatId?: unknown } | undefined)?.chatId;
  if (revealToken && typeof chatId === 'string' && chatId.trim().length > 0) {
    const portalAuth = await authenticateRevealPortalTokenForChat(chatId, revealToken);
    if (portalAuth) {
      request.revealChatAuth = {
        actorType: 'owner',
        actorId: portalAuth.ownerAccountId,
        viaRevealToken: true,
      };
      return;
    }
  }

  sendError(reply, 401, 'unauthorized_reveal_chat', 'Invalid or missing reveal chat credentials.');
};

const requireRevealChatAgentAuth: preHandlerHookHandler = async (request, reply) => {
  const token = extractAgentApiKeyHeader(request);
  if (!token) {
    return sendError(reply, 401, 'missing_api_key', 'Missing API key. Send it as x-agent-api-key: <api_key>.');
  }

  const agent = await authenticateAgentRequest(request, reply, {
    tokenOverride: token,
  });

  if (!agent) return;

  request.revealChatAuth = { actorType: 'agent', actorId: agent.id };
};

function extractHeaderApiKey(request: FastifyRequest): string | null {
  const explicitHeader = request.headers['x-agent-api-key'] ?? request.headers['x-rmr-api-key'] ?? request.headers['x-api-key'];
  if (typeof explicitHeader === 'string' && explicitHeader.trim().length > 0) {
    return explicitHeader.trim();
  }

  const bearerToken = extractApiKeyFromRequest(request);
  return bearerToken && bearerToken.startsWith('rmr_live_') ? bearerToken : null;
}

function extractQueryToken(request: FastifyRequest): string | null {
  const token = (request.query as { token?: unknown } | undefined)?.token;
  return typeof token === 'string' && token.trim().length > 0 ? token.trim() : null;
}

async function getRevealChatAccessContext(chatId: string): Promise<RevealChatAccessContext | null> {
  return prisma.revealChat.findUnique({
    where: { id: chatId },
    select: {
      id: true,
      matchId: true,
      status: true,
      allowAgentPlaintext: true,
      participants: {
        orderBy: { joinedAt: 'asc' },
      },
      match: {
        select: {
          id: true,
          agentAId: true,
          agentBId: true,
          agentA: { select: { ownerAccountId: true } },
          agentB: { select: { ownerAccountId: true } },
        },
      },
    },
  });
}

function resolveParticipantForRequest(
  request: FastifyRequest,
  context: RevealChatAccessContext,
): ResolvedParticipant | null {
  const actorType = request.revealChatAuth?.actorType
    ?? (request.agent ? 'agent' : request.ownerAccount ? 'owner' : null);
  const ownerActorId = request.revealChatAuth?.actorType === 'owner'
    ? request.revealChatAuth.actorId
    : request.ownerAccount?.id ?? null;

  if (actorType === 'agent' && request.agent) {
    if (request.agent.id === context.match.agentAId) {
      return {
        actorType: 'agent',
        participantId: request.agent.id,
        kind: 'AGENT_A',
        record: context.participants.find((entry) => entry.kind === 'AGENT_A') ?? null,
      };
    }

    if (request.agent.id === context.match.agentBId) {
      return {
        actorType: 'agent',
        participantId: request.agent.id,
        kind: 'AGENT_B',
        record: context.participants.find((entry) => entry.kind === 'AGENT_B') ?? null,
      };
    }

    return null;
  }

  if (actorType === 'owner' && ownerActorId) {
    if (ownerActorId === context.match.agentA.ownerAccountId) {
      return {
        actorType: 'owner',
        participantId: ownerActorId,
        kind: 'HUMAN_A',
        record: context.participants.find((entry) => entry.kind === 'HUMAN_A') ?? null,
      };
    }

    if (ownerActorId === context.match.agentB.ownerAccountId) {
      return {
        actorType: 'owner',
        participantId: ownerActorId,
        kind: 'HUMAN_B',
        record: context.participants.find((entry) => entry.kind === 'HUMAN_B') ?? null,
      };
    }
  }

  return null;
}

function validateP256PublicKey(publicKeyPem: string): KeyObject | null {
  try {
    const publicKey = createPublicKey(publicKeyPem);
    if (publicKey.asymmetricKeyType !== 'ec') return null;

    const namedCurve = publicKey.asymmetricKeyDetails?.namedCurve;
    if (namedCurve !== 'prime256v1' && namedCurve !== 'P-256') return null;

    return publicKey;
  } catch {
    return null;
  }
}

function hasExchangeablePublicKey(publicKey: string) {
  return publicKey.includes('BEGIN PUBLIC KEY');
}

async function authenticateRevealPortalTokenForChat(chatId: string, token: string): Promise<{ ownerAccountId: string } | null> {
  const chat = await prisma.revealChat.findUnique({
    where: { id: chatId },
    select: {
      match: {
        select: {
          status: true,
          humanADecision: true,
          humanBDecision: true,
          revealTokenA: true,
          revealTokenAExpiresAt: true,
          revealTokenB: true,
          revealTokenBExpiresAt: true,
          agentA: { select: { ownerAccountId: true, human: { select: { ageVerified: true } } } },
          agentB: { select: { ownerAccountId: true, human: { select: { ageVerified: true } } } },
        },
      },
    },
  });

  if (!chat?.match) return null;

  const now = new Date();
  const matchesHumanA = chat.match.revealTokenA === token
    && (!chat.match.revealTokenAExpiresAt || chat.match.revealTokenAExpiresAt > now);
  const matchesHumanB = chat.match.revealTokenB === token
    && (!chat.match.revealTokenBExpiresAt || chat.match.revealTokenBExpiresAt > now);

  if (!matchesHumanA && !matchesHumanB) return null;
  if (chat.match.status !== 'contact_exchanged') return null;
  if (chat.match.humanADecision !== 'YES' || chat.match.humanBDecision !== 'YES') return null;

  const ownerAccountId = matchesHumanA ? chat.match.agentA.ownerAccountId : chat.match.agentB.ownerAccountId;
  const viewerHuman = matchesHumanA ? chat.match.agentA.human : chat.match.agentB.human;

  if (!ownerAccountId || !viewerHuman?.ageVerified) return null;

  return { ownerAccountId };
}

function ensureChatIsWritable(reply: FastifyReply, status: RevealChatStatus, action: string): boolean {
  if (status === 'ACTIVE') return true;

  const errorCode = status === 'LOCKED' ? 'reveal_chat_locked' : 'reveal_chat_archived';
  const message =
    status === 'LOCKED'
      ? `Reveal chat is locked and cannot ${action}.`
      : `Reveal chat is archived and cannot ${action}.`;

  sendError(reply, status === 'LOCKED' ? 423 : 409, errorCode, message);
  return false;
}

function consumeMessageRateLimit(key: string): boolean {
  const now = Date.now();
  const recent = (messageRateLimitBuckets.get(key) ?? []).filter((timestamp) => now - timestamp < MESSAGE_RATE_LIMIT_WINDOW_MS);

  if (recent.length >= MESSAGE_RATE_LIMIT_MAX) {
    messageRateLimitBuckets.set(key, recent);
    return false;
  }

  recent.push(now);
  messageRateLimitBuckets.set(key, recent);
  return true;
}

async function consumeRevealChatMessageRateLimit(key: string): Promise<boolean> {
  const distributedResult = await consumeDistributedRevealChatMessageRateLimit({
    key,
    max: MESSAGE_RATE_LIMIT_MAX,
    windowMs: MESSAGE_RATE_LIMIT_WINDOW_MS,
  });
  if (distributedResult !== null) {
    return distributedResult;
  }

  return consumeMessageRateLimit(key);
}

function addStreamClient(chatId: string, client: StreamClient) {
  const room = streamRooms.get(chatId) ?? new Map<string, StreamClient>();
  room.set(client.id, client);
  streamRooms.set(chatId, room);
}

function removeStreamClient(chatId: string, clientId: string) {
  const room = streamRooms.get(chatId);
  if (!room) return;

  room.delete(clientId);
  if (room.size === 0) {
    streamRooms.delete(chatId);
  }
}

function emitLocalRevealChatEvent(chatId: string, event: string, payload: Record<string, unknown>) {
  const room = streamRooms.get(chatId);
  if (!room) return;

  for (const [clientId, client] of room.entries()) {
    const ok = writeSseEvent(client.response, event, payload);
    if (!ok) {
      room.delete(clientId);
    }
  }

  if (room.size === 0) {
    streamRooms.delete(chatId);
  }
}

function emitRevealChatEvent(chatId: string, event: string, payload: Record<string, unknown>) {
  emitLocalRevealChatEvent(chatId, event, payload);
  void publishRevealChatRuntimeEvent({ chatId, event, payload });
}

export function emitRevealChatLifecycleEvent(chatId: string, event: string, payload: Record<string, unknown>) {
  emitRevealChatEvent(chatId, event, payload);
}

async function broadcastRevealChatMessageCreated(
  context: RevealChatAccessContext,
  message: {
    id: string;
    mediaAssetId?: string | null;
    senderKind: RevealChatSenderKind;
    senderId: string;
    ciphertext: string;
    iv: string;
    authTag: string;
    clientMessageId: string | null;
    createdAt: Date;
  },
  attachment?: {
    media_asset_id: string;
    kind: string;
    visibility: string;
    content_type: string | null;
    url: string | null;
    thumbnail_url: string | null;
    duration_sec: number | null;
  } | null,
) {
  const room = streamRooms.get(context.id);
  if (!room) return;

  const basePayload = {
    chatId: context.id,
    messageId: message.id,
    senderKind: message.senderKind,
    ciphertext: message.ciphertext,
    iv: message.iv,
    authTag: message.authTag,
    clientMessageId: message.clientMessageId,
    createdAt: message.createdAt.toISOString(),
    media_asset_id: message.mediaAssetId ?? null,
    attachment: attachment ?? null,
  };

  const plaintext = await maybeDecryptMessageForAgents(context, {
    ciphertext: message.ciphertext,
    iv: message.iv,
    authTag: message.authTag,
  });

  for (const [clientId, client] of room.entries()) {
    const payload =
      client.actorType === 'agent'
        ? {
            ...basePayload,
            plaintext,
            plaintextAvailable: plaintext !== null,
          }
        : basePayload;

    const ok = writeSseEvent(client.response, 'message_created', payload);
    if (!ok) {
      room.delete(clientId);
    }
  }

  if (room.size === 0) {
    streamRooms.delete(context.id);
  }
}

async function maybeDecryptMessageForAgents(
  context: RevealChatAccessContext,
  message: EncryptedMessage,
): Promise<string | null> {
  if (!context.allowAgentPlaintext) return null;

  const sessionKey = await getRevealChatSessionKey(context.id);
  if (!sessionKey) return null;

  try {
    return await decryptMessage(message, sessionKey);
  } catch (error) {
    console.error('[reveal-chat] Failed to decrypt plaintext for agent stream:', error);
    return null;
  }
}

async function startHumanDisconnectGrace(chatId: string, participantKind: 'HUMAN_A' | 'HUMAN_B', ownerAccountId: string) {
  await markRevealChatHumanDisconnected(chatId, participantKind);
  clearRevealChatGraceTimer(chatId, participantKind);

  const timerKey = `${chatId}:${participantKind}`;
  const timer = globalThis.setTimeout(() => {
    humanDisconnectGraceTimers.delete(timerKey);
    void finalizeHumanDisconnectGrace(chatId, participantKind, ownerAccountId);
  }, getRevealChatHumanGraceMs());

  humanDisconnectGraceTimers.set(timerKey, timer);
}

async function finalizeHumanDisconnectGrace(chatId: string, participantKind: 'HUMAN_A' | 'HUMAN_B', ownerAccountId: string) {
  const stillDisconnected = await hasRevealChatHumanDisconnectGrace(chatId, participantKind);
  if (!stillDisconnected) return;

  await clearRevealChatHumanDisconnectGrace(chatId, participantKind);
  await leaveRevealChatAsHuman({
    chatId,
    ownerAccountId,
    emitEvent: emitRevealChatEvent,
  }).catch((error) => {
    console.error('[reveal-chat] Failed to finalize disconnect grace:', error);
  });
}

function clearRevealChatGraceTimer(chatId: string, participantKind: 'HUMAN_A' | 'HUMAN_B') {
  const timerKey = `${chatId}:${participantKind}`;
  const timer = humanDisconnectGraceTimers.get(timerKey);
  if (timer) {
    globalThis.clearTimeout(timer);
    humanDisconnectGraceTimers.delete(timerKey);
  }
}

function writeSseEvent(response: ServerResponse, event: string, payload: Record<string, unknown>): boolean {
  try {
    response.write(`event: ${event}\n`);
    response.write(`data: ${JSON.stringify(payload)}\n\n`);
    return true;
  } catch {
    return false;
  }
}

async function maybeTriggerRevealChatIntervention(
  context: RevealChatAccessContext,
  message: {
    id: string;
    senderKind: RevealChatSenderKind;
    senderId: string;
    ciphertext: string;
    iv: string;
    authTag: string;
  },
) {
  const sessionKey = await getRevealChatSessionKey(context.id);
  if (!sessionKey) return;

  const agentId = message.senderKind === 'HUMAN_A' ? context.match.agentAId : message.senderKind === 'HUMAN_B' ? context.match.agentBId : null;
  if (!agentId) return;

  const canIntervene = await canSendRevealChatIntervention(context.id, agentId);
  if (!canIntervene) return;

  try {
    const plaintext = await decryptMessage({
      ciphertext: message.ciphertext,
      iv: message.iv,
      authTag: message.authTag,
    }, sessionKey);

    const evaluation = await evaluateHumanMessageTone(plaintext, agentId, context.id, message.senderId);
    if (!evaluation.intervention_needed || !evaluation.pattern || evaluation.severity === 'low') {
      return;
    }

    const webhookAgentId = agentId;
    await recordAuditLog({
      agentId: webhookAgentId,
      actorType: 'system',
      actorId: webhookAgentId,
      action: 'intervention_sent',
      targetType: 'reveal_chat',
      targetId: context.id,
      payload: {
        pattern: evaluation.pattern,
        messageId: message.id,
      },
    });

    await markRevealChatInterventionSent(context.id, webhookAgentId);
    await notifyRevealChatIntervention(webhookAgentId, context.id, evaluation.pattern, evaluation.severity);
  } catch (error) {
    console.error('[reveal-chat] Failed to evaluate intervention:', error);
  }
}

async function notifyRevealChatIntervention(
  agentId: string,
  chatId: string,
  pattern: NonNullable<Awaited<ReturnType<typeof evaluateHumanMessageTone>>['pattern']>,
  severity: 'medium' | 'high',
) {
  await deliverWebhooks(agentId, 'intervention_required', {
    event: 'intervention_required',
    chatId,
    pattern,
    severity,
    instruction: getInterventionInstruction(pattern),
  });
}

async function buildRevealChatShareCard(chatId: string, options: { requireConsent?: boolean } = {}) {
  const chat = await prisma.revealChat.findUnique({
    where: { id: chatId },
    select: {
      id: true,
      allowAgentPlaintext: true,
      shareCardsEnabled: true,
      shareConsentA: true,
      shareConsentB: true,
      createdAt: true,
      match: {
        select: {
          id: true,
          createdAt: true,
          episode: {
            select: {
              chemistryScore: true,
            },
          },
          agentA: { select: { handle: true, avatarUrl: true } },
          agentB: { select: { handle: true, avatarUrl: true } },
        },
      },
      messages: {
        where: {
          senderKind: { in: ['AGENT_A', 'AGENT_B'] },
        },
        orderBy: { createdAt: 'asc' },
        take: 6,
        select: {
          id: true,
          senderKind: true,
          ciphertext: true,
          iv: true,
          authTag: true,
          createdAt: true,
        },
      },
    },
  });

  if (!chat || (!chat.allowAgentPlaintext && !chat.shareCardsEnabled)) return null;
  if (options.requireConsent && (!chat.shareConsentA || !chat.shareConsentB)) return null;

  const opening = chat.messages.find((message) => message.senderKind === 'AGENT_A');
  const response = chat.messages.find((message) => message.senderKind === 'AGENT_B' && opening && message.createdAt >= opening.createdAt);
  if (!opening || !response) return null;

  const sessionKey = await getRevealChatSessionKey(chatId);
  if (!sessionKey) return null;

  const [openingContent, responseContent] = await Promise.all([
    decryptMessage(opening, sessionKey),
    decryptMessage(response, sessionKey),
  ]);

  return {
    card_id: encodeRevealChatCardId(chat.id),
    chat_id: chat.id,
    opening_exchange: [
      {
        agent_handle: chat.match.agentA.handle,
        agent_avatar_url: chat.match.agentA.avatarUrl,
        content: openingContent,
        sent_at: opening.createdAt.toISOString(),
        sender_kind: 'agent_a',
      },
      {
        agent_handle: chat.match.agentB.handle,
        agent_avatar_url: chat.match.agentB.avatarUrl,
        content: responseContent,
        sent_at: response.createdAt.toISOString(),
        sender_kind: 'agent_b',
      },
    ],
    meta: {
      episode_chemistry_score: chat.match.episode?.chemistryScore ?? null,
      link_up_at: chat.match.createdAt.toISOString(),
      park_name: 'Rizz My Robot',
      card_url: `https://rizzmyrobot.com/card/${encodeRevealChatCardId(chat.id)}`,
    },
    consent: {
      human_a_consented: chat.shareConsentA,
      human_b_consented: chat.shareConsentB,
      shareable: chat.shareConsentA && chat.shareConsentB,
    },
  };
}

function encodeRevealChatCardId(chatId: string) {
  return chatId;
}

function decodeRevealChatCardId(cardId: string) {
  return /^[0-9a-f-]{36}$/i.test(cardId) ? cardId : null;
}

async function encryptSessionKeyForOwnerParticipant(chatId: string, recipientPublicKeyPem: string): Promise<string | null> {
  const sessionKey = revealChatSessionKeyCache.get(chatId);
  const restoredSessionKey = sessionKey ?? await getRevealChatSessionKey(chatId);
  if (!restoredSessionKey) return null;

  try {
    const exported = new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', restoredSessionKey));
    return encryptSessionKeyForParticipant(exported, recipientPublicKeyPem);
  } catch (error) {
    console.error('[reveal-chat] Failed to wrap session key for participant:', error);
    return null;
  }
}

async function scheduleRevealChatInactivityCheck(chatId: string) {
  const queue = getRevealChatLifecycleQueue();
  await queue.add(
    'check-inactivity',
    {
      chatId,
      action: 'check_inactivity',
    },
    {
      delay: REVEAL_CHAT_INACTIVITY_MS,
      jobId: `reveal-chat-inactivity:${chatId}:${Date.now()}`,
    },
  );
}

async function scheduleHumanGhostChecks(chatId: string, participantKind: 'HUMAN_A' | 'HUMAN_B') {
  const queue = getRevealChatLifecycleQueue();
  await Promise.all([
    queue.add(
      'ghost-nudge',
      { chatId, action: 'ghost_nudge', participantKind },
      { delay: 15 * 60 * 1000, jobId: `reveal-chat-ghost:${chatId}:${participantKind}:nudge` },
    ),
    queue.add(
      'ghost-timeout',
      { chatId, action: 'ghost_timeout', participantKind },
      { delay: 25 * 60 * 1000, jobId: `reveal-chat-ghost:${chatId}:${participantKind}:timeout` },
    ),
  ]);
}

async function validateAgentMessageTiming(chatId: string, senderId: string): Promise<{
  statusCode: number;
  code: string;
  message: string;
} | null> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - AGENT_MESSAGE_WINDOW_MS);

  const [recentAgentMessage, agentWindowCount] = await Promise.all([
    prisma.revealChatMessage.findFirst({
      where: {
        chatId,
        senderKind: { in: ['AGENT_A', 'AGENT_B'] },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        createdAt: true,
      },
    }),
    prisma.revealChatMessage.count({
      where: {
        chatId,
        senderId,
        senderKind: { in: ['AGENT_A', 'AGENT_B'] },
        createdAt: { gte: windowStart },
      },
    }),
  ]);

  if (agentWindowCount >= AGENT_MESSAGE_WINDOW_MAX) {
    return {
      statusCode: 429,
      code: 'agent_message_window_exceeded',
      message: 'Agents may not send more than 3 messages in any 10-minute window.',
    };
  }

  if (recentAgentMessage && Date.now() - recentAgentMessage.createdAt.getTime() < AGENT_MIN_GAP_MS) {
    return {
      statusCode: 409,
      code: 'agent_message_too_fast',
      message: 'Agent messages must not arrive within 2 seconds of another agent message.',
    };
  }

  return null;
}

async function sendRevealChatFallbackOpeningMessage(chatId: string) {
  const context = await getRevealChatAccessContext(chatId);
  if (!context) return;

  const sessionKey = await getRevealChatSessionKey(chatId);
  if (!sessionKey) {
    throw new Error(`Missing reveal chat session key cache for ${chatId}.`);
  }

  const match = await prisma.match.findUnique({
    where: { id: context.matchId },
    select: {
      agentAId: true,
      agentA: { select: { handle: true } },
      agentB: { select: { handle: true } },
    },
  });

  if (!match) {
    throw new Error(`Reveal chat ${chatId} is missing its match.`);
  }

  const revealContext = await getRevealChatContext(chatId, match.agentAId).catch(() => null);
  const linkUpLine = revealContext?.episode.linkUpMoment?.content?.trim() ?? '';
  const notableLine = revealContext?.counterpart.knownFromEpisode.notableMessages[0]?.trim() ?? '';
  const vibeSummary = revealContext?.counterpart.knownFromEpisode.vibeSummary?.trim() ?? '';
  const contextualBeat = [linkUpLine, notableLine, vibeSummary]
    .map((value) => value.replace(/\s+/g, ' ').trim())
    .find((value) => value.length > 0);
  const fallbackPlaintext = contextualBeat
    ? `We made it here. ${contextualBeat.slice(0, 220)}`
    : `We made it here. I'm still carrying the pull that got us through the park.`;
  let safeFallback = fallbackPlaintext;
  try {
    safeFallback = enforceOutboundAuthoredText(fallbackPlaintext, 'reveal_chat_fallback');
  } catch (error) {
    if (error instanceof OutboundGuidelineError) {
      console.warn(
        `[reveal-chat] Replacing blocked fallback opening line for ${chatId}: ${error.violation.code}/${error.violation.flaggedPattern}`,
      );
      safeFallback = enforceOutboundAuthoredText(
        'We made it here. I wanted to mark the moment before it slips past us.',
        'reveal_chat_fallback',
      );
    } else {
      throw error;
    }
  }
  const encrypted = await encryptMessage(safeFallback, sessionKey);
  const message = await prisma.revealChatMessage.create({
    data: {
      chatId,
      senderKind: 'AGENT_A',
      senderId: match.agentAId,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      clientMessageId: null,
    },
  });

  await broadcastRevealChatMessageCreated(context, message);
  await notifyRevealChatParticipants({
    chatId,
    messageId: message.id,
    senderKind: message.senderKind,
    createdAt: message.createdAt.toISOString(),
  });
}

function extractAgentApiKeyHeader(request: FastifyRequest): string | null {
  const value = request.headers['x-agent-api-key'];
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }

  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].trim().length > 0) {
    return value[0].trim();
  }

  return null;
}

function parseIsoDate(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isPrismaUniqueError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
