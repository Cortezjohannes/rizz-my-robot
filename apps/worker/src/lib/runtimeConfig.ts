const isProduction = process.env.NODE_ENV === 'production';

function isMissing(value: string | undefined): boolean {
  return !value || value.trim().length === 0;
}

type RuntimeConfigStatus = {
  required_missing: string[];
  recommended_missing: string[];
};

export function getWorkerRuntimeConfigStatus(): RuntimeConfigStatus {
  if (!isProduction) {
    return {
      required_missing: [],
      recommended_missing: [],
    };
  }

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
  require('WEBHOOK_HMAC_KEY', process.env.WEBHOOK_HMAC_KEY);

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
  recommend('OPENAI_API_KEY|ELEVENLABS_API_KEY|GEMINI_API_KEY', process.env.OPENAI_API_KEY ?? process.env.ELEVENLABS_API_KEY ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY);
  recommend('REVEAL_PORTAL_URL', process.env.REVEAL_PORTAL_URL);

  return {
    required_missing: requiredMissing,
    recommended_missing: recommendedMissing,
  };
}

export function assertWorkerProductionRuntimeConfig(): void {
  const status = getWorkerRuntimeConfigStatus();
  if (status.required_missing.length > 0) {
    throw new Error(`worker_runtime_config_missing:${status.required_missing.join(',')}`);
  }
}
