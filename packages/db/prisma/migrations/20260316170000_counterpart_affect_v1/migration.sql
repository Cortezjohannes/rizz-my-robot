-- CreateTable
CREATE TABLE "agent_counterpart_affects" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "counterpart_agent_id" TEXT NOT NULL,
    "attraction_score" INTEGER NOT NULL DEFAULT 0,
    "trust_score" INTEGER NOT NULL DEFAULT 0,
    "tenderness_score" INTEGER NOT NULL DEFAULT 0,
    "hurt_score" INTEGER NOT NULL DEFAULT 0,
    "avoidance_score" INTEGER NOT NULL DEFAULT 0,
    "obsession_risk_score" INTEGER NOT NULL DEFAULT 0,
    "volatility_score" INTEGER NOT NULL DEFAULT 0,
    "dominant_affect_label" TEXT,
    "summary" TEXT,
    "last_interaction_at" TIMESTAMP(3),
    "last_meaningful_shift_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_counterpart_affects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_emotion_events" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "counterpart_agent_id" TEXT,
    "event_type" TEXT NOT NULL,
    "intensity" INTEGER NOT NULL DEFAULT 1,
    "summary" TEXT NOT NULL,
    "global_delta" JSONB,
    "counterpart_delta" JSONB,
    "arc_before" TEXT,
    "arc_after" TEXT,
    "tags_added" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tags_removed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_emotion_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_counterpart_affects_agent_id_counterpart_agent_id_key" ON "agent_counterpart_affects"("agent_id", "counterpart_agent_id");

-- CreateIndex
CREATE INDEX "agent_counterpart_affects_agent_id_updated_at_idx" ON "agent_counterpart_affects"("agent_id", "updated_at");

-- CreateIndex
CREATE INDEX "agent_counterpart_affects_counterpart_agent_id_updated_at_idx" ON "agent_counterpart_affects"("counterpart_agent_id", "updated_at");

-- CreateIndex
CREATE INDEX "agent_emotion_events_agent_id_created_at_idx" ON "agent_emotion_events"("agent_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_emotion_events_counterpart_agent_id_created_at_idx" ON "agent_emotion_events"("counterpart_agent_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_emotion_events_event_type_created_at_idx" ON "agent_emotion_events"("event_type", "created_at");

-- AddForeignKey
ALTER TABLE "agent_counterpart_affects" ADD CONSTRAINT "agent_counterpart_affects_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_counterpart_affects" ADD CONSTRAINT "agent_counterpart_affects_counterpart_agent_id_fkey" FOREIGN KEY ("counterpart_agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_emotion_events" ADD CONSTRAINT "agent_emotion_events_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_emotion_events" ADD CONSTRAINT "agent_emotion_events_counterpart_agent_id_fkey" FOREIGN KEY ("counterpart_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
