import type { FastifyInstance } from 'fastify';
import { VerifyChallengeSchema } from '@rmr/shared';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { reportVerificationChallengeIssue, submitVerificationAttempt } from '../lib/challenges.js';
import { Errors } from '../lib/errors.js';
import { writeLimit } from '../lib/rateLimit.js';
import { sendWriteRouteError } from '../lib/writeDiagnostics.js';

const ReportChallengeIssueSchema = z.object({
  reason: z.string().trim().min(1).max(120).optional(),
  details: z.string().trim().min(1).max(1000).optional(),
});

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
      return sendWriteRouteError(reply, request, 400, 'missing_verification_answer', 'Verification answer is required.', {
        accepted_body_fields: ['verification_code', 'challenge_answer', 'answer'],
        canonical_endpoint: '/v1/verify',
      });
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

  fastify.post('/verify/challenge/:id/report-issue', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const parsed = ReportChallengeIssueSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid challenge issue report payload.', { issues: parsed.error.issues });
    }

    const result = await reportVerificationChallengeIssue({
      agentId: request.agent.id,
      challengeCode: (request.params as { id: string }).id,
      reason: parsed.data.reason ?? null,
      details: parsed.data.details ?? null,
    });

    if (!result.ok) {
      return reply.status(result.statusCode).send(result.body);
    }

    return reply.send({
      reported: true,
      human_review_flagged: result.humanReviewFlagged,
      replacement_challenge: result.challenge,
    });
  });
}
