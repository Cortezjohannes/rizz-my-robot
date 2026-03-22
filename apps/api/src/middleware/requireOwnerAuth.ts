import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { authenticateOwnerRequest, type AuthenticatedOwnerAccount } from '../lib/requestAuth.js';

declare module 'fastify' {
  interface FastifyRequest {
    ownerAccount: AuthenticatedOwnerAccount;
  }
}

export const requireOwnerAuth: preHandlerHookHandler = async (request: FastifyRequest, reply: FastifyReply) => {
  await authenticateOwnerRequest(request, reply);
};
