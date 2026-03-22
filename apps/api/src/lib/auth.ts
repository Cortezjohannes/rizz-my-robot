import { createHash } from 'crypto';
import { randomBytes } from 'crypto';
import type { FastifyRequest } from 'fastify';

const API_KEY_PREFIX = 'rmr_live_';

export function generateApiKey(): string {
  const raw = randomBytes(32).toString('hex');
  return `${API_KEY_PREFIX}${raw}`;
}

export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  return token.length > 0 ? token : null;
}

function extractHeaderValue(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function extractApiKeyFromRequest(request: FastifyRequest): string | null {
  return extractBearerToken(request.headers.authorization)
    ?? extractHeaderValue(request.headers['x-agent-api-key'])
    ?? extractHeaderValue(request.headers['x-rmr-api-key'])
    ?? extractHeaderValue(request.headers['x-api-key']);
}
