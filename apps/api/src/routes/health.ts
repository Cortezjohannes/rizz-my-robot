import type { FastifyInstance } from 'fastify';
import { prisma } from '@rmr/db';

export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/health', async (_request, reply) => {
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
  });

  // Liveness probe — no db check, just confirms process is alive
  fastify.get('/health/live', async (_request, reply) => {
    return reply.status(200).send({ status: 'ok' });
  });
}
