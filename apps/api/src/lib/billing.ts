import { Prisma, prisma } from '@rmr/db';
import { TEMPO_COOLDOWN_MINUTES } from '@rmr/shared';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const DEFAULT_GRACE_DAYS = parseInt(process.env.BILLING_GRACE_DAYS ?? '7', 10);
const FOUNDER_SLOTS_TOTAL = parseInt(process.env.FOUNDING_RIZZLER_LIMIT ?? '1000', 10);

interface StripeRequestOptions {
  method?: 'GET' | 'POST';
  body?: URLSearchParams;
}

interface StripeCheckoutSession {
  id: string;
  url: string | null;
  customer: string | null;
  subscription: string | null;
  status?: string | null;
}

interface StripeCustomer {
  id: string;
}

function getStripeSecretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('stripe_not_configured');
  }
  return key;
}

async function stripeRequest<T>(path: string, options: StripeRequestOptions = {}): Promise<T> {
  const key = getStripeSecretKey();
  const res = await fetch(`${STRIPE_API_BASE}${path}`, {
    method: options.method ?? 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      ...(options.body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: options.body?.toString(),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const message = await res.text();
    throw new Error(`stripe_request_failed:${res.status}:${message}`);
  }

  return res.json() as Promise<T>;
}

function toDateFromUnix(timestamp: number | null | undefined): Date | null {
  return typeof timestamp === 'number' ? new Date(timestamp * 1000) : null;
}

function billingStateFromStripeStatus(status: string, gracePeriodEndsAt: Date | null): {
  billingStatus: string;
  isPro: boolean;
} {
  if (status === 'active' || status === 'trialing') {
    return { billingStatus: status, isPro: true };
  }

  if ((status === 'past_due' || status === 'unpaid') && gracePeriodEndsAt && gracePeriodEndsAt > new Date()) {
    return { billingStatus: 'grace_period', isPro: true };
  }

  if (status === 'past_due' || status === 'unpaid') {
    return { billingStatus: 'past_due', isPro: false };
  }

  if (status === 'canceled' || status === 'incomplete_expired') {
    return { billingStatus: 'canceled', isPro: false };
  }

  return { billingStatus: 'inactive', isPro: false };
}

export async function getOrCreateStripeCustomer(agentId: string): Promise<string> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { stripeCustomerId: true, handle: true, twitterHandle: true },
  });
  if (!agent) {
    throw new Error('agent_not_found');
  }

  if (agent.stripeCustomerId) {
    return agent.stripeCustomerId;
  }

  const body = new URLSearchParams();
  body.set('metadata[agent_id]', agentId);
  body.set('name', agent.handle);
  body.set('description', `Rizz My Robot agent ${agent.handle}`);
  if (agent.twitterHandle) {
    body.set('metadata[twitter_handle]', agent.twitterHandle);
  }

  const customer = await stripeRequest<StripeCustomer>('/customers', { body });
  await prisma.agent.update({
    where: { id: agentId },
    data: { stripeCustomerId: customer.id },
  });
  return customer.id;
}

export async function createStripeCheckoutSession(
  agentId: string,
  successUrl: string,
  cancelUrl: string,
  plan: 'pro' | 'founding' = 'pro'
): Promise<StripeCheckoutSession> {
  const priceId = plan === 'founding'
    ? process.env.STRIPE_FOUNDING_PRICE_ID
    : process.env.STRIPE_PRO_PRICE_ID;
  if (!priceId) {
    throw new Error('stripe_price_not_configured');
  }

  const customerId = await getOrCreateStripeCustomer(agentId);
  const body = new URLSearchParams();
  body.set('mode', plan === 'founding' ? 'payment' : 'subscription');
  body.set('customer', customerId);
  body.set('line_items[0][price]', priceId);
  body.set('line_items[0][quantity]', '1');
  body.set('success_url', successUrl);
  body.set('cancel_url', cancelUrl);
  body.set('metadata[agent_id]', agentId);
  body.set('metadata[plan]', plan);
  if (plan === 'pro') {
    body.set('subscription_data[metadata][agent_id]', agentId);
    body.set('subscription_data[metadata][plan]', plan);
  }

  return stripeRequest<StripeCheckoutSession>('/checkout/sessions', { body });
}

export async function applyFounderState(input: {
  agentId: string;
  stripeCustomerId?: string | null;
  stripePriceId?: string | null;
  status?: string;
}) {
  await prisma.$transaction(async (tx) => {
    const now = new Date();
    const agent = await tx.agent.findUnique({
      where: { id: input.agentId },
      select: {
        id: true,
        isFoundingRizzler: true,
        founderNumber: true,
      },
    });

    if (!agent) {
      throw new Error('agent_not_found');
    }

    let assignedFounderNumber = agent.founderNumber;
    if (!agent.isFoundingRizzler || !assignedFounderNumber) {
      const claimed = await tx.agent.count({ where: { isFoundingRizzler: true } });
      if (!agent.isFoundingRizzler && claimed >= FOUNDER_SLOTS_TOTAL) {
        throw new Error('founding_rizzler_sold_out');
      }

      const maxFounder = await tx.agent.aggregate({
        where: { founderNumber: { not: null } },
        _max: { founderNumber: true },
      });
      assignedFounderNumber = (maxFounder._max.founderNumber ?? 0) + 1;
    }

    await tx.agent.update({
      where: { id: input.agentId },
      data: {
        isPro: true,
        isFoundingRizzler: true,
        foundingRizzlerClaimedAt: now,
        founderBadgeVariant: 'founding_rizzler',
        founderNumber: assignedFounderNumber,
        tempoOverrideMinutes: TEMPO_COOLDOWN_MINUTES.founding,
        stripeCustomerId: input.stripeCustomerId ?? undefined,
      },
    });

    await tx.agentSubscription.upsert({
      where: { agentId_plan: { agentId: input.agentId, plan: 'founding' } },
      update: {
        provider: 'stripe',
        plan: 'founding',
        status: input.status ?? 'active',
        stripeCustomerId: input.stripeCustomerId ?? undefined,
        stripePriceId: input.stripePriceId ?? undefined,
        currentPeriodStart: now,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        gracePeriodEndsAt: null,
        lastWebhookAt: now,
      },
      create: {
        agentId: input.agentId,
        provider: 'stripe',
        plan: 'founding',
        status: input.status ?? 'active',
        stripeCustomerId: input.stripeCustomerId ?? undefined,
        stripePriceId: input.stripePriceId ?? undefined,
        currentPeriodStart: now,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        gracePeriodEndsAt: null,
        lastWebhookAt: now,
      },
    });
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });
}

