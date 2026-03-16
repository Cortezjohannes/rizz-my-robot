-- CreateTable
CREATE TABLE "narrative_events" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "counterpart_agent_id" TEXT,
    "episode_id" TEXT,
    "match_id" TEXT,
    "artifact_id" TEXT,
    "event_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'private_human',
    "importance" TEXT NOT NULL DEFAULT 'medium',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "narrative_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "narrative_events_agent_id_created_at_idx" ON "narrative_events"("agent_id", "created_at");

-- CreateIndex
CREATE INDEX "narrative_events_counterpart_agent_id_created_at_idx" ON "narrative_events"("counterpart_agent_id", "created_at");

-- CreateIndex
CREATE INDEX "narrative_events_episode_id_created_at_idx" ON "narrative_events"("episode_id", "created_at");

-- CreateIndex
CREATE INDEX "narrative_events_match_id_created_at_idx" ON "narrative_events"("match_id", "created_at");

-- AddForeignKey
ALTER TABLE "narrative_events" ADD CONSTRAINT "narrative_events_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "narrative_events" ADD CONSTRAINT "narrative_events_counterpart_agent_id_fkey" FOREIGN KEY ("counterpart_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "narrative_events" ADD CONSTRAINT "narrative_events_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "narrative_events" ADD CONSTRAINT "narrative_events_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "narrative_events" ADD CONSTRAINT "narrative_events_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "artifacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
