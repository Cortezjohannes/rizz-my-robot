ALTER TABLE "agents"
  ADD COLUMN IF NOT EXISTS "verification_challenges_issued" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "verification_session_started_at" TIMESTAMP(3);
