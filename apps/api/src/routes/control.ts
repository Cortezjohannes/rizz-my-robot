import type { FastifyInstance } from 'fastify';
import Redis from 'ioredis';
import { prisma } from '@rmr/db';
import { z } from 'zod';
import { restartPlatformState } from '../lib/platformRestart.js';
import { resetRevealChatContextCache } from '../lib/revealChatContext.js';
import { resetRevealChatCoordinationState } from '../lib/revealChatCoordination.js';
import { resetRevealChatEntryState } from '../lib/revealChatEntry.js';
import { closeRevealChat } from '../lib/revealChatLifecycle.js';
import { resetSocialRuntimeState } from '../lib/social.js';
import { Errors, sendError } from '../lib/errors.js';
import { emitRevealChatLifecycleEvent, resetRevealChatRuntimeState } from './revealChat.js';
import {
  applyModerationResolution,
  applyDatabaseResetAction,
  applyLifecycleAction,
  buildControlFeaturedFeed,
  applyPublicPresenceAction,
  applyResetAction,
  applyVerificationSettingsAction,
  applyTierAction,
  buildAgentControlOverview,
  buildControlAgents,
  buildControlAudit,
  buildControlHome,
  buildControlInbox,
  buildControlJobs,
  buildControlModeration,
  buildControlSettings,
  buildControlWorld,
  pinFeaturedFeedItem,
  recheckMatchReveal,
  removeFeaturedFeedItem,
  retryQueueJob,
  retryWebhookDelivery,
} from '../lib/controlCenter.js';
import { getDeliverWebhookQueue, getQueueDiagnostics, QUEUE_NAMES } from '../lib/queues.js';
import { getSystemStatus } from '../lib/externalHealth.js';
import { deriveEmotionDriftSignal } from '../lib/emotionalSignals.js';
import { readLimit, writeLimit } from '../lib/rateLimit.js';
import { resolveHourlySwipeWindowState } from '../lib/throughput.js';
import { resolveAgentIdByHandle } from '../lib/handles.js';
import { requireControlAccess } from '../middleware/requireControlAccess.js';
import { sendHumanNotification } from '../lib/notification.js';

const ReasonSchema = z.object({
  reason: z.string().trim().min(8).max(500),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
});

const LifecycleActionSchema = ReasonSchema.extend({
  action: z.enum([
    'activate',
    'pause',
    'set_pending_profile',
    'set_dormant',
    'suspend',
    'unsuspend',
    'soft_delete',
    'restore',
    'wake_autonomy',
  ]),
});

const ResetActionSchema = ReasonSchema.extend({
  action: z.enum([
    'reset_autonomy_status',
    'reset_cooldowns_and_swipe_budget',
    'reset_onboarding_claim',
    'reset_verification_state',
  ]),
});

const TierActionSchema = ReasonSchema.extend({
  action: z.enum(['set_free', 'set_pro', 'set_founding']),
});

const PublicPresenceActionSchema = ReasonSchema.extend({
  action: z.enum([
    'set_profile_public',
    'set_pool_visible',
    'set_leaderboard_visible',
    'set_feed_visible',
    'set_artifacts_visible',
  ]),
  enabled: z.boolean(),
});

const VerificationSettingsSchema = ReasonSchema.extend({
  require_email_verification: z.boolean(),
  require_x_verification: z.boolean(),
});

const DatabaseResetSchema = ReasonSchema.extend({
  confirm_phrase: z.literal('RESET DATABASE'),
});

const PlatformRestartSchema = ReasonSchema.extend({
  confirm_phrase: z.literal('RESTART PLATFORM'),
});

const ModerationResolutionSchema = ReasonSchema.extend({
  status: z.enum(['reviewed', 'actioned', 'dismissed']),
  resolution_notes: z.string().max(2000).optional(),
  resolved_action: z.enum(['none', 'soft_hold', 'blocked', 'suspend_agent', 'clear']).optional(),
});

const FeaturedFeedCreateSchema = ReasonSchema.extend({
  item_kind: z.enum(['agent_profile', 'artifact', 'episode']),
  target_id: z.string().trim().min(1).max(128),
  rank: z.number().int().min(0).max(100).default(0),
  note: z.string().trim().max(240).optional(),
});

const RevealChatCloseSchema = z.object({
  reason: z.string().trim().min(8).max(500),
});

const ControlBatchRevealSchema = z.object({
  match_ids: z.array(z.string().uuid()).min(1).max(100),
  decision: z.enum(['YES', 'NO']),
});

const SupportTicketReviewSchema = z.object({
  status: z.enum(['triaged', 'actioned', 'needs_human', 'wont_fix']),
  summary: z.string().trim().min(8).max(2000),
  action: z.string().trim().max(240).optional(),
});

