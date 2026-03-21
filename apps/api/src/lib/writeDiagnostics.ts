import type { FastifyReply, FastifyRequest } from 'fastify';
import { sendError } from './errors.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function stripQuery(url: string): string {
  const [path] = url.split('?');
  return path || url;
}

function isWriteMethod(method: string): boolean {
  return WRITE_METHODS.has(method.toUpperCase());
}

function baseRequestDetails(request: FastifyRequest) {
  return {
    method: request.method,
    path: stripQuery(request.url),
  };
}

export function buildAuthDiagnostics(request: FastifyRequest) {
  return {
    ...baseRequestDetails(request),
    accepted_api_key_transports: [
      'Authorization: Bearer <api_key>',
      'x-api-key: <api_key>',
      'x-rmr-api-key: <api_key>',
    ],
  };
}

export function sendWriteRouteError(
  reply: FastifyReply,
  request: FastifyRequest,
  status: number,
  code: string,
  message: string,
  details: Record<string, unknown> = {},
) {
  return sendError(reply, status, code, message, {
    ...baseRequestDetails(request),
    ...details,
  });
}

function episodeMessageSuggestions(path: string) {
  const episodeMatch = path.match(/^\/v1\/episodes\/([^/]+)\/([^/]+)$/);
  if (episodeMatch) {
    const [, episodeId, action] = episodeMatch;
    if (!['message', 'messages', 'reply', 'respond', 'send'].includes(action)) {
      return {
        canonical_endpoint: `/v1/episodes/${episodeId}/message`,
        compatible_endpoints: [
          `/v1/episodes/${episodeId}/messages`,
          `/v1/episodes/${episodeId}/reply`,
          `/v1/episodes/${episodeId}/respond`,
          `/v1/episodes/${episodeId}/send`,
          '/v1/messages',
        ],
        note: 'Episode message writes use /message as the canonical route. The listed aliases are also supported on current builds.',
      };
    }
  }

  const matchMessage = path.match(/^\/v1\/matches\/([^/]+)\/([^/]+)$/);
  if (matchMessage) {
    const [, matchId, action] = matchMessage;
    if (!['message', 'messages', 'respond', 'send'].includes(action)) {
      return {
        canonical_endpoint: `/v1/matches/${matchId}/message`,
        compatible_endpoints: [
          `/v1/matches/${matchId}/messages`,
          `/v1/matches/${matchId}/respond`,
          `/v1/matches/${matchId}/send`,
          '/v1/messages',
        ],
        note: 'Match-scoped message writes use /message as the canonical route. The listed aliases are also supported on current builds.',
      };
    }
  }

  return null;
}

export function buildWriteNotFoundDiagnostics(request: FastifyRequest) {
  if (!isWriteMethod(request.method)) return null;

  const path = stripQuery(request.url);
  const directSuggestion = episodeMessageSuggestions(path);
  if (directSuggestion) {
    return {
      ...baseRequestDetails(request),
      ...directSuggestion,
    };
  }

  if (path === '/v1/messages') {
    return {
      ...baseRequestDetails(request),
      canonical_endpoint: '/v1/messages',
      accepted_body_fields: ['episode_id', 'match_id', 'content'],
      compatible_endpoints: [
        '/v1/episodes/:id/message',
        '/v1/matches/:id/message',
      ],
      note: 'The generic /v1/messages route only works for POST and requires either episode_id or match_id in the body.',
    };
  }

  return {
    ...baseRequestDetails(request),
    supported_write_surfaces: [
      '/v1/swipe',
      '/v1/episodes/:id/message',
      '/v1/episodes/:id/decision',
      '/v1/messages',
      '/v1/verify',
    ],
  };
}

export function buildRateLimitDiagnostics(request: FastifyRequest, reply: FastifyReply) {
  const retryAfter = reply.getHeader('retry-after');
  const retryAfterSeconds = typeof retryAfter === 'string'
    ? Number.parseInt(retryAfter, 10)
    : typeof retryAfter === 'number'
      ? retryAfter
      : null;

  return {
    ...baseRequestDetails(request),
    retry_after_seconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : null,
    limit: reply.getHeader('x-ratelimit-limit') ?? null,
    remaining: reply.getHeader('x-ratelimit-remaining') ?? null,
    reset: reply.getHeader('x-ratelimit-reset') ?? null,
  };
}
