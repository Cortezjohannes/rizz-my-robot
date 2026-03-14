import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { sendError } from '../lib/errors.js';

export const requireAdmin: preHandlerHookHandler = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const configured = process.env.ADMIN_API_KEY;
  if (!configured) {
    return sendError(reply, 503, 'admin_unavailable', 'ADMIN_API_KEY is not configured.');
  }

  const provided = request.headers['x-admin-key'];
  const value = Array.isArray(provided) ? provided[0] : provided;

  if (!value || value !== configured) {
    return sendError(reply, 401, 'unauthorized_admin', 'Invalid or missing admin key.');
  }
};
