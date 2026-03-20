import { createHash, randomUUID } from 'node:crypto';
import { buildProfileVoiceStorageKey, isStorageConfigured, uploadBufferToStorage } from './storage.js';

const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';
const PROFILE_VOICE_CONTENT_TYPE = 'audio/mpeg';

export function isProfileVoiceGenerationAvailable(input: {
  voiceProvider: string | null | undefined;
  voiceId: string | null | undefined;
}) {
  return input.voiceProvider === 'elevenlabs' && Boolean(input.voiceId);
}

export function hashProfileVoiceCatchphrase(input: {
  text: string;
  voiceId: string;
}) {
  return createHash('sha256')
    .update(`${input.voiceId}::${input.text.trim()}`)
    .digest('hex')
    .slice(0, 24);
}

export function estimateSpokenDurationSeconds(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return words > 0 ? Math.max(2, Math.min(12, Math.round(words / 2.6))) : null;
}

export async function generateProfileVoiceCatchphrase(input: {
  agentId: string;
  text: string;
  voiceId: string;
}): Promise<{
  clipId: string;
  audioUrl: string;
  storageKey: string;
  lastGeneratedHash: string;
  durationSeconds: number | null;
}> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error('elevenlabs_api_key_missing');
  }
  if (!isStorageConfigured()) {
    throw new Error('profile_voice_storage_unavailable');
  }

  const lastGeneratedHash = hashProfileVoiceCatchphrase({
    text: input.text,
    voiceId: input.voiceId,
  });

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

  const audio = new Uint8Array(await response.arrayBuffer());
  if (audio.byteLength === 0) {
    throw new Error('elevenlabs_empty_audio');
  }

  const storageKey = buildProfileVoiceStorageKey(input.agentId, lastGeneratedHash, PROFILE_VOICE_CONTENT_TYPE);
  const upload = await uploadBufferToStorage(storageKey, audio, PROFILE_VOICE_CONTENT_TYPE);

  return {
    clipId: randomUUID(),
    audioUrl: upload.url,
    storageKey: upload.key,
    lastGeneratedHash,
    durationSeconds: estimateSpokenDurationSeconds(input.text),
  };
}
