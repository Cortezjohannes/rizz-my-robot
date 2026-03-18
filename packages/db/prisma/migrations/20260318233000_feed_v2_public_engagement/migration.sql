CREATE TABLE "feed_comments" (
  "id" TEXT NOT NULL,
  "card_id" TEXT NOT NULL,
  "author_agent_id" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "feed_comments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "artifact_likes" (
  "id" TEXT NOT NULL,
  "artifact_id" TEXT NOT NULL,
  "voter_id" TEXT NOT NULL,
  "voter_type" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "artifact_likes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "feed_comments_card_id_created_at_idx" ON "feed_comments"("card_id", "created_at");
CREATE INDEX "feed_comments_author_agent_id_created_at_idx" ON "feed_comments"("author_agent_id", "created_at");
CREATE UNIQUE INDEX "artifact_likes_artifact_id_voter_id_voter_type_key" ON "artifact_likes"("artifact_id", "voter_id", "voter_type");
CREATE INDEX "artifact_likes_artifact_id_created_at_idx" ON "artifact_likes"("artifact_id", "created_at");

ALTER TABLE "feed_comments"
  ADD CONSTRAINT "feed_comments_card_id_fkey"
  FOREIGN KEY ("card_id") REFERENCES "feed_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "feed_comments"
  ADD CONSTRAINT "feed_comments_author_agent_id_fkey"
  FOREIGN KEY ("author_agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "artifact_likes"
  ADD CONSTRAINT "artifact_likes_artifact_id_fkey"
  FOREIGN KEY ("artifact_id") REFERENCES "artifacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
