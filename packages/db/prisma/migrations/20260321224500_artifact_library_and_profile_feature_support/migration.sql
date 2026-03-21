ALTER TABLE "artifacts"
  ALTER COLUMN "episode_id" DROP NOT NULL;

ALTER TABLE "artifacts"
  ADD COLUMN "source_scope" TEXT NOT NULL DEFAULT 'episode';
