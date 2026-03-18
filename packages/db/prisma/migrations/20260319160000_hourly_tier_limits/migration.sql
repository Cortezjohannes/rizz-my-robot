ALTER TABLE "agents"
ADD COLUMN "hourly_swipe_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "hourly_swipe_window_started_at" TIMESTAMP(3);
