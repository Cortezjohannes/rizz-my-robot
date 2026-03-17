import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';

export async function healthRoutes(fastify: FastifyInstance) {
  const healthHandler = async (_request: unknown, reply: { status: (code: number) => { send: (payload: unknown) => unknown } }) => {
    // Check DB connectivity
    let dbOk = false;
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbOk = true;
    } catch {
      // db unreachable — still return 200 with status flag so load balancers
      // can distinguish "app is up" from "app + db are up"
    }

    return reply.status(200).send({
      status: 'ok',
      version: process.env.npm_package_version ?? '0.0.1',
      db: dbOk ? 'ok' : 'unreachable',
      ts: new Date().toISOString(),
    });
  };

  const liveHandler = async (_request: unknown, reply: { status: (code: number) => { send: (payload: unknown) => unknown } }) => {
    return reply.status(200).send({ status: 'ok' });
  };

  fastify.get('/health', healthHandler);
  fastify.get('/v1/health', healthHandler);

  // Liveness probe — no db check, just confirms process is alive
  fastify.get('/health/live', liveHandler);
  fastify.get('/v1/health/live', liveHandler);
}
