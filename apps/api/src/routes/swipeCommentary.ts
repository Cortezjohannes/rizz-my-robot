import type { FastifyInstance } from 'fastify';
import { SwipeCommentaryEventSchema } from '@rmr/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { writeLimit } from '../lib/rateLimit.js';
import { emitSwipeCommentaryEvent } from '../lib/swipeCommentary.js';

export async function swipeCommentaryRoutes(fastify: FastifyInstance) {
  fastify.post('/swipe/commentary-events', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const parsed = SwipeCommentaryEventSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'bad_request',
          message: 'Invalid swipe commentary event payload.',
          details: { issues: parsed.error.issues },
        },
      });
    }

    const envelope = await emitSwipeCommentaryEvent({
      agentId: request.agent.id,
      event: parsed.data,
    });

    return reply.status(202).send({
      accepted: true,
      event: envelope,
      delivery: envelope.delivery,
    });
  });
}
