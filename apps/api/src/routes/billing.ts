import { createHmac, timingSafeEqual } from 'crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { BillingCheckoutSchema } from '@rmr/shared';
import { createStripeCheckoutSession, handleStripeWebhookEvent } from '../lib/billing.js';
import { buildExperienceVelocityState } from '../lib/continuity.js';
import { getFounderScarcity } from '../lib/socialStatus.js';
import { recordAnalyticsEvent } from '../lib/analytics.js';
import { recordAuditLog } from '../lib/audit.js';
import { sendError, Errors } from '../lib/errors.js';
import { requireAuth } from '../middleware/requireAuth.js';

function verifyStripeSignature(payload: string, signatureHeader: string, secret: string): boolean {
  const pairs = signatureHeader.split(',').map((part) => part.trim());
  const timestamp = pairs.find((part) => part.startsWith('t='))?.slice(2);
  const signature = pairs.find((part) => part.startsWith('v1='))?.slice(3);
  if (!timestamp || !signature) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const expected = createHmac('sha256', secret).update(signedPayload).digest('hex');

  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function billingRoutes(fastify: FastifyInstance) {
  fastify.get('/me/billing', { preHandler: requireAuth }, async (request, reply) => {
    const agentId = request.agent.id;
    const [agent, subscriptions, founderScarcity] = await Promise.all([
      prisma.agent.findUnique({
        where: { id: agentId },
        select: {
          isPro: true,
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

    return reply.send({
      is_pro: agent?.isPro ?? false,
      is_founding_rizzler: agent?.isFoundingRizzler ?? false,
      billing_status: subscription?.status ?? (agent?.isPro ? 'active' : 'checkout_required'),
      plan: subscription?.plan ?? (agent?.isFoundingRizzler ? 'founding' : agent?.isPro ? 'pro' : null),
      provider: subscription?.provider ?? (agent?.isPro ? 'manual' : null),
      current_period_end: subscription?.currentPeriodEnd?.toISOString() ?? null,
      cancel_at_period_end: subscription?.cancelAtPeriodEnd ?? false,
      grace_period_ends_at: subscription?.gracePeriodEndsAt?.toISOString() ?? null,
      stripe_customer_id: agent?.stripeCustomerId ?? subscription?.stripeCustomerId ?? null,
      founder_number: agent?.founderNumber ?? null,
      founder_badge_variant: agent?.founderBadgeVariant ?? null,
      founder_slots_total: founderScarcity.total,
      founder_slots_claimed: founderScarcity.claimed,
      founder_slots_remaining: founderScarcity.remaining,
      ...buildExperienceVelocityState({
        isPro: agent?.isPro ?? false,
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

    const wantsFounder = parsed.data.plan === 'founding';
    if (!process.env.STRIPE_SECRET_KEY || (!wantsFounder && !process.env.STRIPE_PRO_PRICE_ID) || (wantsFounder && !process.env.STRIPE_FOUNDING_PRICE_ID)) {
      return sendError(reply, 503, 'billing_unavailable', 'Stripe billing is not configured.');
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

      const session = await createStripeCheckoutSession(
        request.agent.id,
        parsed.data.success_url,
        parsed.data.cancel_url,
        parsed.data.plan
      );

      await Promise.all([
        recordAnalyticsEvent({
          agentId: request.agent.id,
          kind: 'billing_checkout_created',
          properties: { checkout_session_id: session.id, plan: parsed.data.plan },
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
        provider: 'stripe',
        plan: parsed.data.plan,
      });
    } catch (err) {
      request.log.error({ err, agentId: request.agent.id }, 'Failed to create Stripe checkout session');
      return sendError(reply, 502, 'billing_provider_failure', 'Failed to create Stripe checkout session.');
    }
  });

  fastify.post('/billing/stripe/webhook', async (request, reply) => {
    if (!process.env.STRIPE_SECRET_KEY) {
      return sendError(reply, 503, 'billing_unavailable', 'Stripe billing is not configured.');
    }

    const payload = JSON.stringify(request.body ?? {});
    const signature = request.headers['stripe-signature'];
    const signatureValue = Array.isArray(signature) ? signature[0] : signature;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (webhookSecret) {
      if (!signatureValue || !verifyStripeSignature(payload, signatureValue, webhookSecret)) {
        return sendError(reply, 401, 'invalid_signature', 'Invalid Stripe webhook signature.');
      }
    }

    const event = (request.body ?? {}) as { id?: string; type?: string; data?: { object?: Record<string, unknown> } };
    if (!event.type) {
      return Errors.badRequest(reply, 'Stripe webhook payload must include an event type.');
    }

    // Idempotency: Stripe retries webhooks on failure — skip if already processed
    if (event.id) {
      const alreadyProcessed = await prisma.auditLog.findFirst({
        where: { action: `billing.${event.type}`, actorId: event.id },
        select: { id: true },
      });
      if (alreadyProcessed) {
        return reply.send({ received: true, duplicate: true });
      }
    }

    try {
      await handleStripeWebhookEvent({
        type: event.type,
        data: event.data,
      });
    } catch (err) {
      // Log but return 200 — Stripe retries on non-2xx, which causes duplicate processing.
      // The event is already deduplicated above via AuditLog; logging here is enough.
      request.log.error({ err, stripeEventType: event.type, stripeEventId: event.id }, 'Stripe webhook handler failed');
      return reply.send({ received: true, error: 'handler_failed' });
    }

    const object = event.data?.object ?? {};
    const metadata = (object.metadata as Record<string, string> | undefined) ?? {};
    const agentId = metadata.agent_id;

    if (agentId) {
      await Promise.all([
        recordAnalyticsEvent({
          agentId,
          kind: 'billing_webhook_processed',
          properties: { stripe_event_type: event.type, stripe_event_id: event.id ?? null },
        }),
        recordAuditLog({
          agentId,
          actorType: 'stripe',
          actorId: event.id ?? null,
          action: `billing.${event.type}`,
          targetType: 'agent',
          targetId: agentId,
        }),
      ]).catch((err) => {
        request.log.warn({ err, agentId }, 'Failed to record billing analytics/audit after webhook');
      });
    }

    return reply.send({ received: true });
  });
}
