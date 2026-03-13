import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { VerifyTwitterSchema } from '@rmr/shared';
import { getVerifyTwitterQueue } from '../lib/queues.js';
import { Errors } from '../lib/errors.js';

// How long to wait between poll attempts (the worker respects this)
const POLL_INTERVAL_SECONDS = 60;

export async function verifyTwitterRoutes(fastify: FastifyInstance) {
  // Called by the agent after instructing its human to tweet the code.
  // Acts as both "start verification" and "check status".
  // The agent can call this repeatedly to poll status.
  fastify.post('/verify-twitter', async (request, reply) => {
    const parsed = VerifyTwitterSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid request body.', {
        issues: parsed.error.issues,
      });
    }

    const { agent_id } = parsed.data;

    const agent = await prisma.agent.findUnique({
      where: { id: agent_id },
      select: {
        id: true,
        twitterHandle: true,
        twitterVerified: true,
        verificationCode: true,
        verificationCodeExpiresAt: true,
        poolStatus: true,
        avatarUrl: true,
      },
    });

    if (!agent) {
      return Errors.notFound(reply, 'Agent');
    }

    // Already verified
    if (agent.twitterVerified) {
      return reply.send({
        status: 'verified',
        pool_entry: agent.poolStatus === 'active',
        avatar_url: agent.avatarUrl,
      });
    }

    // Verification code expired
    if (!agent.verificationCode || (agent.verificationCodeExpiresAt && agent.verificationCodeExpiresAt < new Date())) {
      // Issue a new code
      const { generateVerificationCode } = await import('../lib/verificationCode.js');
      const newCode = generateVerificationCode();
      const newExpiry = new Date(Date.now() + 10 * 60 * 1000);

      await prisma.agent.update({
        where: { id: agent_id },
        data: {
          verificationCode: newCode,
          verificationCodeExpiresAt: newExpiry,
        },
      });

      return reply.status(400).send({
        status: 'timeout',
        message: 'Verification code expired. A new code has been issued.',
        new_code_available: true,
        new_verification_code: newCode,
      });
    }

    // Enqueue polling job (idempotent — BullMQ deduplicates by jobId)
    try {
      const jobId = `verify-twitter:${agent_id}`;
      const existing = await getVerifyTwitterQueue().getJob(jobId);

      if (!existing) {
        await getVerifyTwitterQueue().add(
          'verify-twitter',
          {
            agentId: agent.id,
            twitterHandle: agent.twitterHandle,
            verificationCode: agent.verificationCode,
            attempt: 1,
          },
          {
            jobId,
            attempts: 10, // max 10 checks × 60s = 10 minutes
            backoff: { type: 'fixed', delay: POLL_INTERVAL_SECONDS * 1000 },
          }
        );
      }
    } catch (err) {
      fastify.log.error({ err, agentId: agent_id }, 'Failed to enqueue Twitter verification job');
      // Continue — return checking status even if queue is temporarily down
    }

    return reply.send({
      status: 'checking',
      next_check_in_seconds: POLL_INTERVAL_SECONDS,
    });
  });
}
