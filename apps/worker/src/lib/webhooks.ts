import { Queue } from 'bullmq';
import { prisma } from '@rmr/db';
import { getRedisConnection } from './redis.js';

let deliverQueue: Queue | null = null;

function getDeliverQueue(): Queue {
  if (!deliverQueue) {
    deliverQueue = new Queue('deliver-webhook', { connection: getRedisConnection() });
  }
  return deliverQueue;
}

export async function enqueueWebhookDeliveries(
  agentId: string,
  event: string,
  data: Record<string, unknown>
): Promise<void> {
  const hooks = await prisma.webhook.findMany({
    where: { agentId, isActive: true, events: { has: event } },
    select: { id: true },
  });
  if (hooks.length === 0) return;

  const queue = getDeliverQueue();
  await Promise.all(
    hooks.map(async (hook) => {
      const delivery = await prisma.webhookDelivery.create({
        data: {
          webhookId: hook.id,
          agentId,
          event,
          status: 'queued',
          requestBody: JSON.parse(JSON.stringify(data)),
        },
      });

      return queue.add(
        'deliver',
        {
          webhookId: hook.id,
          deliveryId: delivery.id,
          agentId,
          event,
          data,
        },
        { jobId: `${hook.id}:${event}:${delivery.id}` }
      );
    })
  );
}

export async function enqueueEpisodeOpeningTurn(agentId: string, episodeId: string): Promise<void> {
  await enqueueWebhookDeliveries(agentId, 'episode_turn', {
    episode_id: episodeId,
    message_count: 0,
    can_decide: false,
    your_turn: true,
    opener_required: true,
    reason: 'episode_opened',
  });
}
