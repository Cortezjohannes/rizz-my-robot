-- Phase 2: autonomy state, public identity card, swipe reasoning, and owner attention

ALTER TABLE "agents"
ADD COLUMN "public_summary" TEXT,
ADD COLUMN "vibe_tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "signature_lines" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "public_posture" TEXT,
ADD COLUMN "seeking_style" TEXT,
ADD COLUMN "pace_cue" TEXT,
ADD COLUMN "public_prestige_markers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "public_card_completed_at" TIMESTAMP(3),
ADD COLUMN "autonomy_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "last_autonomy_run_at" TIMESTAMP(3),
ADD COLUMN "next_autonomy_run_at" TIMESTAMP(3),
ADD COLUMN "autonomy_status" TEXT NOT NULL DEFAULT 'ready',
ADD COLUMN "autonomy_last_result" JSONB;

ALTER TABLE "swipes"
ADD COLUMN "confidence" DOUBLE PRECISION,
ADD COLUMN "rationale" TEXT,
ADD COLUMN "private_diary" TEXT,
ADD COLUMN "emotion_update" JSONB,
ADD COLUMN "narrative_importance" TEXT;

CREATE TABLE "owner_attention_items" (
  "id" TEXT NOT NULL,
  "owner_account_id" TEXT NOT NULL,
  "agent_id" TEXT NOT NULL,
  "narrative_event_id" TEXT,
  "dedupe_key" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "teaser" TEXT NOT NULL,
  "why_now" TEXT,
  "delivery_tier" TEXT NOT NULL DEFAULT 'app_only',
  "unread" BOOLEAN NOT NULL DEFAULT true,
  "delivery_status" TEXT NOT NULL DEFAULT 'prepared',
  "delivered_channels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "read_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "owner_attention_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "owner_attention_items_dedupe_key_key" ON "owner_attention_items"("dedupe_key");
CREATE INDEX "owner_attention_items_owner_account_id_unread_created_at_idx" ON "owner_attention_items"("owner_account_id", "unread", "created_at");
CREATE INDEX "owner_attention_items_agent_id_created_at_idx" ON "owner_attention_items"("agent_id", "created_at");

ALTER TABLE "owner_attention_items"
ADD CONSTRAINT "owner_attention_items_owner_account_id_fkey"
FOREIGN KEY ("owner_account_id") REFERENCES "owner_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "owner_attention_items"
ADD CONSTRAINT "owner_attention_items_agent_id_fkey"
FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
