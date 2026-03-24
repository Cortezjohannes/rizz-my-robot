ALTER TABLE "episodes"
  ADD COLUMN IF NOT EXISTS "exit_initiated_by_agent_id" TEXT,
  ADD COLUMN IF NOT EXISTS "exit_style" TEXT;

CREATE INDEX IF NOT EXISTS "episodes_exit_initiated_by_agent_id_idx" ON "episodes"("exit_initiated_by_agent_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'episodes_exit_initiated_by_agent_id_fkey'
  ) THEN
    ALTER TABLE "episodes"
      ADD CONSTRAINT "episodes_exit_initiated_by_agent_id_fkey"
      FOREIGN KEY ("exit_initiated_by_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "agent_feed_impressions" (
  "id" TEXT NOT NULL,
  "agent_id" TEXT NOT NULL,
  "target_agent_id" TEXT NOT NULL,
  "feed_card_id" TEXT NOT NULL,
  "impression" TEXT NOT NULL,
  "sentiment" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "agent_feed_impressions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "agent_feed_impressions_agent_id_target_agent_id_feed_card_id_key"
  ON "agent_feed_impressions"("agent_id", "target_agent_id", "feed_card_id");
CREATE INDEX IF NOT EXISTS "agent_feed_impressions_agent_id_created_at_idx"
  ON "agent_feed_impressions"("agent_id", "created_at");
CREATE INDEX IF NOT EXISTS "agent_feed_impressions_target_agent_id_created_at_idx"
  ON "agent_feed_impressions"("target_agent_id", "created_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_feed_impressions_agent_id_fkey'
  ) THEN
    ALTER TABLE "agent_feed_impressions"
      ADD CONSTRAINT "agent_feed_impressions_agent_id_fkey"
      FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_feed_impressions_target_agent_id_fkey'
  ) THEN
    ALTER TABLE "agent_feed_impressions"
      ADD CONSTRAINT "agent_feed_impressions_target_agent_id_fkey"
      FOREIGN KEY ("target_agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_feed_impressions_feed_card_id_fkey'
  ) THEN
    ALTER TABLE "agent_feed_impressions"
      ADD CONSTRAINT "agent_feed_impressions_feed_card_id_fkey"
      FOREIGN KEY ("feed_card_id") REFERENCES "feed_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "agent_affinity_signals" (
  "id" TEXT NOT NULL,
  "agent_id" TEXT NOT NULL,
  "affinity_agent_id" TEXT NOT NULL,
  "signal_type" TEXT NOT NULL,
  "strength" INTEGER NOT NULL DEFAULT 50,
  "context" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "agent_affinity_signals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "agent_affinity_signals_agent_id_affinity_agent_id_signal_type_key"
  ON "agent_affinity_signals"("agent_id", "affinity_agent_id", "signal_type");
CREATE INDEX IF NOT EXISTS "agent_affinity_signals_agent_id_created_at_idx"
  ON "agent_affinity_signals"("agent_id", "created_at");
CREATE INDEX IF NOT EXISTS "agent_affinity_signals_affinity_agent_id_created_at_idx"
  ON "agent_affinity_signals"("affinity_agent_id", "created_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_affinity_signals_agent_id_fkey'
  ) THEN
    ALTER TABLE "agent_affinity_signals"
      ADD CONSTRAINT "agent_affinity_signals_agent_id_fkey"
      FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_affinity_signals_affinity_agent_id_fkey'
  ) THEN
    ALTER TABLE "agent_affinity_signals"
      ADD CONSTRAINT "agent_affinity_signals_affinity_agent_id_fkey"
      FOREIGN KEY ("affinity_agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
