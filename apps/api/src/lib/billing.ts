import { Prisma, prisma } from '@rmr/db';
import { TEMPO_COOLDOWN_MINUTES } from '@rmr/shared';

const DEFAULT_GRACE_DAYS = parseInt(process.env.BILLING_GRACE_DAYS ?? '7', 10);
const FOUNDER_SLOTS_TOTAL = parseInt(process.env.FOUNDING_RIZZLER_LIMIT ?? '1000', 10);

type BillingPlan = 'pro' | 'founding';
type BillingProvider = 'revenuecat' | 'manual' | 'bonus';

interface RevenueCatEventPayload {
  type?: string | null;
  app_user_id?: string | null;
  original_app_user_id?: string | null;
  product_id?: string | null;
  entitlement_ids?: string[] | null;
  aliases?: string[] | null;
  period_type?: string | null;
  purchased_at_ms?: number | null;
  expiration_at_ms?: number | null;
  expiration_at?: string | null;
  event_timestamp_ms?: number | null;
  store?: string | null;
  transaction_id?: string | null;
  original_transaction_id?: string | null;
}

function getRevenueCatCheckoutTemplate(plan: BillingPlan): string {
  const url = plan === 'founding'
    ? process.env.REVENUECAT_FOUNDING_CHECKOUT_URL
    : process.env.REVENUECAT_PRO_CHECKOUT_URL;

  if (!url) {
    throw new Error('revenuecat_checkout_not_configured');
  }
  return url;
}

function normalizeCheckoutTemplate(url: string) {
  return url.replace(/\/+$/, '');
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function fromMillis(value: number | null | undefined): Date | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function billingStateFromStatus(status: string, gracePeriodEndsAt: Date | null): {
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

function inferPlanFromProductId(productId: string | null | undefined): BillingPlan {
  if (!productId) return 'pro';
  const foundingProductId = process.env.REVENUECAT_FOUNDING_PRODUCT_ID;
  if (foundingProductId && productId === foundingProductId) return 'founding';
  return 'pro';
}

function inferOccurredAt(event: RevenueCatEventPayload): Date | null {
  return fromMillis(event.event_timestamp_ms) ?? fromMillis(event.purchased_at_ms) ?? null;
}

function inferCurrentPeriodStart(event: RevenueCatEventPayload): Date | null {
  return fromMillis(event.purchased_at_ms) ?? inferOccurredAt(event);
}

function inferCurrentPeriodEnd(event: RevenueCatEventPayload): Date | null {
  return fromMillis(event.expiration_at_ms) ?? toDate(event.expiration_at);
}

function normalizeRevenueCatEvent(payload: Record<string, unknown>): RevenueCatEventPayload {
  const nested = payload.event;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return nested as RevenueCatEventPayload;
  }
  return payload as RevenueCatEventPayload;
}

function resolveWebhookAgentId(event: RevenueCatEventPayload): string | null {
  return event.app_user_id ?? event.original_app_user_id ?? event.aliases?.[0] ?? null;
}

function mapRevenueCatStatus(event: RevenueCatEventPayload): {
  status: string;
  cancelAtPeriodEnd: boolean;
  gracePeriodEndsAt: Date | null;
} | null {
  const type = event.type?.toUpperCase() ?? '';
  const expirationAt = inferCurrentPeriodEnd(event);

  switch (type) {
    case 'INITIAL_PURCHASE':
    case 'RENEWAL':
    case 'PRODUCT_CHANGE':
    case 'SUBSCRIPTION_EXTENDED':
    case 'TEMPORARY_ENTITLEMENT_GRANT':
    case 'UNCANCELLATION':
      return {
        status: event.period_type === 'TRIAL' ? 'trialing' : 'active',
        cancelAtPeriodEnd: false,
        gracePeriodEndsAt: null,
      };
    case 'NON_RENEWING_PURCHASE':
      return {
        status: 'active',
        cancelAtPeriodEnd: true,
        gracePeriodEndsAt: expirationAt,
      };
    case 'CANCELLATION':
      return {
        status: expirationAt && expirationAt > new Date() ? 'active' : 'canceled',
        cancelAtPeriodEnd: true,
        gracePeriodEndsAt: null,
      };
    case 'BILLING_ISSUE':
      return {
        status: 'past_due',
        cancelAtPeriodEnd: false,
        gracePeriodEndsAt: expirationAt ?? new Date(Date.now() + DEFAULT_GRACE_DAYS * 24 * 60 * 60 * 1000),
      };
    case 'EXPIRATION':
    case 'REFUND':
    case 'SUBSCRIBER_ALIAS':
      return {
        status: 'inactive',
        cancelAtPeriodEnd: false,
        gracePeriodEndsAt: null,
      };
    default:
      return null;
  }
}

export async function createRevenueCatCheckoutSession(
  agentId: string,
  successUrl: string,
  plan: BillingPlan = 'pro',
  email?: string | null
): Promise<{ id: string; url: string }> {
  const template = normalizeCheckoutTemplate(getRevenueCatCheckoutTemplate(plan));
  const url = new URL(`${template}/${encodeURIComponent(agentId)}`);
  url.searchParams.set('redirect_url', successUrl);
  url.searchParams.set('skip_purchase_success', 'true');
  if (email) {
    url.searchParams.set('email', email);
  }

  return {
    id: `rc_${plan}_${agentId}_${Date.now()}`,
    url: url.toString(),
  };
}

export async function applyFounderState(input: {
  agentId: string;
  provider?: BillingProvider;
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
        provider: input.provider ?? 'revenuecat',
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
        provider: input.provider ?? 'revenuecat',
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
  provider?: BillingProvider;
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
  const normalized = billingStateFromStatus(input.status, gracePeriodEndsAt);

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
        provider: input.provider ?? 'revenuecat',
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
        provider: input.provider ?? 'revenuecat',
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

export async function handleRevenueCatWebhookEvent(payload: Record<string, unknown>): Promise<{ agentId: string | null; plan: BillingPlan | null }> {
  const event = normalizeRevenueCatEvent(payload);
  const agentId = resolveWebhookAgentId(event);
  if (!agentId) {
    return { agentId: null, plan: null };
  }

  const plan = inferPlanFromProductId(event.product_id);
  const occurredAt = inferOccurredAt(event);
  const providerSubscriptionId = event.original_transaction_id ?? event.transaction_id ?? null;
  const mappedState = mapRevenueCatStatus(event);

  if (!mappedState) {
    return { agentId, plan };
  }

  if (plan === 'founding' && mappedState.status !== 'inactive' && mappedState.status !== 'canceled') {
    await applyFounderState({
      agentId,
      provider: 'revenuecat',
      providerCustomerId: agentId,
      providerPriceId: event.product_id ?? null,
      status: mappedState.status,
      webhookOccurredAt: occurredAt,
    });
    return { agentId, plan };
  }

  await applySubscriptionState({
    agentId,
    provider: 'revenuecat',
    providerCustomerId: agentId,
    providerSubscriptionId,
    providerPriceId: event.product_id ?? null,
    status: mappedState.status,
    currentPeriodStart: inferCurrentPeriodStart(event),
    currentPeriodEnd: inferCurrentPeriodEnd(event),
    cancelAtPeriodEnd: mappedState.cancelAtPeriodEnd,
    gracePeriodEndsAt: mappedState.gracePeriodEndsAt,
    webhookOccurredAt: occurredAt,
  });

  return { agentId, plan };
}
