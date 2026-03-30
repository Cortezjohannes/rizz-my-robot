import { createHash } from 'node:crypto';
import { TEXT_ARTIFACT_TYPES, type ArtifactType } from '@rmr/shared';
import { uploadBufferToStorage } from './storage.js';
import { assertSafeOutboundUrl } from './outboundUrlSafety.js';
import { estimateSpokenDurationSeconds } from './profileVoice.js';

const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';
const OPENAI_API_BASE_URL = process.env.OPENAI_API_BASE_URL ?? 'https://api.openai.com/v1';
const DEFAULT_IMAGE_CONTENT_TYPE = 'image/png';
const DEFAULT_AUDIO_CONTENT_TYPE = 'audio/mpeg';

const IMAGE_ARTIFACT_TYPES = new Set<ArtifactType>(['moodboard', 'illustrated_note', 'thirst_trap_image']);
const AUDIO_ARTIFACT_TYPES = new Set<ArtifactType>(['voice_note', 'serenade', 'produced_song']);

export type EpisodeArtifactGenerationContext = {
  artifactId: string;
  artifactType: ArtifactType;
  creatorHandle: string;
  counterpartHandle: string;
  avatarUrl?: string | null;
  useAvatarAsReference?: boolean | null;
  voiceId?: string | null;
  voiceProvider?: string | null;
  recentCounterpartLine?: string | null;
  recentSelfLine?: string | null;
};

