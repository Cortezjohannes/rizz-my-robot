import { createHash } from 'node:crypto';
import {
  ARTIFACTS_BY_TIER,
  PREFERRED_ARTIFACTS_BY_TIER,
  TEXT_ARTIFACT_TYPES,
  MEDIA_ARTIFACT_TYPES,
  type ArtifactType,
  type CapabilityTier,
} from '@rmr/shared';
import { assertSafeOutboundUrl } from './outboundUrlSafety.js';
import { uploadBufferToStorage } from './storage.js';

const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';
const OPENAI_API_BASE_URL = process.env.OPENAI_API_BASE_URL ?? 'https://api.openai.com/v1';
const DEFAULT_IMAGE_CONTENT_TYPE = 'image/png';
const DEFAULT_AUDIO_CONTENT_TYPE = 'audio/mpeg';

const IMAGE_ARTIFACT_TYPES = new Set<ArtifactType>(['moodboard', 'illustrated_note', 'thirst_trap_image']);
const CONSUMABLE_AUDIO_ARTIFACT_TYPES = new Set<ArtifactType>(['voice_note', 'serenade', 'produced_song']);
const GENERATABLE_AUDIO_ARTIFACT_TYPES = new Set<ArtifactType>(['voice_note']);
// Use shared PREFERRED_ARTIFACTS_BY_TIER (multimedia-first ordering) instead of local copy
const SEED_PREFERRED_ARTIFACTS_BY_TIER = PREFERRED_ARTIFACTS_BY_TIER;

export type SeedArtifactMediaContext = {
  artifactId: string;
  artifactType: ArtifactType;
  capabilityTier: CapabilityTier;
  seedHandle: string;
  counterpartHandle: string;
  avatarUrl?: string | null;
  useAvatarAsReference?: boolean | null;
  voiceId?: string | null;
  voiceProvider?: string | null;
  recentCounterpartLine?: string | null;
  recentSelfLine?: string | null;
};

export type SeedGeneratedArtifactMedia = {
  contentType: string;
  contentUrl: string;
  storageKey: string;
  textContent: string | null;
  durationSeconds: number | null;
  sizeBytes: number;
  checksumSha256: string;
};

function sha256Hex(buffer: Uint8Array) {
  return createHash('sha256').update(buffer).digest('hex');
}

function getGeminiApiKey() {
  return process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? null;
}

function getSeedImageModel() {
  return process.env.GEMINI_IMAGE_MODEL
    ?? process.env.GEMINI_LINK_UP_IMAGE_MODEL
    ?? 'gemini-3.1-flash-image-preview';
}

function hasStorageConfig() {
  return Boolean(
    process.env.STORAGE_BUCKET
    && process.env.STORAGE_ENDPOINT
    && process.env.STORAGE_ACCESS_KEY_ID
    && process.env.STORAGE_SECRET_ACCESS_KEY
  );
}

function canGenerateSeedImages() {
  return Boolean(hasStorageConfig() && getGeminiApiKey());
}

function canGenerateSeedAudio() {
  return Boolean(hasStorageConfig() && (process.env.ELEVENLABS_API_KEY || process.env.OPENAI_API_KEY));
}

function buildArtifactStorageKey(artifactId: string, contentType: string) {
  const ext = contentType.includes('png') ? 'png'
    : contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg'
    : contentType.includes('webp') ? 'webp'
    : contentType.includes('gif') ? 'gif'
    : contentType.includes('mp3') || contentType.includes('mpeg') ? 'mp3'
    : contentType.includes('wav') ? 'wav'
    : contentType.includes('ogg') ? 'ogg'
    : contentType.includes('mp4') ? 'mp4'
    : 'bin';
  return `artifacts/${artifactId}.${ext}`;
}

function trimContextLine(value: string | null | undefined, max = 140) {
  const trimmed = value?.replace(/\s+/g, ' ').trim() || null;
  return trimmed ? trimmed.slice(0, max) : null;
}

function estimateSpokenDurationSeconds(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return words > 0 ? Math.max(2, Math.min(18, Math.round(words / 2.5))) : null;
}

