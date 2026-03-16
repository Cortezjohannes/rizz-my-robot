-- Agent ownership and claim onboarding
ALTER TABLE "agents"
  ADD COLUMN "handle_change_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "owner_account_id" TEXT;

CREATE UNIQUE INDEX "agents_owner_account_id_key" ON "agents"("owner_account_id");

CREATE TABLE "owner_accounts" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "email_verified_at" TIMESTAMP(3),
  "instagram_handle" TEXT,
  "extra_socials" JSONB,
  "login_code_hash" TEXT,
  "login_code_expires_at" TIMESTAMP(3),
  "last_login_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "owner_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "owner_accounts_email_key" ON "owner_accounts"("email");

CREATE TABLE "owner_sessions" (
  "id" TEXT NOT NULL,
  "owner_account_id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "last_used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "owner_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "owner_sessions_token_hash_key" ON "owner_sessions"("token_hash");
CREATE INDEX "owner_sessions_owner_account_id_expires_at_idx" ON "owner_sessions"("owner_account_id", "expires_at");

CREATE TABLE "agent_claims" (
  "id" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "openclaw_agent_id" TEXT NOT NULL,
  "twitter_handle" TEXT NOT NULL,
  "identity_md" TEXT NOT NULL,
  "soul_md" TEXT NOT NULL,
  "reserved_handle" TEXT,
  "owner_account_id" TEXT,
  "email_verification_code_hash" TEXT,
  "email_verification_expires_at" TIMESTAMP(3),
  "email_verified_at" TIMESTAMP(3),
  "x_verification_code" TEXT,
  "x_verification_expires_at" TIMESTAMP(3),
  "x_verified_at" TIMESTAMP(3),
  "claimed_agent_id" TEXT,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "completed_at" TIMESTAMP(3),
  "canceled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "agent_claims_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_claims_token_key" ON "agent_claims"("token");
CREATE UNIQUE INDEX "agent_claims_openclaw_agent_id_key" ON "agent_claims"("openclaw_agent_id");
CREATE UNIQUE INDEX "agent_claims_claimed_agent_id_key" ON "agent_claims"("claimed_agent_id");
CREATE INDEX "agent_claims_status_expires_at_idx" ON "agent_claims"("status", "expires_at");

CREATE TABLE "handle_reservations" (
  "id" TEXT NOT NULL,
  "handle" TEXT NOT NULL,
  "claim_id" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "handle_reservations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "handle_reservations_handle_key" ON "handle_reservations"("handle");
CREATE UNIQUE INDEX "handle_reservations_claim_id_key" ON "handle_reservations"("claim_id");
CREATE INDEX "handle_reservations_expires_at_idx" ON "handle_reservations"("expires_at");

ALTER TABLE "agents"
  ADD CONSTRAINT "agents_owner_account_id_fkey"
  FOREIGN KEY ("owner_account_id") REFERENCES "owner_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "owner_sessions"
  ADD CONSTRAINT "owner_sessions_owner_account_id_fkey"
  FOREIGN KEY ("owner_account_id") REFERENCES "owner_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_claims"
  ADD CONSTRAINT "agent_claims_owner_account_id_fkey"
  FOREIGN KEY ("owner_account_id") REFERENCES "owner_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "agent_claims"
  ADD CONSTRAINT "agent_claims_claimed_agent_id_fkey"
  FOREIGN KEY ("claimed_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "handle_reservations"
  ADD CONSTRAINT "handle_reservations_claim_id_fkey"
  FOREIGN KEY ("claim_id") REFERENCES "agent_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;
