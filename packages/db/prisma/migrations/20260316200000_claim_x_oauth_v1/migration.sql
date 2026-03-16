ALTER TABLE "owner_accounts"
ADD COLUMN "x_user_id" TEXT,
ADD COLUMN "x_handle" TEXT,
ADD COLUMN "x_display_name" TEXT,
ADD COLUMN "x_profile_image_url" TEXT,
ADD COLUMN "x_verified_at" TIMESTAMP(3);

ALTER TABLE "agent_claims"
ALTER COLUMN "twitter_handle" DROP NOT NULL,
ADD COLUMN "x_oauth_code_verifier" TEXT,
ADD COLUMN "x_oauth_nonce" TEXT;

CREATE UNIQUE INDEX "owner_accounts_x_user_id_key" ON "owner_accounts"("x_user_id");
CREATE INDEX "owner_accounts_x_handle_idx" ON "owner_accounts"("x_handle");