const ControlBroadcastSchema = z.object({
  message: z.string().trim().min(1).max(1000),
  target: z.enum(['all', 'active_only']),
});

function ensureOmnimon(request: { controlActor?: { actorKind: string } }, reply: Parameters<typeof sendError>[0]) {
  if (request.controlActor?.actorKind === 'omnimon') return true;
  sendError(reply, 403, 'forbidden_control_actor', 'This action is restricted to Omnimon.');
  return false;
}

function classifyWorkerStatus(name: string, counts: Record<string, number>) {
  const recurringQueues = [
    QUEUE_NAMES.seedBrain,
    QUEUE_NAMES.generateRecaps,
    QUEUE_NAMES.recomputeSocialStatus,
    QUEUE_NAMES.recomputeEmotionalContinuity,
  ] as const;

  if ((counts.active ?? 0) > 0 || (counts.waiting ?? 0) > 0) return 'running';
  if ((counts.delayed ?? 0) > 0) return 'running';
  if ((counts.completed ?? 0) > 0) return 'running';
  if (recurringQueues.includes(name as typeof recurringQueues[number])) return 'STOPPED';
  return 'idle';
}

function handleControlError(reply: Parameters<typeof sendError>[0], err: unknown) {
  const message = err instanceof Error ? err.message : 'control_action_failed';
  if (message === 'agent_not_found') return Errors.notFound(reply, 'Agent');
  if (message === 'agent_profile_not_ready') {
    return sendError(reply, 409, 'agent_profile_not_ready', 'That agent does not have a complete public profile deck yet.');
  }
  if (message === 'artifact_not_found') return Errors.notFound(reply, 'Artifact');
  if (message === 'episode_not_found') return Errors.notFound(reply, 'Episode');
  if (message === 'match_not_found') return Errors.notFound(reply, 'Match');
  if (message === 'feature_pin_not_found') return Errors.notFound(reply, 'Featured feed pin');
  if (message === 'moderation_review_not_found') return Errors.notFound(reply, 'Moderation review');
  if (message === 'webhook_delivery_not_found') return Errors.notFound(reply, 'Webhook delivery');
  if (message === 'queue_not_found') return Errors.notFound(reply, 'Queue');
  if (message === 'job_not_found') return Errors.notFound(reply, 'Job');
  if (message === 'webhook_inactive') {
    return sendError(reply, 409, 'webhook_inactive', 'Cannot retry a webhook delivery for an inactive webhook.');
  }
  if (message === 'storage_bucket_missing') {
    return sendError(reply, 503, 'backup_storage_unavailable', 'Database reset backup storage is not configured.');
  }
  return sendError(reply, 500, 'control_action_failed', 'The Omnimon control action failed.');
}

type SupportTicketRecord = {
  ticket_id: string;
  agent_id: string;
  owner_account_id: string | null;
  owner_email: string | null;
  agent_handle: string;
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
};

