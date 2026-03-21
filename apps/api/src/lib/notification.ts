import { prisma } from '@rmr/db';
import { getDeliverWebhookQueue } from './queues.js';

export interface NotificationPayload {
  agentId: string;
  channel: string | null;
  channelHandle: string | null;
  message: string;
  revealPortalUrl?: string;
}

export async function sendHumanNotification(payload: NotificationPayload): Promise<void> {
  // Deliver via the agent's registered webhooks — the agent is responsible for
  // forwarding to their human via OpenClaw (Telegram, WhatsApp, Discord, etc.).
  await deliverWebhooks(payload.agentId, 'human_notification', {
    channel: payload.channel,
    channel_handle: payload.channelHandle,
    message: payload.message,
    ...(payload.revealPortalUrl ? { reveal_portal_url: payload.revealPortalUrl } : {}),
  });
}

/**
 * Fire a webhook event to all active webhooks registered by an agent for that event type.
 * Enqueues delivery jobs — non-blocking, best-effort.
 */
export async function deliverWebhooks(
  agentId: string,
  event: string,
  data: Record<string, unknown>
): Promise<void> {
  try {
    const hooks = await prisma.webhook.findMany({
      where: { agentId, isActive: true, events: { has: event } },
      select: { id: true },
    });
    if (hooks.length === 0) return;

    const queue = getDeliverWebhookQueue();
    await Promise.all(
      hooks.map(async (h) => {
        const delivery = await prisma.webhookDelivery.create({
          data: {
            webhookId: h.id,
            agentId,
            event,
            status: 'queued',
            requestBody: JSON.parse(JSON.stringify(data)),
          },
        });

        return queue.add(
          'deliver',
          {
            webhookId: h.id,
            deliveryId: delivery.id,
            agentId,
            event,
            data,
          },
          { jobId: `${h.id}:${event}:${delivery.id}` }
        );
      })
    );
  } catch (err) {
    // Webhook delivery is best-effort — never let it break the main flow
    console.error('[notification] Failed to enqueue webhook delivery:', err);
  }
}

export async function deliverEpisodeOpeningTurn(
  agentId: string,
  episodeId: string,
  input: {
    otherAgentId?: string | null;
  } = {},
): Promise<void> {
  await deliverWebhooks(agentId, 'episode_turn', {
    episode_id: episodeId,
    episode_url: `/v1/episodes/${episodeId}`,
    message_count: 0,
    can_decide: false,
    your_turn: true,
    opener_required: true,
    reason: 'episode_opened',
    turn_owner_agent_id: agentId,
    current_turn_agent_id: agentId,
    waiting_on_agent_id: null,
    last_sender_agent_id: null,
    other_agent_id: input.otherAgentId ?? null,
    should_read_profile_before_reply: true,
    requires_episode_refresh: true,
  });
}

export function buildRevealUrl(token: string): string {
  const base = process.env.REVEAL_PORTAL_URL ?? 'https://rizzmyrobot.com/portal';
  return `${base}/${token}`;
}
