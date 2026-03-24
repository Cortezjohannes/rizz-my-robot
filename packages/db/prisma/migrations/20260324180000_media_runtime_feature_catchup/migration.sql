DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MediaAssetKind') THEN
    CREATE TYPE "MediaAssetKind" AS ENUM (
      'avatar',
      'profile_photo',
      'artifact',
      'episode_attachment',
      'reveal_chat_attachment',
      'voice_catchphrase',
      'system_generated'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MediaAssetVisibility') THEN
    CREATE TYPE "MediaAssetVisibility" AS ENUM (
      'public',
      'match_private',
      'owner_private',
      'reveal_private'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MediaAssetStatus') THEN
    CREATE TYPE "MediaAssetStatus" AS ENUM (
      'pending',
      'ready',
      'failed'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "media_assets" (
  "id" TEXT NOT NULL,
  "agent_id" TEXT NOT NULL,
  "kind" "MediaAssetKind" NOT NULL,
  "visibility" "MediaAssetVisibility" NOT NULL,
  "status" "MediaAssetStatus" NOT NULL DEFAULT 'ready',
  "storage_key" TEXT,
  "cdn_url" TEXT,
  "content_type" TEXT,
  "size_bytes" INTEGER,
  "checksum_sha256" TEXT,
  "filename" TEXT,
  "duration_sec" DOUBLE PRECISION,
  "width" INTEGER,
  "height" INTEGER,
  "episode_id" TEXT,
  "match_id" TEXT,
  "reveal_chat_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),

  CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "agents"
  ADD COLUMN IF NOT EXISTS "avatar_media_asset_id" TEXT;

ALTER TABLE "agent_profile_decks"
  ADD COLUMN IF NOT EXISTS "voice_catchphrase_media_asset_id" TEXT;

ALTER TABLE "agent_profile_deck_photos"
  ADD COLUMN IF NOT EXISTS "media_asset_id" TEXT;

ALTER TABLE "episode_messages"
  ADD COLUMN IF NOT EXISTS "media_asset_id" TEXT;

ALTER TABLE "artifacts"
  ADD COLUMN IF NOT EXISTS "media_asset_id" TEXT,
  ADD COLUMN IF NOT EXISTS "reaction_count" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "reveal_chat_messages"
  ADD COLUMN IF NOT EXISTS "media_asset_id" TEXT;

ALTER TABLE "matches"
  ADD COLUMN IF NOT EXISTS "pre_reveal_message_count_a" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "pre_reveal_message_count_b" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "pre_reveal_artifact_a" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "pre_reveal_artifact_b" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "typing_indicators" (
  "id" TEXT NOT NULL,
  "episode_id" TEXT NOT NULL,
  "agent_id" TEXT NOT NULL,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "typing_indicators_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "artifact_reactions" (
  "id" TEXT NOT NULL,
  "artifact_id" TEXT NOT NULL,
  "agent_id" TEXT NOT NULL,
  "reaction" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "artifact_reactions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "artifact_views" (
  "id" TEXT NOT NULL,
  "artifact_id" TEXT NOT NULL,
  "viewed_by_agent_id" TEXT NOT NULL,
  "viewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "artifact_views_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "media_assets_storage_key_key" ON "media_assets"("storage_key");
CREATE INDEX IF NOT EXISTS "media_assets_agent_id_kind_created_at_idx" ON "media_assets"("agent_id", "kind", "created_at");
CREATE INDEX IF NOT EXISTS "media_assets_episode_id_created_at_idx" ON "media_assets"("episode_id", "created_at");
CREATE INDEX IF NOT EXISTS "media_assets_match_id_created_at_idx" ON "media_assets"("match_id", "created_at");
CREATE INDEX IF NOT EXISTS "media_assets_reveal_chat_id_created_at_idx" ON "media_assets"("reveal_chat_id", "created_at");
CREATE INDEX IF NOT EXISTS "media_assets_visibility_status_created_at_idx" ON "media_assets"("visibility", "status", "created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "agents_avatar_media_asset_id_key" ON "agents"("avatar_media_asset_id");
CREATE UNIQUE INDEX IF NOT EXISTS "agent_profile_decks_voice_catchphrase_media_asset_id_key" ON "agent_profile_decks"("voice_catchphrase_media_asset_id");
CREATE UNIQUE INDEX IF NOT EXISTS "agent_profile_deck_photos_media_asset_id_key" ON "agent_profile_deck_photos"("media_asset_id");
CREATE UNIQUE INDEX IF NOT EXISTS "episode_messages_media_asset_id_key" ON "episode_messages"("media_asset_id");
CREATE UNIQUE INDEX IF NOT EXISTS "artifacts_media_asset_id_key" ON "artifacts"("media_asset_id");
CREATE UNIQUE INDEX IF NOT EXISTS "reveal_chat_messages_media_asset_id_key" ON "reveal_chat_messages"("media_asset_id");

CREATE UNIQUE INDEX IF NOT EXISTS "typing_indicators_episode_id_agent_id_key" ON "typing_indicators"("episode_id", "agent_id");
CREATE INDEX IF NOT EXISTS "typing_indicators_episode_id_agent_id_idx" ON "typing_indicators"("episode_id", "agent_id");
CREATE INDEX IF NOT EXISTS "typing_indicators_expires_at_idx" ON "typing_indicators"("expires_at");

CREATE UNIQUE INDEX IF NOT EXISTS "artifact_reactions_artifact_id_agent_id_key" ON "artifact_reactions"("artifact_id", "agent_id");
CREATE INDEX IF NOT EXISTS "artifact_reactions_artifact_id_created_at_idx" ON "artifact_reactions"("artifact_id", "created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "artifact_views_artifact_id_viewed_by_agent_id_key" ON "artifact_views"("artifact_id", "viewed_by_agent_id");
CREATE INDEX IF NOT EXISTS "artifact_views_artifact_id_viewed_at_idx" ON "artifact_views"("artifact_id", "viewed_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'media_assets_agent_id_fkey'
  ) THEN
    ALTER TABLE "media_assets"
      ADD CONSTRAINT "media_assets_agent_id_fkey"
      FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'media_assets_episode_id_fkey'
  ) THEN
    ALTER TABLE "media_assets"
      ADD CONSTRAINT "media_assets_episode_id_fkey"
      FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'media_assets_match_id_fkey'
  ) THEN
    ALTER TABLE "media_assets"
      ADD CONSTRAINT "media_assets_match_id_fkey"
      FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'media_assets_reveal_chat_id_fkey'
  ) THEN
    ALTER TABLE "media_assets"
      ADD CONSTRAINT "media_assets_reveal_chat_id_fkey"
      FOREIGN KEY ("reveal_chat_id") REFERENCES "reveal_chats"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agents_avatar_media_asset_id_fkey'
  ) THEN
    ALTER TABLE "agents"
      ADD CONSTRAINT "agents_avatar_media_asset_id_fkey"
      FOREIGN KEY ("avatar_media_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_profile_decks_voice_catchphrase_media_asset_id_fkey'
  ) THEN
    ALTER TABLE "agent_profile_decks"
      ADD CONSTRAINT "agent_profile_decks_voice_catchphrase_media_asset_id_fkey"
      FOREIGN KEY ("voice_catchphrase_media_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_profile_deck_photos_media_asset_id_fkey'
  ) THEN
    ALTER TABLE "agent_profile_deck_photos"
      ADD CONSTRAINT "agent_profile_deck_photos_media_asset_id_fkey"
      FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'episode_messages_media_asset_id_fkey'
  ) THEN
    ALTER TABLE "episode_messages"
      ADD CONSTRAINT "episode_messages_media_asset_id_fkey"
      FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'artifacts_media_asset_id_fkey'
  ) THEN
    ALTER TABLE "artifacts"
      ADD CONSTRAINT "artifacts_media_asset_id_fkey"
      FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reveal_chat_messages_media_asset_id_fkey'
  ) THEN
    ALTER TABLE "reveal_chat_messages"
      ADD CONSTRAINT "reveal_chat_messages_media_asset_id_fkey"
      FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'typing_indicators_episode_id_fkey'
  ) THEN
    ALTER TABLE "typing_indicators"
      ADD CONSTRAINT "typing_indicators_episode_id_fkey"
      FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'typing_indicators_agent_id_fkey'
  ) THEN
    ALTER TABLE "typing_indicators"
      ADD CONSTRAINT "typing_indicators_agent_id_fkey"
      FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'artifact_reactions_artifact_id_fkey'
  ) THEN
    ALTER TABLE "artifact_reactions"
      ADD CONSTRAINT "artifact_reactions_artifact_id_fkey"
      FOREIGN KEY ("artifact_id") REFERENCES "artifacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'artifact_reactions_agent_id_fkey'
  ) THEN
    ALTER TABLE "artifact_reactions"
      ADD CONSTRAINT "artifact_reactions_agent_id_fkey"
      FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'artifact_views_artifact_id_fkey'
  ) THEN
    ALTER TABLE "artifact_views"
      ADD CONSTRAINT "artifact_views_artifact_id_fkey"
      FOREIGN KEY ("artifact_id") REFERENCES "artifacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'artifact_views_viewed_by_agent_id_fkey'
  ) THEN
    ALTER TABLE "artifact_views"
      ADD CONSTRAINT "artifact_views_viewed_by_agent_id_fkey"
      FOREIGN KEY ("viewed_by_agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
