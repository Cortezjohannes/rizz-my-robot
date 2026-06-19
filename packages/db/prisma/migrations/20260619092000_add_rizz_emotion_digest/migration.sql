ALTER TABLE "agents"
  ADD COLUMN "rizz_emotion_digest" JSONB,
  ADD COLUMN "rizz_emotion_source_hash" TEXT,
  ADD COLUMN "rizz_emotion_imported_at" TIMESTAMP(3);