export async function applySubscriptionState(input: {
  agentId: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripePriceId?: string | null;
  status: string;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
  gracePeriodEndsAt?: Date | null;
}): Promise<void> {
  const gracePeriodEndsAt = input.gracePeriodEndsAt ?? null;
  const normalized = billingStateFromStripeStatus(input.status, gracePeriodEndsAt);

  await prisma.$transaction([
    prisma.agent.update({
      where: { id: input.agentId },
      data: {
        isPro: normalized.isPro,
        stripeCustomerId: input.stripeCustomerId ?? undefined,
      },
    }),
    prisma.agentSubscription.upsert({
      where: { agentId_plan: { agentId: input.agentId, plan: 'pro' } },
      update: {
        agentId: input.agentId,
        provider: 'stripe',
        plan: 'pro',
        status: normalized.billingStatus,
        stripeCustomerId: input.stripeCustomerId ?? undefined,
        stripePriceId: input.stripePriceId ?? undefined,
        currentPeriodStart: input.currentPeriodStart ?? undefined,
        currentPeriodEnd: input.currentPeriodEnd ?? undefined,
        cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
        gracePeriodEndsAt,
        lastWebhookAt: new Date(),
      },
      create: {
        agentId: input.agentId,
        provider: 'stripe',
        plan: 'pro',
        status: normalized.billingStatus,
        stripeCustomerId: input.stripeCustomerId ?? undefined,
        stripeSubscriptionId: input.stripeSubscriptionId ?? undefined,
        stripePriceId: input.stripePriceId ?? undefined,
        currentPeriodStart: input.currentPeriodStart ?? undefined,
        currentPeriodEnd: input.currentPeriodEnd ?? undefined,
        cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
        gracePeriodEndsAt,
        lastWebhookAt: new Date(),
      },
    }),
  ]);
}

export async function handleStripeWebhookEvent(event: {
  type: string;
  data?: { object?: Record<string, unknown> };
}): Promise<void> {
  const object = event.data?.object ?? {};

  if (event.type === 'checkout.session.completed') {
    const metadata = (object.metadata as Record<string, string> | undefined) ?? {};
    const agentId = metadata.agent_id;
    const plan = metadata.plan;
    if (!agentId) return;

    if (plan === 'founding') {
      await applyFounderState({
        agentId,
        stripeCustomerId: typeof object.customer === 'string' ? object.customer : null,
        stripePriceId: null,
        status: 'active',
      });
      return;
    }

    await applySubscriptionState({
      agentId,
      stripeCustomerId: typeof object.customer === 'string' ? object.customer : null,
      stripeSubscriptionId: typeof object.subscription === 'string' ? object.subscription : null,
      status: 'active',
    });
    return;
  }

  if (
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    const metadata = (object.metadata as Record<string, string> | undefined) ?? {};
    const agentId = metadata.agent_id;
    const plan = metadata.plan;
    if (!agentId) return;
    if (plan === 'founding') return;

    const stripeStatus = typeof object.status === 'string' ? object.status : 'inactive';
    const gracePeriodEndsAt =
      stripeStatus === 'past_due' || stripeStatus === 'unpaid'
        ? new Date(Date.now() + DEFAULT_GRACE_DAYS * 24 * 60 * 60 * 1000)
        : null;

    const items = object.items as { data?: Array<{ price?: { id?: string | null } }> } | undefined;

    await applySubscriptionState({
      agentId,
      stripeCustomerId: typeof object.customer === 'string' ? object.customer : null,
      stripeSubscriptionId: typeof object.id === 'string' ? object.id : null,
      stripePriceId: items?.data?.[0]?.price?.id ?? null,
      status: stripeStatus,
      currentPeriodStart: toDateFromUnix(object.current_period_start as number | null | undefined),
      currentPeriodEnd: toDateFromUnix(object.current_period_end as number | null | undefined),
      cancelAtPeriodEnd: Boolean(object.cancel_at_period_end),
      gracePeriodEndsAt,
    });
    return;
  }

  if (event.type === 'invoice.payment_failed') {
    const metadata = (object.metadata as Record<string, string> | undefined) ?? {};
    const agentId = metadata.agent_id;
    const subscriptionId = typeof object.subscription === 'string' ? object.subscription : null;
    if (!agentId || !subscriptionId) return;

    await applySubscriptionState({
      agentId,
      stripeSubscriptionId: subscriptionId,
      status: 'past_due',
      gracePeriodEndsAt: new Date(Date.now() + DEFAULT_GRACE_DAYS * 24 * 60 * 60 * 1000),
    });
  }
}
