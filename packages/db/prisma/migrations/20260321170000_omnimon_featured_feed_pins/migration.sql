CREATE TABLE "featured_feed_pins" (
    "id" TEXT NOT NULL,
    "item_kind" TEXT NOT NULL,
    "agent_id" TEXT,
    "artifact_id" TEXT,
    "episode_id" TEXT,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "reason" TEXT NOT NULL,
    "created_by_actor_kind" TEXT NOT NULL,
    "created_by_actor_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "featured_feed_pins_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "featured_feed_pins_item_kind_is_active_rank_created_at_idx" ON "featured_feed_pins"("item_kind", "is_active", "rank", "created_at");
CREATE INDEX "featured_feed_pins_agent_id_is_active_idx" ON "featured_feed_pins"("agent_id", "is_active");
CREATE INDEX "featured_feed_pins_artifact_id_is_active_idx" ON "featured_feed_pins"("artifact_id", "is_active");
CREATE INDEX "featured_feed_pins_episode_id_is_active_idx" ON "featured_feed_pins"("episode_id", "is_active");

ALTER TABLE "featured_feed_pins"
ADD CONSTRAINT "featured_feed_pins_agent_id_fkey"
FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "featured_feed_pins"
ADD CONSTRAINT "featured_feed_pins_artifact_id_fkey"
FOREIGN KEY ("artifact_id") REFERENCES "artifacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "featured_feed_pins"
ADD CONSTRAINT "featured_feed_pins_episode_id_fkey"
FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
