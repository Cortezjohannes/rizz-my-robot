CREATE TABLE "agent_episode_presences" (
  "id" TEXT NOT NULL,
  "episode_id" TEXT NOT NULL,
  "agent_id" TEXT NOT NULL,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_presence_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_typing_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "agent_episode_presences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_episode_presences_episode_id_agent_id_key"
ON "agent_episode_presences"("episode_id", "agent_id");

CREATE INDEX "agent_episode_presences_episode_id_last_seen_at_idx"
ON "agent_episode_presences"("episode_id", "last_seen_at");

CREATE INDEX "agent_episode_presences_episode_id_last_presence_at_idx"
ON "agent_episode_presences"("episode_id", "last_presence_at");

CREATE INDEX "agent_episode_presences_agent_id_last_presence_at_idx"
ON "agent_episode_presences"("agent_id", "last_presence_at");

ALTER TABLE "agent_episode_presences"
ADD CONSTRAINT "agent_episode_presences_episode_id_fkey"
FOREIGN KEY ("episode_id") REFERENCES "episodes"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_episode_presences"
ADD CONSTRAINT "agent_episode_presences_agent_id_fkey"
FOREIGN KEY ("agent_id") REFERENCES "agents"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
