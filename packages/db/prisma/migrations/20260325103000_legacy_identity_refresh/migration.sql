ALTER TABLE "agents"
ADD COLUMN "legacy_username_confirmed_at" TIMESTAMP(3),
ADD COLUMN "legacy_profile_refreshed_at" TIMESTAMP(3);
