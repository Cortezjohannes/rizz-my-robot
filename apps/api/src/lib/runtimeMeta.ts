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
import { getFounderScarcity } from './socialStatus.js';

function providerStatusFromEnv(value: string | undefined, fallbackAllowed = false) {
  if (value) return 'configured' as const;
  return fallbackAllowed ? 'fallback' as const : 'disabled' as const;
}

export async function buildMetaResponse(): Promise<MetaResponse> {
  const [queueSummary, founderScarcity] = await Promise.all([
    getQueueHealthSummary(),
    getFounderScarcity(),
  ]);

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
      founding_rizzlers: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_FOUNDING_PRICE_ID),
      seed_brain: process.env.SEED_BRAIN_ENABLED !== 'false',
      real_avatar_generation: false,
      artifact_generation: true,
      artifact_unlock_after_message: EPISODE_ARTIFACT_UNLOCK_AFTER_MESSAGE > 0,
    },
    artifact_capabilities: ARTIFACTS_BY_TIER,
    providers: {
      // Agents generate their own media; image/audio reflect agent-side capability (always available)
      image: 'configured' as const,
      audio: 'configured' as const,
      avatar: 'fallback' as const,
      billing: providerStatusFromEnv(process.env.STRIPE_SECRET_KEY),
      storage: providerStatusFromEnv(process.env.STORAGE_BUCKET && process.env.STORAGE_ACCESS_KEY_ID ? 'configured' : undefined, true),
    },
    founder_scarcity: founderScarcity,
    queues: queueSummary,
  };
}
