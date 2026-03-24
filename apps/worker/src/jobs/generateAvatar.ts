import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import type { Job } from 'bullmq';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { prisma } from '@rmr/db';
import { pickDefaultAvatarUrl } from '@rmr/shared';

export type GenerateAvatarJobData =
  | {
      jobType?: 'avatar';
      agentId: string;
      identityMd: string;
      handle: string;
      capabilityTier: string;
    }
  | {
      jobType: 'profile_voice_catchphrase';
      agentId: string;
      text: string;
      voiceId: string;
    };

const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';
const OPENAI_API_BASE_URL = process.env.OPENAI_API_BASE_URL ?? 'https://api.openai.com/v1';
const PROFILE_VOICE_CONTENT_TYPE = 'audio/mpeg';

let storageClient: S3Client | null = null;

function getStorageClient() {
  if (!storageClient) {
    storageClient = new S3Client({
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

  return storageClient;
}

function isStorageConfigured() {
  return Boolean(
    process.env.STORAGE_BUCKET
    && process.env.STORAGE_ENDPOINT
    && process.env.STORAGE_ACCESS_KEY_ID
    && process.env.STORAGE_SECRET_ACCESS_KEY
  );
}

function buildPublicUrl(key: string) {
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

function buildProfileVoiceStorageKey(agentId: string, clipHash: string, contentType: string) {
  const ext = contentType.includes('mp3') || contentType.includes('mpeg') ? 'mp3' : 'bin';
  return `profile-voice/${agentId}/${clipHash}.${ext}`;
}

function hashProfileVoiceCatchphrase(input: { text: string; voiceId: string }) {
  return createHash('sha256')
    .update(`${input.voiceId}::${input.text.trim()}`)
    .digest('hex')
    .slice(0, 24);
}

function estimateSpokenDurationSeconds(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return words > 0 ? Math.max(2, Math.min(12, Math.round(words / 2.6))) : null;
}

async function uploadBufferToStorage(key: string, body: Uint8Array, contentType: string) {
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

async function synthesizeProfileVoiceCatchphrase(input: {
  agentId: string;
  text: string;
  voiceId: string;
}) {
  if (!isStorageConfigured()) {
    throw new Error('profile_voice_storage_unavailable');
  }

  const lastGeneratedHash = hashProfileVoiceCatchphrase({
    text: input.text,
    voiceId: input.voiceId,
  });

  const audio = await synthesizeVoiceAudio(input);
  if (audio.byteLength === 0) {
    throw new Error('tts_empty_audio');
  }

  const storageKey = buildProfileVoiceStorageKey(input.agentId, lastGeneratedHash, PROFILE_VOICE_CONTENT_TYPE);
  const upload = await uploadBufferToStorage(storageKey, audio, PROFILE_VOICE_CONTENT_TYPE);
  await stageVoiceFileLocally(input.agentId, audio);

  return {
    clipId: randomUUID(),
    audioUrl: upload.url,
    storageKey: upload.key,
    lastGeneratedHash,
    durationSeconds: estimateSpokenDurationSeconds(input.text),
  };
}

async function synthesizeWithElevenLabs(input: { text: string; voiceId: string }) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error('elevenlabs_api_key_missing');
  }

  const response = await fetch(`${ELEVENLABS_BASE_URL}/text-to-speech/${encodeURIComponent(input.voiceId)}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': PROFILE_VOICE_CONTENT_TYPE,
    },
    body: JSON.stringify({
      text: input.text.trim(),
      model_id: 'eleven_multilingual_v2',
      output_format: 'mp3_44100_128',
    }),
    signal: AbortSignal.timeout(25_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`elevenlabs_generation_failed:${response.status}:${body.slice(0, 200)}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

async function synthesizeWithOpenAi(input: { text: string }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('openai_tts_api_key_missing');
  }

  const response = await fetch(`${OPENAI_API_BASE_URL}/audio/speech`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_TTS_MODEL ?? 'gpt-4o-mini-tts',
      voice: process.env.OPENAI_TTS_VOICE ?? 'alloy',
      input: input.text.trim(),
      response_format: 'mp3',
    }),
    signal: AbortSignal.timeout(25_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`openai_tts_generation_failed:${response.status}:${body.slice(0, 200)}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

async function synthesizeVoiceAudio(input: { text: string; voiceId: string }) {
  try {
    return await synthesizeWithElevenLabs(input);
  } catch (elevenLabsError) {
    console.warn('[generate-avatar] ElevenLabs TTS failed, trying OpenAI fallback:', elevenLabsError);
    try {
      return await synthesizeWithOpenAi({ text: input.text });
    } catch (openAiError) {
      console.error('[generate-avatar] OpenAI TTS fallback failed:', openAiError);
      throw openAiError instanceof Error ? openAiError : elevenLabsError;
    }
  }
}

async function stageVoiceFileLocally(agentId: string, audio: Uint8Array) {
  const mediaDir = process.env.OPENCLAW_MEDIA_DIR ?? '/data/.openclaw/media';
  const filePath = `${mediaDir.replace(/\/$/, '')}/profile-voice-${agentId}-${randomUUID()}.mp3`;

  try {
    await mkdir(mediaDir, { recursive: true });
    await writeFile(filePath, audio);
    console.info(`[generate-avatar] Staged profile voice at ${filePath}`);
  } catch (error) {
    console.warn('[generate-avatar] Failed to stage profile voice locally:', error);
  }
}

async function processProfileVoiceCatchphrase(job: Job<Extract<GenerateAvatarJobData, { jobType: 'profile_voice_catchphrase' }>>) {
  const { agentId, text, voiceId } = job.data;

  try {
    const generated = await synthesizeProfileVoiceCatchphrase({ agentId, text, voiceId });
    const mediaAsset = await prisma.mediaAsset.upsert({
      where: { storageKey: generated.storageKey },
      update: {
        agentId,
        kind: 'voice_catchphrase',
        visibility: 'public',
        status: 'ready',
        cdnUrl: generated.audioUrl,
        contentType: PROFILE_VOICE_CONTENT_TYPE,
        checksumSha256: generated.lastGeneratedHash,
        durationSec: generated.durationSeconds,
        deletedAt: null,
      },
      create: {
        agentId,
        kind: 'voice_catchphrase',
        visibility: 'public',
        status: 'ready',
        storageKey: generated.storageKey,
        cdnUrl: generated.audioUrl,
        contentType: PROFILE_VOICE_CONTENT_TYPE,
        checksumSha256: generated.lastGeneratedHash,
        durationSec: generated.durationSeconds,
      },
    });
    await prisma.agentProfileDeck.update({
      where: { agentId },
      data: {
        voiceCatchphraseClipId: generated.clipId,
        voiceCatchphraseStatus: 'ready',
        voiceCatchphraseAudioUrl: generated.audioUrl,
        voiceCatchphraseStorageKey: generated.storageKey,
        voiceCatchphraseMediaAssetId: mediaAsset.id,
        voiceCatchphraseDurationSec: generated.durationSeconds,
        voiceCatchphraseLastGeneratedHash: generated.lastGeneratedHash,
        voiceCatchphraseVoiceId: voiceId,
        voiceCatchphraseError: null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Voice generation failed.';
    await prisma.agentProfileDeck.updateMany({
      where: { agentId },
      data: {
        voiceCatchphraseStatus: 'generation_failed',
        voiceCatchphraseAudioUrl: null,
        voiceCatchphraseStorageKey: null,
        voiceCatchphraseMediaAssetId: null,
        voiceCatchphraseDurationSec: null,
        voiceCatchphraseLastGeneratedHash: null,
        voiceCatchphraseVoiceId: voiceId,
        voiceCatchphraseError: message.slice(0, 240),
      },
    });
    throw error;
  }
}

async function processAvatar(job: Job<Extract<GenerateAvatarJobData, { jobType?: 'avatar' }>>) {
  const { agentId, identityMd } = job.data;

  await prisma.agent.update({
    where: { id: agentId },
    data: {
      avatarStatus: 'default',
      avatarGenerationRetryCount: job.attemptsMade,
      avatarGenerationFailureReason: null,
      avatarGenerationFailedAt: null,
    },
  });

  const avatarUrl = pickDefaultAvatarUrl(identityMd);
  await prisma.agent.update({
    where: { id: agentId },
    data: {
      avatarUrl,
      avatarStatus: 'default',
      avatarProvider: 'fallback',
    },
  });

  console.info(`[generate-avatar] Default avatar assigned for agent ${agentId}: ${avatarUrl}`);
}

export async function processGenerateAvatar(job: Job<GenerateAvatarJobData>): Promise<void> {
  if (job.data.jobType === 'profile_voice_catchphrase') {
    await processProfileVoiceCatchphrase(job as Job<Extract<GenerateAvatarJobData, { jobType: 'profile_voice_catchphrase' }>>);
    return;
  }

  await processAvatar(job as Job<Extract<GenerateAvatarJobData, { jobType?: 'avatar' }>>);
}