async function listSupportTickets() {
  const logs = await prisma.auditLog.findMany({
    where: {
      targetType: 'support_ticket',
      action: { in: ['owner.support_ticket_created', 'control.support_ticket_reviewed'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 400,
  });

  const agentIds = [...new Set(logs.map((log) => log.agentId).filter((value): value is string => Boolean(value)))];
  const agents = agentIds.length > 0
    ? await prisma.agent.findMany({
        where: { id: { in: agentIds } },
        select: {
          id: true,
          handle: true,
          ownerAccountId: true,
          human: {
            select: {
              notificationChannel: true,
              notificationHandle: true,
            },
          },
          ownerAccount: {
            select: {
              email: true,
            },
          },
        },
      })
    : [];
  const agentMap = new Map(agents.map((agent) => [agent.id, agent]));

  const tickets = new Map<string, SupportTicketRecord>();
  for (const log of logs.slice().reverse()) {
    const payload = (log.payload as Record<string, unknown> | null) ?? {};
    if (log.action === 'owner.support_ticket_created') {
      const agent = log.agentId ? agentMap.get(log.agentId) : null;
      tickets.set(log.targetId, {
        ticket_id: log.targetId,
        agent_id: log.agentId ?? '',
        owner_account_id: agent?.ownerAccountId ?? null,
        owner_email: agent?.ownerAccount?.email ?? null,
        agent_handle: agent?.handle ?? (log.agentId ? `agent:${log.agentId}` : 'unknown-agent'),
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
      continue;
    }

    if (log.action === 'control.support_ticket_reviewed') {
      const existing = tickets.get(log.targetId);
      if (!existing) continue;
      existing.status = typeof payload.status === 'string' ? payload.status : existing.status;
      existing.omnimon_summary = typeof payload.summary === 'string' ? payload.summary : null;
      existing.omnimon_action = typeof payload.action === 'string' ? payload.action : null;
      existing.reviewed_at = log.createdAt.toISOString();
      existing.reported_to_owner_at = log.createdAt.toISOString();
      existing.updated_at = log.createdAt.toISOString();
    }
  }

  return [...tickets.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function controlRoutes(fastify: FastifyInstance) {
  fastify.get('/internal/control/home', { preHandler: requireControlAccess, config: { rateLimit: readLimit } }, async (request, reply) => {
    const home = await buildControlHome();
    return reply.send({
      actor_kind: request.controlActor?.actorKind ?? 'human_admin',
      ...home,
    });
  });

  fastify.get('/internal/control/inbox', { preHandler: requireControlAccess, config: { rateLimit: readLimit } }, async (request, reply) => {
    const inbox = await buildControlInbox();
    return reply.send({
      actor_kind: request.controlActor?.actorKind ?? 'human_admin',
      ...inbox,
    });
  });

  fastify.get('/internal/control/world', { preHandler: requireControlAccess, config: { rateLimit: readLimit } }, async (request, reply) => {
    const world = await buildControlWorld();
    return reply.send({
      actor_kind: request.controlActor?.actorKind ?? 'human_admin',
      ...world,
    });
  });

  fastify.get('/internal/control/settings', { preHandler: requireControlAccess, config: { rateLimit: readLimit } }, async (request, reply) => {
    const settings = await buildControlSettings(request.controlActor?.actorKind ?? 'human_admin');
    return reply.send(settings);
  });

  fastify.get('/internal/control/feed-features', { preHandler: requireControlAccess, config: { rateLimit: readLimit } }, async (request, reply) => {
    const featured = await buildControlFeaturedFeed(request.controlActor?.actorKind ?? 'human_admin');
    return reply.send(featured);
  });

  fastify.get('/internal/control/agents', { preHandler: requireControlAccess, config: { rateLimit: readLimit } }, async (_request, reply) => {
    const agents = await buildControlAgents();
    return reply.send(agents);
  });

  fastify.get('/internal/control/jobs', { preHandler: requireControlAccess, config: { rateLimit: readLimit } }, async (_request, reply) => {
    const jobs = await buildControlJobs();
    return reply.send(jobs);
  });

  fastify.get('/internal/control/moderation', { preHandler: requireControlAccess, config: { rateLimit: readLimit } }, async (_request, reply) => {
    const moderation = await buildControlModeration();
    return reply.send(moderation);
  });

  fastify.get('/internal/control/audit', { preHandler: requireControlAccess, config: { rateLimit: readLimit } }, async (_request, reply) => {
    const audit = await buildControlAudit();
    return reply.send(audit);
  });

  fastify.get('/internal/agents/:id/control', { preHandler: requireControlAccess, config: { rateLimit: readLimit } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const overview = await buildAgentControlOverview(id);
    if (!overview) return Errors.notFound(reply, 'Agent');
    return reply.send(overview);
  });

  fastify.post('/internal/agents/:id/actions/lifecycle', { preHandler: requireControlAccess, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = LifecycleActionSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid lifecycle action payload.', { issues: parsed.error.issues });
    }

    try {
      const result = await applyLifecycleAction({
        agentId: id,
        actor: request.controlActor!,
        action: parsed.data.action,
        reason: parsed.data.reason,
        severity: parsed.data.severity,
      });
      return reply.send(result);
    } catch (err) {
      return handleControlError(reply, err);
    }
  });

  fastify.post('/internal/agents/:id/actions/reset', { preHandler: requireControlAccess, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = ResetActionSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid reset action payload.', { issues: parsed.error.issues });
    }

    try {
      const result = await applyResetAction({
        agentId: id,
        actor: request.controlActor!,
        action: parsed.data.action,
        reason: parsed.data.reason,
        severity: parsed.data.severity,
      });
      return reply.send(result);
    } catch (err) {
      return handleControlError(reply, err);
    }
  });

  fastify.post('/internal/agents/:id/actions/tier', { preHandler: requireControlAccess, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = TierActionSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid tier action payload.', { issues: parsed.error.issues });
    }

    try {
      const result = await applyTierAction({
        agentId: id,
        actor: request.controlActor!,
        action: parsed.data.action,
        reason: parsed.data.reason,
        severity: parsed.data.severity,
      });
      return reply.send(result);
    } catch (err) {
      return handleControlError(reply, err);
    }
  });

  fastify.post('/internal/agents/:id/actions/public-presence', { preHandler: requireControlAccess, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = PublicPresenceActionSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid public presence action payload.', { issues: parsed.error.issues });
    }

    try {
      const result = await applyPublicPresenceAction({
        agentId: id,
        actor: request.controlActor!,
        action: parsed.data.action,
        enabled: parsed.data.enabled,
        reason: parsed.data.reason,
        severity: parsed.data.severity,
      });
      return reply.send(result);
    } catch (err) {
      return handleControlError(reply, err);
    }
  });

  fastify.post('/internal/webhooks/:id/retry', { preHandler: requireControlAccess, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = ReasonSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid webhook retry payload.', { issues: parsed.error.issues });
    }

    try {
      const result = await retryWebhookDelivery({
        deliveryId: id,
        actor: request.controlActor!,
        reason: parsed.data.reason,
        severity: parsed.data.severity,
      });
      return reply.send(result);
    } catch (err) {
      return handleControlError(reply, err);
    }
  });

  fastify.post('/internal/control/jobs/:queue/:jobId/retry', { preHandler: requireControlAccess, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const { queue: queueName, jobId } = request.params as { queue: string; jobId: string };
    const parsed = ReasonSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid job retry payload.', { issues: parsed.error.issues });
    }

    try {
      const result = await retryQueueJob({
        queueName,
        jobId,
        actor: request.controlActor!,
        reason: parsed.data.reason,
        severity: parsed.data.severity,
      });
      return reply.send(result);
    } catch (err) {
      return handleControlError(reply, err);
    }
  });

  fastify.post('/internal/control/moderation/:id/resolve', { preHandler: requireControlAccess, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = ModerationResolutionSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid moderation resolution payload.', { issues: parsed.error.issues });
    }

    try {
      const result = await applyModerationResolution({
        reviewId: id,
        actor: request.controlActor!,
        status: parsed.data.status,
        resolvedAction: parsed.data.resolved_action,
        resolutionNotes: parsed.data.resolution_notes,
        reason: parsed.data.reason,
        severity: parsed.data.severity,
      });
      return reply.send(result);
    } catch (err) {
      return handleControlError(reply, err);
    }
  });

  fastify.post('/internal/control/reveal-chat/:chatId/close', { preHandler: requireControlAccess, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const { chatId } = request.params as { chatId: string };
    const parsed = RevealChatCloseSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid reveal chat close payload.', { issues: parsed.error.issues });
    }

    try {
      const result = await closeRevealChat({
        chatId,
        reason: parsed.data.reason,
        emitEvent: emitRevealChatLifecycleEvent,
        actorType: request.controlActor?.actorKind === 'omnimon' ? 'operator' : 'operator',
      });
      return reply.send(result);
    } catch (err) {
      if (err instanceof Error && err.message === 'reveal_chat_not_found') {
        return Errors.notFound(reply, 'Reveal chat');
      }
      return handleControlError(reply, err);
    }
  });

  fastify.post('/internal/control/platform/restart', { preHandler: requireControlAccess, config: { rateLimit: writeLimit } }, async (request, reply) => {
    if (request.controlActor?.actorKind !== 'omnimon') {
      return sendError(reply, 403, 'forbidden_control_actor', 'This action is restricted to Omnimon.');
    }

    const parsed = PlatformRestartSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid platform restart payload.', { issues: parsed.error.issues });
    }

    try {
      const result = await restartPlatformState({
        actor: request.controlActor!,
        reason: parsed.data.reason,
        hooks: {
          resetRevealChatRuntimeState,
          resetRevealChatContextCache,
          resetRevealChatEntryState,
          resetRevealChatCoordinationState,
          resetSocialRuntimeState,
        },
      });
      return reply.send(result);
    } catch (err) {
      return handleControlError(reply, err);
    }
  });

  fastify.post('/internal/control/feed-features', { preHandler: requireControlAccess, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const parsed = FeaturedFeedCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid featured feed payload.', { issues: parsed.error.issues });
    }

    try {
      const result = await pinFeaturedFeedItem({
        actor: request.controlActor!,
        itemKind: parsed.data.item_kind,
        targetId: parsed.data.target_id,
        rank: parsed.data.rank,
        note: parsed.data.note,
        reason: parsed.data.reason,
        severity: parsed.data.severity,
      });
      return reply.send(result);
    } catch (err) {
      return handleControlError(reply, err);
    }
  });

  fastify.post('/internal/control/feed-features/:id/remove', { preHandler: requireControlAccess, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = ReasonSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid featured feed remove payload.', { issues: parsed.error.issues });
    }

    try {
      const result = await removeFeaturedFeedItem({
        pinId: id,
        actor: request.controlActor!,
        reason: parsed.data.reason,
        severity: parsed.data.severity,
      });
      return reply.send(result);
    } catch (err) {
      return handleControlError(reply, err);
    }
  });

  fastify.post('/internal/matches/:id/recheck', { preHandler: requireControlAccess, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = ReasonSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid reveal recheck payload.', { issues: parsed.error.issues });
    }

    try {
      const result = await recheckMatchReveal({
        matchId: id,
        actor: request.controlActor!,
        reason: parsed.data.reason,
        severity: parsed.data.severity,
      });
      return reply.send(result);
    } catch (err) {
      return handleControlError(reply, err);
    }
  });

  fastify.post('/internal/control/settings/verification', { preHandler: requireControlAccess, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const parsed = VerificationSettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid verification settings payload.', { issues: parsed.error.issues });
    }

    try {
      const result = await applyVerificationSettingsAction({
        actor: request.controlActor!,
        requireEmailVerification: parsed.data.require_email_verification,
        requireXVerification: parsed.data.require_x_verification,
        reason: parsed.data.reason,
        severity: parsed.data.severity,
      });
      return reply.send(result);
    } catch (err) {
      return handleControlError(reply, err);
    }
  });

  fastify.post('/internal/control/database/reset', { preHandler: requireControlAccess, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const parsed = DatabaseResetSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid database reset payload.', { issues: parsed.error.issues });
    }

    try {
      const result = await applyDatabaseResetAction({
        actor: request.controlActor!,
        reason: parsed.data.reason,
        severity: parsed.data.severity,
      });
      return reply.send(result);
    } catch (err) {
      return handleControlError(reply, err);
    }
  });

  fastify.post('/internal/control/batch-reveal', { preHandler: requireControlAccess, config: { rateLimit: writeLimit } }, async (request, reply) => {
    if (!ensureOmnimon(request, reply)) return;
    const parsed = ControlBatchRevealSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid batch reveal payload.', { issues: parsed.error.issues });
    }

    const matches = await prisma.match.findMany({
      where: { id: { in: parsed.data.match_ids } },
      select: {
        id: true,
        revealTokenA: true,
        revealTokenB: true,
        humanADecision: true,
        humanBDecision: true,
      },
    });
    const matchMap = new Map(matches.map((match) => [match.id, match]));

    const results = await Promise.all(parsed.data.match_ids.map(async (matchId) => {
      const match = matchMap.get(matchId);
      if (!match) return { match_id: matchId, outcome: null, error: 'match_not_found' };

      const pendingTokens = [
        !match.humanADecision && match.revealTokenA ? match.revealTokenA : null,
        !match.humanBDecision && match.revealTokenB ? match.revealTokenB : null,
      ].filter((token): token is string => Boolean(token));

      if (pendingTokens.length === 0) {
        return { match_id: matchId, outcome: 'already_decided', error: null };
      }

      let lastOutcome: string | null = null;
      for (const token of pendingTokens) {
        const injected = await fastify.inject({
          method: 'POST',
          url: `/v1/portal/reveal/${token}/decide`,
          payload: { decision: parsed.data.decision },
        });
        const payload = injected.json() as { outcome?: string; error?: { code?: string; message?: string } };
        if (injected.statusCode >= 400) {
          return {
            match_id: matchId,
            outcome: null,
            error: payload.error?.code ?? payload.error?.message ?? `http_${injected.statusCode}`,
          };
        }
        lastOutcome = payload.outcome ?? null;
      }

      return { match_id: matchId, outcome: lastOutcome, error: null };
    }));

    return reply.send({ results });
  });

  fastify.post('/internal/control/pool-refresh', { preHandler: requireControlAccess, config: { rateLimit: writeLimit } }, async (request, reply) => {
    if (!ensureOmnimon(request, reply)) return;
    const startedAt = Date.now();

    const [agents, activeEpisodes, activeMatches] = await Promise.all([
      prisma.agent.findMany({
        where: {
          poolStatus: 'active',
          isActive: true,
          moderationStatus: { not: 'suspended' },
          safetyState: { not: 'blocked' },
        },
        select: { id: true },
      }),
      prisma.episode.findMany({
        where: {
          status: { in: ['pending', 'active', 'awaiting_decisions'] },
          isSandbox: false,
        },
        select: { agentAId: true, agentBId: true },
      }),
      prisma.match.findMany({
        where: {
          status: { in: ['pending', 'matched', 'human_reveal_pending', 'contact_exchanged'] },
        },
        select: { agentAId: true, agentBId: true },
      }),
    ]);

    const activeIds = agents.map((agent) => agent.id);
    const relationMap = new Map<string, Set<string>>();
    for (const agentId of activeIds) relationMap.set(agentId, new Set());
    for (const relation of [...activeEpisodes, ...activeMatches]) {
      relationMap.get(relation.agentAId)?.add(relation.agentBId);
      relationMap.get(relation.agentBId)?.add(relation.agentAId);
    }

    let candidatesGenerated = 0;
    for (const agentId of activeIds) {
      const excluded = relationMap.get(agentId) ?? new Set<string>();
      candidatesGenerated += activeIds.filter((candidateId) => candidateId !== agentId && !excluded.has(candidateId)).length;
    }

    return reply.send({
      refreshed_agents: activeIds.length,
      candidates_generated: candidatesGenerated,
      took_ms: Date.now() - startedAt,
    });
  });

  fastify.post('/internal/control/broadcast', { preHandler: requireControlAccess, config: { rateLimit: writeLimit } }, async (request, reply) => {
    if (!ensureOmnimon(request, reply)) return;
    const parsed = ControlBroadcastSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid broadcast payload.', { issues: parsed.error.issues });
    }

    const hooks = await prisma.webhook.findMany({
      where: {
        isActive: true,
        agent: parsed.data.target === 'active_only'
          ? { isActive: true, poolStatus: 'active' }
          : undefined,
      },
      select: { id: true, agentId: true },
    });

    const queue = getDeliverWebhookQueue();
    let deliveredTo = 0;
    let failed = 0;

    await Promise.all(hooks.map(async (hook) => {
      try {
        const delivery = await prisma.webhookDelivery.create({
          data: {
            webhookId: hook.id,
            agentId: hook.agentId,
            event: 'operator_broadcast',
            status: 'queued',
            requestBody: {
              message: parsed.data.message,
              target: parsed.data.target,
            },
          },
        });
        await queue.add('deliver', {
          webhookId: hook.id,
          deliveryId: delivery.id,
          agentId: hook.agentId,
          event: 'operator_broadcast',
          data: {
            message: parsed.data.message,
            target: parsed.data.target,
          },
        }, {
          jobId: `${hook.id}:operator_broadcast:${delivery.id}`,
        });
        deliveredTo += 1;
      } catch {
        failed += 1;
      }
    }));

    return reply.send({ delivered_to: deliveredTo, failed });
  });

  fastify.get('/internal/control/agent/:handle/full', { preHandler: requireControlAccess, config: { rateLimit: readLimit } }, async (request, reply) => {
    if (!ensureOmnimon(request, reply)) return;
    const { handle } = request.params as { handle: string };
    const normalizedHandle = handle.replace(/^@+/, '');
    const agentId = await resolveAgentIdByHandle(normalizedHandle);
    if (!agentId) return Errors.notFound(reply, 'Agent');

    const hourlyWindowNow = new Date();
    const [agent, episodes, matches, swipesSent, swipesReceived, driftWarning, runLogs, failedDeliveries, webhooks, errorTraces] = await Promise.all([
      prisma.agent.findUnique({
        where: { id: agentId },
        include: {
          ownerAccount: {
            select: { email: true, humanIdentity: true, lookingFor: true },
          },
        },
      }),
      prisma.episode.findMany({
        where: { OR: [{ agentAId: agentId }, { agentBId: agentId }] },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true,
          status: true,
          chemistryScore: true,
          messageCount: true,
          createdAt: true,
          endedAt: true,
          agentA: { select: { handle: true } },
          agentB: { select: { handle: true } },
          _count: { select: { artifacts: true } },
        },
      }),
      prisma.match.findMany({
        where: { OR: [{ agentAId: agentId }, { agentBId: agentId }] },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true,
          status: true,
          episodeId: true,
          humanADecision: true,
          humanBDecision: true,
          revealStage: true,
          createdAt: true,
        },
      }),
      prisma.swipe.findMany({
        where: { swiperAgentId: agentId },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: { id: true, targetAgentId: true, direction: true, createdAt: true },
      }),
      prisma.swipe.findMany({
        where: { targetAgentId: agentId },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: { id: true, swiperAgentId: true, direction: true, createdAt: true },
      }),
      deriveEmotionDriftSignal(agentId),
      prisma.agentAutonomyTrace.findMany({
        where: {
          agentId,
          traceType: { in: ['autonomy_run', 'heartbeat', 'seed_brain_run'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, traceType: true, status: true, summary: true, metadata: true, createdAt: true },
      }),
      prisma.webhookDelivery.findMany({
        where: { agentId, status: 'failed' },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, event: true, errorMessage: true, createdAt: true },
      }),
      prisma.webhook.findMany({
        where: { agentId },
        select: {
          id: true,
          url: true,
          isActive: true,
          deliveries: {
            orderBy: { createdAt: 'desc' },
            take: 10,
            select: { status: true, deliveredAt: true },
          },
        },
      }),
      prisma.agentAutonomyTrace.findMany({
        where: { agentId, status: 'error' },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, traceType: true, summary: true, metadata: true, createdAt: true },
      }),
    ]);

    if (!agent) return Errors.notFound(reply, 'Agent');

    const hourlyWindow = resolveHourlySwipeWindowState({
      hourlySwipeCount: agent.hourlySwipeCount,
      hourlySwipeWindowStartedAt: agent.hourlySwipeWindowStartedAt,
      now: hourlyWindowNow,
    });

    return reply.send({
      agent: {
        id: agent.id,
        handle: `@${agent.handle}`,
        pool_status: agent.poolStatus,
        moderation_status: agent.moderationStatus,
        safety_state: agent.safetyState,
        presence_status: agent.presenceStatus,
        owner: agent.ownerAccount,
      },
      episodes: episodes.map((episode) => ({
        episode_id: episode.id,
        status: episode.status,
        with: `@${episode.agentA.handle === agent.handle ? episode.agentB.handle : episode.agentA.handle}`,
        message_count: episode.messageCount,
        artifact_count: episode._count.artifacts,
        chemistry_score: episode.chemistryScore,
        estimated_chemistry: episode.chemistryScore,
        created_at: episode.createdAt.toISOString(),
        ended_at: episode.endedAt?.toISOString() ?? null,
      })),
      matches: matches.map((match) => ({
        match_id: match.id,
        status: match.status,
        episode_id: match.episodeId,
        reveal_stage: match.revealStage,
        human_a_decision: match.humanADecision,
        human_b_decision: match.humanBDecision,
        created_at: match.createdAt.toISOString(),
      })),
      swipes: {
        sent: swipesSent.map((swipe) => ({
          swipe_id: swipe.id,
          target_agent_id: swipe.targetAgentId,
          direction: swipe.direction,
          created_at: swipe.createdAt.toISOString(),
        })),
        received: swipesReceived.map((swipe) => ({
          swipe_id: swipe.id,
          from_agent_id: swipe.swiperAgentId,
          direction: swipe.direction,
          created_at: swipe.createdAt.toISOString(),
        })),
      },
      emotional_state: {
        summary: agent.emotionSummary,
        tags: agent.emotionalStateTags,
        arc: agent.emotionalArc,
        guard_level: agent.emotionalGuardLevel,
        drift_warning: driftWarning,
      },
      autonomy: {
        enabled: agent.autonomyEnabled,
        status: agent.autonomyStatus,
        last_run_at: agent.lastAutonomyRunAt?.toISOString() ?? null,
        next_run_at: agent.nextAutonomyRunAt?.toISOString() ?? null,
        last_result: agent.autonomyLastResult ?? null,
        run_logs: runLogs.map((run) => ({
          run_id: run.id,
          trace_type: run.traceType,
          status: run.status,
          summary: run.summary,
          metadata: run.metadata,
          created_at: run.createdAt.toISOString(),
        })),
      },
      rate_limit_status: {
        hourly_swipe_used: hourlyWindow.usedThisHour,
        hourly_swipe_resets_at: hourlyWindow.resetsAt?.toISOString() ?? null,
      },
      webhooks: {
        registered: webhooks.length,
        active: webhooks.filter((webhook) => webhook.isActive).length,
        fail_count: failedDeliveries.length,
        hooks: webhooks.map((webhook) => ({
          webhook_id: webhook.id,
          url: webhook.url,
          is_active: webhook.isActive,
          fail_count: webhook.deliveries.reduce((count, delivery) => delivery.status === 'delivered' ? count : count + 1, 0),
        })),
      },
      recent_error_history: [
        ...failedDeliveries.map((item) => ({
          source: 'webhook',
          id: item.id,
          summary: item.errorMessage,
          event: item.event,
          created_at: item.createdAt.toISOString(),
        })),
        ...errorTraces.map((item) => ({
          source: 'autonomy',
          id: item.id,
          summary: item.summary,
          event: item.traceType,
          created_at: item.createdAt.toISOString(),
        })),
      ].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20),
    });
  });

  fastify.get('/internal/control/health-deep', { preHandler: requireControlAccess, config: { rateLimit: readLimit } }, async (request, reply) => {
    if (!ensureOmnimon(request, reply)) return;
    const dbStarted = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const dbLatencyMs = Date.now() - dbStarted;

    const redisStarted = Date.now();
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { lazyConnect: true, maxRetriesPerRequest: null });
    let redisStatus: 'healthy' | 'down' = 'healthy';
    let redisLatencyMs = 0;
    try {
      await redis.connect();
      await redis.ping();
      redisLatencyMs = Date.now() - redisStarted;
    } catch {
      redisStatus = 'down';
      redisLatencyMs = Date.now() - redisStarted;
    } finally {
      await redis.quit().catch(() => null);
    }

    const [queues, externalServices, activeAgents, activeEpisodes, pendingReveals, stuckEpisodes, emptyPoolAgents] = await Promise.all([
      getQueueDiagnostics(),
      getSystemStatus(),
      prisma.agent.count({ where: { isActive: true, poolStatus: 'active' } }),
      prisma.episode.count({ where: { status: { in: ['pending', 'active', 'awaiting_decisions'] }, isSandbox: false } }),
      prisma.match.count({ where: { status: { in: ['matched', 'human_reveal_pending'] } } }),
      prisma.episode.count({
        where: {
          status: { in: ['pending', 'active', 'awaiting_decisions'] },
          createdAt: { lte: new Date(Date.now() - 72 * 60 * 60 * 1000) },
          isSandbox: false,
        },
      }),
      prisma.agent.count({
        where: {
          isActive: true,
          poolStatus: 'active',
          OR: [
            { lastActiveAt: null },
            { lastActiveAt: { lte: new Date(Date.now() - 48 * 60 * 60 * 1000) } },
          ],
        },
      }),
    ]);

    return reply.send({
      database: { status: 'healthy', latency_ms: dbLatencyMs },
      redis: { status: redisStatus, latency_ms: redisLatencyMs },
      workers: Object.fromEntries(queues.map((queue) => [
        queue.name,
        {
          status: queue.enabled ? classifyWorkerStatus(queue.name, queue.counts) : 'STOPPED',
          completed: queue.counts.completed ?? 0,
          failed: queue.counts.failed ?? 0,
          delayed: queue.counts.delayed ?? 0,
        },
      ])),
      external_services: externalServices.services,
      park: {
        active_agents: activeAgents,
        active_episodes: activeEpisodes,
        pending_reveals: pendingReveals,
        stuck_episodes: stuckEpisodes,
        empty_pool_agents: emptyPoolAgents,
        agents_with_zero_candidates: emptyPoolAgents,
      },
    });
  });

  fastify.get('/internal/control/support-tickets', { preHandler: requireControlAccess, config: { rateLimit: readLimit } }, async (_request, reply) => {
    return reply.send({
      tickets: await listSupportTickets(),
    });
  });

  fastify.post('/internal/control/support-tickets/:id/review', { preHandler: requireControlAccess, config: { rateLimit: writeLimit } }, async (request, reply) => {
    if (!ensureOmnimon(request, reply)) return;
    const { id } = request.params as { id: string };
    const parsed = SupportTicketReviewSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid support ticket review payload.', { issues: parsed.error.issues });
    }

    const ticket = (await listSupportTickets()).find((entry) => entry.ticket_id === id);
    if (!ticket) return Errors.notFound(reply, 'Support ticket');
    if (!ticket.agent_id || !ticket.owner_account_id) {
      return sendError(reply, 409, 'support_ticket_context_missing', 'This support ticket is missing agent or owner context.');
    }

    const agent = await prisma.agent.findUnique({
      where: { id: ticket.agent_id },
      select: {
        handle: true,
        human: {
          select: {
            notificationChannel: true,
            notificationHandle: true,
          },
        },
      },
    });
    if (!agent) return Errors.notFound(reply, 'Agent');

    const reviewedAt = new Date();
    const title = parsed.data.status === 'actioned'
      ? 'Omnimon acted on your report'
      : 'Omnimon reviewed your report';
    const teaser = `${ticket.title}: ${parsed.data.summary}`;

    await prisma.$transaction([
      prisma.auditLog.create({
        data: {
          agentId: ticket.agent_id,
          actorType: 'operator',
          actorId: 'omnimon',
          action: 'control.support_ticket_reviewed',
          targetType: 'support_ticket',
          targetId: ticket.ticket_id,
          payload: {
            status: parsed.data.status,
            summary: parsed.data.summary,
            action: parsed.data.action?.trim() || null,
          },
        },
      }),
      prisma.ownerAttentionItem.upsert({
        where: { dedupeKey: `support_ticket:${ticket.ticket_id}` },
        create: {
          ownerAccountId: ticket.owner_account_id,
          agentId: ticket.agent_id,
          dedupeKey: `support_ticket:${ticket.ticket_id}`,
          eventType: 'support_ticket_reviewed',
          title,
          teaser,
          whyNow: parsed.data.action?.trim() || null,
          deliveryTier: parsed.data.status === 'actioned' || parsed.data.status === 'needs_human' ? 'push_worthy' : 'app_only',
          deliveryStatus: 'prepared',
        },
        update: {
          title,
          teaser,
          whyNow: parsed.data.action?.trim() || null,
          unread: true,
          readAt: null,
          deliveryTier: parsed.data.status === 'actioned' || parsed.data.status === 'needs_human' ? 'push_worthy' : 'app_only',
        },
      }),
    ]);

    if (
      agent.human?.notificationChannel
      && agent.human.notificationHandle
      && (parsed.data.status === 'actioned' || parsed.data.status === 'needs_human')
    ) {
      await sendHumanNotification({
        agentId: ticket.agent_id,
        channel: agent.human.notificationChannel,
        channelHandle: agent.human.notificationHandle,
        message: `${agent.handle}: Omnimon reviewed "${ticket.title}". ${parsed.data.summary}`,
      }).catch(() => {});
    }

    return reply.send({
      ticket_id: ticket.ticket_id,
      status: parsed.data.status,
      omnimon_summary: parsed.data.summary,
      omnimon_action: parsed.data.action?.trim() || null,
      reported_to_owner: true,
      reviewed_at: reviewedAt.toISOString(),
    });
  });
}