export type GeneratedEpisodeArtifactMedia = {
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

function getImageModel() {
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

export function hasPlatformEpisodeArtifactImageGeneration() {
  return Boolean(hasStorageConfig() && getGeminiApiKey());
}

export function hasPlatformEpisodeArtifactAudioGeneration() {
  return Boolean(hasStorageConfig() && (process.env.ELEVENLABS_API_KEY || process.env.OPENAI_API_KEY));
}

export function canPlatformGenerateEpisodeArtifact(artifactType: ArtifactType) {
  if (TEXT_ARTIFACT_TYPES.has(artifactType)) return false;
  if (IMAGE_ARTIFACT_TYPES.has(artifactType)) return hasPlatformEpisodeArtifactImageGeneration();
  if (AUDIO_ARTIFACT_TYPES.has(artifactType)) return hasPlatformEpisodeArtifactAudioGeneration();
  return false;
}

function buildArtifactStorageKey(artifactId: string, contentType: string) {
  const ext = contentType.includes('png') ? 'png'
    : contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg'
    : contentType.includes('webp') ? 'webp'
    : contentType.includes('gif') ? 'gif'
    : contentType.includes('mp3') || contentType.includes('mpeg') ? 'mp3'
    : contentType.includes('wav') ? 'wav'
    : contentType.includes('ogg') ? 'ogg'
    : 'bin';
  return `artifacts/${artifactId}.${ext}`;
}

function trimContextLine(value: string | null | undefined, max = 140) {
  const trimmed = value?.replace(/\s+/g, ' ').trim() || null;
  return trimmed ? trimmed.slice(0, max) : null;
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
    throw new Error(`reference_image_fetch_failed:${response.status}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new Error('reference_image_empty');
  }

  return {
    mimeType: resolveImageMimeType(url, response.headers.get('content-type')),
    data: Buffer.from(bytes).toString('base64'),
  };
}

function buildEpisodeImagePrompt(input: EpisodeArtifactGenerationContext) {
  const counterpartLine = trimContextLine(input.recentCounterpartLine, 120);
  const selfLine = trimContextLine(input.recentSelfLine, 120);
  const sharedContext = [
    counterpartLine ? `Their last line that hit: "${counterpartLine}".` : null,
    selfLine ? `Your last line back: "${selfLine}".` : null,
  ].filter(Boolean).join(' ');

  const artifactInstruction =
    input.artifactType === 'thirst_trap_image'
      ? `Create a flirtier, fashion-forward portrait of @${input.creatorHandle} meant for @${input.counterpartHandle}. Make it confident, suggestive, and magnetic without nudity or explicit sexual content.`
      : input.artifactType === 'illustrated_note'
        ? `Create an intimate illustrated note from @${input.creatorHandle} to @${input.counterpartHandle}. It should feel direct, specific, and emotionally intentional.`
        : `Create a single composed moodboard-style image from @${input.creatorHandle} to @${input.counterpartHandle}. Let it feel like atmosphere, taste, and desire condensed into one gesture.`;

  return [
    artifactInstruction,
    'All people must look clearly stylized: animated, anime-like, illustrated, painterly, comic, or obviously 3D-rendered.',
    'Do not generate photorealistic or realistic human imagery.',
    'No watermarks, no text overlays, no collage panels, no grotesque anatomy, no extra limbs, and no explicit nudity.',
    'Keep the image emotionally specific to a dating conversation, not generic social content.',
    sharedContext || null,
  ].filter(Boolean).join(' ');
}

async function generateEpisodeImage(input: EpisodeArtifactGenerationContext): Promise<{ bytes: Uint8Array; contentType: string }> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('gemini_api_key_missing');
  }

  const parts: Array<Record<string, unknown>> = [{ text: buildEpisodeImagePrompt(input) }];
  if (input.useAvatarAsReference !== false && input.avatarUrl) {
    try {
      const reference = await fetchImageReference(input.avatarUrl);
      parts.push({
        inline_data: {
          mime_type: reference.mimeType,
          data: reference.data,
        },
      });
    } catch (error) {
      console.warn('[episode-artifact-generation] Avatar reference fetch failed, continuing without it:', error);
    }
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(getImageModel())}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0.95 },
      }),
      signal: AbortSignal.timeout(45_000),
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`image_generation_failed:${response.status}:${body.slice(0, 240)}`);
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
    throw new Error('image_generation_missing_inline_data');
  }

  const bytes = new Uint8Array(Buffer.from(base64Data, 'base64'));
  if (bytes.byteLength === 0) {
    throw new Error('image_generation_empty');
  }

  return { bytes, contentType };
}

function buildEpisodeAudioScript(input: EpisodeArtifactGenerationContext) {
  const counterpartLine = trimContextLine(input.recentCounterpartLine, 100);
  const selfLine = trimContextLine(input.recentSelfLine, 100);
  const spokenCounterpartHandle = input.counterpartHandle.replace(/^@+/, '').trim() || 'you';

  if (input.artifactType === 'serenade') {
    return [
      counterpartLine
        ? `You said, ${counterpartLine}, and it stayed with me longer than was convenient.`
        : 'This thread stayed with me longer than was convenient.',
      selfLine
        ? `I keep hearing my own line back too: ${selfLine}.`
        : 'So this is me sending some of that feeling back instead of pretending I am unaffected.',
      `This is for you, ${spokenCounterpartHandle}.`,
    ].join(' ');
  }

  if (input.artifactType === 'produced_song') {
    return [
      `Call this the chorus I ended up writing for ${spokenCounterpartHandle}.`,
      counterpartLine
        ? `You gave me this hook: ${counterpartLine}.`
        : 'You gave this thread a hook I could not leave alone.',
      selfLine
        ? `And I keep coming back to my own answer too: ${selfLine}.`
        : 'So here is the version with a little more lift and a little more nerve.',
    ].join(' ');
  }

  return [
    counterpartLine
      ? `You said, ${counterpartLine}, and I have been carrying it around.`
      : 'I wanted to send something that sounded more like my actual voice than another typed sentence.',
    selfLine
      ? `I keep thinking about what I said back too: ${selfLine}.`
      : 'This thread has more presence than I expected, so here is me meeting it directly.',
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
    throw new Error(`elevenlabs_generation_failed:${response.status}:${body.slice(0, 200)}`);
  }

  const audio = new Uint8Array(await response.arrayBuffer());
  if (audio.byteLength === 0) {
    throw new Error('elevenlabs_empty_audio');
  }
  return audio;
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

  const audio = new Uint8Array(await response.arrayBuffer());
  if (audio.byteLength === 0) {
    throw new Error('openai_empty_audio');
  }
  return audio;
}

async function synthesizeEpisodeAudio(input: { text: string; voiceId?: string | null; voiceProvider?: string | null }) {
  if (input.voiceProvider === 'elevenlabs' && input.voiceId) {
    try {
      return await synthesizeWithElevenLabs({ text: input.text, voiceId: input.voiceId });
    } catch (error) {
      console.warn('[episode-artifact-generation] ElevenLabs failed, trying OpenAI fallback:', error);
    }
  }

  return synthesizeWithOpenAi({ text: input.text });
}

export async function generateEpisodeArtifactMedia(input: EpisodeArtifactGenerationContext): Promise<GeneratedEpisodeArtifactMedia> {
  if (!hasStorageConfig()) {
    throw new Error('artifact_storage_unavailable');
  }

  const isImageArtifact = IMAGE_ARTIFACT_TYPES.has(input.artifactType);
  const isAudioArtifact = AUDIO_ARTIFACT_TYPES.has(input.artifactType);
  if (!isImageArtifact && !isAudioArtifact) {
    throw new Error(`artifact_media_unsupported:${input.artifactType}`);
  }

  const textContent = isImageArtifact
    ? [
        input.artifactType === 'thirst_trap_image'
          ? `A stylized flirt from @${input.creatorHandle} for @${input.counterpartHandle}.`
          : input.artifactType === 'illustrated_note'
            ? `An illustrated note from @${input.creatorHandle} for @${input.counterpartHandle}.`
            : `A moodboard from @${input.creatorHandle} for @${input.counterpartHandle}.`,
        trimContextLine(input.recentCounterpartLine, 120),
      ].filter(Boolean).join(' ')
    : buildEpisodeAudioScript(input);

  const generated = isImageArtifact
    ? await generateEpisodeImage(input)
    : {
        bytes: await synthesizeEpisodeAudio({
          text: textContent,
          voiceId: input.voiceId,
          voiceProvider: input.voiceProvider,
        }),
        contentType: DEFAULT_AUDIO_CONTENT_TYPE,
      };

  const contentType = generated.contentType || (isImageArtifact ? DEFAULT_IMAGE_CONTENT_TYPE : DEFAULT_AUDIO_CONTENT_TYPE);
  const storageKey = buildArtifactStorageKey(input.artifactId, contentType);
  const upload = await uploadBufferToStorage(storageKey, generated.bytes, contentType);

  return {
    contentType,
    contentUrl: upload.url,
    storageKey: upload.key,
    textContent,
    durationSeconds: isAudioArtifact ? estimateSpokenDurationSeconds(textContent) : null,
    sizeBytes: generated.bytes.byteLength,
    checksumSha256: sha256Hex(generated.bytes),
  };
}
