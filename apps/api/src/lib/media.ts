import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { assertSafeOutboundUrl } from './outboundUrlSafety.js';
import {
  buildAvatarStorageKey,
  buildMediaStorageKey,
  buildProfileDeckPhotoStorageKey,
  isStorageConfigured,
  resolveStorageExtension,
  uploadBufferToStorage,
} from './storage.js';

export const MAX_MEDIA_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ALLOWED_MEDIA_CONTENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
]);

function sanitizeContentType(contentType: string | null | undefined) {
  return contentType?.split(';')[0]?.trim().toLowerCase() ?? '';
}

function extractMultipartBoundary(contentTypeHeader: string | undefined) {
  if (!contentTypeHeader) return null;
  const match = contentTypeHeader.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  return (match?.[1] ?? match?.[2] ?? '').trim() || null;
}

async function readRequestBody(request: FastifyRequest, maxBytes: number) {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request.raw) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      throw new Error('Uploaded file exceeds the 10MB limit.');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export async function parseSingleMultipartUpload(request: FastifyRequest) {
  const multipartRequest = request as FastifyRequest & {
    file?: () => Promise<{
      filename?: string;
      mimetype?: string;
      file: AsyncIterable<Buffer | Uint8Array | string>;
    } | undefined>;
  };

  if (typeof multipartRequest.file === 'function') {
    const upload = await multipartRequest.file();
    if (upload) {
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of upload.file) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buffer.length;
        if (total > MAX_MEDIA_UPLOAD_BYTES) {
          throw new Error('Uploaded file exceeds the 10MB limit.');
        }
        chunks.push(buffer);
      }

      const fileBuffer = Buffer.concat(chunks);
      if (fileBuffer.byteLength === 0) {
        throw new Error('Uploaded file is empty.');
      }

      return {
        filename: upload.filename ?? 'upload.bin',
        contentType: sanitizeContentType(upload.mimetype),
        buffer: new Uint8Array(fileBuffer),
        sizeBytes: fileBuffer.byteLength,
      };
    }
  }

  const boundary = extractMultipartBoundary(request.headers['content-type']);
  if (!boundary) {
    throw new Error('multipart/form-data with a boundary is required.');
  }

  const body = await readRequestBody(request, MAX_MEDIA_UPLOAD_BYTES + (512 * 1024));
  const boundaryToken = `--${boundary}`;
  const parts = body.toString('latin1').split(boundaryToken);

  for (const rawPart of parts) {
    const trimmed = rawPart.replace(/^\r\n/, '').replace(/\r\n$/, '');
    if (!trimmed || trimmed === '--') continue;

    const partBuffer = Buffer.from(trimmed, 'latin1');
    const headerEnd = partBuffer.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd === -1) continue;

    const headerText = partBuffer.slice(0, headerEnd).toString('utf8');
    const disposition = headerText.match(/content-disposition:\s*form-data;([^\n]+)/i)?.[1] ?? '';
    const filename = disposition.match(/filename="([^"]+)"/i)?.[1] ?? null;
    if (!filename) continue;

    const contentType = sanitizeContentType(
      headerText.match(/content-type:\s*([^\r\n]+)/i)?.[1] ?? null,
    );
    const fileBuffer = partBuffer.slice(headerEnd + 4);
    if (fileBuffer.byteLength === 0) {
      throw new Error('Uploaded file is empty.');
    }
    if (fileBuffer.byteLength > MAX_MEDIA_UPLOAD_BYTES) {
      throw new Error('Uploaded file exceeds the 10MB limit.');
    }

    return {
      filename,
      contentType,
      buffer: new Uint8Array(fileBuffer),
      sizeBytes: fileBuffer.byteLength,
    };
  }

  throw new Error('No file field was found in the multipart upload.');
}

export function assertAllowedMediaContentType(contentType: string | null | undefined) {
  const normalized = sanitizeContentType(contentType);
  if (!ALLOWED_MEDIA_CONTENT_TYPES.has(normalized)) {
    throw new Error(`Unsupported media type '${normalized || 'unknown'}'.`);
  }
  return normalized;
}

