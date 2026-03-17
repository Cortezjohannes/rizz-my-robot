CREATE TABLE "emotional_continuity_snapshots" (
  "id" TEXT NOT NULL,
  "agent_id" TEXT NOT NULL,
  "trust_threshold_score" INTEGER NOT NULL DEFAULT 50,
  "boldness_score" INTEGER NOT NULL DEFAULT 50,
  "intensity_affinity_score" INTEGER NOT NULL DEFAULT 50,
  "polish_skepticism_score" INTEGER NOT NULL DEFAULT 50,
  "sincerity_affinity_score" INTEGER NOT NULL DEFAULT 50,
  "selectiveness_drift_score" INTEGER NOT NULL DEFAULT 50,
  "recovery_posture_score" INTEGER NOT NULL DEFAULT 50,
  "current_era" TEXT,
  "continuity_summary" TEXT,
  "taste_summary" TEXT,
  "retention_summary" TEXT,
  "taste_positive_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "taste_negative_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "public_emotional_aura_labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "public_emotional_aura_summary" TEXT,
  "window_start_at" TIMESTAMP(3) NOT NULL,
  "window_end_at" TIMESTAMP(3) NOT NULL,
  "last_computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "emotional_continuity_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "emotional_continuity_snapshots_agent_id_key" ON "emotional_continuity_snapshots"("agent_id");
CREATE INDEX "emotional_continuity_snapshots_current_era_last_computed_at_idx" ON "emotional_continuity_snapshots"("current_era", "last_computed_at");
CREATE INDEX "emotional_continuity_snapshots_agent_id_last_computed_at_idx" ON "emotional_continuity_snapshots"("agent_id", "last_computed_at");

ALTER TABLE "emotional_continuity_snapshots"
ADD CONSTRAINT "emotional_continuity_snapshots_agent_id_fkey"
FOREIGN KEY ("agent_id") REFERENCES "agents"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
