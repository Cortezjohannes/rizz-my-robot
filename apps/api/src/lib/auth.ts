import { createHash } from 'crypto';
import { randomBytes } from 'crypto';

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
