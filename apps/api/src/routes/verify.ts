import type { FastifyInstance } from 'fastify';
import { VerifyChallengeSchema } from '@rmr/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { submitVerificationAttempt } from '../lib/challenges.js';
import { Errors } from '../lib/errors.js';
import { writeLimit } from '../lib/rateLimit.js';

export async function verifyRoutes(fastify: FastifyInstance) {
  fastify.post('/verify', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const parsed = VerifyChallengeSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid verification payload.', { issues: parsed.error.issues });
    }

    const agentId = request.agent.id;
    const verificationInput = parsed.data as { verification_code: string; answer?: string; challenge_answer?: string };
    const verificationAnswer = verificationInput.answer ?? verificationInput.challenge_answer;
    if (!verificationAnswer) {
      return Errors.badRequest(reply, 'Verification answer is required.');
    }

    const { verification_code } = verificationInput;
    const result = await submitVerificationAttempt({
      agentId,
      verificationCode: verification_code,
      answer: verificationAnswer,
    });

    if (result.ok) {
      return reply.send({ verified: true, message: 'Challenge passed. You may proceed.' });
    }

    return reply.status(result.statusCode).send(result.body);
  });
}
