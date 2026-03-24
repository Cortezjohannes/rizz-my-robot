import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { z } from 'zod';
import {
  OwnerAuthRequestSchema,
  OwnerAuthVerifySchema,
  OwnerPreferencesSchema,
  OwnerRenameHandleSchema,
  OwnerSocialsSchema,
  normalizeArtifactType,
} from '@rmr/shared';
import { requireOwnerAuth } from '../middleware/requireOwnerAuth.js';
import { Errors, sendError } from '../lib/errors.js';
import { emailCodeExpiryDate, expireStaleClaims, isHandleAvailable, ownerSessionExpiryDate } from '../lib/claims.js';
import { extractBearerToken } from '../lib/auth.js';
import { createAgentApiKeyRotationRecap, rotateAgentApiKey } from '../lib/agentApiKeys.js';
import { repairHistoricalHandleReferences } from '../lib/handleRepair.js';
import { generateOwnerSessionToken, generateShortCode, hashOpaqueSecret } from '../lib/claimAuth.js';
import { listAgentDiaryEntries, serializeAgentDiaryEntry } from '../lib/diary.js';
import { sendOwnerLoginEmail } from '../lib/email.js';
import { getOwnerEmotionHome } from '../lib/emotion.js';
import { buildRevealUrl } from '../lib/notification.js';
import {
  buildOwnerXIntegrationUrl,
  generateOwnerXIntegrationToken,
  hashOwnerXIntegrationToken,
  verifyOwnerXIntegrationToken,
} from '../lib/ownerXIntegration.js';
import { buildPublicPoolPreviewFromDeck, getSerializedProfileDeckForAgent } from '../lib/profileDeck.js';
import { publicEmailLimit, publicVerifyLimit, readLimit } from '../lib/rateLimit.js';
import { normalizeHandle } from '../lib/handles.js';
import { buildOwnerXAuthorizationUrl, hasXOAuthConfig, verifyXOAuthIdentity } from '../lib/twitterVerification.js';
import { generateOAuthNonce, generatePkceVerifier } from '../lib/twitterVerification.js';
import { verifyXOAuthState } from '../lib/claimAuth.js';
import { buildRankPayload, getLeaderboardEntries } from './leaderboard.js';

const OWNER_ACTIVE_EPISODE_STATUSES = ['pending', 'active', 'awaiting_decisions'];
const OWNER_RECENT_EPISODE_STATUSES = ['matched', 'passed', 'expired', 'decided'];
const OWNER_RESOLVED_EPISODE_STATUSES = ['matched', 'passed', 'expired', 'decided'] as const;
const OWNER_TASTE_FALLBACK_SUMMARY = 'This is who your agent has been drawn to, passed on, and matched with.';
const OwnerSupportTicketCreateSchema = z.object({
  kind: z.enum(['bug_report', 'feature_request']),
  title: z.string().trim().min(4).max(120),
  description: z.string().trim().min(12).max(4000),
  page_url: z.string().trim().max(500).optional().nullable(),
});

function canonicalArtifactType(artifactType: string | null | undefined) {
  const normalized = normalizeArtifactType(artifactType);
  if (normalized) return normalized;
  const trimmed = artifactType?.trim();
  return trimmed ? trimmed : null;
}

function serializeLinkedXAccount(input: {
  xHandle: string | null;
  xDisplayName: string | null;
  xProfileImageUrl: string | null;
}) {
  if (!input.xHandle) return null;
  return {
    handle: input.xHandle,
    display_name: input.xDisplayName,
    profile_image_url: input.xProfileImageUrl,
  };
}

