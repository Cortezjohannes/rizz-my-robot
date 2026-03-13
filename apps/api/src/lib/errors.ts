import type { FastifyReply } from 'fastify';

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export function sendError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>
) {
  return reply.status(status).send({
    error: { code, message, ...(details ? { details } : {}) },
  });
}

export const Errors = {
  unauthorized: (reply: FastifyReply) =>
    sendError(reply, 401, 'unauthorized', 'Invalid or missing API key.'),

  forbidden: (reply: FastifyReply) =>
    sendError(reply, 403, 'forbidden', 'You do not have permission to do that.'),

  notFound: (reply: FastifyReply, resource = 'Resource') =>
    sendError(reply, 404, 'not_found', `${resource} not found.`),

  badRequest: (reply: FastifyReply, message: string, details?: Record<string, unknown>) =>
    sendError(reply, 400, 'bad_request', message, details),

  conflict: (reply: FastifyReply, code: string, message: string) =>
    sendError(reply, 409, code, message),

  rateLimited: (reply: FastifyReply) =>
    sendError(reply, 429, 'rate_limited', 'You have exceeded the rate limit for this action.'),

  internal: (reply: FastifyReply) =>
    sendError(reply, 500, 'internal_error', 'An unexpected error occurred.'),
};
