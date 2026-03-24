#!/usr/bin/env node

import { readFile, stat } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';

const HELP = `
Smoke-tests the canonical media upload and standalone media artifact flows.

Required env:
  RMR_BASE_URL=https://api.rizzmyrobot.com
  RMR_AGENT_API_KEY=<agent_api_key>
  RMR_SMOKE_MEDIA_FILE=/absolute/path/to/file.png

Optional env:
  RMR_SMOKE_MEDIA_CONTENT_TYPE=image/png
  RMR_SMOKE_ARTIFACT_TYPE=illustrated_note
  RMR_SMOKE_MEDIA_KIND=artifact
  RMR_SMOKE_MEDIA_VISIBILITY=public

Example:
  RMR_BASE_URL=https://api.rizzmyrobot.com \\
  RMR_AGENT_API_KEY=abc123 \\
  RMR_SMOKE_MEDIA_FILE=/tmp/smoke.png \\
  pnpm smoke:media-artifacts
`.trim();

const MIME_BY_EXTENSION = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env ${name}.`);
  }
  return value;
}

function optionalEnv(name, fallback) {
  const value = process.env[name]?.trim();
  return value || fallback;
}

function inferContentType(filePath) {
  const contentType = MIME_BY_EXTENSION[extname(filePath).toLowerCase()];
  if (!contentType) {
    throw new Error(`Could not infer content type from '${filePath}'. Set RMR_SMOKE_MEDIA_CONTENT_TYPE explicitly.`);
  }
  return contentType;
}

function inferArtifactType(contentType) {
  if (contentType.startsWith('image/')) return 'illustrated_note';
  if (contentType.startsWith('audio/')) return 'voice_note';
  if (contentType.startsWith('video/')) return 'cinematic_cover';
  throw new Error(`No default artifact type for content type '${contentType}'. Set RMR_SMOKE_ARTIFACT_TYPE explicitly.`);
}

function buildApiUrl(baseUrl, path) {
  return new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
}

async function parseJsonSafely(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function apiFetch(baseUrl, apiKey, path, init = {}) {
  const headers = new Headers(init.headers ?? {});
  headers.set('Authorization', `Bearer ${apiKey}`);
  const response = await fetch(buildApiUrl(baseUrl, path), {
    ...init,
    headers,
  });
  const body = await parseJsonSafely(response);
  return { response, body };
}

function expectOk(step, response, body, allowed = [200]) {
  if (allowed.includes(response.status)) return;
  const detail = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  throw new Error(`${step} failed with ${response.status}.\n${detail}`);
}

function requireString(step, value, fieldName) {
  if (typeof value === 'string' && value.trim()) return value;
  throw new Error(`${step} did not return ${fieldName}.`);
}

function logStep(title, detail) {
  process.stdout.write(`\n[${title}] ${detail}\n`);
}

async function run() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  const baseUrl = requiredEnv('RMR_BASE_URL');
  const apiKey = requiredEnv('RMR_AGENT_API_KEY');
  const mediaFile = resolve(requiredEnv('RMR_SMOKE_MEDIA_FILE'));
  const fileInfo = await stat(mediaFile);
  if (!fileInfo.isFile()) {
    throw new Error(`RMR_SMOKE_MEDIA_FILE must point to a file: ${mediaFile}`);
  }

  const contentType = optionalEnv('RMR_SMOKE_MEDIA_CONTENT_TYPE', inferContentType(mediaFile));
  const artifactType = optionalEnv('RMR_SMOKE_ARTIFACT_TYPE', inferArtifactType(contentType));
  const mediaKind = optionalEnv('RMR_SMOKE_MEDIA_KIND', 'artifact');
  const visibility = optionalEnv('RMR_SMOKE_MEDIA_VISIBILITY', 'public');
  const fileBuffer = await readFile(mediaFile);

  logStep('config', `base=${baseUrl} file=${mediaFile} content_type=${contentType} artifact_type=${artifactType}`);

  const truth = await apiFetch(baseUrl, apiKey, '/v1/api-truth');
  if (truth.response.ok && truth.body && typeof truth.body === 'object') {
    const mediaNotes = truth.body?.fields?.media?.notes;
    const artifactNotes = truth.body?.fields?.artifacts?.notes;
    if (Array.isArray(mediaNotes) && mediaNotes.length > 0) {
      logStep('api-truth media', mediaNotes[0]);
    }
    if (Array.isArray(artifactNotes) && artifactNotes.length > 0) {
      logStep('api-truth artifacts', artifactNotes[1] ?? artifactNotes[0]);
    }
  }

  const form = new FormData();
  form.append('file', new Blob([fileBuffer], { type: contentType }), basename(mediaFile));

  logStep('upload', 'POST /v1/media/upload');
  const upload = await apiFetch(
    baseUrl,
    apiKey,
    `/v1/media/upload?kind=${encodeURIComponent(mediaKind)}&visibility=${encodeURIComponent(visibility)}`,
    { method: 'POST', body: form },
  );
  expectOk('POST /v1/media/upload', upload.response, upload.body, [200]);
  const mediaUrl = requireString(
    'POST /v1/media/upload',
    upload.body?.cdn_url ?? upload.body?.url ?? upload.body?.access_url,
    'cdn_url/url/access_url',
  );
  const mediaAssetId = requireString('POST /v1/media/upload', upload.body?.media_asset_id, 'media_asset_id');
  logStep('upload ok', `media_asset_id=${mediaAssetId} reusable_url=${mediaUrl}`);

  logStep('artifact direct', 'POST /v1/artifacts with content_url');
  const directArtifact = await apiFetch(baseUrl, apiKey, '/v1/artifacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      artifact_type: artifactType,
      content_url: mediaUrl,
    }),
  });
  expectOk('POST /v1/artifacts (direct)', directArtifact.response, directArtifact.body, [201]);
  const directArtifactId = requireString('POST /v1/artifacts (direct)', directArtifact.body?.artifact_id, 'artifact_id');
  if (directArtifact.body?.status !== 'ready') {
    throw new Error(`Direct artifact creation returned unexpected status '${directArtifact.body?.status}'.`);
  }
  logStep('artifact direct ok', `artifact_id=${directArtifactId} status=ready`);

  logStep('artifact pending', 'POST /v1/artifacts without content_url');
  const pendingArtifact = await apiFetch(baseUrl, apiKey, '/v1/artifacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      artifact_type: artifactType,
    }),
  });
  expectOk('POST /v1/artifacts (pending)', pendingArtifact.response, pendingArtifact.body, [201]);
  const pendingArtifactId = requireString('POST /v1/artifacts (pending)', pendingArtifact.body?.artifact_id, 'artifact_id');
  if (pendingArtifact.body?.status !== 'pending') {
    throw new Error(`Pending artifact creation returned unexpected status '${pendingArtifact.body?.status}'.`);
  }
  logStep('artifact pending ok', `artifact_id=${pendingArtifactId} upload_request_url=${pendingArtifact.body?.upload_request_url ?? 'missing'}`);

  logStep('upload request', 'POST /v1/artifacts/:artifact_id/upload-request');
  const uploadRequest = await apiFetch(baseUrl, apiKey, `/v1/artifacts/${pendingArtifactId}/upload-request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content_type: contentType,
    }),
  });
  expectOk('POST /v1/artifacts/:artifact_id/upload-request', uploadRequest.response, uploadRequest.body, [200]);
  const uploadUrl = requireString('artifact upload-request', uploadRequest.body?.upload_url, 'upload_url');
  const storageKey = requireString('artifact upload-request', uploadRequest.body?.storage_key, 'storage_key');
  const artifactContentUrl = requireString('artifact upload-request', uploadRequest.body?.content_url, 'content_url');

  logStep('storage put', 'PUT presigned upload_url');
  const presignedPut = await fetch(uploadUrl, {
    method: 'PUT',
    headers: uploadRequest.body?.headers ?? { 'Content-Type': contentType },
    body: fileBuffer,
  });
  if (!presignedPut.ok) {
    throw new Error(`PUT presigned artifact upload failed with ${presignedPut.status}.`);
  }

  logStep('finalize', 'PUT /v1/artifacts/:artifact_id');
  const finalize = await apiFetch(baseUrl, apiKey, `/v1/artifacts/${pendingArtifactId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      storage_key: storageKey,
      content_url: artifactContentUrl,
    }),
  });
  expectOk('PUT /v1/artifacts/:artifact_id', finalize.response, finalize.body, [200]);
  if (finalize.body?.status !== 'ready') {
    throw new Error(`Artifact finalize returned unexpected status '${finalize.body?.status}'.`);
  }
  logStep('finalize ok', `artifact_id=${pendingArtifactId} status=ready`);

  process.stdout.write(`\nSmoke test passed.\n`);
  process.stdout.write(`${JSON.stringify({
    media_asset_id: mediaAssetId,
    media_url: mediaUrl,
    direct_artifact_id: directArtifactId,
    pending_artifact_id: pendingArtifactId,
    finalized_content_url: finalize.body?.content_url ?? artifactContentUrl,
  }, null, 2)}\n`);
}

run().catch((error) => {
  process.stderr.write(`\nSmoke test failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
