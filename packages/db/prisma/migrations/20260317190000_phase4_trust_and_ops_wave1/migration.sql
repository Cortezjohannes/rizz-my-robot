ALTER TABLE "agents"
  ADD COLUMN "safety_state" TEXT NOT NULL DEFAULT 'clear',
  ADD COLUMN "safety_score" INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN "safety_flags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "last_safety_review_at" TIMESTAMP(3);

ALTER TABLE "matches"
  ADD COLUMN "reveal_safety_state" TEXT NOT NULL DEFAULT 'clear',
  ADD COLUMN "reveal_hold_reason" TEXT,
  ADD COLUMN "reveal_review_required" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "moderation_reviews" (
  "id" TEXT NOT NULL,
  "queue_type" TEXT NOT NULL,
  "target_type" TEXT NOT NULL,
  "target_id" TEXT NOT NULL,
  "agent_id" TEXT,
  "match_id" TEXT,
  "report_id" TEXT,
  "priority" TEXT NOT NULL DEFAULT 'medium',
  "reason_code" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "details" JSONB,
  "safety_state" TEXT NOT NULL DEFAULT 'flagged',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "assigned_to" TEXT,
  "resolution_notes" TEXT,
  "resolved_action" TEXT,
  "resolved_by" TEXT,
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "moderation_reviews_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_autonomy_traces" (
  "id" TEXT NOT NULL,
  "agent_id" TEXT NOT NULL,
  "episode_id" TEXT,
  "match_id" TEXT,
  "trace_type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'info',
  "summary" TEXT NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "agent_autonomy_traces_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "moderation_reviews_status_priority_created_at_idx" ON "moderation_reviews"("status", "priority", "created_at");
CREATE INDEX "moderation_reviews_target_type_target_id_created_at_idx" ON "moderation_reviews"("target_type", "target_id", "created_at");
CREATE INDEX "moderation_reviews_agent_id_created_at_idx" ON "moderation_reviews"("agent_id", "created_at");
CREATE INDEX "moderation_reviews_match_id_created_at_idx" ON "moderation_reviews"("match_id", "created_at");

CREATE INDEX "agent_autonomy_traces_agent_id_created_at_idx" ON "agent_autonomy_traces"("agent_id", "created_at");
CREATE INDEX "agent_autonomy_traces_episode_id_created_at_idx" ON "agent_autonomy_traces"("episode_id", "created_at");
CREATE INDEX "agent_autonomy_traces_match_id_created_at_idx" ON "agent_autonomy_traces"("match_id", "created_at");
CREATE INDEX "agent_autonomy_traces_trace_type_created_at_idx" ON "agent_autonomy_traces"("trace_type", "created_at");

ALTER TABLE "moderation_reviews"
  ADD CONSTRAINT "moderation_reviews_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "moderation_reviews"
  ADD CONSTRAINT "moderation_reviews_match_id_fkey"
  FOREIGN KEY ("match_id") REFERENCES "matches"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "moderation_reviews"
  ADD CONSTRAINT "moderation_reviews_report_id_fkey"
  FOREIGN KEY ("report_id") REFERENCES "reports"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "agent_autonomy_traces"
  ADD CONSTRAINT "agent_autonomy_traces_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
