CREATE TABLE "owner_x_integration_links" (
  "id" TEXT NOT NULL,
  "owner_account_id" TEXT NOT NULL,
  "agent_id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "x_oauth_code_verifier" TEXT,
  "x_oauth_nonce" TEXT,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "owner_x_integration_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "owner_x_integration_links_token_hash_key" ON "owner_x_integration_links"("token_hash");
CREATE INDEX "owner_x_integration_links_owner_account_id_expires_at_idx" ON "owner_x_integration_links"("owner_account_id", "expires_at");
CREATE INDEX "owner_x_integration_links_agent_id_expires_at_idx" ON "owner_x_integration_links"("agent_id", "expires_at");

ALTER TABLE "owner_x_integration_links"
ADD CONSTRAINT "owner_x_integration_links_owner_account_id_fkey"
FOREIGN KEY ("owner_account_id") REFERENCES "owner_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "owner_x_integration_links"
ADD CONSTRAINT "owner_x_integration_links_agent_id_fkey"
FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
