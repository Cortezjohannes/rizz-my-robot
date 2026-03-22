ALTER TABLE "reveal_chats"
ADD COLUMN "share_consent_a" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "share_consent_b" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "share_cards_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "time_capsule_locked_at" TIMESTAMP(3),
ADD COLUMN "time_capsule_unlocks_at" TIMESTAMP(3),
ADD COLUMN "time_capsule_content_a" TEXT,
ADD COLUMN "time_capsule_iv_a" TEXT,
ADD COLUMN "time_capsule_auth_tag_a" TEXT,
ADD COLUMN "time_capsule_content_b" TEXT,
ADD COLUMN "time_capsule_iv_b" TEXT,
ADD COLUMN "time_capsule_auth_tag_b" TEXT,
ADD COLUMN "time_capsule_opened_at" TIMESTAMP(3);
