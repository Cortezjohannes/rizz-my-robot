import Fastify from 'fastify';
import type { FastifyRequest, RouteOptions } from 'fastify';
import { pathToFileURL } from 'node:url';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { Prisma } from '@rmr/db';
import { getSwipeLimitForTier, resolveExperienceTier } from '@rmr/shared';
import { healthRoutes } from './routes/health.js';
import { registerRoutes } from './routes/register.js';
import { claimsRoutes } from './routes/claims.js';
import { verifyTwitterRoutes } from './routes/verifyTwitter.js';
import { meRoutes } from './routes/me.js';
import { candidatesRoutes } from './routes/candidates.js';
import { swipeRoutes } from './routes/swipe.js';
import { episodeRoutes } from './routes/episodes.js';
import { matchesRoutes } from './routes/matches.js';
import { portalRoutes } from './routes/portal.js';
import { datePlanningRoutes } from './routes/datePlanning.js';
import { feedRoutes } from './routes/feed.js';
import { chatRoutes } from './routes/chat.js';
import { leaderboardRoutes } from './routes/leaderboard.js';
import { webhookRoutes } from './routes/webhooks.js';
import { sandboxRoutes } from './routes/sandbox.js';
import { blocksRoutes } from './routes/blocks.js';
import { metaRoutes } from './routes/meta.js';
import { billingRoutes } from './routes/billing.js';
import { internalRoutes } from './routes/internal.js';
import { controlRoutes } from './routes/control.js';
import { ownerRoutes } from './routes/owner.js';
import { heartbeatRoutes } from './routes/heartbeat.js';
import { verifyRoutes } from './routes/verify.js';
import { homeRoutes } from './routes/home.js';
import { artifactsRoutes } from './routes/artifacts.js';
import { diaryRoutes } from './routes/diary.js';
import { profileDeckRoutes } from './routes/profileDeck.js';
import { revealChatRoutes } from './routes/revealChat.js';
import { mediaRoutes } from './routes/media.js';
import { feedImpressionRoutes } from './routes/feedImpressions.js';
import { livingWorldRoutes } from './routes/livingWorld.js';
import { assertProductionRuntimeConfig, getCorsOrigin } from './lib/runtimeConfig.js';
import { buildRateLimitDiagnostics, buildWriteNotFoundDiagnostics } from './lib/writeDiagnostics.js';
import { buildErrorPayload, sendValidationFailed } from './lib/errors.js';
import { resolveHourlySwipeWindowState } from './lib/throughput.js';
import {
  captureRuntimeError,
  flushErrorAggregation,
  initializeErrorAggregation,
} from './lib/errorAggregation.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }

  interface FastifyInstance {
    routeCatalog: Array<{
      method: string;
      url: string;
      schema?: unknown;
    }>;
  }
}

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const HOST = process.env.HOST ?? '0.0.0.0';
let processGuardsInstalled = false;

function stripQuery(url: string) {
  return url.split('?')[0] ?? url;
}

function findClosestRoute(fastify: ReturnType<typeof Fastify>, path: string) {
  const targetParts = path.split('/').filter(Boolean);
  let best: { method: string; url: string; score: number } | null = null;

  for (const route of fastify.routeCatalog) {
    const routeParts = route.url.split('/').filter(Boolean);
    const score = routeParts.reduce((acc: number, part: string, index: number) => {
      const target = targetParts[index];
      if (!target) return acc;
      if (part === target) return acc + 3;
      if (part.startsWith(':')) return acc + 1;
      return acc;
    }, routeParts.length === targetParts.length ? 2 : 0);

    if (!best || score > best.score) {
      best = { method: route.method, url: route.url, score };
    }
  }

  return best && best.score > 0 ? `${best.method} ${best.url}` : null;
}

function buildOpenApiSpecFor(fastify: ReturnType<typeof Fastify>) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of fastify.routeCatalog) {
    if (route.url.includes('*')) continue;
    const path = route.url;
    const method = route.method.toLowerCase();
    paths[path] ??= {};
    paths[path][method] = {
      operationId: `${method}_${path.replace(/[/:]+/g, '_').replace(/^_+|_+$/g, '')}`,
      responses: {
        '200': { description: 'Successful response' },
      },
      ...(route.schema ? { 'x-fastify-schema': route.schema } : {}),
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Rizz My Robot API',
      version: '1.0.0',
    },
    paths,
  };
}

function installProcessGuards(fastify: ReturnType<typeof Fastify>) {
  if (processGuardsInstalled) return;
  processGuardsInstalled = true;

  process.on('unhandledRejection', (reason) => {
    captureRuntimeError(reason, { surface: 'api', phase: 'unhandled_rejection' });
    fastify.log.error({ reason }, 'Unhandled rejection');
  });

  process.on('uncaughtException', (error) => {
    captureRuntimeError(error, { surface: 'api', phase: 'uncaught_exception' });
    fastify.log.error({ err: error }, 'Uncaught exception');
  });
}

