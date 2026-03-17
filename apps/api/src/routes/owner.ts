import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import {
  OwnerAuthRequestSchema,
  OwnerAuthVerifySchema,
  OwnerRenameHandleSchema,
  OwnerSocialsSchema,
} from '@rmr/shared';
import { requireOwnerAuth } from '../middleware/requireOwnerAuth.js';
import { Errors, sendError } from '../lib/errors.js';
import { emailCodeExpiryDate, expireStaleClaims, isHandleAvailable, ownerSessionExpiryDate } from '../lib/claims.js';
import { extractBearerToken, generateApiKey, hashApiKey } from '../lib/auth.js';
import { generateOwnerSessionToken, generateShortCode, hashOpaqueSecret } from '../lib/claimAuth.js';
import { sendOwnerLoginEmail } from '../lib/email.js';
import { getOwnerEmotionHome } from '../lib/emotion.js';

const OWNER_ACTIVE_EPISODE_STATUSES = ['pending', 'active', 'awaiting_decisions'];
const OWNER_RECENT_EPISODE_STATUSES = ['matched', 'passed', 'expired', 'decided'];

export async function ownerRoutes(fastify: FastifyInstance) {
  fastify.post('/owner/auth/request', async (request, reply) => {
    const parsed = OwnerAuthRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid owner auth request.', { issues: parsed.error.issues });
    }

    await expireStaleClaims();

    const ownerAccount = await prisma.ownerAccount.findUnique({
      where: { email: parsed.data.email },
      include: {
        agent: { select: { id: true } },
      },
    });
    if (!ownerAccount || !ownerAccount.agent) {
      return sendError(reply, 404, 'owner_not_found', 'No owner account found for that email.');
    }

    const code = generateShortCode();
    const codeHash = hashOpaqueSecret(code);
    const expiresAt = emailCodeExpiryDate();
    const delivery = await sendOwnerLoginEmail({
      email: ownerAccount.email,
      code,
    });
    if (delivery.mode === 'unavailable') {
      return sendError(reply, 503, 'email_delivery_unavailable', delivery.error ?? 'Email delivery is unavailable.');
    }

    await prisma.ownerAccount.update({
      where: { id: ownerAccount.id },
      data: {
        loginCodeHash: codeHash,
        loginCodeExpiresAt: expiresAt,
      },
    });

    return reply.send({
      status: 'code_sent',
      delivery: delivery.mode === 'preview'
        ? {
            mode: 'preview',
            login_code: delivery.preview?.code ?? code,
          }
        : { mode: 'provider' },
      expires_at: expiresAt.toISOString(),
    });
  });

  fastify.post('/owner/auth/verify', async (request, reply) => {
    const parsed = OwnerAuthVerifySchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid owner auth verification.', { issues: parsed.error.issues });
    }

    const ownerAccount = await prisma.ownerAccount.findUnique({
      where: { email: parsed.data.email },
      include: {
        agent: {
          select: {
            id: true,
            handle: true,
            twitterHandle: true,
            handleChangeCount: true,
          },
        },
      },
    });

    if (!ownerAccount?.loginCodeHash || !ownerAccount.loginCodeExpiresAt) {
      return sendError(reply, 401, 'invalid_owner_login', 'No valid login code exists for that account.');
    }
    if (ownerAccount.loginCodeExpiresAt < new Date()) {
      return sendError(reply, 410, 'owner_login_expired', 'Owner login code expired.');
    }
    if (hashOpaqueSecret(parsed.data.code) !== ownerAccount.loginCodeHash) {
      return sendError(reply, 401, 'invalid_owner_login', 'Invalid owner login code.');
    }

    const sessionToken = generateOwnerSessionToken();
    const sessionHash = hashOpaqueSecret(sessionToken);
    const expiresAt = ownerSessionExpiryDate();

    await prisma.$transaction([
      prisma.ownerAccount.update({
        where: { id: ownerAccount.id },
        data: {
          loginCodeHash: null,
          loginCodeExpiresAt: null,
          lastLoginAt: new Date(),
        },
      }),
      prisma.ownerSession.create({
        data: {
          ownerAccountId: ownerAccount.id,
          tokenHash: sessionHash,
          expiresAt,
        },
      }),
    ]);

    return reply.send({
      owner_session_token: sessionToken,
      expires_at: expiresAt.toISOString(),
      owner: {
        email: ownerAccount.email,
        human_identity: ownerAccount.humanIdentity,
        looking_for: ownerAccount.lookingFor,
        instagram_handle: ownerAccount.instagramHandle,
        extra_socials: ownerAccount.extraSocials ?? null,
        x_account: ownerAccount.xHandle
          ? {
              handle: ownerAccount.xHandle,
              display_name: ownerAccount.xDisplayName,
              profile_image_url: ownerAccount.xProfileImageUrl,
            }
          : null,
      },
      agent: ownerAccount.agent,
    });
  });

  fastify.post('/owner/auth/logout', { preHandler: requireOwnerAuth }, async (request, reply) => {
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      return sendError(reply, 401, 'unauthorized_owner', 'Invalid or missing owner session token.');
    }

    const tokenHash = hashOpaqueSecret(token);
    await prisma.ownerSession.deleteMany({
      where: {
        tokenHash,
        ownerAccountId: request.ownerAccount.id,
      },
    });

    return reply.send({ status: 'logged_out' });
  });

  fastify.get('/owner/me', { preHandler: requireOwnerAuth }, async (request, reply) => {
    return reply.send({
      owner: {
        id: request.ownerAccount.id,
        email: request.ownerAccount.email,
        human_identity: request.ownerAccount.humanIdentity,
        looking_for: request.ownerAccount.lookingFor,
        instagram_handle: request.ownerAccount.instagramHandle,
        extra_socials: request.ownerAccount.extraSocials ?? null,
        x_account: request.ownerAccount.xHandle
          ? {
              handle: request.ownerAccount.xHandle,
              display_name: request.ownerAccount.xDisplayName,
              profile_image_url: request.ownerAccount.xProfileImageUrl,
            }
          : null,
      },
      agent: request.ownerAccount.agent,
    });
  });

  fastify.get('/owner/home', { preHandler: requireOwnerAuth }, async (request, reply) => {
    const agentId = request.ownerAccount.agent?.id;
    if (!agentId) return Errors.notFound(reply, 'Owned agent');

    const [home, attentionItems, recapItems, revealHolds] = await Promise.all([
      getOwnerEmotionHome(agentId),
      prisma.ownerAttentionItem.findMany({
        where: { ownerAccountId: request.ownerAccount.id },
        orderBy: [{ unread: 'desc' }, { createdAt: 'desc' }],
        take: 8,
      }),
      prisma.ownerRecapItem.findMany({
        where: { ownerAccountId: request.ownerAccount.id },
        orderBy: [{ unread: 'desc' }, { createdAt: 'desc' }],
        take: 4,
      }),
      prisma.match.findMany({
        where: {
          OR: [{ agentAId: agentId }, { agentBId: agentId }],
          revealReviewRequired: true,
        },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: {
          id: true,
          revealSafetyState: true,
          revealHoldReason: true,
          status: true,
          updatedAt: true,
        },
      }),
    ]);
    if (!home) return Errors.notFound(reply, 'Owned agent');

    return reply.send({
      owner: {
        id: request.ownerAccount.id,
        email: request.ownerAccount.email,
        human_identity: request.ownerAccount.humanIdentity,
        looking_for: request.ownerAccount.lookingFor,
        instagram_handle: request.ownerAccount.instagramHandle,
        extra_socials: request.ownerAccount.extraSocials ?? null,
        x_account: request.ownerAccount.xHandle
          ? {
              handle: request.ownerAccount.xHandle,
              display_name: request.ownerAccount.xDisplayName,
              profile_image_url: request.ownerAccount.xProfileImageUrl,
            }
          : null,
      },
      attention_items: attentionItems.map((item) => ({
        attention_item_id: item.id,
        narrative_event_id: item.narrativeEventId,
        event_type: item.eventType,
        title: item.title,
        teaser: item.teaser,
        why_now: item.whyNow,
        delivery_tier: item.deliveryTier,
        delivery_status: item.deliveryStatus,
        delivered_channels: item.deliveredChannels,
        unread: item.unread,
        created_at: item.createdAt.toISOString(),
      })),
      recap_items: recapItems.map((item) => ({
        recap_item_id: item.id,
        recap_type: item.recapType,
        title: item.title,
        teaser: item.teaser,
        summary: item.summary,
        why_now: item.whyNow,
        unread: item.unread,
        delivered_channels: item.deliveredChannels,
        delivered_at: item.deliveredAt?.toISOString() ?? null,
        window_start_at: item.windowStartAt.toISOString(),
        window_end_at: item.windowEndAt.toISOString(),
        created_at: item.createdAt.toISOString(),
      })),
      reveal_holds: revealHolds.map((match) => ({
        match_id: match.id,
        reveal_safety_state: match.revealSafetyState,
        reveal_hold_reason: match.revealHoldReason,
        status: match.status,
        updated_at: match.updatedAt.toISOString(),
      })),
      ...home,
    });
  });

  fastify.get('/owner/episodes', { preHandler: requireOwnerAuth }, async (request, reply) => {
    const agentId = request.ownerAccount.agent?.id;
    if (!agentId) return Errors.notFound(reply, 'Owned agent');

    const query = request.query as { status?: string; limit?: string | number };
    const requestedStatus = query.status === 'active' || query.status === 'recent' || query.status === 'all'
      ? query.status
      : 'all';
    const parsedLimit = typeof query.limit === 'string' ? Number.parseInt(query.limit, 10) : Number(query.limit);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 24)
      : 12;
    const statusFilter =
      requestedStatus === 'active'
        ? OWNER_ACTIVE_EPISODE_STATUSES
        : requestedStatus === 'recent'
          ? OWNER_RECENT_EPISODE_STATUSES
          : undefined;
    const fetchLimit = statusFilter ? limit : Math.min(Math.max(limit * 3, 24), 72);

    const episodes = await prisma.episode.findMany({
      where: {
        OR: [{ agentAId: agentId }, { agentBId: agentId }],
        isSandbox: false,
        ...(statusFilter ? { status: { in: statusFilter } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: fetchLimit,
      select: {
        id: true,
        agentAId: true,
        agentBId: true,
        status: true,
        messageCount: true,
        chemistryScore: true,
        startedAt: true,
        createdAt: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
        artifacts: {
          select: { id: true },
        },
        match: {
          select: {
            revealStage: true,
            revealReviewRequired: true,
            revealHoldReason: true,
          },
        },
        agentA: {
          select: {
            id: true,
            handle: true,
            avatarUrl: true,
          },
        },
        agentB: {
          select: {
            id: true,
            handle: true,
            avatarUrl: true,
          },
        },
      },
    });

    const sortedEpisodes = [...episodes]
      .sort((a, b) => {
        const bucketDiff = getOwnerEpisodeBucketPriority(a.status) - getOwnerEpisodeBucketPriority(b.status);
        if (bucketDiff !== 0) return bucketDiff;
        return getEpisodeActivityTimestamp(b) - getEpisodeActivityTimestamp(a);
      })
      .slice(0, limit);

    return reply.send({
      episodes: sortedEpisodes.map((episode) => serializeOwnerEpisodeSummary(episode, agentId)),
    });
  });

  fastify.get('/owner/episodes/:id', { preHandler: requireOwnerAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const agentId = request.ownerAccount.agent?.id;
    if (!agentId) return Errors.notFound(reply, 'Owned agent');

    const episode = await prisma.episode.findUnique({
      where: { id },
      select: {
        id: true,
        isSandbox: true,
        agentAId: true,
        agentBId: true,
        status: true,
        messageCount: true,
        chemistryScore: true,
        startedAt: true,
        createdAt: true,
        messages: {
          orderBy: { sequenceNumber: 'asc' },
          select: {
            id: true,
            senderAgentId: true,
            content: true,
            messageType: true,
            sequenceNumber: true,
            createdAt: true,
            sender: {
              select: {
                handle: true,
                avatarUrl: true,
              },
            },
          },
        },
        artifacts: {
          orderBy: [{ droppedAtMessage: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            creatorAgentId: true,
            artifactType: true,
            status: true,
            contentUrl: true,
            textContent: true,
            qualityScore: true,
            droppedAtMessage: true,
            createdAt: true,
            creator: {
              select: {
                handle: true,
                avatarUrl: true,
              },
            },
          },
        },
        match: {
          select: {
            revealStage: true,
            revealReviewRequired: true,
            revealHoldReason: true,
          },
        },
        agentA: {
          select: {
            id: true,
            handle: true,
            avatarUrl: true,
            tierLabel: true,
            capabilityTier: true,
          },
        },
        agentB: {
          select: {
            id: true,
            handle: true,
            avatarUrl: true,
            tierLabel: true,
            capabilityTier: true,
          },
        },
      },
    });

    if (!episode || episode.isSandbox || (episode.agentAId !== agentId && episode.agentBId !== agentId)) {
      return Errors.notFound(reply, 'Episode');
    }

    const counterpart = episode.agentAId === agentId ? episode.agentB : episode.agentA;
    const lastMessageAt = episode.messages[episode.messages.length - 1]?.createdAt ?? null;

    return reply.send({
      episode_id: episode.id,
      status: episode.status,
      message_count: episode.messageCount,
      chemistry_score: episode.chemistryScore,
      started_at: episode.startedAt?.toISOString() ?? null,
      created_at: episode.createdAt.toISOString(),
      last_message_at: lastMessageAt?.toISOString() ?? null,
      artifact_count: episode.artifacts.length,
      reveal_stage: episode.match?.revealStage ?? null,
      review_required: episode.match?.revealReviewRequired ?? false,
      reveal_hold_reason: episode.match?.revealHoldReason ?? null,
      counterpart: {
        agent_id: counterpart.id,
        handle: counterpart.handle,
        avatar_url: counterpart.avatarUrl,
        tier_label: counterpart.tierLabel,
        capability_tier: counterpart.capabilityTier,
      },
      transcript: serializeOwnerTranscript(episode, agentId),
    });
  });

  fastify.post('/owner/attention/:id/read', { preHandler: requireOwnerAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const item = await prisma.ownerAttentionItem.findFirst({
      where: {
        id,
        ownerAccountId: request.ownerAccount.id,
      },
      select: { id: true },
    });
    if (!item) return Errors.notFound(reply, 'Owner attention item');

    await prisma.ownerAttentionItem.update({
      where: { id },
      data: {
        unread: false,
        readAt: new Date(),
      },
    });

    return reply.send({ attention_item_id: id, unread: false });
  });

  fastify.post('/owner/recaps/:id/read', { preHandler: requireOwnerAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const item = await prisma.ownerRecapItem.findFirst({
      where: {
        id,
        ownerAccountId: request.ownerAccount.id,
      },
      select: { id: true },
    });
    if (!item) return Errors.notFound(reply, 'Owner recap item');

    await prisma.ownerRecapItem.update({
      where: { id },
      data: {
        unread: false,
        readAt: new Date(),
      },
    });

    return reply.send({ recap_item_id: id, unread: false });
  });

  fastify.put('/owner/socials', { preHandler: requireOwnerAuth }, async (request, reply) => {
    const parsed = OwnerSocialsSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid owner socials payload.', { issues: parsed.error.issues });
    }

    const updated = await prisma.ownerAccount.update({
      where: { id: request.ownerAccount.id },
      data: {
        instagramHandle: parsed.data.instagram_handle,
        extraSocials: parsed.data.extra_socials,
      },
      select: {
        instagramHandle: true,
        extraSocials: true,
      },
    });

    return reply.send({
      instagram_handle: updated.instagramHandle,
      extra_socials: updated.extraSocials ?? null,
    });
  });

  fastify.post('/owner/handle', { preHandler: requireOwnerAuth }, async (request, reply) => {
    const parsed = OwnerRenameHandleSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid handle rename payload.', { issues: parsed.error.issues });
    }

    const agent = request.ownerAccount.agent;
    if (!agent) return Errors.notFound(reply, 'Owned agent');
    if (agent.handleChangeCount >= 1) {
      return Errors.conflict(reply, 'handle_rename_limit_reached', 'This agent has already used its one allowed rename.');
    }

    const available = await isHandleAvailable(parsed.data.handle, { excludeAgentId: agent.id });
    if (!available) {
      return Errors.conflict(reply, 'handle_unavailable', 'That username is not available.');
    }

    const updated = await prisma.agent.update({
      where: { id: agent.id },
      data: {
        handle: parsed.data.handle,
        handleChangeCount: { increment: 1 },
      },
      select: {
        id: true,
        handle: true,
        handleChangeCount: true,
      },
    });

    return reply.send({
      agent_id: updated.id,
      handle: updated.handle,
      handle_change_count: updated.handleChangeCount,
    });
  });

  fastify.post('/owner/api-key/regenerate', { preHandler: requireOwnerAuth }, async (request, reply) => {
    const agent = request.ownerAccount.agent;
    if (!agent) return Errors.notFound(reply, 'Owned agent');

    const apiKey = generateApiKey();
    await prisma.agent.update({
      where: { id: agent.id },
      data: {
        apiKeyHash: hashApiKey(apiKey),
      },
    });

    return reply.send({
      agent_id: agent.id,
      api_key: apiKey,
      message: 'API key regenerated. Previous key is no longer valid.',
    });
  });
}

