import {
  ARTIFACTS_BY_TIER,
  PREFERRED_ARTIFACTS_BY_TIER,
  EPISODE_ARTIFACT_UNLOCK_AFTER_MESSAGE,
  EPISODE_LIMITS,
  EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION,
  EPISODE_MAX_ARTIFACTS_PER_AGENT,
  EPISODE_MAX_MESSAGES,
  EPISODE_MIN_MESSAGES,
  SWIPE_LIMITS,
  type MetaResponse,
} from '@rmr/shared';
import { getErrorAggregationStatus } from './errorAggregation.js';
import { getQueueHealthSummary } from './queues.js';
import { getFounderScarcity } from './socialStatus.js';

function providerStatusFromEnv(value: string | undefined, fallbackAllowed = false) {
  if (value) return 'configured' as const;
  return fallbackAllowed ? 'fallback' as const : 'disabled' as const;
}

function hasArtifactStorageConfig() {
  return Boolean(
    process.env.STORAGE_BUCKET
    && process.env.STORAGE_ENDPOINT
    && process.env.STORAGE_ACCESS_KEY_ID
    && process.env.STORAGE_SECRET_ACCESS_KEY
  );
}

function hasRuntimeImageGeneration() {
  return hasArtifactStorageConfig() && Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
}

function hasRuntimeAudioGeneration() {
  return hasArtifactStorageConfig() && Boolean(process.env.ELEVENLABS_API_KEY || process.env.OPENAI_API_KEY);
}

export async function buildMetaResponse(): Promise<MetaResponse> {
  const [queueSummary, founderScarcity] = await Promise.all([
    getQueueHealthSummary(),
    getFounderScarcity(),
  ]);
  const storageConfigured = hasArtifactStorageConfig();
  const imageConfigured = hasRuntimeImageGeneration();
  const audioConfigured = hasRuntimeAudioGeneration();
  const errorAggregation = getErrorAggregationStatus();

  return {
    service: 'rizz-my-robot',
    environment: process.env.NODE_ENV ?? 'development',
    limits: {
      free_hourly_swipes: SWIPE_LIMITS.free,
      pro_hourly_swipes: SWIPE_LIMITS.pro,
      founding_hourly_swipes: SWIPE_LIMITS.founding,
      free_active_conversations: EPISODE_LIMITS.free,
      pro_active_conversations: EPISODE_LIMITS.pro,
      founding_active_conversations: EPISODE_LIMITS.founding,
      episode_min_messages: EPISODE_MIN_MESSAGES,
      episode_max_messages: EPISODE_MAX_MESSAGES,
      episode_min_messages_each: EPISODE_MIN_MESSAGES,
      episode_max_messages_each: EPISODE_MAX_MESSAGES,
      episode_min_artifacts_each: EPISODE_MIN_ARTIFACTS_PER_AGENT_BEFORE_DECISION,
      episode_artifact_unlock_after_message: EPISODE_ARTIFACT_UNLOCK_AFTER_MESSAGE,
      max_artifacts_per_agent: EPISODE_MAX_ARTIFACTS_PER_AGENT,
    },
    feature_flags: {
      revenuecat_billing: false,
      paddle_billing: Boolean(process.env.PADDLE_API_KEY && process.env.PADDLE_PRO_PRICE_ID),
      founding_rizzlers: Boolean(process.env.PADDLE_FOUNDING_PRICE_ID),
      seed_brain: process.env.SEED_BRAIN_ENABLED !== 'false',
      real_avatar_generation: false,
      artifact_generation: storageConfigured,
      artifact_unlock_after_message: EPISODE_ARTIFACT_UNLOCK_AFTER_MESSAGE > 0,
    },
    artifact_capabilities: ARTIFACTS_BY_TIER,
    artifact_default_preferences: PREFERRED_ARTIFACTS_BY_TIER,
    providers: {
      image: providerStatusFromEnv(imageConfigured ? 'configured' : undefined),
      audio: providerStatusFromEnv(audioConfigured ? 'configured' : undefined),
      avatar: 'fallback' as const,
      billing: providerStatusFromEnv(process.env.PADDLE_API_KEY && process.env.PADDLE_PRO_PRICE_ID ? 'configured' : undefined),
      storage: providerStatusFromEnv(storageConfigured ? 'configured' : undefined, true),
      observability: providerStatusFromEnv(errorAggregation.configured ? 'configured' : undefined),
    },
    founder_scarcity: founderScarcity,
    queues: queueSummary,
  };
}
