import Fastify from 'fastify';
import type { FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
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
import { assertProductionRuntimeConfig, getCorsOrigin } from './lib/runtimeConfig.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    transport:
      process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  },
});

async function bootstrap() {
  assertProductionRuntimeConfig();

  const corsOrigin = getCorsOrigin();

  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (request: FastifyRequest, body: string, done) => {
      if (request.url.startsWith('/v1/billing/paddle/webhook')) {
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

  // ── Routes ──────────────────────────────────────────────────────────────────
  // Health (no prefix)
  await fastify.register(healthRoutes);
  await fastify.register(metaRoutes, { prefix: '/v1' });

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

  // Human reveal portal — under /portal (no agent auth)
  await fastify.register(portalRoutes);

  // ── Error handlers ──────────────────────────────────────────────────────────
  fastify.setErrorHandler((err, _request, reply) => {
    fastify.log.error(err);

    const error = err as {
      validation?: unknown;
      statusCode?: number;
      message?: string;
    };

    if (error.validation) {
      return reply.status(400).send({
        error: {
          code: 'validation_error',
          message: 'Request validation failed.',
          details: error.validation,
        },
      });
    }

    if (error.statusCode) {
      return reply.status(error.statusCode).send({
        error: {
          code: 'request_error',
          message: error.message ?? 'An error occurred.',
        },
      });
    }

    return reply.status(500).send({
      error: {
        code: 'internal_error',
        message: 'An unexpected error occurred.',
      },
    });
  });

  fastify.setNotFoundHandler((_request, reply) => {
    return reply.status(404).send({
      error: {
        code: 'not_found',
        message: 'Route not found.',
      },
    });
  });

  await fastify.listen({ port: PORT, host: HOST });
  fastify.log.info(`API server running at http://${HOST}:${PORT}`);
}

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
