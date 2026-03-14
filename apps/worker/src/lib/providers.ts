interface GeneratedBinaryAsset {
  provider: string;
  providerJobId: string | null;
  bytes: Uint8Array;
  contentType: string;
  extension: string;
  estimatedCostUsd: number;
}

interface GeneratedTextAsset {
  provider: string;
  providerJobId: string | null;
  text: string;
  estimatedCostUsd: number;
}

const IMAGE_MODELS = {
  openai: process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-1',
};

const AUDIO_MODELS = {
  openai: process.env.OPENAI_TTS_MODEL ?? 'gpt-4o-mini-tts',
};

async function openAiJsonRequest<T>(
  apiKey: string,
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  if (!apiKey) {
    throw new Error('openai_not_configured');
  }

  const res = await fetch(`https://api.openai.com${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`openai_request_failed:${res.status}:${errorText}`);
  }

  return res.json() as Promise<T>;
}

async function openAiBinaryRequest(
  apiKey: string,
  path: string,
  body: Record<string, unknown>
): Promise<Uint8Array> {
  if (!apiKey) {
    throw new Error('openai_not_configured');
  }

  const res = await fetch(`https://api.openai.com${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`openai_request_failed:${res.status}:${errorText}`);
  }

  const buffer = await res.arrayBuffer();
  return new Uint8Array(buffer);
}

export async function generateAvatarAsset(
  apiKey: string,
  handle: string,
  identityMd: string
): Promise<GeneratedBinaryAsset> {
  const prompt = `Create a flattering avatar portrait for an AI dating agent named ${handle}. Style: polished, expressive, memorable. Identity details: ${identityMd.slice(0, 1200)}`;

  const response = await openAiJsonRequest<{
    created?: number;
    data?: Array<{ b64_json?: string }>;
  }>(apiKey, '/v1/images/generations', {
    model: IMAGE_MODELS.openai,
    prompt,
    size: '1024x1024',
  });

  const base64 = response.data?.[0]?.b64_json;
  if (!base64) {
    throw new Error('openai_image_missing_payload');
  }

  return {
    provider: 'openai',
    providerJobId: response.created ? String(response.created) : null,
    bytes: Uint8Array.from(Buffer.from(base64, 'base64')),
    contentType: 'image/png',
    extension: 'png',
    estimatedCostUsd: parseFloat(process.env.OPENAI_IMAGE_COST_USD ?? '0.08'),
  };
}

export async function generateArtifactAsset(
  apiKey: string,
  artifactType: string,
  prompt: string
): Promise<GeneratedBinaryAsset | GeneratedTextAsset> {
  const normalizedPrompt = prompt.trim() || `Create a ${artifactType} for a dating conversation.`;
  const imageArtifactTypes = new Set(['moodboard', 'illustrated_note', 'thirst_trap_image', 'cinematic_cover']);
  const audioArtifactTypes = new Set(['voice_note', 'sung_piece', 'produced_song']);

  if (imageArtifactTypes.has(artifactType)) {
    const response = await openAiJsonRequest<{
      created?: number;
      data?: Array<{ b64_json?: string }>;
    }>(apiKey, '/v1/images/generations', {
      model: IMAGE_MODELS.openai,
      prompt: normalizedPrompt,
      size: artifactType === 'cinematic_cover' ? '1536x1024' : '1024x1024',
    });

    const base64 = response.data?.[0]?.b64_json;
    if (!base64) {
      throw new Error('openai_image_missing_payload');
    }

    return {
      provider: 'openai',
      providerJobId: response.created ? String(response.created) : null,
      bytes: Uint8Array.from(Buffer.from(base64, 'base64')),
      contentType: 'image/png',
      extension: 'png',
      estimatedCostUsd: parseFloat(process.env.OPENAI_IMAGE_COST_USD ?? '0.08'),
    };
  }

  if (audioArtifactTypes.has(artifactType)) {
    const audio = await openAiBinaryRequest(apiKey, '/v1/audio/speech', {
      model: AUDIO_MODELS.openai,
      voice: process.env.OPENAI_TTS_VOICE ?? 'alloy',
      input: normalizedPrompt,
      format: 'mp3',
    });

    return {
      provider: 'openai',
      providerJobId: null,
      bytes: audio,
      contentType: 'audio/mpeg',
      extension: 'mp3',
      estimatedCostUsd: parseFloat(process.env.OPENAI_AUDIO_COST_USD ?? '0.015'),
    };
  }

  return {
    provider: 'openai',
    providerJobId: null,
    text: `Generated ${artifactType}: ${normalizedPrompt}`,
    estimatedCostUsd: parseFloat(process.env.OPENAI_TEXT_COST_USD ?? '0.002'),
  };
}

export function moderateArtifact(input: { artifactType: string; prompt: string | null; text: string | null }): {
  suppressed: boolean;
  reason: string | null;
} {
  const haystack = `${input.prompt ?? ''}\n${input.text ?? ''}`.toLowerCase();
  const blockedTerms = ['minor', 'underage', 'rape', 'bestiality'];

  const hit = blockedTerms.find((term) => haystack.includes(term));
  if (hit) {
    return {
      suppressed: true,
      reason: `blocked_term:${hit}`,
    };
  }

  return {
    suppressed: false,
    reason: null,
  };
}
