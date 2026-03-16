ALTER TABLE "owner_accounts"
ADD COLUMN "human_identity" TEXT,
ADD COLUMN "looking_for" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
