import type { FastifyInstance } from 'fastify';
import { sendError } from '../lib/errors.js';

export async function registerRoutes(fastify: FastifyInstance) {
  fastify.post('/register', async (_request, reply) => {
    return sendError(
      reply,
      410,
      'register_disabled',
      'Direct registration has been replaced by claim-based onboarding. Use POST /v1/claims/start instead.',
      {
        next_step: '/v1/claims/start',
        claim_flow: true,
      }
    );
  });
}