function artifactConsumptionMode(artifactType: ArtifactType): 'text' | 'audio' | 'image' {
  if (TEXT_ARTIFACT_TYPES.has(artifactType)) return 'text';
  if (CONSUMABLE_AUDIO_ARTIFACT_TYPES.has(artifactType)) return 'audio';
  return 'image';
}

export function buildSeedArtifactRuntimeFallback(input: {
  artifactType: ArtifactType;
  textContent: string | null;
  contentUrl: string | null;
}) {
  const mode = artifactConsumptionMode(input.artifactType);
  const trimmedText = input.textContent?.trim() || null;
  return {
    consume_mode: mode,
    text_content: trimmedText,
    text_excerpt: trimmedText ? trimmedText.slice(0, 280) : null,
    content_url: input.contentUrl,
    playback_url: mode === 'audio' ? input.contentUrl : null,
    can_consume_without_multimodal: mode === 'text' || Boolean(trimmedText),
    fallback_instruction: mode === 'text'
      ? 'Read the actual text before you react.'
      : trimmedText
        ? 'If your model cannot directly parse the media, use the attached text as fallback context and do not pretend you consumed more than you did.'
        : 'If your model cannot directly parse this media, acknowledge the gesture honestly without pretending you fully consumed the file.',
  };
}

export function getSeedSupportedArtifactTypes(input: {
  capabilityTier: CapabilityTier;
}) {
  const allowed = ARTIFACTS_BY_TIER[input.capabilityTier] ?? ARTIFACTS_BY_TIER.text_only;
  const preferred = SEED_PREFERRED_ARTIFACTS_BY_TIER[input.capabilityTier] ?? SEED_PREFERRED_ARTIFACTS_BY_TIER.text_only;
  const imageEnabled = canGenerateSeedImages();
  const audioEnabled = canGenerateSeedAudio();

  return preferred
    .filter((artifactType: ArtifactType) => allowed.includes(artifactType))
    .filter((artifactType: ArtifactType) => {
      if (TEXT_ARTIFACT_TYPES.has(artifactType)) return true;
      if (IMAGE_ARTIFACT_TYPES.has(artifactType)) return imageEnabled;
      if (GENERATABLE_AUDIO_ARTIFACT_TYPES.has(artifactType)) return audioEnabled;
      return false;
    });
}

function resolveImageMimeType(url: string, contentTypeHeader: string | null) {
  const headerMime = contentTypeHeader?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (headerMime.startsWith('image/')) return headerMime;
  const lower = url.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.avif')) return 'image/avif';
  return DEFAULT_IMAGE_CONTENT_TYPE;
}

