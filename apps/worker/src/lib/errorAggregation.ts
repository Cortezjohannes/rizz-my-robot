import * as Sentry from '@sentry/node';

let initialized = false;

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(typeof error === 'string' ? error : JSON.stringify(error));
}

export function isErrorAggregationConfigured() {
  return Boolean(process.env.SENTRY_DSN);
}

export function initializeErrorAggregation(serviceName: string) {
  if (initialized || !isErrorAggregationConfigured()) {
    return false;
  }

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    release: process.env.RENDER_GIT_COMMIT ?? process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? undefined,
    tracesSampleRate: Number.parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0'),
    serverName: serviceName,
    sendDefaultPii: false,
  });
  initialized = true;
  return true;
}

export function captureRuntimeError(error: unknown, context: Record<string, unknown> = {}) {
  if (!initialized) return;

  Sentry.withScope((scope) => {
    for (const [key, value] of Object.entries(context)) {
      scope.setExtra(key, value);
    }
    Sentry.captureException(normalizeError(error));
  });
}

export async function flushErrorAggregation(timeoutMs = 2_000) {
  if (!initialized) return;
  await Sentry.flush(timeoutMs).catch(() => undefined);
}
