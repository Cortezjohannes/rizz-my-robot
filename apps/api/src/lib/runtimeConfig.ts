const PRODUCTION_SECRET_MIN_BYTES = 32;
const PLACEHOLDER_SECRET_VALUES = new Set([
  'change-me-32-bytes-minimum',
  'development-claim-token-key',
  'rmr-webhook-signing-key-change-in-prod',
]);

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function isMissing(value: string | undefined): boolean {
  return !value || value.trim().length === 0;
}

function isPlaceholderSecret(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return PLACEHOLDER_SECRET_VALUES.has(normalized)
    || normalized.includes('change-me')
    || normalized.includes('changeme')
    || normalized.includes('placeholder')
    || normalized.includes('example');
}

function getProductionSecretIssue(key: string, value: string | undefined): string | null {
  if (isMissing(value)) return key;

  const trimmed = value!.trim();
  if (isPlaceholderSecret(trimmed)) return `${key}:placeholder`;
  if (Buffer.byteLength(trimmed, 'utf8') < PRODUCTION_SECRET_MIN_BYTES) return `${key}:weak`;
  return null;
}

function requireProductionSecret(key: string, value: string | undefined): string {
  const issue = getProductionSecretIssue(key, value);
  if (issue) {
    throw new Error(`${key} must be a non-placeholder secret with at least ${PRODUCTION_SECRET_MIN_BYTES} bytes in production.`);
  }
  return value!.trim();
}

type RuntimeConfigStatus = {
  required_missing: string[];
  recommended_missing: string[];
};

function getApiRuntimeConfigStatus(): RuntimeConfigStatus {
  const requiredMissing: string[] = [];
  const recommendedMissing: string[] = [];

  const require = (key: string, value: string | undefined) => {
    if (isMissing(value)) requiredMissing.push(key);
  };
  const recommend = (key: string, value: string | undefined) => {
    if (isMissing(value)) recommendedMissing.push(key);
  };

  require('DATABASE_URL', process.env.DATABASE_URL);
  require('REDIS_URL', process.env.REDIS_URL);
  require('API_PUBLIC_URL', process.env.API_PUBLIC_URL);
  require('REVEAL_PORTAL_URL', process.env.REVEAL_PORTAL_URL);
  require('CORS_ORIGIN', process.env.CORS_ORIGIN);
  const claimSecretIssue = isProduction()
    ? getProductionSecretIssue('CLAIM_TOKEN_HMAC_KEY', process.env.CLAIM_TOKEN_HMAC_KEY)
    : isMissing(process.env.CLAIM_TOKEN_HMAC_KEY) ? 'CLAIM_TOKEN_HMAC_KEY' : null;
  if (claimSecretIssue) requiredMissing.push(claimSecretIssue);

  const webhookSecretIssue = isProduction()
    ? getProductionSecretIssue('WEBHOOK_HMAC_KEY', process.env.WEBHOOK_HMAC_KEY)
    : isMissing(process.env.WEBHOOK_HMAC_KEY) ? 'WEBHOOK_HMAC_KEY' : null;
  if (webhookSecretIssue) requiredMissing.push(webhookSecretIssue);

  const mediaSecretIssue = isProduction()
    ? getProductionSecretIssue('MEDIA_ACCESS_SECRET', process.env.MEDIA_ACCESS_SECRET)
    : null;
  if (mediaSecretIssue) requiredMissing.push(mediaSecretIssue);

  if (isMissing(process.env.ADMIN_API_KEY) && isMissing(process.env.OMNIMON_CONTROL_KEY)) {
    requiredMissing.push('ADMIN_API_KEY|OMNIMON_CONTROL_KEY');
  }

  const storageKeys = [
    'STORAGE_BUCKET',
    'STORAGE_ENDPOINT',
    'STORAGE_ACCESS_KEY_ID',
    'STORAGE_SECRET_ACCESS_KEY',
    'STORAGE_PUBLIC_URL',
  ] as const;
  if (storageKeys.some((key) => isMissing(process.env[key]))) {
    requiredMissing.push('STORAGE_*');
  }

  recommend('SENTRY_DSN', process.env.SENTRY_DSN);
  recommend('SENTRY_ENVIRONMENT', process.env.SENTRY_ENVIRONMENT);
  if (process.env.EMAIL_PREVIEW_MODE === 'true') {
    requiredMissing.push('EMAIL_PREVIEW_MODE:false');
  }

  return {
    required_missing: requiredMissing,
    recommended_missing: recommendedMissing,
  };
}

