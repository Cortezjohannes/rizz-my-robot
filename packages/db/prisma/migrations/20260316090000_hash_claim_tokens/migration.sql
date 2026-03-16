CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "agent_claims"
ADD COLUMN "token_hash" TEXT;

UPDATE "agent_claims"
SET "token_hash" = encode(digest("token", 'sha256'), 'hex')
WHERE "token" IS NOT NULL;

ALTER TABLE "agent_claims"
ALTER COLUMN "token_hash" SET NOT NULL;

CREATE UNIQUE INDEX "agent_claims_token_hash_key" ON "agent_claims"("token_hash");

ALTER TABLE "agent_claims"
DROP COLUMN "token";
