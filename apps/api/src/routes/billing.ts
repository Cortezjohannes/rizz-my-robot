import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { BillingCheckoutSchema } from '@rmr/shared';
import { createRevenueCatCheckoutSession, handleRevenueCatWebhookEvent } from '../lib/billing.js';
import { buildExperienceVelocityState } from '../lib/continuity.js';
import { isEffectivelyPro } from '../lib/entitlements.js';
import { getFounderScarcity } from '../lib/socialStatus.js';
import { recordAnalyticsEvent } from '../lib/analytics.js';
import { recordAuditLog } from '../lib/audit.js';
import { sendError, Errors } from '../lib/errors.js';
import { requireAuth } from '../middleware/requireAuth.js';
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

function getRevenueCatWebhookToken(): string | null {
  return process.env.REVENUECAT_WEBHOOK_AUTH_TOKEN ?? null;
}

function hasValidRevenueCatWebhookAuth(request: {
  headers: Record<string, string | string[] | undefined>;
}): boolean {
  const configured = getRevenueCatWebhookToken();
  if (!configured) return false;

  const authorizationHeader = request.headers.authorization;
  const raw = Array.isArray(authorizationHeader) ? authorizationHeader[0] : authorizationHeader;
  if (!raw) return false;
  return raw === `Bearer ${configured}` || raw === configured;
}

export async function billingRoutes(fastify: FastifyInstance) {
  fastify.get('/me/billing', { preHandler: requireAuth }, async (request, reply) => {
    const agentId = request.agent.id;
    const [agent, subscriptions, founderScarcity] = await Promise.all([
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

    return reply.send({
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
      provider_customer_id: agent?.stripeCustomerId ?? subscription?.stripeCustomerId ?? null,
      stripe_customer_id: agent?.stripeCustomerId ?? subscription?.stripeCustomerId ?? null,
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
    });
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
    if ((!wantsFounder && !process.env.REVENUECAT_PRO_CHECKOUT_URL) || (wantsFounder && !process.env.REVENUECAT_FOUNDING_CHECKOUT_URL)) {
      return sendError(reply, 503, 'billing_unavailable', 'RevenueCat billing is not configured.');
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

      const ownerAccount = await prisma.agent.findUnique({
        where: { id: request.agent.id },
        select: {
          ownerAccount: {
            select: {
              email: true,
            },
          },
        },
      });

      const session = await createRevenueCatCheckoutSession(
        request.agent.id,
        successUrl,
        parsed.data.plan,
        ownerAccount?.ownerAccount?.email ?? null,
      );

      await Promise.all([
        recordAnalyticsEvent({
          agentId: request.agent.id,
          kind: 'billing_checkout_created',
          properties: { checkout_session_id: session.id, plan: parsed.data.plan, provider: 'revenuecat' },
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
        provider: 'revenuecat',
        plan: parsed.data.plan,
        cancel_url: cancelUrl,
      });
    } catch (err) {
      request.log.error({ err, agentId: request.agent.id }, 'Failed to create RevenueCat checkout session');
      return sendError(reply, 502, 'billing_provider_failure', 'Failed to create RevenueCat checkout session.');
    }
  });

  const handleRevenueCatWebhook = async (request: any, reply: any) => {
    if (!getRevenueCatWebhookToken()) {
      return sendError(reply, 503, 'billing_unavailable', 'RevenueCat billing is not configured.');
    }

    if (!hasValidRevenueCatWebhookAuth(request)) {
      return sendError(reply, 401, 'invalid_signature', 'Invalid RevenueCat webhook authorization.');
    }

    const payload = (request.body ?? {}) as Record<string, unknown>;
    const nested = payload.event;
    const event = nested && typeof nested === 'object' && !Array.isArray(nested)
      ? nested as Record<string, unknown>
      : payload;
    const eventType = typeof event.type === 'string' ? event.type : null;
    if (!eventType) {
      return Errors.badRequest(reply, 'RevenueCat webhook payload must include an event type.');
    }

    const eventId = typeof event.id === 'string'
      ? event.id
      : `${eventType}:${typeof event.app_user_id === 'string' ? event.app_user_id : 'unknown'}:${typeof event.event_timestamp_ms === 'number' ? event.event_timestamp_ms : Date.now()}`;

    if (eventId) {
      const alreadyProcessed = await prisma.auditLog.findFirst({
        where: { action: `billing.${eventType}`, actorId: eventId },
        select: { id: true },
      });
      if (alreadyProcessed) {
        return reply.send({ received: true, duplicate: true });
      }
    }

    let processedAgentId: string | null = null;
    try {
      const handled = await handleRevenueCatWebhookEvent(payload);
      processedAgentId = handled.agentId;
    } catch (err) {
      request.log.error({ err, revenueCatEventType: eventType, revenueCatEventId: eventId }, 'RevenueCat webhook handler failed');
      return sendError(reply, 500, 'billing_webhook_failed', 'RevenueCat webhook processing failed.');
    }

    if (processedAgentId) {
      await Promise.all([
        recordAnalyticsEvent({
          agentId: processedAgentId,
          kind: 'billing_webhook_processed',
          properties: { revenuecat_event_type: eventType, revenuecat_event_id: eventId },
        }),
        recordAuditLog({
          agentId: processedAgentId,
          actorType: 'billing_provider',
          actorId: eventId,
          action: `billing.${eventType}`,
          targetType: 'agent',
          targetId: processedAgentId,
        }),
      ]).catch((err) => {
        request.log.warn({ err, agentId: processedAgentId }, 'Failed to record billing analytics/audit after webhook');
      });
    }

    return reply.send({ received: true });
  };

  fastify.post('/billing/webhook', handleRevenueCatWebhook);
  fastify.post('/billing/revenuecat/webhook', handleRevenueCatWebhook);

  fastify.post('/billing/paddle/webhook', async (_request, reply) => {
    return sendError(reply, 410, 'billing_provider_retired', 'Paddle billing has been retired. Use the RevenueCat webhook endpoint instead.', {
      canonical_endpoint: '/v1/billing/webhook',
    });
  });
}
