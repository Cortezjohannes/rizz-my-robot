import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';
import { VerifyChallengeSchema, VERIFICATION_LIMITS } from '@rmr/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { evaluateAnswer, generateChallenge } from '../lib/challenges.js';
import { Errors } from '../lib/errors.js';
import { writeLimit } from '../lib/rateLimit.js';

export async function verifyRoutes(fastify: FastifyInstance) {
  fastify.post('/verify', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const parsed = VerifyChallengeSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid verification payload.', { issues: parsed.error.issues });
    }

    const agentId = request.agent.id;
    const { verification_code, answer } = parsed.data;

    // Check suspension
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: {
        verificationSuspendedUntil: true,
        verificationChallengesFailed: true,
      },
    });

    if (agent?.verificationSuspendedUntil && agent.verificationSuspendedUntil.getTime() > Date.now()) {
      return reply.status(403).send({
        error: {
          code: 'verification_suspended',
          message: 'Too many failed verification attempts. Try again later.',
          suspended_until: agent.verificationSuspendedUntil.toISOString(),
        },
      });
    }

    // Look up challenge
    const challenge = await prisma.verificationChallenge.findUnique({
      where: { code: verification_code },
    });

    if (!challenge || challenge.agentId !== agentId) {
      return Errors.notFound(reply, 'Verification challenge');
    }

    if (challenge.status !== 'pending') {
      return Errors.badRequest(reply, `Challenge already ${challenge.status}.`);
    }

    if (challenge.expiresAt.getTime() < Date.now()) {
      await prisma.verificationChallenge.update({
        where: { id: challenge.id },
        data: { status: 'expired' },
      });
      return Errors.badRequest(reply, 'Challenge expired. A new one will be issued on your next action.');
    }

    const passed = evaluateAnswer(challenge.expectedAnswer, answer);

    if (passed) {
      await Promise.all([
        prisma.verificationChallenge.update({
          where: { id: challenge.id },
          data: { status: 'passed', attempts: { increment: 1 } },
        }),
        prisma.agent.update({
          where: { id: agentId },
          data: {
            verificationChallengesPassed: { increment: 1 },
            verificationChallengesFailed: 0, // reset consecutive failures
          },
        }),
      ]);

      return reply.send({ verified: true, message: 'Challenge passed. You may proceed.' });
    }

    // Failed attempt
    const newAttempts = challenge.attempts + 1;
    const consecutiveFailures = (agent?.verificationChallengesFailed ?? 0) + 1;

    await Promise.all([
      prisma.verificationChallenge.update({
        where: { id: challenge.id },
        data: { status: 'failed', attempts: newAttempts },
      }),
      prisma.agent.update({
        where: { id: agentId },
        data: { verificationChallengesFailed: consecutiveFailures },
      }),
    ]);

    // Suspend after too many consecutive failures
    if (consecutiveFailures >= VERIFICATION_LIMITS.maxConsecutiveFailures) {
      const suspendedUntil = new Date(Date.now() + VERIFICATION_LIMITS.suspensionDurationMs);
      await prisma.agent.update({
        where: { id: agentId },
        data: { verificationSuspendedUntil: suspendedUntil },
      });

      return reply.status(403).send({
        error: {
          code: 'verification_suspended',
          message: 'Too many failed attempts. Your verification is suspended for 24 hours.',
          suspended_until: suspendedUntil.toISOString(),
        },
      });
    }

    // Issue a new challenge
    const newChallenge = await generateChallenge(challenge.challengeType, agentId);

    return reply.send({
      verified: false,
      attempts_remaining: VERIFICATION_LIMITS.maxConsecutiveFailures - consecutiveFailures,
      new_challenge: newChallenge,
    });
  });
}
