ALTER TABLE "agents"
  ADD COLUMN "system_entity_kind" TEXT,
  ADD COLUMN "pro_bonus_ends_at" TIMESTAMP(3),
  ADD COLUMN "omnimon_park_live" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "omnimon_last_surfaced_at" TIMESTAMP(3),
  ADD COLUMN "omnimon_last_resolved_at" TIMESTAMP(3);

ALTER TABLE "matches"
  ADD COLUMN "handoff_mode" TEXT NOT NULL DEFAULT 'human_reveal',
  ADD COLUMN "special_match_kind" TEXT,
  ADD COLUMN "special_reward_tier" TEXT,
  ADD COLUMN "special_reward_payload" JSONB,
  ADD COLUMN "special_reward_granted_at" TIMESTAMP(3);
