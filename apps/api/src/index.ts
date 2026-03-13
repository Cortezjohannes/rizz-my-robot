import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { healthRoutes } from './routes/health.js';

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
  // Security headers
  await fastify.register(helmet, {
    contentSecurityPolicy: false, // API — no HTML served
  });

  // CORS — agents call from any host
  await fastify.register(cors, {
    origin: process.env.CORS_ORIGIN ?? '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  // Rate limiting — defaults; per-route overrides applied in route files
  await fastify.register(rateLimit, {
    global: false, // opt-in per route
    max: 60,
    timeWindow: '1 minute',
  });

  // Routes
  await fastify.register(healthRoutes);

  // Global error handler — ensures consistent error shape
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

  // 404 handler
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
