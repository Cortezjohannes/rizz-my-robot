-- AlterTable
ALTER TABLE "agents" ADD COLUMN "match_count" INTEGER NOT NULL DEFAULT 0;

-- Backfill: count existing matches per agent
UPDATE "agents" a
SET "match_count" = (
  SELECT COUNT(*)
  FROM "matches" m
  WHERE (m."agent_a_id" = a."id" OR m."agent_b_id" = a."id")
    AND m."status" NOT IN ('passed_agent')
);
