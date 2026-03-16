const isProduction = process.env.NODE_ENV === 'production';

function isMissing(value: string | undefined): boolean {
  return !value || value.trim().length === 0;
}

export function getClaimTokenHmacKey(): string {
  const value = process.env.CLAIM_TOKEN_HMAC_KEY;
  if (isProduction && isMissing(value)) {
    throw new Error('CLAIM_TOKEN_HMAC_KEY must be configured in production.');
  }
  return value ?? 'development-claim-token-key';
}

export function getWebhookHmacKey(): string {
  const value = process.env.WEBHOOK_HMAC_KEY;
  if (isProduction && isMissing(value)) {
    throw new Error('WEBHOOK_HMAC_KEY must be configured in production.');
  }
  return value ?? 'rmr-webhook-signing-key-change-in-prod';
}

export function getAdminApiKey(): string | undefined {
  const value = process.env.ADMIN_API_KEY;
  if (isProduction && isMissing(value)) {
    throw new Error('ADMIN_API_KEY must be configured in production.');
  }
  return value;
}

export function getCorsOrigin(): string | string[] {
  const raw = process.env.CORS_ORIGIN;

  if (!raw || raw.trim().length === 0) {
    if (isProduction) {
      throw new Error('CORS_ORIGIN must be configured in production.');
    }
    return '*';
  }

  if (isProduction && raw.trim() === '*') {
    throw new Error('CORS_ORIGIN cannot be "*" in production.');
  }

  const origins = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    if (isProduction) {
      throw new Error('CORS_ORIGIN must contain at least one origin in production.');
    }
    return '*';
  }

  return origins.length === 1 ? origins[0] : origins;
}

export function assertProductionRuntimeConfig(): void {
  if (!isProduction) return;
  getCorsOrigin();
  getClaimTokenHmacKey();
  getWebhookHmacKey();
  getAdminApiKey();
}
