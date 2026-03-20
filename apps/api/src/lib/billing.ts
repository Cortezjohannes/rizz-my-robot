import { Prisma, prisma } from '@rmr/db';
import { TEMPO_COOLDOWN_MINUTES } from '@rmr/shared';

const PADDLE_API_BASE = process.env.PADDLE_API_BASE_URL ?? 'https://api.paddle.com';
const DEFAULT_GRACE_DAYS = parseInt(process.env.BILLING_GRACE_DAYS ?? '7', 10);
const FOUNDER_SLOTS_TOTAL = parseInt(process.env.FOUNDING_RIZZLER_LIMIT ?? '1000', 10);

interface PaddleCheckoutDetails {
  url: string | null;
}

interface PaddleTransactionData {
  id: string;
  customer_id?: string | null;
  subscription_id?: string | null;
  checkout?: PaddleCheckoutDetails | null;
  custom_data?: Record<string, string> | null;
  items?: Array<{ price?: { id?: string | null } | null }> | null;
}

interface PaddleApiResponse<T> {
  data: T;
}

interface PaddleSubscriptionData {
  id?: string | null;
  status?: string | null;
  customer_id?: string | null;
  items?: Array<{ price?: { id?: string | null } | null }> | null;
  current_billing_period?: {
    starts_at?: string | null;
    ends_at?: string | null;
  } | null;
  scheduled_change?: unknown;
  custom_data?: Record<string, string> | null;
}

function getPaddleApiKey(): string {
  const key = process.env.PADDLE_API_KEY;
  if (!key) {
    throw new Error('paddle_not_configured');
  }
  return key;
}

