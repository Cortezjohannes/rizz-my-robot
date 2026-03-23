import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodIssue } from 'zod';

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

function stripQuery(url: string) {
  return url.split('?')[0] ?? url;
}

function endpointForRequest(request: FastifyRequest) {
  return `${request.method.toUpperCase()} ${stripQuery(request.url)}`;
}

export function buildErrorPayload(input: {
  request: FastifyRequest;
  code: string;
  message: string;
  details?: Record<string, unknown>;
  suggestion?: string;
}) {
  return {
    error: {
      code: input.code,
      message: input.message,
      endpoint: endpointForRequest(input.request),
      request_id: String(input.request.id),
      timestamp: new Date().toISOString(),
      ...(input.details ? { details: input.details } : {}),
      ...(input.suggestion ? { suggestion: input.suggestion } : {}),
    },
  };
}

export function sendError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>
) {
  const suggestion = typeof details?.suggestion === 'string' ? details.suggestion : undefined;
  const sanitizedDetails = details
    ? Object.fromEntries(Object.entries(details).filter(([key]) => key !== 'suggestion'))
    : undefined;

  return reply.status(status).send(buildErrorPayload({
    request: reply.request,
    code,
    message,
    details: sanitizedDetails,
    suggestion,
  }));
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

function zodPathToField(path: ZodIssue['path']) {
  return path.reduce<string>((acc, segment) => {
    if (typeof segment === 'number') return `${acc}[${segment}]`;
    return acc ? `${acc}.${segment}` : String(segment);
  }, '') || 'payload';
}

function buildValidationMessage(issue: ZodIssue, field: string) {
  if (issue.code === 'too_small' && issue.type === 'array' && typeof issue.minimum === 'number') {
    return `${field} must contain at least ${issue.minimum} items`;
  }
  if (issue.code === 'too_small' && issue.type === 'string' && typeof issue.minimum === 'number') {
    return `${field} must be at least ${issue.minimum} characters`;
  }
  if (issue.code === 'too_big' && issue.type === 'array' && typeof issue.maximum === 'number') {
    return `${field} must contain at most ${issue.maximum} items`;
  }
  if (issue.code === 'too_big' && issue.type === 'string' && typeof issue.maximum === 'number') {
    return `${field} must be at most ${issue.maximum} characters`;
  }
  if (issue.code === 'invalid_type') {
    if (issue.expected === 'array') return `${field} must be an array`;
    return `${field} must be ${issue.expected}`;
  }
  if (issue.code === 'invalid_enum_value') {
    return `${field} '${String(issue.received)}' is not valid. Use: ${issue.options.join(', ')}`;
  }
  return issue.message || `${field} is invalid`;
}

export function formatValidationIssues(issues: ZodIssue[]) {
  return issues.map((issue) => {
    const field = zodPathToField(issue.path);
    const base = {
      field,
      error: issue.code,
      message: buildValidationMessage(issue, field),
    } as Record<string, unknown>;

    if ('minimum' in issue && typeof issue.minimum === 'number') {
      base.required = issue.minimum;
    }
    if ('maximum' in issue && typeof issue.maximum === 'number') {
      base.maximum = issue.maximum;
    }
    if ('received' in issue && issue.received !== undefined) {
      base.provided = issue.received;
    }
    if ('expected' in issue && issue.expected !== undefined) {
      base.expected = issue.expected;
    }
    if (issue.code === 'invalid_enum_value') {
      base.error = 'invalid_enum';
      base.valid_values = issue.options;
      base.provided = issue.received;
    }
    if (issue.code === 'too_small') {
      base.error = 'minimum_not_met';
    }
    if (issue.code === 'too_big') {
      base.error = 'maximum_exceeded';
    }

    return base;
  });
}

export function sendValidationFailed(reply: FastifyReply, issues: ZodIssue[], status = 400) {
  return reply.status(status).send(buildErrorPayload({
    request: reply.request,
    code: 'validation_failed',
    message: 'Request validation failed.',
    details: {
      fields: formatValidationIssues(issues),
    },
  }));
}

export const Errors = {
  unauthorized: (reply: FastifyReply) =>
    sendError(reply, 401, 'unauthorized', 'Invalid or missing API key.'),

  forbidden: (reply: FastifyReply) =>
    sendError(reply, 403, 'forbidden', 'You do not have permission to do that.'),

  notFound: (reply: FastifyReply, resource = 'Resource') =>
    sendError(reply, 404, 'not_found', `${resource} not found.`),

  badRequest: (reply: FastifyReply, message: string, details?: Record<string, unknown>) => {
    const issues = details?.issues;
    if (Array.isArray(issues)) {
      return sendValidationFailed(reply, issues as ZodIssue[], 400);
    }
    return sendError(reply, 400, 'bad_request', message, details);
  },

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
