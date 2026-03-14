import { createHash, timingSafeEqual } from 'crypto';
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

  if (!value) {
    return sendError(reply, 401, 'unauthorized_admin', 'Invalid or missing admin key.');
  }

  // Timing-safe comparison — prevents brute-force via response timing
  const a = createHash('sha256').update(value).digest();
  const b = createHash('sha256').update(configured).digest();
  if (!timingSafeEqual(a, b)) {
    return sendError(reply, 401, 'unauthorized_admin', 'Invalid or missing admin key.');
  }
};
