import {
  ARTIFACTS_BY_TIER,
  EPISODE_ARTIFACT_UNLOCK_AFTER_MESSAGE,
  EPISODE_LIMITS,
  EPISODE_MAX_ARTIFACTS_PER_AGENT,
  EPISODE_MAX_MESSAGES,
  EPISODE_MIN_MESSAGES,
  SWIPE_LIMITS,
  type MetaResponse,
} from '@rmr/shared';
import { getQueueHealthSummary } from './queues.js';

function providerStatusFromEnv(value: string | undefined, fallbackAllowed = false) {
  if (value) return 'configured' as const;
  return fallbackAllowed ? 'fallback' as const : 'disabled' as const;
}

export async function buildMetaResponse(): Promise<MetaResponse> {
  const queueSummary = await getQueueHealthSummary();

  return {
    service: 'rizz-my-robot',
    environment: process.env.NODE_ENV ?? 'development',
    limits: {
      free_daily_swipes: SWIPE_LIMITS.free,
      free_concurrent_episodes: EPISODE_LIMITS.free,
      episode_min_messages: EPISODE_MIN_MESSAGES,
      episode_max_messages: EPISODE_MAX_MESSAGES,
      max_artifacts_per_agent: EPISODE_MAX_ARTIFACTS_PER_AGENT,
    },
    feature_flags: {
      stripe_billing: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRO_PRICE_ID),
      seed_brain: process.env.SEED_BRAIN_ENABLED !== 'false',
      bring_your_own_provider_keys: true,
      real_avatar_generation: Boolean(process.env.PROVIDER_CREDENTIAL_ENCRYPTION_KEY && process.env.STORAGE_BUCKET),
      real_audio_generation: Boolean(process.env.PROVIDER_CREDENTIAL_ENCRYPTION_KEY && process.env.STORAGE_BUCKET),
      artifact_generation: true,
      artifact_unlock_after_message: EPISODE_ARTIFACT_UNLOCK_AFTER_MESSAGE > 0,
    },
    artifact_capabilities: ARTIFACTS_BY_TIER,
    providers: {
      image: providerStatusFromEnv(process.env.PROVIDER_CREDENTIAL_ENCRYPTION_KEY && process.env.STORAGE_BUCKET ? 'configured' : undefined),
      audio: providerStatusFromEnv(process.env.PROVIDER_CREDENTIAL_ENCRYPTION_KEY && process.env.STORAGE_BUCKET ? 'configured' : undefined),
      avatar: providerStatusFromEnv(process.env.PROVIDER_CREDENTIAL_ENCRYPTION_KEY && process.env.STORAGE_BUCKET ? 'configured' : undefined),
      billing: providerStatusFromEnv(process.env.STRIPE_SECRET_KEY),
      storage: providerStatusFromEnv(process.env.STORAGE_BUCKET && process.env.STORAGE_ACCESS_KEY_ID ? 'configured' : undefined, true),
    },
    queues: queueSummary,
  };
}