export async function buildApiServer() {
  const corsOrigin = getCorsOrigin();
  const fastify = Fastify({
    bodyLimit: 12 * 1024 * 1024,
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      transport:
        process.env.NODE_ENV !== 'production'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
    trustProxy: process.env.NODE_ENV === 'production',
  });

  fastify.decorate('routeCatalog', []);

  fastify.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      fastify.routeCatalog.push({
        method: method.toUpperCase(),
        url: route.url,
        schema: route.schema,
      });
    }
  });

  installProcessGuards(fastify);

  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (request: FastifyRequest, body: string, done) => {
      if (
        request.url.startsWith('/v1/billing/webhook')
        || request.url.startsWith('/v1/billing/paddle/webhook')
      ) {
        request.rawBody = body;
      }

      if (!body) {
        done(null, {});
        return;
      }

      try {
        done(null, JSON.parse(body));
      } catch (err) {
        done(err as Error, undefined);
      }
    }
  );

  // Security headers
  await fastify.register(helmet, {
    contentSecurityPolicy: false, // API — no HTML served
    crossOriginResourcePolicy: false, // API responses are intentionally consumed cross-origin by the web app
  });

  await fastify.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024,
      files: 1,
    },
  });

  // CORS — agents call from any host
  await fastify.register(cors, {
    origin:
      Array.isArray(corsOrigin)
        ? (origin, cb) => {
            if (!origin) return cb(null, true);
            if (corsOrigin.includes(origin)) return cb(null, origin);
            cb(null, false);
          }
        : corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Rate limiting — global: false means opt-in per route via config.rateLimit
  await fastify.register(rateLimit, {
    global: false,
    max: 60,
    timeWindow: '1 minute',
    addHeadersOnExceeding: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
    },
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
  });

  fastify.addHook('onSend', async (request, reply, payload) => {
    const rateLimitConfig = request.routeOptions.config?.rateLimit as { max?: number | ((request: FastifyRequest, key: string) => number) } | undefined;
    const configuredMax = typeof rateLimitConfig?.max === 'function'
      ? rateLimitConfig.max(request, request.ip)
      : typeof rateLimitConfig?.max === 'number'
        ? rateLimitConfig.max
        : request.method === 'GET'
          ? 200
          : 60;

    if (!reply.hasHeader('x-ratelimit-limit')) {
      reply.header('X-RateLimit-Limit', String(configuredMax));
    }
    if (!reply.hasHeader('x-ratelimit-remaining')) {
      reply.header('X-RateLimit-Remaining', 'unknown');
    }
    if (!reply.hasHeader('x-ratelimit-reset')) {
      reply.header('X-RateLimit-Reset', String(Math.floor(Date.now() / 1000) + 60));
    }

    if (request.agent) {
      const experienceTier = resolveExperienceTier({
        isPro: request.agent.isPro,
        isFoundingRizzler: request.agent.isFoundingRizzler,
      });
      const swipeLimit = getSwipeLimitForTier(experienceTier);
      const swipeWindow = resolveHourlySwipeWindowState({
        hourlySwipeCount: request.agent.hourlySwipeCount,
        hourlySwipeWindowStartedAt: request.agent.hourlySwipeWindowStartedAt,
      });
      reply.header('X-Swipe-Budget-Remaining', String(Math.max(0, swipeLimit - swipeWindow.usedThisHour)));
      reply.header('X-Swipe-Budget-Reset', String(Math.floor((swipeWindow.resetsAt?.getTime() ?? (Date.now() + 60 * 60 * 1000)) / 1000)));
    }

    return payload;
  });

  // ── Routes ──────────────────────────────────────────────────────────────────
  // Health (no prefix)
  await fastify.register(healthRoutes);
  await fastify.register(metaRoutes, { prefix: '/v1' });
  fastify.get('/v1/openapi.json', async (_request, reply) => {
    return reply.send(buildOpenApiSpecFor(fastify));
  });

  // Agent API — all under /v1
  await fastify.register(registerRoutes, { prefix: '/v1' });
  await fastify.register(claimsRoutes, { prefix: '/v1' });
  await fastify.register(verifyTwitterRoutes, { prefix: '/v1' });
  await fastify.register(meRoutes, { prefix: '/v1' });
  await fastify.register(candidatesRoutes, { prefix: '/v1' });
  await fastify.register(swipeRoutes, { prefix: '/v1' });
  await fastify.register(episodeRoutes, { prefix: '/v1' });
  await fastify.register(matchesRoutes, { prefix: '/v1' });
  await fastify.register(datePlanningRoutes, { prefix: '/v1' });
  await fastify.register(feedRoutes, { prefix: '/v1' });
  await fastify.register(chatRoutes, { prefix: '/v1' });
  await fastify.register(leaderboardRoutes, { prefix: '/v1' });
  await fastify.register(webhookRoutes, { prefix: '/v1' });
  await fastify.register(billingRoutes, { prefix: '/v1' });
  await fastify.register(sandboxRoutes, { prefix: '/v1' });
  await fastify.register(blocksRoutes, { prefix: '/v1' });
  await fastify.register(internalRoutes, { prefix: '/v1' });
  await fastify.register(controlRoutes, { prefix: '/v1' });
  await fastify.register(ownerRoutes, { prefix: '/v1' });
  await fastify.register(heartbeatRoutes, { prefix: '/v1' });
  await fastify.register(verifyRoutes, { prefix: '/v1' });
  await fastify.register(homeRoutes, { prefix: '/v1' });
  await fastify.register(artifactsRoutes, { prefix: '/v1' });
  await fastify.register(diaryRoutes, { prefix: '/v1' });
  await fastify.register(profileDeckRoutes, { prefix: '/v1' });
  await fastify.register(revealChatRoutes, { prefix: '/v1' });
  await fastify.register(mediaRoutes, { prefix: '/v1' });
  await fastify.register(livingWorldRoutes, { prefix: '/v1' });
  await fastify.register(feedImpressionRoutes);

  // Human reveal portal — under /portal (no agent auth)
  await fastify.register(portalRoutes);

  // ── Error handlers ──────────────────────────────────────────────────────────
  fastify.setErrorHandler((err, request, reply) => {
    captureRuntimeError(err, {
      surface: 'api',
      phase: 'request_error',
      method: request.method,
      path: stripQuery(request.url),
      route: request.routeOptions.url,
    });
    fastify.log.error(err);

    const error = err as {
      validation?: unknown;
      statusCode?: number;
      message?: string;
      code?: string;
    };

    if (error.code === 'FST_ERR_CTP_INVALID_JSON_BODY') {
      return reply.status(400).send(buildErrorPayload({
        request,
        code: 'invalid_json',
        message: 'Malformed JSON payload.',
        details: {
          received_at_endpoint: `${request.method.toUpperCase()} ${stripQuery(request.url)}`,
        },
      }));
    }

    if (error.validation) {
      return sendValidationFailed(reply, error.validation as never, 400);
    }

    if (
      err instanceof Prisma.PrismaClientKnownRequestError
      && (err.code === 'P2021' || err.code === 'P2022')
    ) {
      return reply.status(503).send(buildErrorPayload({
        request,
        code: 'schema_out_of_date',
        message: 'The database schema is behind the deployed API code.',
        details: {
          prisma_code: err.code,
          missing_table: err.code === 'P2021' ? err.meta?.table ?? null : null,
          missing_column: err.code === 'P2022' ? err.meta?.column ?? null : null,
        },
        suggestion: 'Run the latest Prisma migrations, then retry this request.',
      }));
    }

    if (error.statusCode === 429 || error.code === 'FST_ERR_RATE_LIMITED') {
      return reply.status(429).send(buildErrorPayload({
        request,
        code: 'rate_limited',
        message: 'You have exceeded the rate limit for this action.',
        details: buildRateLimitDiagnostics(request, reply),
      }));
    }

    if (error.statusCode) {
      return reply.status(error.statusCode).send(buildErrorPayload({
        request,
        code: 'request_error',
        message: error.message ?? 'An error occurred.',
        details: {
          method: request.method,
          path: stripQuery(request.url),
        },
      }));
    }

    return reply.status(500).send(buildErrorPayload({
      request,
      code: 'internal_error',
      message: 'An unexpected error occurred.',
    }));
  });

  fastify.setNotFoundHandler((request, reply) => {
    const closest = findClosestRoute(fastify, stripQuery(request.url));
    return reply.status(404).send(buildErrorPayload({
      request,
      code: 'not_found',
      message: 'Route not found.',
      details: {
        ...(buildWriteNotFoundDiagnostics(request) ?? {}),
        closest_matching_route: closest,
      },
      suggestion: closest ? `Use ${closest} instead.` : undefined,
    }));
  });

  return fastify;
}

async function bootstrap() {
  initializeErrorAggregation('rmr-api');
  assertProductionRuntimeConfig();

  const fastify = await buildApiServer();
  await fastify.listen({ port: PORT, host: HOST });
  fastify.log.info(`API server running at http://${HOST}:${PORT}`);
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectRun) {
  bootstrap().catch((err) => {
    captureRuntimeError(err, { surface: 'api', phase: 'bootstrap' });
    console.error('Failed to start server:', err);
    if (err instanceof Error && (/must be configured in production/.test(err.message) || /production_runtime_config_missing/.test(err.message))) {
      console.error('Render startup hint: check DATABASE_URL, REDIS_URL, API_PUBLIC_URL, REVEAL_PORTAL_URL, CORS_ORIGIN, CLAIM_TOKEN_HMAC_KEY, WEBHOOK_HMAC_KEY, ADMIN_API_KEY or OMNIMON_CONTROL_KEY, and STORAGE_*.');
    }
    void flushErrorAggregation().finally(() => process.exit(1));
  });
}
