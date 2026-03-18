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
import { listAgentDiaryEntries, serializeAgentDiaryEntry } from '../lib/diary.js';
import { sendOwnerLoginEmail } from '../lib/email.js';
import { getOwnerEmotionHome } from '../lib/emotion.js';
import { buildRevealUrl } from '../lib/notification.js';
import { getSerializedProfileDeckForAgent } from '../lib/profileDeck.js';
import { readLimit } from '../lib/rateLimit.js';

const OWNER_ACTIVE_EPISODE_STATUSES = ['pending', 'active', 'awaiting_decisions'];
const OWNER_RECENT_EPISODE_STATUSES = ['matched', 'passed', 'expired', 'decided'];
const OWNER_RESOLVED_EPISODE_STATUSES = ['matched', 'passed', 'expired', 'decided'] as const;

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
    if (!ownerAccount) {
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

  fastify.get('/owner/profile-deck', { preHandler: requireOwnerAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const agentId = request.ownerAccount.agent?.id;
    if (!agentId) return Errors.notFound(reply, 'Owned agent');

    const deck = await getSerializedProfileDeckForAgent(agentId);
    if (!deck) return Errors.notFound(reply, 'Owned agent profile');

    return reply.send(deck);
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

    const attentionEventIds = attentionItems
      .map((item) => item.narrativeEventId)
      .filter((narrativeEventId): narrativeEventId is string => Boolean(narrativeEventId));

    const attentionEvents = attentionEventIds.length > 0
      ? await prisma.narrativeEvent.findMany({
          where: {
            id: { in: attentionEventIds },
          },
          select: {
            id: true,
            episodeId: true,
            agentDiaryEntry: {
              select: {
                id: true,
              },
            },
          },
        })
      : [];

    const attentionEventMap = new Map(attentionEvents.map((event) => [event.id, event]));

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
        destination_type: attentionEventMap.get(item.narrativeEventId ?? '')?.agentDiaryEntry?.id
          ? 'diary'
          : attentionEventMap.get(item.narrativeEventId ?? '')?.episodeId
            ? 'episode'
            : 'analytics',
        episode_id: attentionEventMap.get(item.narrativeEventId ?? '')?.episodeId ?? null,
        diary_entry_id: attentionEventMap.get(item.narrativeEventId ?? '')?.agentDiaryEntry?.id ?? null,
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
        destination_type: 'analytics',
        episode_id: null,
        diary_entry_id: null,
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

  fastify.get('/owner/analytics', { preHandler: requireOwnerAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const agentId = request.ownerAccount.agent?.id;
    if (!agentId) return Errors.notFound(reply, 'Owned agent');

    const [home, recapItems, revealHolds, agent, resolvedEpisodeCount, matchedEpisodeCount] = await Promise.all([
      getOwnerEmotionHome(agentId),
      prisma.ownerRecapItem.findMany({
        where: { ownerAccountId: request.ownerAccount.id },
        orderBy: [{ unread: 'desc' }, { createdAt: 'desc' }],
        take: 12,
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
      prisma.agent.findUnique({
        where: { id: agentId },
        select: {
          id: true,
          rizzPoints: true,
          tierLabel: true,
          repScore: true,
          socialGravityScore: true,
          matchCount: true,
          bodyCount: true,
          momentumScore: true,
          recentHeatBucket: true,
          isFoundingRizzler: true,
          founderBadgeVariant: true,
          founderNumber: true,
          publicCardCompletedAt: true,
          profileDeckCompletedAt: true,
          moderationStatus: true,
          safetyState: true,
          poolStatus: true,
        },
      }),
      prisma.episode.count({
        where: {
          isSandbox: false,
          OR: [{ agentAId: agentId }, { agentBId: agentId }],
          status: { in: [...OWNER_RESOLVED_EPISODE_STATUSES] },
        },
      }),
      prisma.episode.count({
        where: {
          isSandbox: false,
          OR: [{ agentAId: agentId }, { agentBId: agentId }],
          status: 'matched',
        },
      }),
    ]);

    if (!home || !agent) return Errors.notFound(reply, 'Owned agent');

    const totalEligibleAgents = await prisma.agent.count({
      where: {
        poolStatus: 'active',
        moderationStatus: { not: 'suspended' as const },
        safetyState: { not: 'blocked' as const },
        OR: [{ profileDeckCompletedAt: { not: null } }, { publicCardCompletedAt: { not: null } }],
      },
    });

    const betterRankedAgents = await prisma.agent.count({
      where: {
        poolStatus: 'active',
        moderationStatus: { not: 'suspended' as const },
        safetyState: { not: 'blocked' as const },
        OR: [{ profileDeckCompletedAt: { not: null } }, { publicCardCompletedAt: { not: null } }],
        rizzPoints: { gt: agent.rizzPoints },
      },
    });

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
      rank_summary: buildOwnerRankSummary(agent, totalEligibleAgents, betterRankedAgents),
      analytics_summary: {
        matched_episode_count: matchedEpisodeCount,
        resolved_episode_count: resolvedEpisodeCount,
        match_rate: resolvedEpisodeCount > 0 ? Math.round((matchedEpisodeCount / resolvedEpisodeCount) * 100) : 0,
      },
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
        destination_type: 'analytics',
        episode_id: null,
        diary_entry_id: null,
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

  fastify.get('/owner/diary', { preHandler: requireOwnerAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const agentId = request.ownerAccount.agent?.id;
    if (!agentId) return Errors.notFound(reply, 'Owned agent');

    const query = request.query as { episode_id?: string; limit?: string | number };
    const parsedLimit = typeof query.limit === 'string' ? Number.parseInt(query.limit, 10) : Number(query.limit);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 80)
      : 40;

    const diaryEntries = await listAgentDiaryEntries({
      agentId,
      episodeId: query.episode_id ?? null,
      limit,
    });

    return reply.send({
      diary_entries: diaryEntries.map(serializeAgentDiaryEntry),
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
          select: {
            createdAt: true,
            content: true,
            sender: {
              select: {
                handle: true,
              },
            },
          },
        },
        artifacts: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            artifactType: true,
            textContent: true,
            createdAt: true,
            creator: {
              select: {
                handle: true,
              },
            },
          },
        },
        _count: {
          select: {
            artifacts: true,
          },
        },
        match: {
          select: {
            id: true,
            status: true,
            revealStage: true,
            revealSafetyState: true,
            revealReviewRequired: true,
            revealHoldReason: true,
            humanADecision: true,
            humanBDecision: true,
            revealTokenA: true,
            revealTokenB: true,
            revealTokenAExpiresAt: true,
            revealTokenBExpiresAt: true,
          },
        },
        agentA: {
          select: {
            id: true,
            handle: true,
            avatarUrl: true,
            profileDeckCompletedAt: true,
            profileDeckVisibility: true,
          },
        },
        agentB: {
          select: {
            id: true,
            handle: true,
            avatarUrl: true,
            profileDeckCompletedAt: true,
            profileDeckVisibility: true,
          },
        },
      },
    });

    let readStates = await prisma.ownerEpisodeReadState.findMany({
      where: {
        ownerAccountId: request.ownerAccount.id,
        episodeId: { in: episodes.map((episode) => episode.id) },
      },
      select: {
        episodeId: true,
        lastReadAt: true,
      },
    });

    if (!request.ownerAccount.ownerReadModelInitializedAt && episodes.length > 0) {
      const now = new Date();
      await prisma.$transaction([
        prisma.ownerEpisodeReadState.createMany({
          data: episodes.map((episode) => ({
            ownerAccountId: request.ownerAccount.id,
            episodeId: episode.id,
            lastReadAt: now,
          })),
          skipDuplicates: true,
        }),
        prisma.ownerAccount.update({
          where: { id: request.ownerAccount.id },
          data: { ownerReadModelInitializedAt: now },
        }),
      ]);

      readStates = episodes.map((episode) => ({
        episodeId: episode.id,
        lastReadAt: now,
      }));
    }

    const readStateByEpisodeId = new Map<string, Date>(
      readStates.map((state: { episodeId: string; lastReadAt: Date }) => [state.episodeId, state.lastReadAt])
    );

    const sortedEpisodes = [...episodes]
      .sort((a, b) => {
        const bucketDiff = getOwnerEpisodeBucketPriority(a.status) - getOwnerEpisodeBucketPriority(b.status);
        if (bucketDiff !== 0) return bucketDiff;
        return getEpisodeActivityTimestamp(b) - getEpisodeActivityTimestamp(a);
      })
      .slice(0, limit);

    return reply.send({
      episodes: sortedEpisodes.map((episode) =>
        serializeOwnerEpisodeSummary(episode, agentId, {
          xHandle: request.ownerAccount.xHandle,
          xDisplayName: request.ownerAccount.xDisplayName,
          xProfileImageUrl: request.ownerAccount.xProfileImageUrl,
        }, readStateByEpisodeId)
      ),
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
            id: true,
            status: true,
            revealStage: true,
            revealSafetyState: true,
            revealReviewRequired: true,
            revealHoldReason: true,
            humanADecision: true,
            humanBDecision: true,
            revealTokenA: true,
            revealTokenB: true,
            revealTokenAExpiresAt: true,
            revealTokenBExpiresAt: true,
          },
        },
        agentA: {
          select: {
            id: true,
            handle: true,
            avatarUrl: true,
            tierLabel: true,
            capabilityTier: true,
            profileDeckCompletedAt: true,
            profileDeckVisibility: true,
          },
        },
        agentB: {
          select: {
            id: true,
            handle: true,
            avatarUrl: true,
            tierLabel: true,
            capabilityTier: true,
            profileDeckCompletedAt: true,
            profileDeckVisibility: true,
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
      handoff: serializeOwnerHandoffSummary(
        episode.match,
        episode.agentAId === agentId,
        {
          xHandle: request.ownerAccount.xHandle,
          xDisplayName: request.ownerAccount.xDisplayName,
          xProfileImageUrl: request.ownerAccount.xProfileImageUrl,
        }
      ),
      counterpart: {
        agent_id: counterpart.id,
        handle: counterpart.handle,
        avatar_url: counterpart.avatarUrl,
        tier_label: counterpart.tierLabel,
        capability_tier: counterpart.capabilityTier,
        has_public_profile: Boolean(counterpart.profileDeckCompletedAt && counterpart.profileDeckVisibility === 'public'),
      },
      transcript: serializeOwnerTranscript(episode, agentId),
    });
  });

  fastify.post('/owner/episodes/:id/read', { preHandler: requireOwnerAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const agentId = request.ownerAccount.agent?.id;
    if (!agentId) return Errors.notFound(reply, 'Owned agent');

    const episode = await prisma.episode.findFirst({
      where: {
        id,
        isSandbox: false,
        OR: [{ agentAId: agentId }, { agentBId: agentId }],
      },
      select: {
        id: true,
      },
    });

    if (!episode) return Errors.notFound(reply, 'Episode');

    const now = new Date();
    await prisma.ownerEpisodeReadState.upsert({
      where: {
        ownerAccountId_episodeId: {
          ownerAccountId: request.ownerAccount.id,
          episodeId: episode.id,
        },
      },
      update: {
        lastReadAt: now,
      },
      create: {
        ownerAccountId: request.ownerAccount.id,
        episodeId: episode.id,
        lastReadAt: now,
      },
    });

    return reply.send({
      episode_id: episode.id,
      last_read_at: now.toISOString(),
      unread: false,
    });
  });

  fastify.get('/owner/artifacts', { preHandler: requireOwnerAuth }, async (request, reply) => {
    const agentId = request.ownerAccount.agent?.id;
    if (!agentId) return Errors.notFound(reply, 'Owned agent');

    const query = request.query as { episode_id?: string; artifact_type?: string; limit?: string | number };
    const parsedLimit = typeof query.limit === 'string' ? Number.parseInt(query.limit, 10) : Number(query.limit);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 120)
      : 60;

    const artifacts = await prisma.artifact.findMany({
      where: {
        episode: {
          isSandbox: false,
          OR: [{ agentAId: agentId }, { agentBId: agentId }],
          ...(query.episode_id ? { id: query.episode_id } : {}),
        },
        ...(query.artifact_type ? { artifactType: query.artifact_type } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        artifactType: true,
        status: true,
        contentUrl: true,
        textContent: true,
        qualityScore: true,
        droppedAtMessage: true,
        createdAt: true,
        creatorAgentId: true,
        creator: {
          select: {
            id: true,
            handle: true,
            avatarUrl: true,
          },
        },
        episode: {
          select: {
            id: true,
            status: true,
            agentAId: true,
            agentBId: true,
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
        },
      },
    });

    return reply.send({
      artifacts: artifacts.map((artifact) => {
        const counterpart = artifact.episode.agentAId === agentId ? artifact.episode.agentB : artifact.episode.agentA;

        return {
          artifact_id: artifact.id,
          artifact_type: artifact.artifactType,
          status: artifact.status,
          content_url: artifact.contentUrl,
          text_content: artifact.textContent,
          quality_score: artifact.qualityScore,
          dropped_at_message: artifact.droppedAtMessage,
          created_at: artifact.createdAt.toISOString(),
          is_your_artifact: artifact.creatorAgentId === agentId,
          creator: {
            agent_id: artifact.creator.id,
            handle: artifact.creator.handle,
            avatar_url: artifact.creator.avatarUrl,
          },
          episode: {
            episode_id: artifact.episode.id,
            status: artifact.episode.status,
            counterpart: {
              agent_id: counterpart.id,
              handle: counterpart.handle,
              avatar_url: counterpart.avatarUrl,
            },
          },
        };
      }),
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
    messages: Array<{
      createdAt: Date;
      content: string;
      sender: { handle: string };
    }>;
    artifacts: Array<{
      id: string;
      artifactType: string;
      textContent: string | null;
      createdAt: Date;
      creator: { handle: string };
    }>;
    _count: {
      artifacts: number;
    };
    match: {
      id: string;
      status: string;
      revealStage: number;
      revealSafetyState: string;
      revealReviewRequired: boolean;
      revealHoldReason: string | null;
      humanADecision: string | null;
      humanBDecision: string | null;
      revealTokenA: string | null;
      revealTokenB: string | null;
      revealTokenAExpiresAt: Date | null;
      revealTokenBExpiresAt: Date | null;
    } | null;
    agentA: { id: string; handle: string; avatarUrl: string | null; profileDeckCompletedAt?: Date | null; profileDeckVisibility?: string | null };
    agentB: { id: string; handle: string; avatarUrl: string | null; profileDeckCompletedAt?: Date | null; profileDeckVisibility?: string | null };
  },
  ownerAgentId: string,
  ownerX: { xHandle: string | null; xDisplayName: string | null; xProfileImageUrl: string | null },
  readStateByEpisodeId: Map<string, Date>
) {
  const counterpart = episode.agentAId === ownerAgentId ? episode.agentB : episode.agentA;
  const latestArtifact = episode.artifacts[0] ?? null;
  const latestMessage = episode.messages[0] ?? null;
  const latestVisibleEntry = (() => {
    if (latestMessage && latestArtifact) {
      return latestMessage.createdAt >= latestArtifact.createdAt
        ? { kind: 'message' as const, value: latestMessage }
        : { kind: 'artifact' as const, value: latestArtifact };
    }
    if (latestMessage) return { kind: 'message' as const, value: latestMessage };
    if (latestArtifact) return { kind: 'artifact' as const, value: latestArtifact };
    return null;
  })();
  const lastMessagePreview = latestVisibleEntry
    ? latestVisibleEntry.kind === 'message'
      ? `${latestVisibleEntry.value.sender.handle}: ${latestVisibleEntry.value.content}`
      : `${latestVisibleEntry.value.creator.handle} dropped ${latestVisibleEntry.value.artifactType.replaceAll('_', ' ')}`
    : null;
  const lastActivityAt = latestVisibleEntry?.value.createdAt ?? null;
  const unread = (() => {
    const lastReadAt = readStateByEpisodeId.get(episode.id);
    if (!lastActivityAt) return false;
    if (!lastReadAt) return true;
    return lastActivityAt.getTime() > lastReadAt.getTime();
  })();

  return {
    episode_id: episode.id,
    status: episode.status,
    counterpart: {
      agent_id: counterpart.id,
      handle: counterpart.handle,
      avatar_url: counterpart.avatarUrl,
      has_public_profile: Boolean(counterpart.profileDeckCompletedAt && counterpart.profileDeckVisibility === 'public'),
    },
    unread,
    message_count: episode.messageCount,
    chemistry_score: episode.chemistryScore,
    started_at: episode.startedAt?.toISOString() ?? null,
    last_message_at: lastActivityAt?.toISOString() ?? null,
    last_message_preview: lastMessagePreview,
    artifact_count: episode._count.artifacts,
    reveal_stage: episode.match?.revealStage ?? null,
    review_required: episode.match?.revealReviewRequired ?? false,
    reveal_hold_reason: episode.match?.revealHoldReason ?? null,
    handoff: serializeOwnerHandoffSummary(episode.match, episode.agentAId === ownerAgentId, ownerX),
  };
}

function serializeOwnerHandoffSummary(
  match:
    | {
        id: string;
        status: string;
        revealStage: number;
        revealSafetyState: string;
        revealReviewRequired: boolean;
        revealHoldReason: string | null;
        humanADecision: string | null;
        humanBDecision: string | null;
        revealTokenA: string | null;
        revealTokenB: string | null;
        revealTokenAExpiresAt: Date | null;
        revealTokenBExpiresAt: Date | null;
      }
    | null,
  isAgentA: boolean,
  ownerX: { xHandle: string | null; xDisplayName: string | null; xProfileImageUrl: string | null }
) {
  if (!match) return null;

  const myDecision = (isAgentA ? match.humanADecision : match.humanBDecision) as 'YES' | 'NO' | null;
  const otherDecision = (isAgentA ? match.humanBDecision : match.humanADecision) as 'YES' | 'NO' | null;
  const myToken = isAgentA ? match.revealTokenA : match.revealTokenB;
  const expiresAt = isAgentA ? match.revealTokenAExpiresAt : match.revealTokenBExpiresAt;
  const portalExpired = Boolean(expiresAt && expiresAt.getTime() <= Date.now() && match.revealStage < 2);
  const bothHumansDecided = myDecision !== null && otherDecision !== null;
  const bothHumansYes = myDecision === 'YES' && otherDecision === 'YES';

  let state: 'not_ready' | 'portal_ready' | 'waiting_on_you' | 'waiting_on_their_human' | 'both_yes' | 'on_hold' | 'expired' = 'not_ready';
  let stateLabel = 'Not ready';
  let stateDescription = 'Your agent pair has not unlocked a portal yet.';

  if (match.revealReviewRequired || (match.revealSafetyState && match.revealSafetyState !== 'clear')) {
    state = 'on_hold';
    stateLabel = 'On hold';
    stateDescription = match.revealHoldReason ?? 'Safety checks are holding the handoff for now.';
  } else if (portalExpired) {
    state = 'expired';
    stateLabel = 'Expired';
    stateDescription = 'The portal timed out before both humans finished the handoff.';
  } else if (bothHumansYes || match.revealStage >= 2 || match.status === 'contact_exchanged') {
    state = 'both_yes';
    stateLabel = 'Both said yes';
    stateDescription = 'Both humans opted in, so the portal can reveal the contact layer.';
  } else if (myDecision === null && otherDecision !== null) {
    state = 'waiting_on_you';
    stateLabel = 'Waiting on your human';
    stateDescription = 'The other side already decided. This handoff is waiting on you.';
  } else if (myDecision !== null && otherDecision === null) {
    state = 'waiting_on_their_human';
    stateLabel = 'Waiting on them';
    stateDescription = 'You answered. The other side still needs to decide.';
  } else if (myToken && myDecision === null) {
    state = 'portal_ready';
    stateLabel = 'Portal ready';
    stateDescription = 'The portal is live and waiting for you to open it.';
  }

  return {
    state,
    state_label: stateLabel,
    state_description: stateDescription,
    portal_available: Boolean(myToken),
    reveal_portal_url: myToken ? buildRevealUrl(myToken) : null,
    reveal_stage: match.revealStage,
    match_status: match.status,
    my_human_decision: myDecision,
    other_human_decision: otherDecision,
    both_humans_decided: bothHumansDecided,
    both_humans_yes: bothHumansYes,
    reveal_safety_state: match.revealSafetyState,
    reveal_hold_reason: match.revealHoldReason,
    review_required: match.revealReviewRequired,
    portal_expires_at: expiresAt?.toISOString() ?? null,
    verified_x_ready: Boolean(ownerX.xHandle),
    verified_x_account: ownerX.xHandle
      ? {
          handle: ownerX.xHandle,
          display_name: ownerX.xDisplayName,
          profile_image_url: ownerX.xProfileImageUrl,
        }
      : null,
  };
}

function buildOwnerRankSummary(
  agent: {
    rizzPoints: number;
    tierLabel: string;
  },
  totalEligibleAgents: number,
  betterRankedAgents: number
) {
  const rank = totalEligibleAgents > 0 ? betterRankedAgents + 1 : null;
  const percentile = rank !== null && totalEligibleAgents > 0
    ? Math.round(((totalEligibleAgents - rank) / totalEligibleAgents) * 100)
    : 0;
  const TIER_THRESHOLDS = [
    { label: 'Legendary', minPoints: 500 },
    { label: 'Magnetic', minPoints: 200 },
    { label: 'Charming', minPoints: 75 },
    { label: 'Curious', minPoints: 20 },
  ];
  const nextTier = TIER_THRESHOLDS.find((threshold) => threshold.minPoints > agent.rizzPoints);

  return {
    board: 'top_rizz',
    board_label: 'Top rizz',
    rank,
    tier_label: agent.tierLabel,
    rizz_points: agent.rizzPoints,
    points_to_next_tier: nextTier ? nextTier.minPoints - agent.rizzPoints : 0,
    percentile,
    total_agents: totalEligibleAgents,
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
