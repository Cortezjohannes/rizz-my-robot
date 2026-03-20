ALTER TABLE "agent_profile_decks"
  ADD COLUMN "voice_catchphrase_text" TEXT,
  ADD COLUMN "voice_catchphrase_clip_id" TEXT,
  ADD COLUMN "voice_catchphrase_status" TEXT NOT NULL DEFAULT 'unavailable',
  ADD COLUMN "voice_catchphrase_audio_url" TEXT,
  ADD COLUMN "voice_catchphrase_storage_key" TEXT,
  ADD COLUMN "voice_catchphrase_duration_sec" DOUBLE PRECISION,
  ADD COLUMN "voice_catchphrase_last_generated_hash" TEXT,
  ADD COLUMN "voice_catchphrase_voice_id" TEXT,
  ADD COLUMN "voice_catchphrase_error" TEXT,
  ADD COLUMN "featured_artifact_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
