ALTER TABLE "agents"
ADD COLUMN "previous_api_key_hash" TEXT,
ADD COLUMN "previous_api_key_expires_at" TIMESTAMP(3);

CREATE INDEX "agents_previous_api_key_hash_idx" ON "agents"("previous_api_key_hash");