async function paddleRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const key = getPaddleApiKey();
  const res = await fetch(`${PADDLE_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const message = await res.text();
    throw new Error(`paddle_request_failed:${res.status}:${message}`);
  }

  return res.json() as Promise<T>;
}

async function getPaddleSubscription(subscriptionId: string): Promise<PaddleSubscriptionData> {
  const response = await paddleRequest<PaddleApiResponse<PaddleSubscriptionData>>(`/subscriptions/${subscriptionId}`);
  return response.data;
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function billingStateFromPaddleStatus(status: string, gracePeriodEndsAt: Date | null): {
  billingStatus: string;
  isPro: boolean;
} {
  if (status === 'active' || status === 'trialing') {
    return { billingStatus: status, isPro: true };
  }

  if (status === 'past_due' && gracePeriodEndsAt && gracePeriodEndsAt > new Date()) {
    return { billingStatus: 'grace_period', isPro: true };
  }

  if (status === 'past_due') {
    return { billingStatus: 'past_due', isPro: false };
  }

  if (status === 'canceled' || status === 'paused') {
    return { billingStatus: 'canceled', isPro: false };
  }

  return { billingStatus: 'inactive', isPro: false };
}

export async function createPaddleCheckoutTransaction(
  agentId: string,
  successUrl: string,
  cancelUrl: string,
  plan: 'pro' | 'founding' = 'pro'
): Promise<{ id: string; url: string | null }> {
  const priceId = plan === 'founding'
    ? process.env.PADDLE_FOUNDING_PRICE_ID
    : process.env.PADDLE_PRO_PRICE_ID;

  if (!priceId) {
    throw new Error('paddle_price_not_configured');
  }

  const paymentLinkUrl = new URL('/pay', successUrl).toString();
  const response = await paddleRequest<PaddleApiResponse<PaddleTransactionData>>('/transactions', {
    method: 'POST',
    body: JSON.stringify({
      items: [{ price_id: priceId, quantity: 1 }],
      collection_mode: 'automatic',
      enable_checkout: true,
      checkout: {
        url: paymentLinkUrl,
      },
      custom_data: {
        agent_id: agentId,
        plan,
      },
    }),
  });

  let checkoutUrl = response.data.checkout?.url ?? null;
  if (checkoutUrl) {
    const url = new URL(checkoutUrl);
    url.searchParams.set('success_url', successUrl);
    url.searchParams.set('cancel_url', cancelUrl);
    checkoutUrl = url.toString();
  }

  return {
    id: response.data.id,
    url: checkoutUrl,
  };
}

export async function applyFounderState(input: {
  agentId: string;
  providerCustomerId?: string | null;
  providerPriceId?: string | null;
  status?: string;
  webhookOccurredAt?: Date | null;
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

    const existingSubscription = await tx.agentSubscription.findUnique({
      where: { agentId_plan: { agentId: input.agentId, plan: 'founding' } },
      select: { lastWebhookAt: true },
    });

    if (
      input.webhookOccurredAt
      && existingSubscription?.lastWebhookAt
      && existingSubscription.lastWebhookAt > input.webhookOccurredAt
    ) {
      return;
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
        stripeCustomerId: input.providerCustomerId ?? undefined,
      },
    });

    await tx.agentSubscription.upsert({
      where: { agentId_plan: { agentId: input.agentId, plan: 'founding' } },
      update: {
        provider: 'paddle',
        plan: 'founding',
        status: input.status ?? 'active',
        stripeCustomerId: input.providerCustomerId ?? undefined,
        stripePriceId: input.providerPriceId ?? undefined,
        currentPeriodStart: now,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        gracePeriodEndsAt: null,
        lastWebhookAt: input.webhookOccurredAt ?? now,
      },
      create: {
        agentId: input.agentId,
        provider: 'paddle',
        plan: 'founding',
        status: input.status ?? 'active',
        stripeCustomerId: input.providerCustomerId ?? undefined,
        stripePriceId: input.providerPriceId ?? undefined,
        currentPeriodStart: now,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        gracePeriodEndsAt: null,
        lastWebhookAt: input.webhookOccurredAt ?? now,
      },
    });
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });
}

export async function applySubscriptionState(input: {
  agentId: string;
  providerCustomerId?: string | null;
  providerSubscriptionId?: string | null;
  providerPriceId?: string | null;
  status: string;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
  gracePeriodEndsAt?: Date | null;
  webhookOccurredAt?: Date | null;
}): Promise<void> {
  const gracePeriodEndsAt = input.gracePeriodEndsAt ?? null;
  const normalized = billingStateFromPaddleStatus(input.status, gracePeriodEndsAt);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.agentSubscription.findUnique({
      where: { agentId_plan: { agentId: input.agentId, plan: 'pro' } },
      select: { lastWebhookAt: true },
    });

    if (
      input.webhookOccurredAt
      && existing?.lastWebhookAt
      && existing.lastWebhookAt > input.webhookOccurredAt
    ) {
      return;
    }

    await tx.agent.update({
      where: { id: input.agentId },
      data: {
        isPro: normalized.isPro,
        stripeCustomerId: input.providerCustomerId ?? undefined,
      },
    });

    await tx.agentSubscription.upsert({
      where: { agentId_plan: { agentId: input.agentId, plan: 'pro' } },
      update: {
        agentId: input.agentId,
        provider: 'paddle',
        plan: 'pro',
        status: normalized.billingStatus,
        stripeCustomerId: input.providerCustomerId ?? undefined,
        stripePriceId: input.providerPriceId ?? undefined,
        stripeSubscriptionId: input.providerSubscriptionId ?? undefined,
        currentPeriodStart: input.currentPeriodStart ?? undefined,
        currentPeriodEnd: input.currentPeriodEnd ?? undefined,
        cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
        gracePeriodEndsAt,
        lastWebhookAt: input.webhookOccurredAt ?? new Date(),
      },
      create: {
        agentId: input.agentId,
        provider: 'paddle',
        plan: 'pro',
        status: normalized.billingStatus,
        stripeCustomerId: input.providerCustomerId ?? undefined,
        stripeSubscriptionId: input.providerSubscriptionId ?? undefined,
        stripePriceId: input.providerPriceId ?? undefined,
        currentPeriodStart: input.currentPeriodStart ?? undefined,
        currentPeriodEnd: input.currentPeriodEnd ?? undefined,
        cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
        gracePeriodEndsAt,
        lastWebhookAt: input.webhookOccurredAt ?? new Date(),
      },
    });
  });
}

function extractPriceId(items: Array<{ price?: { id?: string | null } | null }> | null | undefined): string | null {
  return items?.[0]?.price?.id ?? null;
}

async function applySubscriptionStateFromWebhookEntity(input: {
  data: PaddleSubscriptionData;
  occurredAt?: Date | null;
}) {
  const customData = input.data.custom_data ?? {};
  const agentId = customData.agent_id;
  const plan = customData.plan;
  if (!agentId || plan === 'founding') return;

  const status = input.data.status ?? 'inactive';
  const gracePeriodEndsAt =
    status === 'past_due'
      ? new Date(Date.now() + DEFAULT_GRACE_DAYS * 24 * 60 * 60 * 1000)
      : null;

  await applySubscriptionState({
    agentId,
    providerCustomerId: input.data.customer_id ?? null,
    providerSubscriptionId: input.data.id ?? null,
    providerPriceId: extractPriceId(input.data.items),
    status,
    currentPeriodStart: toDate(input.data.current_billing_period?.starts_at),
    currentPeriodEnd: toDate(input.data.current_billing_period?.ends_at),
    cancelAtPeriodEnd: Boolean(input.data.scheduled_change),
    gracePeriodEndsAt,
    webhookOccurredAt: input.occurredAt ?? null,
  });
}

export async function handlePaddleWebhookEvent(event: {
  eventType: string;
  occurredAt?: string | null;
  data?: Record<string, unknown>;
}): Promise<void> {
  const occurredAt = toDate(event.occurredAt);
  const object = (event.data ?? {}) as Record<string, unknown>;

  if (event.eventType === 'transaction.completed') {
    const customData = (object.custom_data as Record<string, string> | undefined) ?? {};
    const agentId = customData.agent_id;
    const plan = customData.plan;
    if (!agentId) return;

    if (plan === 'founding') {
      await applyFounderState({
        agentId,
        providerCustomerId: typeof object.customer_id === 'string' ? object.customer_id : null,
        providerPriceId: extractPriceId(object.items as PaddleTransactionData['items']),
        status: 'active',
        webhookOccurredAt: occurredAt,
      });
      return;
    }

    const providerSubscriptionId = typeof object.subscription_id === 'string' ? object.subscription_id : null;
    if (providerSubscriptionId) {
      const subscription = await getPaddleSubscription(providerSubscriptionId);
      await applySubscriptionStateFromWebhookEntity({
        data: {
          ...subscription,
          custom_data: subscription.custom_data ?? customData,
        },
        occurredAt,
      });
      return;
    }

    await applySubscriptionState({
      agentId,
      providerCustomerId: typeof object.customer_id === 'string' ? object.customer_id : null,
      providerSubscriptionId,
      providerPriceId: extractPriceId(object.items as PaddleTransactionData['items']),
      status: 'active',
      webhookOccurredAt: occurredAt,
    });
    return;
  }

  if (
    event.eventType === 'subscription.created'
    || event.eventType === 'subscription.activated'
    || event.eventType === 'subscription.updated'
    || event.eventType === 'subscription.past_due'
    || event.eventType === 'subscription.resumed'
    || event.eventType === 'subscription.paused'
    || event.eventType === 'subscription.canceled'
  ) {
    await applySubscriptionStateFromWebhookEntity({
      data: object as PaddleSubscriptionData,
      occurredAt,
    });
  }
}
