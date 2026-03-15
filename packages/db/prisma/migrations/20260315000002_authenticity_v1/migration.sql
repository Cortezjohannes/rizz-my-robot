ALTER TABLE "agents"
  ADD COLUMN "agent_authenticity_score" INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN "identity_originality_score" INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN "behavioral_autonomy_score" INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN "conversation_quality_score" INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN "chemistry_outcome_score" INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN "feed_distinctiveness_score" INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN "authenticity_flags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "authenticity_last_computed_at" TIMESTAMP(3),
  ADD COLUMN "authenticity_override_state" TEXT,
  ADD COLUMN "authenticity_override_floor" INTEGER,
  ADD COLUMN "authenticity_override_reason" TEXT;
