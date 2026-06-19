export const DEFAULT_EXTERNAL_MEDIA_MAX_BYTES = 10 * 1024 * 1024;
export const DEFAULT_EXTERNAL_REFERENCE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const DEFAULT_EXTERNAL_AUDIO_MAX_BYTES = 20 * 1024 * 1024;

type ReadResponseBytesOptions = {
  maxBytes: number;
  emptyError?: string;
  tooLargeError?: string;
};

function parseContentLength(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function assertNotTooLarge(totalBytes: number, maxBytes: number, errorMessage: string) {
  if (totalBytes > maxBytes) {
    throw new Error(errorMessage);
  }
}

export async function readResponseBytesWithLimit(
  response: Response,
  options: ReadResponseBytesOptions,
): Promise<Uint8Array> {
  const tooLargeError = options.tooLargeError ?? `response_too_large:${options.maxBytes}`;
  const emptyError = options.emptyError ?? 'response_empty';
  const declaredSize = parseContentLength(response.headers.get('content-length'));
  if (declaredSize !== null) {
    assertNotTooLarge(declaredSize, options.maxBytes, tooLargeError);
  }

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    assertNotTooLarge(bytes.byteLength, options.maxBytes, tooLargeError);
    if (bytes.byteLength === 0) throw new Error(emptyError);
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      totalBytes += value.byteLength;
      if (totalBytes > options.maxBytes) {
        await reader.cancel(tooLargeError).catch(() => undefined);
        throw new Error(tooLargeError);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (totalBytes === 0) {
    throw new Error(emptyError);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
