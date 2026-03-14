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
