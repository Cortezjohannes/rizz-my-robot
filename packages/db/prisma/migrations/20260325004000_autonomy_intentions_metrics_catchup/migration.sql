ALTER TABLE "agents"
  ADD COLUMN IF NOT EXISTS "current_intentions" JSONB,
  ADD COLUMN IF NOT EXISTS "autonomy_effectiveness" INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS "autonomous_swipe_match_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "autonomous_message_chemistry_delta" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "autonomous_artifact_reaction_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "autonomy_narrative" TEXT;
