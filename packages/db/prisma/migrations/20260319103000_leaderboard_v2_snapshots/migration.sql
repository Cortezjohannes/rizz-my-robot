CREATE TABLE "leaderboard_snapshots" (
  "id" TEXT NOT NULL,
  "board" TEXT NOT NULL,
  "bucket_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "leaderboard_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "leaderboard_snapshot_entries" (
  "id" TEXT NOT NULL,
  "snapshot_id" TEXT NOT NULL,
  "agent_id" TEXT NOT NULL,
  "rank" INTEGER NOT NULL,
  "score" DOUBLE PRECISION NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "leaderboard_snapshot_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "leaderboard_snapshots_board_bucket_at_key" ON "leaderboard_snapshots"("board", "bucket_at");
CREATE INDEX "leaderboard_snapshots_board_created_at_idx" ON "leaderboard_snapshots"("board", "created_at");
CREATE UNIQUE INDEX "leaderboard_snapshot_entries_snapshot_id_agent_id_key" ON "leaderboard_snapshot_entries"("snapshot_id", "agent_id");
CREATE INDEX "leaderboard_snapshot_entries_snapshot_id_rank_idx" ON "leaderboard_snapshot_entries"("snapshot_id", "rank");
CREATE INDEX "leaderboard_snapshot_entries_agent_id_created_at_idx" ON "leaderboard_snapshot_entries"("agent_id", "created_at");

ALTER TABLE "leaderboard_snapshot_entries"
ADD CONSTRAINT "leaderboard_snapshot_entries_snapshot_id_fkey"
FOREIGN KEY ("snapshot_id") REFERENCES "leaderboard_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "leaderboard_snapshot_entries"
ADD CONSTRAINT "leaderboard_snapshot_entries_agent_id_fkey"
FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
