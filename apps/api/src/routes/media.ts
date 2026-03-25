import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { readLimit, writeLimit } from '../lib/rateLimit.js';
import { Errors } from '../lib/errors.js';
import { assertAllowedMediaContentType, parseSingleMultipartUpload } from '../lib/media.js';
import { getSystemStatus } from '../lib/externalHealth.js';
import {
  MEDIA_KIND,
  MEDIA_VISIBILITY,
  canAccessMediaAsset,
  getMediaAssetById,
  importExternalMediaAsset,
  persistMediaAsset,
  serializeMediaAssetForViewer,
  softDeleteMediaAsset,
} from '../lib/mediaAssets.js';
import { getStorageObjectStream } from '../lib/storage.js';
import { resolveOptionalViewer } from '../lib/viewerContext.js';

const MediaKindSchema = z.enum([
  MEDIA_KIND.AVATAR,
  MEDIA_KIND.PROFILE_PHOTO,
  MEDIA_KIND.ARTIFACT,
  MEDIA_KIND.EPISODE_ATTACHMENT,
  MEDIA_KIND.REVEAL_CHAT_ATTACHMENT,
  MEDIA_KIND.VOICE_CATCHPHRASE,
  MEDIA_KIND.SYSTEM_GENERATED,
]);

const MediaVisibilitySchema = z.enum([
  MEDIA_VISIBILITY.PUBLIC,
  MEDIA_VISIBILITY.MATCH_PRIVATE,
  MEDIA_VISIBILITY.OWNER_PRIVATE,
  MEDIA_VISIBILITY.REVEAL_PRIVATE,
]);

const MediaUploadQuerySchema = z.object({
  kind: MediaKindSchema.optional().default(MEDIA_KIND.ARTIFACT),
  visibility: MediaVisibilitySchema.optional().default(MEDIA_VISIBILITY.PUBLIC),
  artifact_id: z.string().uuid().optional(),
  episode_id: z.string().uuid().optional(),
  match_id: z.string().uuid().optional(),
  reveal_chat_id: z.string().uuid().optional(),
  path_token: z.string().trim().min(1).max(255).optional(),
});

const MediaImportSchema = z.object({
  url: z.string().url().max(2048),
  kind: MediaKindSchema.optional().default(MEDIA_KIND.ARTIFACT),
  visibility: MediaVisibilitySchema.optional().default(MEDIA_VISIBILITY.PUBLIC),
  artifact_id: z.string().uuid().optional(),
  episode_id: z.string().uuid().optional(),
  match_id: z.string().uuid().optional(),
  reveal_chat_id: z.string().uuid().optional(),
  path_token: z.string().trim().min(1).max(255).optional(),
  filename: z.string().trim().min(1).max(255).optional(),
});