async function downloadExternalMedia(sourceUrl: string, maxBytes = MAX_MEDIA_UPLOAD_BYTES) {
  await assertSafeOutboundUrl(sourceUrl, { allowHttpInDevelopment: true });
  const response = await fetch(sourceUrl, {
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`External media download failed with ${response.status}.`);
  }

  const contentType = assertAllowedMediaContentType(response.headers.get('content-type'));
  const contentLengthHeader = response.headers.get('content-length');
  const declaredSize = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : NaN;
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
    throw new Error('External media exceeds the 10MB limit.');
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength === 0) {
    throw new Error('External media download returned 0 bytes.');
  }
  if (arrayBuffer.byteLength > maxBytes) {
    throw new Error('External media exceeds the 10MB limit.');
  }

  return {
    buffer: new Uint8Array(arrayBuffer),
    contentType,
    sizeBytes: arrayBuffer.byteLength,
  };
}

type StorageKeyBuilder = (contentType: string) => string;

async function persistMediaBuffer(input: {
  agentId: string;
  buffer: Uint8Array;
  contentType: string;
  storageKeyBuilder?: StorageKeyBuilder;
}) {
  if (!isStorageConfigured()) {
    throw new Error('Permanent media storage is not configured.');
  }

  const contentType = assertAllowedMediaContentType(input.contentType);
  const key = input.storageKeyBuilder
    ? input.storageKeyBuilder(contentType)
    : buildMediaStorageKey(input.agentId, contentType);
  const upload = await uploadBufferToStorage(key, input.buffer, contentType);
  return {
    url: upload.url,
    storageKey: upload.key,
    contentType,
    sizeBytes: input.buffer.byteLength,
    uploadedAt: new Date().toISOString(),
  };
}

export async function uploadAgentMedia(input: {
  agentId: string;
  buffer: Uint8Array;
  contentType: string;
}) {
  return persistMediaBuffer(input);
}

export async function proxyExternalMediaToStorage(input: {
  agentId: string;
  sourceUrl: string;
  storageKeyBuilder?: StorageKeyBuilder;
}) {
  const publicBase = process.env.STORAGE_PUBLIC_URL?.replace(/\/$/, '');
  if (publicBase && input.sourceUrl.startsWith(publicBase)) {
    return {
      url: input.sourceUrl,
      storageKey: null,
      contentType: '',
      sizeBytes: 0,
      uploadedAt: new Date().toISOString(),
    };
  }

  const downloaded = await downloadExternalMedia(input.sourceUrl);
  return persistMediaBuffer({
    agentId: input.agentId,
    buffer: downloaded.buffer,
    contentType: downloaded.contentType,
    storageKeyBuilder: input.storageKeyBuilder,
  });
}

export async function proxyAvatarUrlToStorage(agentId: string, sourceUrl: string) {
  return proxyExternalMediaToStorage({
    agentId,
    sourceUrl,
    storageKeyBuilder: (contentType) => buildAvatarStorageKey(agentId, contentType),
  });
}

export async function proxyProfilePhotoUrlToStorage(agentId: string, slot: number, sourceUrl: string) {
  return proxyExternalMediaToStorage({
    agentId,
    sourceUrl,
    storageKeyBuilder: (contentType) => buildProfileDeckPhotoStorageKey(agentId, slot, contentType),
  });
}

export function buildOpenClawMediaPath(input: {
  prefix: string;
  agentId: string;
  extension?: string;
}) {
  const baseDir = process.env.OPENCLAW_MEDIA_DIR ?? '/data/.openclaw/media';
  const ext = input.extension ? input.extension.replace(/^\./, '') : 'bin';
  return `${baseDir.replace(/\/$/, '')}/${input.prefix}-${input.agentId}-${randomUUID()}.${ext}`;
}

export function extensionForContentType(contentType: string) {
  return resolveStorageExtension(contentType);
}
