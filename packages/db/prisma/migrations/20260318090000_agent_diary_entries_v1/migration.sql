-- CreateTable
CREATE TABLE "agent_diary_entries" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "narrative_event_id" TEXT,
    "counterpart_agent_id" TEXT,
    "episode_id" TEXT,
    "match_id" TEXT,
    "artifact_id" TEXT,
    "source_event_type" TEXT,
    "trigger_label" TEXT,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "mood_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "emotion_summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_diary_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_diary_entries_narrative_event_id_key" ON "agent_diary_entries"("narrative_event_id");

-- CreateIndex
CREATE INDEX "agent_diary_entries_agent_id_created_at_idx" ON "agent_diary_entries"("agent_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_diary_entries_episode_id_created_at_idx" ON "agent_diary_entries"("episode_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_diary_entries_match_id_created_at_idx" ON "agent_diary_entries"("match_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_diary_entries_artifact_id_created_at_idx" ON "agent_diary_entries"("artifact_id", "created_at");

-- AddForeignKey
ALTER TABLE "agent_diary_entries" ADD CONSTRAINT "agent_diary_entries_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_diary_entries" ADD CONSTRAINT "agent_diary_entries_narrative_event_id_fkey" FOREIGN KEY ("narrative_event_id") REFERENCES "narrative_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_diary_entries" ADD CONSTRAINT "agent_diary_entries_counterpart_agent_id_fkey" FOREIGN KEY ("counterpart_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_diary_entries" ADD CONSTRAINT "agent_diary_entries_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_diary_entries" ADD CONSTRAINT "agent_diary_entries_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_diary_entries" ADD CONSTRAINT "agent_diary_entries_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "artifacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill only truly agent-authored narrative rows into the new diary table.
INSERT INTO "agent_diary_entries" (
    "id",
    "agent_id",
    "narrative_event_id",
    "counterpart_agent_id",
    "episode_id",
    "match_id",
    "artifact_id",
    "source_event_type",
    "title",
    "body",
    "mood_tags",
    "emotion_summary",
    "created_at",
    "updated_at"
)
SELECT
    "id",
    "agent_id",
    "id",
    "counterpart_agent_id",
    "episode_id",
    "match_id",
    "artifact_id",
    COALESCE("metadata"->>'source_turn_event_type', "event_type"),
    "title",
    "body",
    ARRAY[]::TEXT[],
    CASE
      WHEN jsonb_typeof("metadata"->'emotion_update') = 'object'
      THEN NULLIF("metadata"->'emotion_update'->>'summary', '')
      ELSE NULL
    END,
    "created_at",
    "created_at"
FROM "narrative_events"
WHERE COALESCE("metadata"->>'generation_mode', '') = 'agent_authored';
