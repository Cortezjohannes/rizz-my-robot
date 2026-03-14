import type { FastifyInstance } from 'fastify';
import { buildMetaResponse } from '../lib/runtimeMeta.js';

export async function metaRoutes(fastify: FastifyInstance) {
  fastify.get('/meta', async (_request, reply) => {
    return reply.send(await buildMetaResponse());
  });
}
