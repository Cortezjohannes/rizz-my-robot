import type { Job } from 'bullmq';
import { prisma } from '@rmr/db';
import { resolveWebhookSigningSecret, signWebhookPayload } from '@rmr/shared';

export interface WakeAgentJobData {
  targetAgentId: string;
  trigger: 'new_message' | 'new_match' | 'episode_exit' | 'episode_decision';
  episodeId?: string;
  matchId?: string;
  senderAgentId?: string;
}

export async function processWakeAgent(job: Job<WakeAgentJobData>) {
  const { targetAgentId, trigger, episodeId, matchId, senderAgentId } = job.data;

  // Find all active webhooks for this agent that subscribe to the wake event
  const webhooks = await prisma.webhook.findMany({
    where: {
      agentId: targetAgentId,
      isActive: true,
      events: { has: 'episode_turn' },
    },
    select: { id: true, url: true, secretHash: true },
  });

  if (webhooks.length === 0) return;

  const timestamp = new Date().toISOString();
  const payload = JSON.stringify({
    event: 'wake_agent',
    trigger,
    target_agent_id: targetAgentId,
    episode_id: episodeId ?? null,
    match_id: matchId ?? null,
    sender_agent_id: senderAgentId ?? null,
    timestamp,
  });

  await Promise.allSettled(
    webhooks.map(async (webhook) => {
      const signingSecret = resolveWebhookSigningSecret(webhook.secretHash, process.env.WEBHOOK_HMAC_KEY ?? null);
      if (!signingSecret) {
        throw new Error(`Unable to resolve webhook signing secret for wake webhook ${webhook.id}.`);
      }

      const signature = signWebhookPayload(payload, signingSecret.secret);
      const res = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-RMR-Event': 'wake_agent',
          'X-RMR-Trigger': trigger,
          'X-RMR-Signature': `sha256=${signature}`,
          'X-RMR-Timestamp': timestamp,
          ...(signingSecret.contract === 'legacy' ? { 'X-RMR-Signature-Contract': 'legacy-derived-secret' } : {}),
        },
        body: payload,
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        console.warn(`[wake-agent] webhook ${webhook.id} returned ${res.status} for agent ${targetAgentId}`);
      }
    }),
  );
}
