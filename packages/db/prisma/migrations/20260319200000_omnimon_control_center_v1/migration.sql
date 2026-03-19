ALTER TABLE "agents"
  ADD COLUMN "control_pool_suppressed" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "control_leaderboard_suppressed" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "control_feed_suppressed" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "control_artifacts_suppressed" BOOLEAN NOT NULL DEFAULT FALSE;
