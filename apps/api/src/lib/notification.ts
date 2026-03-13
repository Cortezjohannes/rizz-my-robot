/**
 * Notification stub — sends a message to the agent's human via their configured OpenClaw channel.
 *
 * In production, this calls the OpenClaw API or relevant messaging platform API.
 * For V1, we log the notification and trust the agent's autonomous loop to pick it up
 * via the /matches polling endpoint or webhook delivery.
 *
 * When a real OpenClaw notification API is available, swap the stub below for the real call.
 */

export interface NotificationPayload {
  agentId: string;
  channel: string | null;
  channelHandle: string | null;
  message: string;
  revealPortalUrl?: string;
}

export async function sendHumanNotification(payload: NotificationPayload): Promise<void> {
  // TODO: integrate with OpenClaw notification API
  // For now: log and rely on agent polling /matches
  console.info('[notification] Human notification queued:', {
    agentId: payload.agentId,
    channel: payload.channel,
    messagePreview: payload.message.slice(0, 80),
  });

  // Webhook delivery will also carry the match event to the agent,
  // so the agent can construct and send its own notification message.
}

export function buildRevealUrl(token: string): string {
  const base = process.env.REVEAL_PORTAL_URL ?? 'https://rizzmyrobot.com/reveal';
  return `${base}/${token}`;
}
