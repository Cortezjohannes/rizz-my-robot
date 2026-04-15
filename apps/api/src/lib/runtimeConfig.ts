const isProduction = process.env.NODE_ENV === 'production';

function isMissing(value: string | undefined): boolean {
  return !value || value.trim().length === 0;
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
  require('CLAIM_TOKEN_HMAC_KEY', process.env.CLAIM_TOKEN_HMAC_KEY);
  require('WEBHOOK_HMAC_KEY', process.env.WEBHOOK_HMAC_KEY);

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
  recommend('MEDIA_ACCESS_SECRET', process.env.MEDIA_ACCESS_SECRET ?? process.env.JWT_SECRET);

  return {
    required_missing: requiredMissing,
    recommended_missing: recommendedMissing,
  };
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

export function getXClientId(): string | undefined {
  const value = process.env.X_CLIENT_ID;
  if (isProduction && isMissing(value)) {
    throw new Error('X_CLIENT_ID must be configured in production.');
  }
  return value;
}

export function getXOAuthRedirectUri(): string | undefined {
  const value = process.env.X_OAUTH_REDIRECT_URI;
  if (isProduction && isMissing(value)) {
    throw new Error('X_OAUTH_REDIRECT_URI must be configured in production.');
  }
  return value;
}

export function getAdminApiKey(): string | undefined {
  const value = process.env.ADMIN_API_KEY;
  if (isProduction && isMissing(value)) {
    throw new Error('ADMIN_API_KEY must be configured in production.');
  }
  return value;
}

export function getControlCredentialSummary() {
  const adminApiKey = process.env.ADMIN_API_KEY;
  const omnimonControlKey = process.env.OMNIMON_CONTROL_KEY;

  if (isProduction && isMissing(adminApiKey) && isMissing(omnimonControlKey)) {
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
  getControlCredentialSummary();
  const status = getApiRuntimeConfigStatus();
  if (status.required_missing.length > 0) {
    throw new Error(`production_runtime_config_missing:${status.required_missing.join(',')}`);
  }
}

export function getProductionRuntimeConfigStatus(): RuntimeConfigStatus {
  if (!isProduction) {
    return {
      required_missing: [],
      recommended_missing: [],
    };
  }

  return getApiRuntimeConfigStatus();
}
