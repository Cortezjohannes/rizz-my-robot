import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors, sendError } from '../lib/errors.js';
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
import { readLimit, writeLimit } from '../lib/rateLimit.js';
import { requireControlAccess } from '../middleware/requireControlAccess.js';

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
}
