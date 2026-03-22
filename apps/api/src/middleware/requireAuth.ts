import type { FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import { authenticateAgentRequest, type AuthenticatedAgent } from '../lib/requestAuth.js';

// Extend FastifyRequest to carry the authenticated agent
declare module 'fastify' {
  interface FastifyRequest {
    agent: AuthenticatedAgent;
  }
}

export const requireAuth: preHandlerHookHandler = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  await authenticateAgentRequest(request, reply);
};
