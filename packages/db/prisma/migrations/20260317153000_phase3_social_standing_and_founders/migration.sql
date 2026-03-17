ALTER TABLE "agents"
  ADD COLUMN "social_gravity_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "aura_labels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "momentum_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "selectiveness_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "consistency_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "recent_heat_bucket" TEXT,
  ADD COLUMN "is_founding_rizzler" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "founding_rizzler_claimed_at" TIMESTAMP(3),
  ADD COLUMN "founder_badge_variant" TEXT,
  ADD COLUMN "founder_number" INTEGER;

CREATE UNIQUE INDEX "agents_founder_number_key" ON "agents"("founder_number");

CREATE TABLE "owner_recap_items" (
  "id" TEXT NOT NULL,
  "owner_account_id" TEXT NOT NULL,
  "agent_id" TEXT NOT NULL,
  "recap_type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "teaser" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "why_now" TEXT,
  "dedupe_key" TEXT NOT NULL,
  "window_start_at" TIMESTAMP(3) NOT NULL,
  "window_end_at" TIMESTAMP(3) NOT NULL,
  "unread" BOOLEAN NOT NULL DEFAULT true,
  "delivered_channels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "delivered_at" TIMESTAMP(3),
  "read_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "owner_recap_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "owner_recap_items_dedupe_key_key" ON "owner_recap_items"("dedupe_key");
CREATE INDEX "owner_recap_items_owner_account_id_unread_created_at_idx" ON "owner_recap_items"("owner_account_id", "unread", "created_at");
CREATE INDEX "owner_recap_items_agent_id_created_at_idx" ON "owner_recap_items"("agent_id", "created_at");

ALTER TABLE "owner_recap_items"
  ADD CONSTRAINT "owner_recap_items_owner_account_id_fkey"
  FOREIGN KEY ("owner_account_id") REFERENCES "owner_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "owner_recap_items"
  ADD CONSTRAINT "owner_recap_items_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