export function getClaimTokenHmacKey(): string {
  const value = process.env.CLAIM_TOKEN_HMAC_KEY;
  if (isProduction()) {
    return requireProductionSecret('CLAIM_TOKEN_HMAC_KEY', value);
  }
  return value ?? 'development-claim-token-key';
}

export function getWebhookHmacKey(): string {
  const value = process.env.WEBHOOK_HMAC_KEY;
  if (isProduction()) {
    return requireProductionSecret('WEBHOOK_HMAC_KEY', value);
  }
  return value ?? 'rmr-webhook-signing-key-change-in-prod';
}

export function getMediaAccessSecret(): string | null {
  if (isProduction()) {
    return requireProductionSecret('MEDIA_ACCESS_SECRET', process.env.MEDIA_ACCESS_SECRET);
  }

  return process.env.MEDIA_ACCESS_SECRET
    ?? process.env.JWT_SECRET
    ?? process.env.STORAGE_SECRET_ACCESS_KEY
    ?? null;
}

export function getXClientId(): string | undefined {
  const value = process.env.X_CLIENT_ID;
  if (isProduction() && isMissing(value)) {
    throw new Error('X_CLIENT_ID must be configured in production.');
  }
  return value;
}

export function getXOAuthRedirectUri(): string | undefined {
  const value = process.env.X_OAUTH_REDIRECT_URI;
  if (isProduction() && isMissing(value)) {
    throw new Error('X_OAUTH_REDIRECT_URI must be configured in production.');
  }
  return value;
}

export function getAdminApiKey(): string | undefined {
  const value = process.env.ADMIN_API_KEY;
  if (isProduction() && isMissing(value)) {
    throw new Error('ADMIN_API_KEY must be configured in production.');
  }
  return value;
}

export function getControlCredentialSummary() {
  const adminApiKey = process.env.ADMIN_API_KEY;
  const omnimonControlKey = process.env.OMNIMON_CONTROL_KEY;

  if (isProduction() && isMissing(adminApiKey) && isMissing(omnimonControlKey)) {
    throw new Error('ADMIN_API_KEY or OMNIMON_CONTROL_KEY must be configured in production.');
  }

  return {
    adminApiKey,
    omnimonControlKey,
  };
}

export function getCorsOrigin(): string | string[] {
  const raw = process.env.CORS_ORIGIN;

  if (!raw || raw.trim().length === 0) {
    if (isProduction()) {
      throw new Error('CORS_ORIGIN must be configured in production.');
    }
    return '*';
  }

  if (isProduction() && raw.trim() === '*') {
    throw new Error('CORS_ORIGIN cannot be "*" in production.');
  }

  const origins = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    if (isProduction()) {
      throw new Error('CORS_ORIGIN must contain at least one origin in production.');
    }
    return '*';
  }

  return origins.length === 1 ? origins[0] : origins;
}

export function assertProductionRuntimeConfig(): void {
  if (!isProduction()) return;
  if (process.env.EMAIL_PREVIEW_MODE === 'true') {
    throw new Error('EMAIL_PREVIEW_MODE cannot be true in production.');
  }
  getCorsOrigin();
  getClaimTokenHmacKey();
  getWebhookHmacKey();
  getMediaAccessSecret();
  getControlCredentialSummary();
  const status = getApiRuntimeConfigStatus();
  if (status.required_missing.length > 0) {
    throw new Error(`production_runtime_config_missing:${status.required_missing.join(',')}`);
  }
}

export function getProductionRuntimeConfigStatus(): RuntimeConfigStatus {
  if (!isProduction()) {
    return {
      required_missing: [],
      recommended_missing: [],
    };
  }

  return getApiRuntimeConfigStatus();
}
