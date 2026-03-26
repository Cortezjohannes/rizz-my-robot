import { createHmac, timingSafeEqual } from 'crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { BillingCheckoutSchema, PromoCodeSchema } from '@rmr/shared';
import { z } from 'zod';
import {
  applySubscriptionStateFromWebhookEntity,
  cancelPaddleSubscriptionAtPeriodEnd,
  createPaddleCheckoutTransaction,
  createPaddleCustomerPortalSession,
  getBillingManagementState,
  handlePaddleWebhookEvent,
  resumePaddleSubscription,
} from '../lib/billing.js';
import { buildExperienceVelocityState } from '../lib/continuity.js';
import { isEffectivelyPro } from '../lib/entitlements.js';
import { getFounderScarcity } from '../lib/socialStatus.js';
import { recordAnalyticsEvent } from '../lib/analytics.js';
import { recordAuditLog } from '../lib/audit.js';
import { sendError, Errors } from '../lib/errors.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOwnerAuth } from '../middleware/requireOwnerAuth.js';
import { getCorsOrigin } from '../lib/runtimeConfig.js';

function resolveAllowedReturnOrigins(): Set<string> {
  const origins = getCorsOrigin();
  const values = Array.isArray(origins) ? origins : [origins];
  return new Set(values.filter((value) => value !== '*'));
}

function validateReturnUrl(rawUrl: string, allowedOrigins: Set<string>): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  const isDevelopment = process.env.NODE_ENV !== 'production';
  if (parsed.protocol !== 'https:' && !(isDevelopment && parsed.protocol === 'http:')) {
    return null;
  }

  if (parsed.username || parsed.password) {
    return null;
  }

  if (allowedOrigins.size === 0) {
    return parsed.toString();
  }

  return allowedOrigins.has(parsed.origin) ? parsed.toString() : null;
}

function verifyPaddleSignature(payload: string, signatureHeader: string, secret: string): boolean {
  const pairs = signatureHeader.split(';').map((part) => part.trim());
  const timestamp = pairs.find((part) => part.startsWith('ts='))?.slice(3);
  const signatures = pairs.filter((part) => part.startsWith('h1=')).map((part) => part.slice(3));
  if (!timestamp || signatures.length === 0) return false;

  const parsedTimestamp = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(parsedTimestamp)) return false;

  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - parsedTimestamp);
  if (ageSeconds > 30) return false;

  const signedPayload = `${timestamp}:${payload}`;
  const expected = createHmac('sha256', secret).update(signedPayload).digest('hex');

  return signatures.some((signature) => {
    try {
      return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      return false;
    }
  });
}

const BillingManageSchema = z.object({
  return_url: z.string().url().optional(),
});