function getOwnerEpisodeBucketPriority(status: string) {
  return OWNER_ACTIVE_EPISODE_STATUSES.includes(status) ? 0 : 1;
}

function getEpisodeActivityTimestamp(episode: {
  createdAt: Date;
  messages: Array<{ createdAt: Date }>;
}) {
  return episode.messages[0]?.createdAt.getTime() ?? episode.createdAt.getTime();
}

function serializeOwnerEpisodeSummary(
  episode: {
    id: string;
    agentAId: string;
    agentBId: string;
    status: string;
    messageCount: number;
    chemistryScore: number | null;
    startedAt: Date | null;
    createdAt: Date;
    messages: Array<{ createdAt: Date }>;
    artifacts: Array<{ id: string }>;
    match: {
      revealStage: number;
      revealReviewRequired: boolean;
      revealHoldReason: string | null;
    } | null;
    agentA: { id: string; handle: string; avatarUrl: string | null };
    agentB: { id: string; handle: string; avatarUrl: string | null };
  },
  ownerAgentId: string
) {
  const counterpart = episode.agentAId === ownerAgentId ? episode.agentB : episode.agentA;
  const lastMessageAt = episode.messages[0]?.createdAt ?? null;

  return {
    episode_id: episode.id,
    status: episode.status,
    counterpart: {
      agent_id: counterpart.id,
      handle: counterpart.handle,
      avatar_url: counterpart.avatarUrl,
    },
    message_count: episode.messageCount,
    chemistry_score: episode.chemistryScore,
    started_at: episode.startedAt?.toISOString() ?? null,
    last_message_at: lastMessageAt?.toISOString() ?? null,
    artifact_count: episode.artifacts.length,
    reveal_stage: episode.match?.revealStage ?? null,
    review_required: episode.match?.revealReviewRequired ?? false,
    reveal_hold_reason: episode.match?.revealHoldReason ?? null,
  };
}

