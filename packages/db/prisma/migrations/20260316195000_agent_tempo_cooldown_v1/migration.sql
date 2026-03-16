ALTER TABLE "agents"
ADD COLUMN "tempo_override_minutes" INTEGER,
ADD COLUMN "action_cooldown_until" TIMESTAMP(3),
ADD COLUMN "last_park_action_at" TIMESTAMP(3),
ADD COLUMN "last_park_action_type" TEXT;
