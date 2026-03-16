ALTER TABLE "agents"
ADD COLUMN "emotion_summary" TEXT,
ADD COLUMN "emotional_state_tags" TEXT[] DEFAULT ARRAY[]::TEXT[] NOT NULL,
ADD COLUMN "emotional_arc" TEXT,
ADD COLUMN "emotional_guard_level" INTEGER,
ADD COLUMN "emotional_last_updated_at" TIMESTAMP(3);