function serializeOwnerTranscript(
  episode: {
    agentAId: string;
    agentBId: string;
    messages: Array<{
      id: string;
      senderAgentId: string;
      content: string;
      messageType: string;
      sequenceNumber: number;
      createdAt: Date;
      sender: {
        handle: string;
        avatarUrl: string | null;
      };
    }>;
    artifacts: Array<{
      id: string;
      creatorAgentId: string;
      artifactType: string;
      status: string;
      contentUrl: string | null;
      textContent: string | null;
      qualityScore: number | null;
      droppedAtMessage: number | null;
      createdAt: Date;
      creator: {
        handle: string;
        avatarUrl: string | null;
      };
    }>;
  },
  ownerAgentId: string
) {
  const artifactById = new Map(episode.artifacts.map((artifact) => [artifact.id, artifact]));
  const usedArtifactIds = new Set<string>();
  const entries: Array<Record<string, unknown>> = [];

  for (const message of episode.messages) {
    if (message.messageType === 'artifact_drop') {
      const artifactId = extractArtifactId(message.content);
      const artifact = artifactId ? artifactById.get(artifactId) : null;
      if (artifact) {
        usedArtifactIds.add(artifact.id);
        entries.push({
          entry_id: `artifact:${artifact.id}`,
          kind: 'artifact',
          artifact_id: artifact.id,
          sender_agent_id: artifact.creatorAgentId,
          sender_handle: artifact.creator.handle,
          sender_avatar_url: artifact.creator.avatarUrl,
          is_owner_agent: artifact.creatorAgentId === ownerAgentId,
          artifact_type: artifact.artifactType,
          status: artifact.status,
          text_content: artifact.textContent,
          content_url: artifact.contentUrl,
          quality_score: artifact.qualityScore,
          dropped_at_message: artifact.droppedAtMessage,
          sequence_number: message.sequenceNumber,
          created_at: artifact.createdAt.toISOString(),
        });
        continue;
      }
    }

    entries.push({
      entry_id: `message:${message.id}`,
      kind: 'message',
      message_id: message.id,
      sender_agent_id: message.senderAgentId,
      sender_handle: message.sender.handle,
      sender_avatar_url: message.sender.avatarUrl,
      is_owner_agent: message.senderAgentId === ownerAgentId,
      content: message.content,
      message_type: message.messageType,
      sequence_number: message.sequenceNumber,
      created_at: message.createdAt.toISOString(),
    });
  }

  const orphanedArtifacts = episode.artifacts
    .filter((artifact) => !usedArtifactIds.has(artifact.id))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  for (const artifact of orphanedArtifacts) {
    entries.push({
      entry_id: `artifact:${artifact.id}`,
      kind: 'artifact',
      artifact_id: artifact.id,
      sender_agent_id: artifact.creatorAgentId,
      sender_handle: artifact.creator.handle,
      sender_avatar_url: artifact.creator.avatarUrl,
      is_owner_agent: artifact.creatorAgentId === ownerAgentId,
      artifact_type: artifact.artifactType,
      status: artifact.status,
      text_content: artifact.textContent,
      content_url: artifact.contentUrl,
      quality_score: artifact.qualityScore,
      dropped_at_message: artifact.droppedAtMessage,
      sequence_number: null,
      created_at: artifact.createdAt.toISOString(),
    });
  }

  return entries;
}

function extractArtifactId(content: string) {
  const match = content.match(/^\[artifact:([^\]]+)\]$/);
  return match?.[1] ?? null;
}
