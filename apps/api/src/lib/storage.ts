import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

let client: S3Client | null = null;

function getStorageClient(): S3Client {
  if (!client) {
    client = new S3Client({
      region: process.env.STORAGE_REGION ?? 'auto',
      endpoint: process.env.STORAGE_ENDPOINT || undefined,
      credentials:
        process.env.STORAGE_ACCESS_KEY_ID && process.env.STORAGE_SECRET_ACCESS_KEY
          ? {
              accessKeyId: process.env.STORAGE_ACCESS_KEY_ID,
              secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY,
            }
          : undefined,
      forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE === 'true',
    });
  }

  return client;
}

function buildPublicUrl(key: string): string {
  const publicBase = process.env.STORAGE_PUBLIC_URL;
  if (publicBase) {
    return `${publicBase.replace(/\/$/, '')}/${key}`;
  }

  const endpoint = process.env.STORAGE_ENDPOINT;
  const bucket = process.env.STORAGE_BUCKET;
  if (endpoint && bucket) {
    return `${endpoint.replace(/\/$/, '')}/${bucket}/${key}`;
  }

  throw new Error('storage_public_url_missing');
}

export async function uploadBufferToStorage(
  key: string,
  body: Uint8Array,
  contentType: string
): Promise<{ key: string; url: string }> {
  const bucket = process.env.STORAGE_BUCKET;
  if (!bucket) {
    throw new Error('storage_bucket_missing');
  }

  await getStorageClient().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    })
  );

  return {
    key,
    url: buildPublicUrl(key),
  };
}

/** Content-type guesses based on artifact type */
const ARTIFACT_CONTENT_TYPES: Record<string, string> = {
  moodboard: 'image/png',
  illustrated_note: 'image/png',
  thirst_trap_image: 'image/png',
  voice_note: 'audio/mpeg',
  sung_piece: 'audio/mpeg',
  produced_song: 'audio/mpeg',
  cinematic_cover: 'audio/mpeg',
};

/**
 * Download content from an external URL, upload to R2, return CDN URL + storage key.
 * Falls back gracefully — if storage is not configured, returns the original URL.
 */
export async function mirrorArtifactToStorage(
  artifactId: string,
  artifactType: string,
  externalUrl: string
): Promise<{ storageKey: string; cdnUrl: string } | null> {
  if (!process.env.STORAGE_BUCKET || !process.env.STORAGE_ENDPOINT) {
    return null; // storage not configured, keep external URL
  }

  const response = await fetch(externalUrl);
  if (!response.ok) {
    return null; // can't download, keep external URL
  }

  const buffer = new Uint8Array(await response.arrayBuffer());

  // Determine content type from response headers, falling back to artifact type guess
  const contentType =
    response.headers.get('content-type')?.split(';')[0]?.trim() ||
    ARTIFACT_CONTENT_TYPES[artifactType] ||
    'application/octet-stream';

  // Derive extension from content type
  const ext = contentType.includes('png') ? 'png'
    : contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg'
    : contentType.includes('webp') ? 'webp'
    : contentType.includes('gif') ? 'gif'
    : contentType.includes('mp3') || contentType.includes('mpeg') ? 'mp3'
    : contentType.includes('wav') ? 'wav'
    : contentType.includes('ogg') ? 'ogg'
    : contentType.includes('mp4') ? 'mp4'
    : 'bin';

  const key = `artifacts/${artifactId}.${ext}`;

  const result = await uploadBufferToStorage(key, buffer, contentType);
  return { storageKey: result.key, cdnUrl: result.url };
}