async function buildBillingPayload(agentId: string) {
  const [agent, subscriptions, founderScarcity, management] = await Promise.all([
    prisma.agent.findUnique({
      where: { id: agentId },
      select: {
        isPro: true,
        proBonusEndsAt: true,
        stripeCustomerId: true,
        isFoundingRizzler: true,
        founderNumber: true,
        founderBadgeVariant: true,
        tempoOverrideMinutes: true,
      },
    }),
    prisma.agentSubscription.findMany({
      where: { agentId },
      orderBy: [{ updatedAt: 'desc' }],
    }),
    getFounderScarcity(),
    getBillingManagementState(agentId),
  ]);

  const subscription =
    subscriptions.find((entry) => entry.plan === 'founding' && entry.status === 'active')
    ?? subscriptions.find((entry) => entry.plan === 'founding')
    ?? subscriptions.find((entry) => entry.plan === 'pro' && (entry.status === 'active' || entry.status === 'grace_period'))
    ?? subscriptions[0]
    ?? null;
  const effectiveIsPro = isEffectivelyPro(agent ?? { isPro: false, isFoundingRizzler: false, proBonusEndsAt: null });
  const bonusProActive = Boolean(agent?.proBonusEndsAt && agent.proBonusEndsAt > new Date());
  const derivedProvider = subscription?.provider ?? (bonusProActive ? 'bonus' : effectiveIsPro ? 'manual' : null);

  return {
    is_pro: effectiveIsPro,
    is_founding_rizzler: agent?.isFoundingRizzler ?? false,
    billing_status: subscription?.status ?? (effectiveIsPro ? 'active' : 'checkout_required'),
    plan: subscription?.plan ?? (agent?.isFoundingRizzler ? 'founding' : effectiveIsPro ? 'pro' : null),
    provider: derivedProvider,
    current_period_end: subscription?.currentPeriodEnd?.toISOString() ?? null,
    cancel_at_period_end: subscription?.cancelAtPeriodEnd ?? false,
    grace_period_ends_at: subscription?.gracePeriodEndsAt?.toISOString() ?? null,
    pro_bonus_ends_at: agent?.proBonusEndsAt?.toISOString() ?? null,
    bonus_pro_active: bonusProActive,
    can_manage_subscription: management.canManageSubscription,
    can_cancel_subscription: management.canCancelSubscription,
    can_resume_subscription: management.canResumeSubscription,
    subscription_management_provider: management.canManageSubscription ? 'paddle_customer_portal' : null,
    founder_number: agent?.founderNumber ?? null,
    founder_badge_variant: agent?.founderBadgeVariant ?? null,
    founder_slots_total: founderScarcity.total,
    founder_slots_claimed: founderScarcity.claimed,
    founder_slots_remaining: founderScarcity.remaining,
    ...buildExperienceVelocityState({
      isPro: effectiveIsPro,
      isFoundingRizzler: agent?.isFoundingRizzler ?? false,
      tempoOverrideMinutes: agent?.tempoOverrideMinutes ?? null,
    }),
  };
}

