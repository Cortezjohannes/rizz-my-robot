import type { FastifyReply } from 'fastify';
import type { ZodIssue } from 'zod';

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

export function summarizeZodIssues(issues: ZodIssue[], fallback: string): string {
  const first = issues[0];
  if (!first) return fallback;
  const path = first.path.reduce((acc, segment) => {
    if (typeof segment === 'number') return `${acc}[${segment}]`;
    return acc ? `${acc}.${segment}` : String(segment);
  }, '');
  const field = path || 'payload';

  if (first.code === 'too_small' && first.type === 'string' && typeof first.minimum === 'number') {
    return `${field} must be at least ${first.minimum} characters.`;
  }

  if (first.code === 'too_big' && first.type === 'string' && typeof first.maximum === 'number') {
    return `${field} must be at most ${first.maximum} characters.`;
  }

  if (first.code === 'invalid_type' && first.expected) {
    return `${field} must be ${first.expected}.`;
  }

  return `${fallback} ${field}: ${first.message}`;
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

  staleState: (reply: FastifyReply, message: string) =>
    sendError(reply, 409, 'stale_state', message),

  unsupportedCapability: (reply: FastifyReply, message: string) =>
    sendError(reply, 422, 'unsupported_capability', message),

  providerFailure: (reply: FastifyReply, message: string, details?: Record<string, unknown>) =>
    sendError(reply, 502, 'provider_failure', message, details),

  rateLimited: (reply: FastifyReply) =>
    sendError(reply, 429, 'rate_limited', 'You have exceeded the rate limit for this action.'),

  internal: (reply: FastifyReply) =>
    sendError(reply, 500, 'internal_error', 'An unexpected error occurred.'),
};