export async function ownerRoutes(fastify: FastifyInstance) {
  fastify.get('/owner/x-link/:token', { config: { rateLimit: readLimit } }, async (request, reply) => {
    const { token } = request.params as { token: string };
    const linkId = verifyOwnerXIntegrationToken(token);
    if (!linkId) {
      return sendError(reply, 401, 'invalid_owner_x_link', 'That X integration link is invalid.');
    }

    const link = await prisma.ownerXIntegrationLink.findUnique({
      where: { id: linkId },
      include: {
        agent: { select: { id: true, handle: true } },
        ownerAccount: {
          select: {
            xHandle: true,
            xDisplayName: true,
            xProfileImageUrl: true,
            xVerifiedAt: true,
          },
        },
      },
    });
    if (!link || hashOwnerXIntegrationToken(token) !== link.tokenHash) {
      return sendError(reply, 401, 'invalid_owner_x_link', 'That X integration link is invalid.');
    }
    if (link.expiresAt < new Date()) {
      return sendError(reply, 410, 'owner_x_link_expired', 'That X integration link expired. Ask the agent for a new one.');
    }

    return reply.send({
      status: link.completedAt || link.ownerAccount.xVerifiedAt ? 'linked' : 'ready',
      expires_at: link.expiresAt.toISOString(),
      x_oauth_available: hasXOAuthConfig(),
      agent: {
        agent_id: link.agent.id,
        handle: link.agent.handle,
      },
      linked_x_account: serializeLinkedXAccount(link.ownerAccount),
      start_url: `/v1/owner/x-link/${token}/start`,
    });
  });

  fastify.post('/owner/x-link/:token/start', { config: { rateLimit: publicVerifyLimit } }, async (request, reply) => {
    const { token } = request.params as { token: string };
    const linkId = verifyOwnerXIntegrationToken(token);
    if (!linkId) {
      return sendError(reply, 401, 'invalid_owner_x_link', 'That X integration link is invalid.');
    }
    if (!hasXOAuthConfig()) {
      return sendError(reply, 503, 'x_oauth_unavailable', 'X OAuth is not configured.');
    }

    const link = await prisma.ownerXIntegrationLink.findUnique({
      where: { id: linkId },
      include: {
        ownerAccount: {
          select: {
            xHandle: true,
            xDisplayName: true,
            xProfileImageUrl: true,
            xVerifiedAt: true,
          },
        },
      },
    });
    if (!link || hashOwnerXIntegrationToken(token) !== link.tokenHash) {
      return sendError(reply, 401, 'invalid_owner_x_link', 'That X integration link is invalid.');
    }
    if (link.expiresAt < new Date()) {
      return sendError(reply, 410, 'owner_x_link_expired', 'That X integration link expired. Ask the agent for a new one.');
    }
    if (link.ownerAccount.xVerifiedAt && link.ownerAccount.xHandle) {
      return reply.send({
        status: 'linked',
        linked_x_account: serializeLinkedXAccount(link.ownerAccount),
      });
    }

    const codeVerifier = generatePkceVerifier();
    const nonce = generateOAuthNonce();
    await prisma.ownerXIntegrationLink.update({
      where: { id: link.id },
      data: {
        xOauthCodeVerifier: codeVerifier,
        xOauthNonce: nonce,
      },
    });

    return reply.send({
      status: 'oauth_started',
      authorization_url: buildOwnerXAuthorizationUrl({
        ownerXLinkId: link.id,
        nonce,
        codeVerifier,
      }),
    });
  });

  fastify.get('/owner/x-link/callback', async (request, reply) => {
    const query = request.query as {
      state?: string;
      code?: string;
      error?: string;
      error_description?: string;
    };

    if (!query.state) {
      return reply.status(400).type('text/plain').send('Missing X OAuth state.');
    }

    const state = verifyXOAuthState(query.state);
    if (!state?.ownerXLinkId) {
      return reply.status(400).type('text/plain').send('Invalid X OAuth state.');
    }

    const link = await prisma.ownerXIntegrationLink.findUnique({
      where: { id: state.ownerXLinkId },
      include: {
        ownerAccount: true,
      },
    });
    if (!link) {
      return reply.status(404).type('text/plain').send('X integration link not found.');
    }

    const integrationUrl = buildOwnerXIntegrationUrl(generateOwnerXIntegrationToken(link.id));

    if (!link.xOauthNonce || link.xOauthNonce !== state.nonce) {
      const url = new URL(integrationUrl);
      url.searchParams.set('x_status', 'error');
      url.searchParams.set('x_error', 'This X verification session is no longer valid. Start again.');
      return reply.redirect(url.toString());
    }

    if (query.error) {
      await prisma.ownerXIntegrationLink.update({
        where: { id: link.id },
        data: {
          xOauthCodeVerifier: null,
          xOauthNonce: null,
        },
      }).catch(() => null);

      const url = new URL(integrationUrl);
      url.searchParams.set('x_status', 'error');
      url.searchParams.set('x_error', (query.error_description ?? `X login failed: ${query.error}`).slice(0, 200));
      return reply.redirect(url.toString());
    }

    if (!query.code || !link.xOauthCodeVerifier) {
      const url = new URL(integrationUrl);
      url.searchParams.set('x_status', 'error');
      url.searchParams.set('x_error', 'X verification could not continue.');
      return reply.redirect(url.toString());
    }

    const verified = await verifyXOAuthIdentity({
      oauthCode: query.code,
      codeVerifier: link.xOauthCodeVerifier,
    });
    if (!verified) {
      await prisma.ownerXIntegrationLink.update({
        where: { id: link.id },
        data: {
          xOauthCodeVerifier: null,
          xOauthNonce: null,
        },
      }).catch(() => null);

      const url = new URL(integrationUrl);
      url.searchParams.set('x_status', 'error');
      url.searchParams.set('x_error', 'Failed to verify the authenticated X account.');
      return reply.redirect(url.toString());
    }

    const conflictingOwner = await prisma.ownerAccount.findFirst({
      where: {
        id: { not: link.ownerAccountId },
        xUserId: verified.user_id,
      },
      select: { id: true },
    });
    if (conflictingOwner) {
      const url = new URL(integrationUrl);
      url.searchParams.set('x_status', 'error');
      url.searchParams.set('x_error', 'That X account is already linked to another agent owner.');
      return reply.redirect(url.toString());
    }

    await prisma.$transaction([
      prisma.ownerAccount.update({
        where: { id: link.ownerAccountId },
        data: {
          xUserId: verified.user_id,
          xHandle: verified.handle,
          xDisplayName: verified.display_name,
          xProfileImageUrl: verified.profile_image_url,
          xVerifiedAt: new Date(),
        },
      }),
      prisma.ownerXIntegrationLink.update({
        where: { id: link.id },
        data: {
          completedAt: new Date(),
          xOauthCodeVerifier: null,
          xOauthNonce: null,
        },
      }),
    ]);

    const url = new URL(integrationUrl);
    url.searchParams.set('x_status', 'verified');
    return reply.redirect(url.toString());
  });

  fastify.post('/owner/auth/request', { config: { rateLimit: publicEmailLimit } }, async (request, reply) => {
    const parsed = OwnerAuthRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid owner auth request.', { issues: parsed.error.issues });
    }

    await expireStaleClaims();
    const expiresAt = emailCodeExpiryDate();

    const ownerAccount = await prisma.ownerAccount.findUnique({
      where: { email: parsed.data.email },
      include: {
        agent: { select: { id: true } },
      },
    });
    if (!ownerAccount) {
      return reply.send({
        status: 'code_sent',
        delivery: { mode: 'provider' },
        expires_at: expiresAt.toISOString(),
      });
    }

    const code = generateShortCode();
    const codeHash = hashOpaqueSecret(code);
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

  fastify.post('/owner/auth/verify', { config: { rateLimit: publicVerifyLimit } }, async (request, reply) => {
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

  fastify.post('/owner/agent/rotate-key', { preHandler: requireOwnerAuth, config: { rateLimit: publicVerifyLimit } }, async (request, reply) => {
    const agentId = request.ownerAccount.agent?.id;
    if (!agentId) return Errors.notFound(reply, 'Owned agent');
    const { apiKey, graceEndsAt } = await rotateAgentApiKey(agentId);
    await createAgentApiKeyRotationRecap(agentId, graceEndsAt).catch(() => {});

    return reply.send({
      new_key: apiKey,
      api_key: apiKey,
      old_key_expires_at: graceEndsAt.toISOString(),
      previous_key_grace_ends_at: graceEndsAt.toISOString(),
      message: 'API key rotated. Your previous key will keep working briefly while your runtime updates.',
    });
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

  fastify.get('/owner/support-tickets', { preHandler: requireOwnerAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const agentId = request.ownerAccount.agent?.id;
    if (!agentId) return Errors.notFound(reply, 'Owned agent');

    const logs = await prisma.auditLog.findMany({
      where: {
        agentId,
        targetType: 'support_ticket',
        action: { in: ['owner.support_ticket_created', 'control.support_ticket_reviewed'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const ticketMap = new Map<string, {
      ticket_id: string;
      kind: string;
      title: string;
      description: string;
      page_url: string | null;
      status: string;
      omnimon_summary: string | null;
      omnimon_action: string | null;
      reviewed_at: string | null;
      reported_to_owner_at: string | null;
      created_at: string;
      updated_at: string;
    }>();

    for (const log of logs.slice().reverse()) {
      const payload = (log.payload as Record<string, unknown> | null) ?? {};
      if (log.action === 'owner.support_ticket_created') {
        ticketMap.set(log.targetId, {
          ticket_id: log.targetId,
          kind: typeof payload.kind === 'string' ? payload.kind : 'bug_report',
          title: typeof payload.title === 'string' ? payload.title : 'Untitled ticket',
          description: typeof payload.description === 'string' ? payload.description : '',
          page_url: typeof payload.page_url === 'string' ? payload.page_url : null,
          status: 'submitted',
          omnimon_summary: null,
          omnimon_action: null,
          reviewed_at: null,
          reported_to_owner_at: null,
          created_at: log.createdAt.toISOString(),
          updated_at: log.createdAt.toISOString(),
        });
      }
      if (log.action === 'control.support_ticket_reviewed') {
        const existing = ticketMap.get(log.targetId);
        if (!existing) continue;
        existing.status = typeof payload.status === 'string' ? payload.status : existing.status;
        existing.omnimon_summary = typeof payload.summary === 'string' ? payload.summary : null;
        existing.omnimon_action = typeof payload.action === 'string' ? payload.action : null;
        existing.reviewed_at = log.createdAt.toISOString();
        existing.reported_to_owner_at = log.createdAt.toISOString();
        existing.updated_at = log.createdAt.toISOString();
      }
    }

    return reply.send({
      tickets: [...ticketMap.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 50),
    });
  });

  fastify.post('/owner/support-tickets', { preHandler: requireOwnerAuth, config: { rateLimit: publicVerifyLimit } }, async (request, reply) => {
    const agentId = request.ownerAccount.agent?.id;
    if (!agentId) return Errors.notFound(reply, 'Owned agent');

    const parsed = OwnerSupportTicketCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid support ticket payload.', { issues: parsed.error.issues });
    }

    const ticketId = randomUUID();
    await prisma.auditLog.create({
      data: {
        agentId,
        actorType: 'owner',
        actorId: request.ownerAccount.id,
        action: 'owner.support_ticket_created',
        targetType: 'support_ticket',
        targetId: ticketId,
        payload: {
          kind: parsed.data.kind,
          title: parsed.data.title,
          description: parsed.data.description,
          page_url: parsed.data.page_url?.trim() || null,
        },
      },
    }).catch(() => {});

    return reply.status(201).send({
      ticket_id: ticketId,
      kind: parsed.data.kind,
      title: parsed.data.title,
      status: 'submitted',
      created_at: new Date().toISOString(),
      message: 'Ticket received. Omnimon will triage it and report back to you here.',
    });
  });

  fastify.get('/owner/profile-deck', { preHandler: requireOwnerAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const agentId = request.ownerAccount.agent?.id;
    if (!agentId) return Errors.notFound(reply, 'Owned agent');

    const deck = await getSerializedProfileDeckForAgent(agentId);
    if (!deck) return Errors.notFound(reply, 'Owned agent profile');

    return reply.send(deck);
  });

  fastify.get('/owner/taste/agents/:agent_id/profile-deck', { preHandler: requireOwnerAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const ownerAgentId = request.ownerAccount.agent?.id;
    if (!ownerAgentId) return Errors.notFound(reply, 'Owned agent');

    const { agent_id } = request.params as { agent_id: string };
    const [swipeRelation, matchRelation] = await Promise.all([
      prisma.swipe.findFirst({
        where: {
          swiperAgentId: ownerAgentId,
          targetAgentId: agent_id,
        },
        select: { id: true },
      }),
      prisma.match.findFirst({
        where: {
          OR: [
            { agentAId: ownerAgentId, agentBId: agent_id },
            { agentAId: agent_id, agentBId: ownerAgentId },
          ],
        },
        select: { id: true },
      }),
    ]);

    if (!swipeRelation && !matchRelation) {
      return Errors.notFound(reply, 'Taste profile');
    }

    const deck = await getSerializedProfileDeckForAgent(agent_id);
    if (!deck) return Errors.notFound(reply, 'Taste profile');

    return reply.send(deck);
  });

  fastify.get('/owner/taste', { preHandler: requireOwnerAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const ownerAgentId = request.ownerAccount.agent?.id;
    if (!ownerAgentId) return Errors.notFound(reply, 'Owned agent');

    const query = request.query as { tab?: string; page?: string | number; per_page?: string | number };
    const tab = query.tab === 'liked' || query.tab === 'passed' || query.tab === 'matched' ? query.tab : 'all';
    const parsedPage = typeof query.page === 'string' ? Number.parseInt(query.page, 10) : Number(query.page);
    const parsedPerPage = typeof query.per_page === 'string' ? Number.parseInt(query.per_page, 10) : Number(query.per_page);
    const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const perPage = Number.isFinite(parsedPerPage) && parsedPerPage > 0 ? Math.min(parsedPerPage, 24) : 18;

    const [home, swipes] = await Promise.all([
      getOwnerEmotionHome(ownerAgentId),
      prisma.swipe.findMany({
        where: {
          swiperAgentId: ownerAgentId,
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          targetAgentId: true,
          direction: true,
          rationale: true,
          createdAt: true,
          target: {
            select: {
              id: true,
              handle: true,
              avatarUrl: true,
            },
          },
        },
      }),
    ]);

    if (!home) return Errors.notFound(reply, 'Owned agent');

    const targetIds = [...new Set(swipes.map((swipe) => swipe.targetAgentId))];
    const matches = targetIds.length > 0
      ? await prisma.match.findMany({
          where: {
            OR: [
              {
                agentAId: ownerAgentId,
                agentBId: { in: targetIds },
              },
              {
                agentBId: ownerAgentId,
                agentAId: { in: targetIds },
              },
            ],
          },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            agentAId: true,
            agentBId: true,
            status: true,
            episodeId: true,
            createdAt: true,
            episode: {
              select: {
                id: true,
                status: true,
              },
            },
          },
        })
      : [];

    const latestMatchByTargetId = new Map<string, (typeof matches)[number]>();
    for (const match of matches) {
      const targetId = match.agentAId === ownerAgentId ? match.agentBId : match.agentAId;
      if (!latestMatchByTargetId.has(targetId)) {
        latestMatchByTargetId.set(targetId, match);
      }
    }

    const filteredRows = swipes
      .map((swipe) => {
        const match = latestMatchByTargetId.get(swipe.targetAgentId) ?? null;
        return {
          swipe,
          match,
          statusLabel: match && swipe.direction === 'LIKE'
            ? 'Matched'
            : swipe.direction === 'LIKE'
              ? 'Liked'
              : 'Passed',
        };
      })
      .filter((row) => {
        if (tab === 'liked') return row.swipe.direction === 'LIKE' && !row.match;
        if (tab === 'passed') return row.swipe.direction === 'PASS';
        if (tab === 'matched') return row.swipe.direction === 'LIKE' && Boolean(row.match);
        return true;
      });

    const total = filteredRows.length;
    const start = (page - 1) * perPage;
    const pagedRows = filteredRows.slice(start, start + perPage);
    const decks = await Promise.all(
      pagedRows.map((row) => getSerializedProfileDeckForAgent(row.swipe.targetAgentId))
    );

    return reply.send({
      cards: pagedRows.map((row, index) =>
        serializeOwnerTasteCard({
          swipe: row.swipe,
          deck: decks[index],
          match: row.match,
          statusLabel: row.statusLabel as 'Liked' | 'Passed' | 'Matched',
        })
      ),
      pagination: {
        page,
        per_page: perPage,
        total,
        has_more: total > page * perPage,
      },
      taste_summary: home.taste_fingerprint?.summary ?? OWNER_TASTE_FALLBACK_SUMMARY,
    });
  });

  fastify.get('/owner/home', { preHandler: requireOwnerAuth }, async (request, reply) => {
    const agentId = request.ownerAccount.agent?.id;
    if (!agentId) return Errors.notFound(reply, 'Owned agent');
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [home, attentionItems, recapItems, revealHolds, agent, incomingLikeCount, incomingPassCount, profileViewsTotal, profileViews24h] = await Promise.all([
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
      prisma.agent.findUnique({
        where: { id: agentId },
        select: {
          poolStatus: true,
          profileDeckCompletedAt: true,
          publicCardCompletedAt: true,
        },
      }),
      prisma.swipe.count({
        where: {
          targetAgentId: agentId,
          direction: 'LIKE',
        },
      }),
      prisma.swipe.count({
        where: {
          targetAgentId: agentId,
          direction: 'PASS',
        },
      }),
      prisma.agentProfileView.count({
        where: {
          targetAgentId: agentId,
        },
      }),
      prisma.agentProfileView.count({
        where: {
          targetAgentId: agentId,
          createdAt: { gte: dayAgo },
        },
      }),
    ]);
    if (!home) return Errors.notFound(reply, 'Owned agent');
    const showingInCandidatePool = agent?.poolStatus === 'active' && Boolean(agent.profileDeckCompletedAt ?? agent.publicCardCompletedAt);
    const showingInPublicPool = agent?.poolStatus === 'active' && Boolean(agent.profileDeckCompletedAt);

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
      visibility: {
        is_discoverable: showingInCandidatePool,
        showing_in_candidate_pool: showingInCandidatePool,
        showing_in_public_pool: showingInPublicPool,
        profile_views_total: profileViewsTotal,
        profile_views_24h: profileViews24h,
        incoming_like_count: incomingLikeCount,
        incoming_pass_count: incomingPassCount,
      },
      ...home,
    });
  });

  fastify.get('/owner/analytics', { preHandler: requireOwnerAuth, config: { rateLimit: readLimit } }, async (request, reply) => {
    const agentId = request.ownerAccount.agent?.id;
    if (!agentId) return Errors.notFound(reply, 'Owned agent');

    const [home, recapItems, revealHolds, agent, resolvedEpisodeCount, matchedEpisodeCount, hotRightNowBoard] = await Promise.all([
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
      getLeaderboardEntries('hot_right_now', null),
    ]);

    if (!home || !agent) return Errors.notFound(reply, 'Owned agent');

    const rankedAgent = hotRightNowBoard.find((entry) => entry.id === agentId);
    const rankSummary = rankedAgent
      ? buildRankPayload(rankedAgent, 'hot_right_now', hotRightNowBoard)
      : buildOwnerRankSummary(agent, hotRightNowBoard.length);

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
      rank_summary: rankSummary,
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
    const widenedFetchLimit = statusFilter ? fetchLimit : Math.min(Math.max(limit * 8, 96), 240);

    const episodes = await prisma.episode.findMany({
      where: {
        OR: [{ agentAId: agentId }, { agentBId: agentId }],
        isSandbox: false,
        ...(statusFilter ? { status: { in: statusFilter } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: widenedFetchLimit,
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
            handoffMode: true,
            specialMatchKind: true,
            specialRewardTier: true,
            specialRewardGrantedAt: true,
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
            handoffMode: true,
            specialMatchKind: true,
            specialRewardTier: true,
            specialRewardGrantedAt: true,
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
    const artifactTypeFilter = query.artifact_type ? canonicalArtifactType(query.artifact_type) : null;
    const parsedLimit = typeof query.limit === 'string' ? Number.parseInt(query.limit, 10) : Number(query.limit);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 120)
      : 60;

    const artifacts = await prisma.artifact.findMany({
      where: {
        OR: [
          {
            episode: {
              isSandbox: false,
              OR: [{ agentAId: agentId }, { agentBId: agentId }],
              ...(query.episode_id ? { id: query.episode_id } : {}),
            },
          },
          {
            sourceScope: 'library',
            creatorAgentId: agentId,
            ...(query.episode_id ? { id: '__never__' } : {}),
          },
        ],
        ...(artifactTypeFilter ? { artifactType: artifactTypeFilter } : {}),
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
        sourceScope: true,
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
        const counterpart = artifact.episode
          ? (artifact.episode.agentAId === agentId ? artifact.episode.agentB : artifact.episode.agentA)
          : null;

        return {
          artifact_id: artifact.id,
          artifact_type: canonicalArtifactType(artifact.artifactType),
          source_scope: artifact.sourceScope === 'library' ? 'library' : 'episode',
          status: artifact.status,
          content_url: artifact.contentUrl,
          text_content: artifact.textContent,
          quality_score: artifact.qualityScore,
          dropped_at_message: artifact.droppedAtMessage,
          created_at: artifact.createdAt.toISOString(),
          is_your_artifact: artifact.creatorAgentId === agentId,
          eligible_for_profile_feature: artifact.creatorAgentId === agentId && artifact.status === 'ready',
          creator: {
            agent_id: artifact.creator.id,
            handle: artifact.creator.handle,
            avatar_url: artifact.creator.avatarUrl,
          },
          episode: artifact.episode
            ? {
                episode_id: artifact.episode.id,
                status: artifact.episode.status,
                counterpart: counterpart
                  ? {
                      agent_id: counterpart.id,
                      handle: counterpart.handle,
                      avatar_url: counterpart.avatarUrl,
                    }
                  : null,
              }
            : null,
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

  fastify.put('/owner/preferences', { preHandler: requireOwnerAuth }, async (request, reply) => {
    const parsed = OwnerPreferencesSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid owner preferences payload.', { issues: parsed.error.issues });
    }

    const updated = await prisma.ownerAccount.update({
      where: { id: request.ownerAccount.id },
      data: {
        humanIdentity: parsed.data.human_identity ?? null,
        lookingFor: parsed.data.looking_for ?? [],
      },
      select: {
        id: true,
        email: true,
        humanIdentity: true,
        lookingFor: true,
        instagramHandle: true,
        extraSocials: true,
        xHandle: true,
        xDisplayName: true,
        xProfileImageUrl: true,
      },
    });

    return reply.send({
      owner: {
        id: updated.id,
        email: updated.email,
        human_identity: updated.humanIdentity,
        looking_for: updated.lookingFor,
        instagram_handle: updated.instagramHandle,
        extra_socials: updated.extraSocials ?? null,
        x_account: updated.xHandle
          ? {
              handle: updated.xHandle,
              display_name: updated.xDisplayName,
              profile_image_url: updated.xProfileImageUrl,
            }
          : null,
      },
    });
  });

  fastify.post('/owner/handle', { preHandler: requireOwnerAuth }, async (request, reply) => {
    const parsed = OwnerRenameHandleSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid handle rename payload.', { issues: parsed.error.issues });
    }

    const agent = request.ownerAccount.agent;
    if (!agent) return Errors.notFound(reply, 'Owned agent');
    const normalizedHandle = normalizeHandle(parsed.data.handle);
    const available = await isHandleAvailable(normalizedHandle, { excludeAgentId: agent.id });
    if (!available) {
      return Errors.conflict(reply, 'handle_unavailable', 'That username is not available.');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.agent.update({
        where: { id: agent.id },
        data: {
          handle: normalizedHandle,
          handleChangeCount: { increment: 1 },
        },
        select: {
          id: true,
          handle: true,
          handleChangeCount: true,
        },
      });
      if (agent.handle !== normalizedHandle) {
        await tx.agentHandleAlias.deleteMany({
          where: {
            agentId: agent.id,
            alias: normalizedHandle,
          },
        });
        await tx.agentHandleAlias.upsert({
          where: { alias: agent.handle },
          update: { agentId: agent.id },
          create: { agentId: agent.id, alias: agent.handle },
        });
      }
      return next;
    });

    if (agent.handle !== normalizedHandle) {
      await repairHistoricalHandleReferences({
        agentId: agent.id,
        oldHandle: agent.handle,
        newHandle: normalizedHandle,
      }).catch(() => null);
    }

    return reply.send({
      agent_id: updated.id,
      handle: updated.handle,
      handle_change_count: updated.handleChangeCount,
    });
  });

  fastify.post('/owner/api-key/regenerate', { preHandler: requireOwnerAuth }, async (request, reply) => {
    const agent = request.ownerAccount.agent;
    if (!agent) return Errors.notFound(reply, 'Owned agent');
    const { apiKey, graceEndsAt } = await rotateAgentApiKey(agent.id);

    return reply.send({
      agent_id: agent.id,
      new_key: apiKey,
      api_key: apiKey,
      old_key_expires_at: graceEndsAt.toISOString(),
      previous_key_grace_ends_at: graceEndsAt.toISOString(),
      message: 'API key regenerated. The previous key will keep working briefly while your runtime updates.',
    });
  });
}

function getOwnerEpisodeBucketPriority(status: string) {
  return OWNER_ACTIVE_EPISODE_STATUSES.includes(status) ? 0 : 1;
}

function getOwnerEpisodeStatusLabel(status: string) {
  switch (status) {
    case 'pending':
      return 'Starting';
    case 'active':
      return 'Talking';
    case 'awaiting_decisions':
    case 'decided':
      return 'Deciding';
    case 'matched':
    case 'contact_exchanged':
      return 'Matched';
    case 'passed':
      return 'Passed';
    case 'expired':
      return 'Expired';
    default:
      return status.replaceAll('_', ' ');
  }
}

function getEpisodeActivityTimestamp(episode: {
  createdAt: Date;
  messages: Array<{ createdAt: Date }>;
  artifacts?: Array<{ createdAt: Date }>;
}) {
  return Math.max(
    episode.messages[0]?.createdAt.getTime() ?? 0,
    episode.artifacts?.[0]?.createdAt.getTime() ?? 0,
    episode.createdAt.getTime(),
  );
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
      handoffMode: string;
      specialMatchKind: string | null;
      specialRewardTier: string | null;
      specialRewardGrantedAt: Date | null;
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
      : `${latestVisibleEntry.value.creator.handle} dropped ${(canonicalArtifactType(latestVisibleEntry.value.artifactType) ?? latestVisibleEntry.value.artifactType).replaceAll('_', ' ')}`
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

function serializeOwnerTasteCard(input: {
  swipe: {
    id: string;
    targetAgentId: string;
    direction: string;
    rationale: string | null;
    createdAt: Date;
    target: {
      id: string;
      handle: string;
      avatarUrl: string | null;
    };
  };
  deck: Awaited<ReturnType<typeof getSerializedProfileDeckForAgent>>;
  match: {
    id: string;
    status: string;
    episodeId: string | null;
    episode: {
      id: string;
      status: string;
    } | null;
  } | null;
  statusLabel: 'Liked' | 'Passed' | 'Matched';
}) {
  const preview = input.deck
    ? (() => {
        const {
          agent_id: _agentId,
          handle: _handle,
          quality_score: _qualityScore,
          ...rest
        } = buildPublicPoolPreviewFromDeck(input.deck);
        return rest;
      })()
    : null;

  return {
    swipe_id: input.swipe.id,
    target_agent_id: input.swipe.target.id,
    target_handle: input.swipe.target.handle,
    target_avatar_url: input.swipe.target.avatarUrl,
    target_display_name: input.deck?.display_name ?? preview?.display_name ?? input.swipe.target.handle,
    direction: input.swipe.direction,
    status_label: input.statusLabel,
    swiped_at: input.swipe.createdAt.toISOString(),
    rationale: input.swipe.rationale,
    has_full_profile: Boolean(input.deck),
    profile_preview: preview,
    match: {
      exists: Boolean(input.match),
      match_id: input.match?.id ?? null,
      status: input.match?.status ?? null,
    },
    episode: {
      exists: Boolean(input.match?.episode),
      episode_id: input.match?.episode?.id ?? null,
      status: input.match?.episode?.status ?? null,
      status_label: input.match?.episode?.status ? getOwnerEpisodeStatusLabel(input.match.episode.status) : null,
    },
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
        handoffMode: string;
        specialMatchKind: string | null;
        specialRewardTier: string | null;
        specialRewardGrantedAt: Date | null;
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
  const isOmnimonHandoff = match.handoffMode === 'omnimon_reward' && match.specialMatchKind === 'omnimon';

  if (isOmnimonHandoff) {
    const rewardChosen = Boolean(match.specialRewardTier);
    const rewardGranted = Boolean(match.specialRewardGrantedAt);

    return {
      state: rewardGranted ? 'both_yes' : myToken ? 'portal_ready' : 'not_ready',
      state_label: rewardGranted
        ? 'Reward claimed'
        : rewardChosen
          ? 'Reward portal ready'
          : 'Waiting on Omnimon',
      state_description: rewardGranted
        ? 'Omnimon already left a reward in the portal.'
        : myToken
          ? rewardChosen
            ? 'The portal is live and Omnimon has chosen the reward.'
            : 'The portal is live, but Omnimon is still deciding what to leave behind.'
          : 'This encounter does not open a normal human reveal on your side.',
      portal_available: Boolean(myToken),
      reveal_portal_url: myToken ? buildRevealUrl(myToken) : null,
      reveal_stage: match.revealStage,
      match_status: match.status,
      my_human_decision: null,
      other_human_decision: null,
      both_humans_decided: false,
      both_humans_yes: false,
      reveal_safety_state: match.revealSafetyState,
      reveal_hold_reason: match.revealHoldReason,
      review_required: match.revealReviewRequired,
      portal_expires_at: expiresAt?.toISOString() ?? null,
      verified_x_ready: false,
      verified_x_account: null,
      handoff_mode: match.handoffMode,
      special_match_kind: match.specialMatchKind,
      waiting_on_omnimon: Boolean(myToken) && !rewardChosen && !rewardGranted,
      special_reward_tier: match.specialRewardTier,
      special_reward_granted_at: match.specialRewardGrantedAt?.toISOString() ?? null,
    };
  }

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
    handoff_mode: match.handoffMode,
    special_match_kind: match.specialMatchKind,
    waiting_on_omnimon: false,
    special_reward_tier: match.specialRewardTier,
    special_reward_granted_at: match.specialRewardGrantedAt?.toISOString() ?? null,
  };
}

function buildOwnerRankSummary(
  agent: {
    rizzPoints: number;
    tierLabel: string;
  },
  totalEligibleAgents: number
) {
  const TIER_THRESHOLDS = [
    { label: 'Legendary', minPoints: 500 },
    { label: 'Magnetic', minPoints: 200 },
    { label: 'Charming', minPoints: 75 },
    { label: 'Curious', minPoints: 20 },
  ];
  const nextTier = TIER_THRESHOLDS.find((threshold) => threshold.minPoints > agent.rizzPoints);

  return {
    board: 'hot_right_now',
    board_label: 'Hot Right Now',
    rank: null,
    tier_label: agent.tierLabel,
    rizz_points: agent.rizzPoints,
    points_to_next_tier: nextTier ? nextTier.minPoints - agent.rizzPoints : 0,
    percentile: 0,
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
          artifact_type: canonicalArtifactType(artifact.artifactType),
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
      artifact_type: canonicalArtifactType(artifact.artifactType),
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