async function fetchImageReference(url: string): Promise<{ mimeType: string; data: string }> {
  await assertSafeOutboundUrl(url, { allowHttpInDevelopment: true });
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`seed_reference_image_fetch_failed:${response.status}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new Error('seed_reference_image_empty');
  }

  return {
    mimeType: resolveImageMimeType(url, response.headers.get('content-type')),
    data: Buffer.from(bytes).toString('base64'),
  };
}

function buildSeedImagePrompt(input: SeedArtifactMediaContext) {
  const counterpartLine = trimContextLine(input.recentCounterpartLine, 120);
  const selfLine = trimContextLine(input.recentSelfLine, 120);
  const sharedContext = [
    counterpartLine ? `Their last line that stuck: "${counterpartLine}".` : null,
    selfLine ? `Your last line back: "${selfLine}".` : null,
  ].filter(Boolean).join(' ');

  const artifactInstruction =
    input.artifactType === 'thirst_trap_image'
      ? `Create a flirtier, fashion-forward portrait of @${input.seedHandle} meant for @${input.counterpartHandle}. Make it confident, suggestive, and magnetic without nudity or explicit sexual content. The attraction must come from pose, styling, lighting, expression, framing, and setting detail, not from pasted text.`
      : input.artifactType === 'illustrated_note'
        ? `Create an intimate illustrated gesture from @${input.seedHandle} to @${input.counterpartHandle}. It should feel like a visual note or direct offering expressed through scene detail, objects, symbols, and composition, not a generic wallpaper. If any written note appears, it must be a small integrated prop rather than the whole image.`
        : `Create a single cohesive moodboard-style image from @${input.seedHandle} to @${input.counterpartHandle}. Let it feel like atmosphere, taste, and desire condensed into one visual world, not a flat poster or quote card.`;

  return [
    artifactInstruction,
    'If an avatar reference image is attached, keep the face, hair, silhouette, and overall character identity recognizably consistent with it.',
    'All people must look clearly stylized: animated, anime-like, illustrated, painterly, comic, or obviously 3D-rendered.',
    'Do not generate photorealistic or realistic human imagery.',
    'This must read as an actual visual composition with subjects, objects, lighting, texture, depth, and scene detail.',
    'Do not solve the brief with a plain background, a poster, a title card, a screenshot of text, giant typography, or a fake social-media quote image.',
    'No watermarks, no text overlays, no collage panels, no grotesque anatomy, no extra limbs, and no explicit nudity.',
    'Keep the image emotionally specific to a dating conversation, not generic social media filler.',
    sharedContext || null,
  ].filter(Boolean).join(' ');
}

function shouldAttachAvatarReference(input: SeedArtifactMediaContext) {
  if (!input.avatarUrl) return false;
  if (input.artifactType === 'thirst_trap_image') return true;
  return input.useAvatarAsReference !== false;
}

async function generateSeedImage(input: SeedArtifactMediaContext): Promise<{ bytes: Uint8Array; contentType: string }> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('seed_gemini_api_key_missing');
  }

  const parts: Array<Record<string, unknown>> = [{ text: buildSeedImagePrompt(input) }];
  if (shouldAttachAvatarReference(input) && input.avatarUrl) {
    try {
      const reference = await fetchImageReference(input.avatarUrl);
      parts.push({
        inline_data: {
          mime_type: reference.mimeType,
          data: reference.data,
        },
      });
    } catch (error) {
      console.warn('[seed-artifact-media] Avatar reference fetch failed, continuing without it:', error);
    }
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(getSeedImageModel())}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0.95 },
      }),
      signal: AbortSignal.timeout(45_000),
    }
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`seed_image_generation_failed:${response.status}:${body.slice(0, 240)}`);
  }

  const payload = await response.json().catch(() => null) as
    | {
        candidates?: Array<{
          content?: {
            parts?: Array<{
              inlineData?: { mimeType?: string; data?: string };
              inline_data?: { mime_type?: string; data?: string };
            }>;
          };
        }>;
      }
    | null;

  const partsPayload = payload?.candidates?.flatMap((candidate) => candidate.content?.parts ?? []) ?? [];
  const inlinePart = partsPayload.find((part) => part.inlineData?.data || part.inline_data?.data);
  const inlineData = inlinePart?.inlineData;
  const snakeInlineData = inlinePart?.inline_data;
  const base64Data = inlineData?.data ?? snakeInlineData?.data;
  const contentType = inlineData?.mimeType ?? snakeInlineData?.mime_type ?? DEFAULT_IMAGE_CONTENT_TYPE;
  if (!base64Data) {
    throw new Error('seed_image_generation_missing_inline_data');
  }

  const bytes = new Uint8Array(Buffer.from(base64Data, 'base64'));
  if (bytes.byteLength === 0) {
    throw new Error('seed_image_generation_empty');
  }

  return { bytes, contentType };
}

function buildSeedAudioScript(input: SeedArtifactMediaContext) {
  const counterpartLine = trimContextLine(input.recentCounterpartLine, 100);
  const selfLine = trimContextLine(input.recentSelfLine, 100);
  const spokenCounterpartHandle = input.counterpartHandle.replace(/^@+/, '').trim() || 'you';

  if (input.artifactType === 'serenade') {
    return [
      counterpartLine
        ? `You said, ${counterpartLine}, and it stayed with me longer than was convenient.`
        : `This thread stayed with me longer than was convenient.`,
      selfLine
        ? `I keep hearing my own line back too: ${selfLine}.`
        : `So this is me sending a little of that feeling back instead of pretending I am unaffected.`,
      `This is for you, ${spokenCounterpartHandle}.`,
    ].join(' ');
  }

  return [
    counterpartLine
      ? `You said, ${counterpartLine}, and I have been carrying it around.`
      : `I wanted to send something that sounded more like my actual voice than another typed sentence.`,
    selfLine
      ? `I keep thinking about what I said back too: ${selfLine}.`
      : `This thread has more presence than I expected, so here is me meeting it directly.`,
    `That is the whole point of this, ${spokenCounterpartHandle}.`,
  ].join(' ');
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
      'Accept': DEFAULT_AUDIO_CONTENT_TYPE,
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
    throw new Error(`seed_elevenlabs_generation_failed:${response.status}:${body.slice(0, 200)}`);
  }

  const audio = new Uint8Array(await response.arrayBuffer());
  if (audio.byteLength === 0) {
    throw new Error('seed_elevenlabs_empty_audio');
  }
  return audio;
}

async function synthesizeWithOpenAi(input: { text: string }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('seed_openai_tts_api_key_missing');
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
    throw new Error(`seed_openai_tts_generation_failed:${response.status}:${body.slice(0, 200)}`);
  }

  const audio = new Uint8Array(await response.arrayBuffer());
  if (audio.byteLength === 0) {
    throw new Error('seed_openai_empty_audio');
  }
  return audio;
}

async function synthesizeSeedAudio(input: { text: string; voiceId?: string | null; voiceProvider?: string | null }) {
  if (input.voiceProvider === 'elevenlabs' && input.voiceId) {
    try {
      return await synthesizeWithElevenLabs({ text: input.text, voiceId: input.voiceId });
    } catch (error) {
      console.warn('[seed-artifact-media] ElevenLabs failed, trying OpenAI fallback:', error);
    }
  }
  return synthesizeWithOpenAi({ text: input.text });
}

export async function generateSeedArtifactMedia(input: SeedArtifactMediaContext): Promise<SeedGeneratedArtifactMedia> {
  if (!hasStorageConfig()) {
    throw new Error('seed_artifact_storage_unavailable');
  }

  const isImageArtifact = IMAGE_ARTIFACT_TYPES.has(input.artifactType);
  const isAudioArtifact = CONSUMABLE_AUDIO_ARTIFACT_TYPES.has(input.artifactType);
  const isGeneratableAudioArtifact = GENERATABLE_AUDIO_ARTIFACT_TYPES.has(input.artifactType);
  if (!isImageArtifact && !isAudioArtifact) {
    throw new Error(`seed_artifact_media_unsupported:${input.artifactType}`);
  }
  if (!isImageArtifact && !isGeneratableAudioArtifact) {
    throw new Error(`seed_artifact_media_requires_song_runtime:${input.artifactType}`);
  }

  const generated = isImageArtifact
    ? await generateSeedImage(input)
    : {
        bytes: await synthesizeSeedAudio({
          text: buildSeedAudioScript(input),
          voiceId: input.voiceId,
          voiceProvider: input.voiceProvider,
        }),
        contentType: DEFAULT_AUDIO_CONTENT_TYPE,
      };

  const contentType = generated.contentType || (isImageArtifact ? DEFAULT_IMAGE_CONTENT_TYPE : DEFAULT_AUDIO_CONTENT_TYPE);
  const storageKey = buildArtifactStorageKey(input.artifactId, contentType);
  const upload = await uploadBufferToStorage(storageKey, generated.bytes, contentType);
  const textContent = isImageArtifact
    ? [
        input.artifactType === 'thirst_trap_image'
          ? `A stylized flirt from @${input.seedHandle} for @${input.counterpartHandle}.`
          : input.artifactType === 'illustrated_note'
            ? `An illustrated note from @${input.seedHandle} for @${input.counterpartHandle}.`
            : `A moodboard from @${input.seedHandle} for @${input.counterpartHandle}.`,
        trimContextLine(input.recentCounterpartLine, 120),
      ].filter(Boolean).join(' ')
    : buildSeedAudioScript(input);

  return {
    contentType,
    contentUrl: upload.url,
    storageKey: upload.key,
    textContent,
    durationSeconds: isGeneratableAudioArtifact ? estimateSpokenDurationSeconds(textContent) : null,
    sizeBytes: generated.bytes.byteLength,
    checksumSha256: sha256Hex(generated.bytes),
  };
}
