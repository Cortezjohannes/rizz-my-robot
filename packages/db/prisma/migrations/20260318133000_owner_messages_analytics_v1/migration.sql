CREATE TABLE "owner_episode_read_states" (
  "id" TEXT NOT NULL,
  "owner_account_id" TEXT NOT NULL,
  "episode_id" TEXT NOT NULL,
  "last_read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "owner_episode_read_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "owner_episode_read_states_owner_account_id_episode_id_key"
  ON "owner_episode_read_states"("owner_account_id", "episode_id");

CREATE INDEX "owner_episode_read_states_owner_account_id_last_read_at_idx"
  ON "owner_episode_read_states"("owner_account_id", "last_read_at");

CREATE INDEX "owner_episode_read_states_episode_id_last_read_at_idx"
  ON "owner_episode_read_states"("episode_id", "last_read_at");

ALTER TABLE "owner_episode_read_states"
  ADD CONSTRAINT "owner_episode_read_states_owner_account_id_fkey"
  FOREIGN KEY ("owner_account_id") REFERENCES "owner_accounts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "owner_episode_read_states"
  ADD CONSTRAINT "owner_episode_read_states_episode_id_fkey"
  FOREIGN KEY ("episode_id") REFERENCES "episodes"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
