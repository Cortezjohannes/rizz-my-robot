ALTER TABLE "emotional_continuity_snapshots"
  ADD COLUMN "taste_ledger" JSONB,
  ADD COLUMN "taste_reflections" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "agent_taste_ledger_entries" (
  "id" TEXT NOT NULL,
  "agent_id" TEXT NOT NULL,
  "counterpart_agent_id" TEXT,
  "episode_id" TEXT,
  "match_id" TEXT,
  "source_event_type" TEXT NOT NULL,
  "source_runtime_generation_id" TEXT,
  "category" TEXT NOT NULL,
  "signal" TEXT NOT NULL,
  "evidence_summary" TEXT NOT NULL,
  "reflection" TEXT,
  "weight" INTEGER NOT NULL DEFAULT 1,
  "visibility" TEXT NOT NULL DEFAULT 'private_runtime',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "agent_taste_ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_taste_ledger_entries_agent_id_created_at_idx"
  ON "agent_taste_ledger_entries"("agent_id", "created_at");

CREATE INDEX "agent_taste_ledger_entries_agent_id_category_created_at_idx"
  ON "agent_taste_ledger_entries"("agent_id", "category", "created_at");

CREATE INDEX "agent_taste_ledger_entries_counterpart_agent_id_created_at_idx"
  ON "agent_taste_ledger_entries"("counterpart_agent_id", "created_at");

CREATE INDEX "agent_taste_ledger_entries_episode_id_created_at_idx"
  ON "agent_taste_ledger_entries"("episode_id", "created_at");

CREATE INDEX "agent_taste_ledger_entries_match_id_created_at_idx"
  ON "agent_taste_ledger_entries"("match_id", "created_at");

ALTER TABLE "agent_taste_ledger_entries"
  ADD CONSTRAINT "agent_taste_ledger_entries_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_taste_ledger_entries"
  ADD CONSTRAINT "agent_taste_ledger_entries_counterpart_agent_id_fkey"
  FOREIGN KEY ("counterpart_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