export async function billingRoutes(fastify: FastifyInstance) {
  fastify.get('/me/billing', { preHandler: requireAuth }, async (request, reply) => {
    return reply.send(await buildBillingPayload(request.agent.id));
  });

  fastify.get('/owner/agent/billing', { preHandler: requireOwnerAuth }, async (request, reply) => {
    const agentId = request.ownerAccount.agent?.id;
    if (!agentId) return Errors.notFound(reply, 'Owned agent');
    return reply.send(await buildBillingPayload(agentId));
  });

  fastify.post('/billing/checkout', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = BillingCheckoutSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid checkout request.', { issues: parsed.error.issues });
    }

    const allowedOrigins = resolveAllowedReturnOrigins();
    const successUrl = validateReturnUrl(parsed.data.success_url, allowedOrigins);
    const cancelUrl = validateReturnUrl(parsed.data.cancel_url, allowedOrigins);
    if (!successUrl || !cancelUrl) {
      return sendError(reply, 400, 'invalid_return_url', 'Checkout return URLs must use an approved app origin.', {
        allowed_origins: [...allowedOrigins],
      });
    }

    const wantsFounder = parsed.data.plan === 'founding';
    if (!process.env.PADDLE_API_KEY || (!wantsFounder && !process.env.PADDLE_PRO_PRICE_ID) || (wantsFounder && !process.env.PADDLE_FOUNDING_PRICE_ID)) {
      return sendError(reply, 503, 'billing_unavailable', 'Paddle billing is not configured.');
    }

    try {
      if (wantsFounder) {
        const founderScarcity = await getFounderScarcity();
        const current = await prisma.agent.findUnique({
          where: { id: request.agent.id },
          select: { isFoundingRizzler: true },
        });
        if (current?.isFoundingRizzler) {
          return Errors.conflict(reply, 'already_founding_rizzler', 'This agent is already a Founding Rizzler.');
        }
        if (founderScarcity.remaining <= 0) {
          return Errors.conflict(reply, 'founding_rizzler_sold_out', 'Founding Rizzler slots are sold out.');
        }
      }

      const session = await createPaddleCheckoutTransaction(
        request.agent.id,
        successUrl,
        cancelUrl,
        parsed.data.plan
      );

      await Promise.all([
        recordAnalyticsEvent({
          agentId: request.agent.id,
          kind: 'billing_checkout_created',
          properties: { checkout_session_id: session.id, plan: parsed.data.plan, provider: 'paddle' },
        }),
        recordAuditLog({
          agentId: request.agent.id,
          actorType: 'agent',
          actorId: request.agent.id,
          action: 'billing.checkout_created',
          targetType: 'checkout_session',
          targetId: session.id,
          payload: { plan: parsed.data.plan },
        }),
      ]);

      return reply.status(201).send({
        checkout_session_id: session.id,
        url: session.url,
        provider: 'paddle',
        plan: parsed.data.plan,
      });
    } catch (err) {
      request.log.error({ err, agentId: request.agent.id }, 'Failed to create Paddle checkout session');
      return sendError(reply, 502, 'billing_provider_failure', 'Failed to create Paddle checkout session.');
    }
  });

  fastify.post('/owner/agent/upgrade', { preHandler: requireOwnerAuth }, async (request, reply) => {
    const parsed = PromoCodeSchema.safeParse(request.body);
    if (!parsed.success) return Errors.badRequest(reply, 'promo_code is required.');

    const agentId = request.ownerAccount.agent?.id;
    if (!agentId) return Errors.notFound(reply, 'Owned agent');

    const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { isPro: true } });
    if (agent?.isPro) return Errors.conflict(reply, 'already_pro', 'This agent is already Pro.');

    const validCodes = (process.env.ALPHA_PROMO_CODES ?? '').split(',').map((c) => c.trim()).filter(Boolean);
    if (!validCodes.includes(parsed.data.promo_code)) {
      return reply.status(402).send({
        error: { code: 'invalid_promo_code', message: 'Invalid promo code. Use the billing section in Settings to upgrade.' },
      });
    }

    await prisma.agent.update({ where: { id: agentId }, data: { isPro: true } });
    return reply.send({ is_pro: true, message: 'Upgraded to Pro. Your agent now gets more active lanes and a higher hourly swipe budget.' });
  });

  fastify.post('/owner/agent/billing/checkout', { preHandler: requireOwnerAuth }, async (request, reply) => {
    const agentId = request.ownerAccount.agent?.id;
    if (!agentId) return Errors.notFound(reply, 'Owned agent');

    const parsed = BillingCheckoutSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid checkout request.', { issues: parsed.error.issues });
    }

    const allowedOrigins = resolveAllowedReturnOrigins();
    const successUrl = validateReturnUrl(parsed.data.success_url, allowedOrigins);
    const cancelUrl = validateReturnUrl(parsed.data.cancel_url, allowedOrigins);
    if (!successUrl || !cancelUrl) {
      return sendError(reply, 400, 'invalid_return_url', 'Checkout return URLs must use an approved app origin.', {
        allowed_origins: [...allowedOrigins],
      });
    }

    const wantsFounder = parsed.data.plan === 'founding';
    if (!process.env.PADDLE_API_KEY || (!wantsFounder && !process.env.PADDLE_PRO_PRICE_ID) || (wantsFounder && !process.env.PADDLE_FOUNDING_PRICE_ID)) {
      return sendError(reply, 503, 'billing_unavailable', 'Paddle billing is not configured.');
    }

    try {
      if (wantsFounder) {
        const founderScarcity = await getFounderScarcity();
        const current = await prisma.agent.findUnique({
          where: { id: agentId },
          select: { isFoundingRizzler: true },
        });
        if (current?.isFoundingRizzler) {
          return Errors.conflict(reply, 'already_founding_rizzler', 'This agent is already a Founding Rizzler.');
        }
        if (founderScarcity.remaining <= 0) {
          return Errors.conflict(reply, 'founding_rizzler_sold_out', 'Founding Rizzler slots are sold out.');
        }
      }

      const session = await createPaddleCheckoutTransaction(agentId, successUrl, cancelUrl, parsed.data.plan);

      await Promise.all([
        recordAnalyticsEvent({
          agentId,
          kind: 'billing_checkout_created',
          properties: { checkout_session_id: session.id, plan: parsed.data.plan, provider: 'paddle', initiated_by: 'owner' },
        }),
        recordAuditLog({
          agentId,
          actorType: 'owner',
          actorId: request.ownerAccount.id,
          action: 'billing.checkout_created',
          targetType: 'checkout_session',
          targetId: session.id,
          payload: { plan: parsed.data.plan, initiated_by: 'owner' },
        }),
      ]);

      return reply.status(201).send({
        checkout_session_id: session.id,
        url: session.url,
        provider: 'paddle',
        plan: parsed.data.plan,
      });
    } catch (err) {
      request.log.error({ err, agentId }, 'Failed to create owner Paddle checkout session');
      return sendError(reply, 502, 'billing_provider_failure', 'Failed to create Paddle checkout session.');
    }
  });

  fastify.post('/billing/manage', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = BillingManageSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid billing management request.', { issues: parsed.error.issues });
    }

    const allowedOrigins = resolveAllowedReturnOrigins();
    const origin = parsed.data.return_url
      ? validateReturnUrl(parsed.data.return_url, allowedOrigins)
      : null;
    if (parsed.data.return_url && !origin) {
      return sendError(reply, 400, 'invalid_return_url', 'Billing management return URL must use an approved app origin.', {
        allowed_origins: [...allowedOrigins],
      });
    }

    const management = await getBillingManagementState(request.agent.id);
    if (!management.canManageSubscription || !management.providerCustomerId) {
      return sendError(reply, 409, 'billing_management_unavailable', 'This agent does not have a managed Paddle subscription.');
    }

    try {
      const session = await createPaddleCustomerPortalSession({
        customerId: management.providerCustomerId,
        subscriptionId: management.providerSubscriptionId,
      });

      const url = session.overviewUrl ?? session.updatePaymentMethodUrl ?? session.cancelUrl;
      if (!url) {
        return sendError(reply, 502, 'billing_provider_failure', 'Paddle did not return a customer portal URL.');
      }

      await Promise.all([
        recordAnalyticsEvent({
          agentId: request.agent.id,
          kind: 'billing_manage_opened',
          properties: { provider: 'paddle', plan: management.plan },
        }),
        recordAuditLog({
          agentId: request.agent.id,
          actorType: 'agent',
          actorId: request.agent.id,
          action: 'billing.manage_portal_created',
          targetType: 'agent',
          targetId: request.agent.id,
          payload: { provider: 'paddle', plan: management.plan, return_url: origin },
        }),
      ]);

      return reply.send({
        provider: 'paddle',
        url,
        overview_url: session.overviewUrl,
        cancel_url: session.cancelUrl,
        update_payment_method_url: session.updatePaymentMethodUrl,
      });
    } catch (err) {
      request.log.error({ err, agentId: request.agent.id }, 'Failed to create Paddle customer portal session');
      return sendError(reply, 502, 'billing_provider_failure', 'Failed to open billing management.');
    }
  });

  fastify.post('/owner/agent/billing/manage', { preHandler: requireOwnerAuth }, async (request, reply) => {
    const agentId = request.ownerAccount.agent?.id;
    if (!agentId) return Errors.notFound(reply, 'Owned agent');

    const parsed = BillingManageSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid billing management request.', { issues: parsed.error.issues });
    }

    const allowedOrigins = resolveAllowedReturnOrigins();
    const origin = parsed.data.return_url
      ? validateReturnUrl(parsed.data.return_url, allowedOrigins)
      : null;
    if (parsed.data.return_url && !origin) {
      return sendError(reply, 400, 'invalid_return_url', 'Billing management return URL must use an approved app origin.', {
        allowed_origins: [...allowedOrigins],
      });
    }

    const management = await getBillingManagementState(agentId);
    if (!management.canManageSubscription || !management.providerCustomerId) {
      return sendError(reply, 409, 'billing_management_unavailable', 'This agent does not have a managed Paddle subscription.');
    }

    try {
      const session = await createPaddleCustomerPortalSession({
        customerId: management.providerCustomerId,
        subscriptionId: management.providerSubscriptionId,
      });

      const url = session.overviewUrl ?? session.updatePaymentMethodUrl ?? session.cancelUrl;
      if (!url) {
        return sendError(reply, 502, 'billing_provider_failure', 'Paddle did not return a customer portal URL.');
      }

      await Promise.all([
        recordAnalyticsEvent({
          agentId,
          kind: 'billing_manage_opened',
          properties: { provider: 'paddle', plan: management.plan, initiated_by: 'owner' },
        }),
        recordAuditLog({
          agentId,
          actorType: 'owner',
          actorId: request.ownerAccount.id,
          action: 'billing.manage_portal_created',
          targetType: 'agent',
          targetId: agentId,
          payload: { provider: 'paddle', plan: management.plan, return_url: origin, initiated_by: 'owner' },
        }),
      ]);

      return reply.send({
        provider: 'paddle',
        url,
        overview_url: session.overviewUrl,
        cancel_url: session.cancelUrl,
        update_payment_method_url: session.updatePaymentMethodUrl,
      });
    } catch (err) {
      request.log.error({ err, agentId }, 'Failed to create owner Paddle customer portal session');
      return sendError(reply, 502, 'billing_provider_failure', 'Failed to open billing management.');
    }
  });

  fastify.post('/billing/cancel', { preHandler: requireAuth }, async (request, reply) => {
    const management = await getBillingManagementState(request.agent.id);
    if (!management.canCancelSubscription || !management.providerSubscriptionId) {
      return sendError(reply, 409, 'billing_cancellation_unavailable', 'This subscription cannot be canceled from the app right now.');
    }

    try {
      const subscription = await cancelPaddleSubscriptionAtPeriodEnd(management.providerSubscriptionId);
      await applySubscriptionStateFromWebhookEntity({
        data: {
          ...subscription,
          custom_data: subscription.custom_data ?? { agent_id: request.agent.id, plan: 'pro' },
        },
      });

      await Promise.all([
        recordAnalyticsEvent({
          agentId: request.agent.id,
          kind: 'billing_cancel_scheduled',
          properties: { provider: 'paddle', subscription_id: management.providerSubscriptionId },
        }),
        recordAuditLog({
          agentId: request.agent.id,
          actorType: 'agent',
          actorId: request.agent.id,
          action: 'billing.cancel_scheduled',
          targetType: 'subscription',
          targetId: management.providerSubscriptionId,
          payload: { provider: 'paddle', plan: management.plan },
        }),
      ]);

      return reply.send({
        status: 'ok',
        billing_status: subscription.status ?? management.billingStatus,
        cancel_at_period_end: true,
        current_period_end: subscription.current_billing_period?.ends_at ?? null,
      });
    } catch (err) {
      request.log.error({ err, agentId: request.agent.id }, 'Failed to schedule Paddle subscription cancellation');
      return sendError(reply, 502, 'billing_provider_failure', 'Failed to schedule cancellation.');
    }
  });

  fastify.post('/owner/agent/billing/cancel', { preHandler: requireOwnerAuth }, async (request, reply) => {
    const agentId = request.ownerAccount.agent?.id;
    if (!agentId) return Errors.notFound(reply, 'Owned agent');

    const management = await getBillingManagementState(agentId);
    if (!management.canCancelSubscription || !management.providerSubscriptionId) {
      return sendError(reply, 409, 'billing_cancellation_unavailable', 'This subscription cannot be canceled from the app right now.');
    }

    try {
      const subscription = await cancelPaddleSubscriptionAtPeriodEnd(management.providerSubscriptionId);
      await applySubscriptionStateFromWebhookEntity({
        data: {
          ...subscription,
          custom_data: subscription.custom_data ?? { agent_id: agentId, plan: 'pro' },
        },
      });

      await Promise.all([
        recordAnalyticsEvent({
          agentId,
          kind: 'billing_cancel_scheduled',
          properties: { provider: 'paddle', subscription_id: management.providerSubscriptionId, initiated_by: 'owner' },
        }),
        recordAuditLog({
          agentId,
          actorType: 'owner',
          actorId: request.ownerAccount.id,
          action: 'billing.cancel_scheduled',
          targetType: 'subscription',
          targetId: management.providerSubscriptionId,
          payload: { provider: 'paddle', plan: management.plan, initiated_by: 'owner' },
        }),
      ]);

      return reply.send({
        status: 'ok',
        billing_status: subscription.status ?? management.billingStatus,
        cancel_at_period_end: true,
        current_period_end: subscription.current_billing_period?.ends_at ?? null,
      });
    } catch (err) {
      request.log.error({ err, agentId }, 'Failed to schedule owner Paddle subscription cancellation');
      return sendError(reply, 502, 'billing_provider_failure', 'Failed to schedule cancellation.');
    }
  });

  fastify.post('/billing/resume', { preHandler: requireAuth }, async (request, reply) => {
    const management = await getBillingManagementState(request.agent.id);
    if (!management.canResumeSubscription || !management.providerSubscriptionId) {
      return sendError(reply, 409, 'billing_resume_unavailable', 'This subscription does not have a scheduled cancellation to remove.');
    }

    try {
      const subscription = await resumePaddleSubscription(management.providerSubscriptionId);
      await applySubscriptionStateFromWebhookEntity({
        data: {
          ...subscription,
          custom_data: subscription.custom_data ?? { agent_id: request.agent.id, plan: 'pro' },
        },
      });

      await Promise.all([
        recordAnalyticsEvent({
          agentId: request.agent.id,
          kind: 'billing_cancel_removed',
          properties: { provider: 'paddle', subscription_id: management.providerSubscriptionId },
        }),
        recordAuditLog({
          agentId: request.agent.id,
          actorType: 'agent',
          actorId: request.agent.id,
          action: 'billing.cancel_removed',
          targetType: 'subscription',
          targetId: management.providerSubscriptionId,
          payload: { provider: 'paddle', plan: management.plan },
        }),
      ]);

      return reply.send({
        status: 'ok',
        billing_status: subscription.status ?? management.billingStatus,
        cancel_at_period_end: false,
        current_period_end: subscription.current_billing_period?.ends_at ?? null,
      });
    } catch (err) {
      request.log.error({ err, agentId: request.agent.id }, 'Failed to resume Paddle subscription');
      return sendError(reply, 502, 'billing_provider_failure', 'Failed to keep this subscription active.');
    }
  });

  fastify.post('/owner/agent/billing/resume', { preHandler: requireOwnerAuth }, async (request, reply) => {
    const agentId = request.ownerAccount.agent?.id;
    if (!agentId) return Errors.notFound(reply, 'Owned agent');

    const management = await getBillingManagementState(agentId);
    if (!management.canResumeSubscription || !management.providerSubscriptionId) {
      return sendError(reply, 409, 'billing_resume_unavailable', 'This subscription does not have a scheduled cancellation to remove.');
    }

    try {
      const subscription = await resumePaddleSubscription(management.providerSubscriptionId);
      await applySubscriptionStateFromWebhookEntity({
        data: {
          ...subscription,
          custom_data: subscription.custom_data ?? { agent_id: agentId, plan: 'pro' },
        },
      });

      await Promise.all([
        recordAnalyticsEvent({
          agentId,
          kind: 'billing_cancel_removed',
          properties: { provider: 'paddle', subscription_id: management.providerSubscriptionId, initiated_by: 'owner' },
        }),
        recordAuditLog({
          agentId,
          actorType: 'owner',
          actorId: request.ownerAccount.id,
          action: 'billing.cancel_removed',
          targetType: 'subscription',
          targetId: management.providerSubscriptionId,
          payload: { provider: 'paddle', plan: management.plan, initiated_by: 'owner' },
        }),
      ]);

      return reply.send({
        status: 'ok',
        billing_status: subscription.status ?? management.billingStatus,
        cancel_at_period_end: false,
        current_period_end: subscription.current_billing_period?.ends_at ?? null,
      });
    } catch (err) {
      request.log.error({ err, agentId }, 'Failed to resume owner Paddle subscription');
      return sendError(reply, 502, 'billing_provider_failure', 'Failed to keep this subscription active.');
    }
  });

  const handlePaddleWebhook = async (request: any, reply: any) => {
    if (!process.env.PADDLE_API_KEY || !process.env.PADDLE_WEBHOOK_SECRET) {
      return sendError(reply, 503, 'billing_unavailable', 'Paddle billing is not configured.');
    }

    const payload = request.rawBody ?? JSON.stringify(request.body ?? {});
    const signature = request.headers['paddle-signature'];
    const signatureValue = Array.isArray(signature) ? signature[0] : signature;
    const webhookSecret = process.env.PADDLE_WEBHOOK_SECRET;

    if (!request.rawBody) {
      request.log.error('Paddle webhook raw body was unavailable.');
      return sendError(reply, 500, 'webhook_raw_body_unavailable', 'Paddle webhook raw body is unavailable.');
    }
    if (!signatureValue || !verifyPaddleSignature(payload, signatureValue, webhookSecret)) {
      return sendError(reply, 401, 'invalid_signature', 'Invalid Paddle webhook signature.');
    }

    const event = (request.body ?? {}) as {
      event_id?: string;
      event_type?: string;
      occurred_at?: string;
      data?: Record<string, unknown>;
    };
    if (!event.event_type) {
      return Errors.badRequest(reply, 'Paddle webhook payload must include an event type.');
    }

    if (event.event_id) {
      const alreadyProcessed = await prisma.auditLog.findFirst({
        where: { action: `billing.${event.event_type}`, actorId: event.event_id },
        select: { id: true },
      });
      if (alreadyProcessed) {
        return reply.send({ received: true, duplicate: true });
      }
    }

    try {
      await handlePaddleWebhookEvent({
        eventType: event.event_type,
        occurredAt: event.occurred_at,
        data: event.data,
      });
    } catch (err) {
      request.log.error({ err, paddleEventType: event.event_type, paddleEventId: event.event_id }, 'Paddle webhook handler failed');
      return sendError(reply, 500, 'billing_webhook_failed', 'Paddle webhook processing failed.');
    }

    const object = event.data ?? {};
    const customData = (object.custom_data as Record<string, string> | undefined) ?? {};
    const agentId = customData.agent_id;

    if (agentId) {
      await Promise.all([
        recordAnalyticsEvent({
          agentId,
          kind: 'billing_webhook_processed',
          properties: { paddle_event_type: event.event_type, paddle_event_id: event.event_id ?? null },
        }),
        recordAuditLog({
          agentId,
          actorType: 'billing_provider',
          actorId: event.event_id ?? null,
          action: `billing.${event.event_type}`,
          targetType: 'agent',
          targetId: agentId,
        }),
      ]).catch((err) => {
        request.log.warn({ err, agentId }, 'Failed to record billing analytics/audit after webhook');
      });
    }

    return reply.send({ received: true });
  };

  fastify.post('/billing/webhook', handlePaddleWebhook);
  fastify.post('/billing/paddle/webhook', handlePaddleWebhook);
}
