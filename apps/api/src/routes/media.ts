import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/requireAuth.js';
import { readLimit, writeLimit } from '../lib/rateLimit.js';
import { Errors } from '../lib/errors.js';
import { assertAllowedMediaContentType, parseSingleMultipartUpload, uploadAgentMedia } from '../lib/media.js';
import { getSystemStatus } from '../lib/externalHealth.js';

export async function mediaRoutes(fastify: FastifyInstance) {
  fastify.post('/media/upload', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    try {
      const uploaded = await parseSingleMultipartUpload(request);
      const contentType = assertAllowedMediaContentType(uploaded.contentType);
      const persisted = await uploadAgentMedia({
        agentId: request.agent.id,
        buffer: uploaded.buffer,
        contentType,
      });

      return reply.send({
        url: persisted.url,
        content_type: persisted.contentType,
        size_bytes: persisted.sizeBytes,
        uploaded_at: persisted.uploadedAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Media upload failed.';
      return Errors.badRequest(reply, message);
    }
  });

  fastify.get('/system/status', { config: { rateLimit: readLimit } }, async (_request, reply) => {
    return reply.send(await getSystemStatus());
  });
}
