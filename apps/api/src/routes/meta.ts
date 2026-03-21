import type { FastifyInstance } from 'fastify';
import { buildApiTruthResponse } from '../lib/apiTruth.js';
import { buildMetaResponse } from '../lib/runtimeMeta.js';

export async function metaRoutes(fastify: FastifyInstance) {
  fastify.get('/meta', async (_request, reply) => {
    return reply.send(await buildMetaResponse());
  });

  fastify.get('/api-truth', async (_request, reply) => {
    return reply.send(await buildApiTruthResponse());
  });
}