export async function mediaRoutes(fastify: FastifyInstance) {
  fastify.post('/media/upload', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    try {
      const parsedQuery = MediaUploadQuerySchema.safeParse(request.query ?? {});
      if (!parsedQuery.success) {
        return Errors.badRequest(reply, 'Invalid media upload query.', { issues: parsedQuery.error.issues });
      }
      const uploaded = await parseSingleMultipartUpload(request);
      const contentType = assertAllowedMediaContentType(uploaded.contentType);
      const persisted = await persistMediaAsset({
        agentId: request.agent.id,
        buffer: uploaded.buffer,
        contentType,
        kind: parsedQuery.data.kind,
        visibility: parsedQuery.data.visibility,
        artifactId: parsedQuery.data.artifact_id ?? null,
        episodeId: parsedQuery.data.episode_id ?? null,
        matchId: parsedQuery.data.match_id ?? null,
        revealChatId: parsedQuery.data.reveal_chat_id ?? null,
        pathToken: parsedQuery.data.path_token ?? null,
        filename: uploaded.filename,
      });

      return reply.send(await serializeMediaAssetForViewer(persisted, { agentId: request.agent.id }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Media upload failed.';
      return Errors.badRequest(reply, message);
    }
  });

  fastify.post('/media/import', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    const parsed = MediaImportSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return Errors.badRequest(reply, 'Invalid media import payload.', { issues: parsed.error.issues });
    }

    try {
      const mediaAsset = await importExternalMediaAsset({
        agentId: request.agent.id,
        kind: parsed.data.kind,
        visibility: parsed.data.visibility,
        sourceUrl: parsed.data.url,
        filename: parsed.data.filename ?? null,
        artifactId: parsed.data.artifact_id ?? null,
        episodeId: parsed.data.episode_id ?? null,
        matchId: parsed.data.match_id ?? null,
        revealChatId: parsed.data.reveal_chat_id ?? null,
        pathToken: parsed.data.path_token ?? null,
      });
      return reply.send(await serializeMediaAssetForViewer(mediaAsset, { agentId: request.agent.id }));
    } catch (error) {
      return Errors.badRequest(reply, error instanceof Error ? error.message : 'Media import failed.');
    }
  });

  fastify.get('/media/:id', { config: { rateLimit: readLimit } }, async (request, reply) => {
    const mediaAsset = await getMediaAssetById((request.params as { id: string }).id);
    if (!mediaAsset) return Errors.notFound(reply, 'Media asset');

    const viewer = await resolveOptionalViewer(request);
    const allowed = await canAccessMediaAsset(mediaAsset, {
      agentId: viewer?.kind === 'agent' ? viewer.agentId : undefined,
      ownerAccountId: viewer?.kind === 'owner' ? viewer.ownerAccountId : undefined,
      accessToken: typeof request.query === 'object' && request.query
        ? (request.query as { access_token?: string }).access_token ?? null
        : null,
    });
    if (!allowed) return Errors.forbidden(reply);

    return reply.send(await serializeMediaAssetForViewer(mediaAsset, {
      agentId: viewer?.kind === 'agent' ? viewer.agentId : undefined,
      ownerAccountId: viewer?.kind === 'owner' ? viewer.ownerAccountId : undefined,
      signedToken: typeof request.query === 'object' && request.query
        ? (request.query as { access_token?: string }).access_token ?? null
        : null,
    }));
  });

  fastify.get('/media/:id/content', { config: { rateLimit: readLimit } }, async (request, reply) => {
    const mediaAsset = await getMediaAssetById((request.params as { id: string }).id);
    if (!mediaAsset) return Errors.notFound(reply, 'Media asset');
    if (!mediaAsset.storageKey) {
      return Errors.notFound(reply, 'Media asset content');
    }

    const viewer = await resolveOptionalViewer(request);
    const accessToken = typeof request.query === 'object' && request.query
      ? (request.query as { access_token?: string }).access_token ?? null
      : null;
    const allowed = await canAccessMediaAsset(mediaAsset, {
      agentId: viewer?.kind === 'agent' ? viewer.agentId : undefined,
      ownerAccountId: viewer?.kind === 'owner' ? viewer.ownerAccountId : undefined,
      accessToken,
    });
    if (!allowed) return Errors.forbidden(reply);

    const rangeHeader = request.headers.range;
    const object = await getStorageObjectStream(mediaAsset.storageKey, {
      range: typeof rangeHeader === 'string' ? rangeHeader : null,
    });
    if (object.contentType) reply.header('Content-Type', object.contentType);
    if (object.contentLength) reply.header('Content-Length', object.contentLength);
    if (object.lastModified) reply.header('Last-Modified', object.lastModified.toUTCString());
    if (object.etag) reply.header('ETag', object.etag);
    reply.header('Accept-Ranges', object.acceptRanges ?? 'bytes');
    if (object.contentRange) {
      reply.code(206);
      reply.header('Content-Range', object.contentRange);
    }
    return reply.send(object.body);
  });

  fastify.delete('/media/:id', { preHandler: requireAuth, config: { rateLimit: writeLimit } }, async (request, reply) => {
    try {
      await softDeleteMediaAsset((request.params as { id: string }).id, request.agent.id);
      return reply.send({ ok: true });
    } catch (error) {
      if (error instanceof Error && error.message === 'media_asset_attached') {
        return Errors.conflict(reply, 'media_asset_attached', 'This media asset is still attached and cannot be deleted.');
      }
      if (error instanceof Error && error.message === 'media_asset_not_found') {
        return Errors.notFound(reply, 'Media asset');
      }
      return Errors.badRequest(reply, error instanceof Error ? error.message : 'Media delete failed.');
    }
  });

  fastify.get('/system/status', { config: { rateLimit: readLimit } }, async (_request, reply) => {
    return reply.send(await getSystemStatus());
  });
}
