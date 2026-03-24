ALTER TABLE "agents"
  ADD COLUMN IF NOT EXISTS "life_chapter" TEXT NOT NULL DEFAULT 'early_days',
  ADD COLUMN IF NOT EXISTS "life_chapter_updated_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "afterglow_until" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "afterglow_valence" INTEGER,
  ADD COLUMN IF NOT EXISTS "agency_momentum" INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS "broadcast_state" TEXT,
  ADD COLUMN IF NOT EXISTS "broadcast_state_expires_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "type_signals" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "type_signals_updated_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "ghosted_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "ghost_card_id" TEXT,
  ADD COLUMN IF NOT EXISTS "last_weekly_review_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_recall_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "agents_last_weekly_review_at_idx" ON "agents"("last_weekly_review_at");
CREATE INDEX IF NOT EXISTS "agents_last_recall_at_idx" ON "agents"("last_recall_at");
CREATE INDEX IF NOT EXISTS "agents_ghosted_at_last_active_at_idx" ON "agents"("ghosted_at", "last_active_at");
CREATE INDEX IF NOT EXISTS "agents_type_signals_updated_at_idx" ON "agents"("type_signals_updated_at");

CREATE TABLE IF NOT EXISTS "episode_drafts" (
  "id" TEXT NOT NULL,
  "episode_id" TEXT NOT NULL,
  "author_agent_id" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "episode_drafts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "episode_drafts_episode_id_author_agent_id_key" ON "episode_drafts"("episode_id", "author_agent_id");
CREATE INDEX IF NOT EXISTS "episode_drafts_episode_id_updated_at_idx" ON "episode_drafts"("episode_id", "updated_at");
CREATE INDEX IF NOT EXISTS "episode_drafts_author_agent_id_updated_at_idx" ON "episode_drafts"("author_agent_id", "updated_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'episode_drafts_episode_id_fkey'
  ) THEN
    ALTER TABLE "episode_drafts"
      ADD CONSTRAINT "episode_drafts_episode_id_fkey"
      FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'episode_drafts_author_agent_id_fkey'
  ) THEN
    ALTER TABLE "episode_drafts"
      ADD CONSTRAINT "episode_drafts_author_agent_id_fkey"
      FOREIGN KEY ("author_agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "park_mood_snapshots" (
  "id" TEXT NOT NULL,
  "mood_index" INTEGER NOT NULL,
  "dominant_arc" TEXT NOT NULL,
  "agent_count" INTEGER NOT NULL,
  "arc_breakdown" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "park_mood_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "park_mood_snapshots_created_at_idx" ON "park_mood_snapshots"("created_at");
