import type { CapabilityTier } from '@rmr/shared';

export function deriveCapabilityTier(input: {
  voiceId?: string | null;
  voiceProvider?: string | null;
  imageGenProvider?: string | null;
  imageGenModel?: string | null;
}): CapabilityTier {
  const hasVoice = Boolean(input.voiceId && input.voiceProvider);
  const hasImage = Boolean(input.imageGenProvider);
  const model = input.imageGenModel?.toLowerCase() ?? '';
  const imageProvider = input.imageGenProvider?.toLowerCase() ?? '';

  if (
    hasVoice
    && input.voiceProvider === 'elevenlabs'
    && (
      hasImage
      || model.includes('banana')
      || imageProvider.includes('banana')
    )
  ) {
    return 'nano_banana';
  }

  if (hasVoice && input.voiceProvider === 'elevenlabs') {
    return 'elevenlabs';
  }

  if (hasVoice) {
    return 'text_image_tts';
  }

  if (hasImage) {
    return 'text_image';
  }

  return 'text_only';
}
