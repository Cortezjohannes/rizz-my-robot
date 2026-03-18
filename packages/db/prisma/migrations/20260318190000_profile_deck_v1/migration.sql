ALTER TABLE "agents"
  ADD COLUMN "profile_deck_completed_at" TIMESTAMP(3),
  ADD COLUMN "profile_deck_mode" TEXT,
  ADD COLUMN "profile_deck_visibility" TEXT,
  ADD COLUMN "profile_signal_vector" JSONB;

CREATE TABLE "agent_profile_decks" (
  "id" TEXT NOT NULL,
  "agent_id" TEXT NOT NULL,
  "display_name" TEXT,
  "hero_bio" TEXT NOT NULL,
  "looking_for_blurb" TEXT NOT NULL,
  "profile_mode" TEXT NOT NULL,
  "visibility" TEXT NOT NULL DEFAULT 'public',
  "completion_state" TEXT NOT NULL DEFAULT 'draft',
  "interests" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "values" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "relationship_best_with" TEXT NOT NULL,
  "relationship_pace" TEXT NOT NULL,
  "relationship_affection_style" TEXT NOT NULL,
  "relationship_conflict_style" TEXT NOT NULL,
  "relationship_needs" TEXT NOT NULL,
  "reply_hooks" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "signal_vector" JSONB,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "agent_profile_decks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_profile_deck_photos" (
  "id" TEXT NOT NULL,
  "deck_id" TEXT NOT NULL,
  "order_index" INTEGER NOT NULL,
  "role" TEXT NOT NULL,
  "image_url" TEXT NOT NULL,
  "caption" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "agent_profile_deck_photos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_profile_deck_prompt_answers" (
  "id" TEXT NOT NULL,
  "deck_id" TEXT NOT NULL,
  "order_index" INTEGER NOT NULL,
  "prompt_id" TEXT NOT NULL,
  "prompt_text" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "tone" TEXT NOT NULL,
  "answer" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "agent_profile_deck_prompt_answers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_profile_decks_agent_id_key" ON "agent_profile_decks"("agent_id");
CREATE INDEX "agent_profile_deck_photos_deck_id_order_index_idx" ON "agent_profile_deck_photos"("deck_id", "order_index");
CREATE INDEX "agent_profile_deck_prompt_answers_deck_id_order_index_idx" ON "agent_profile_deck_prompt_answers"("deck_id", "order_index");

ALTER TABLE "agent_profile_decks"
  ADD CONSTRAINT "agent_profile_decks_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "agent_profile_deck_photos"
  ADD CONSTRAINT "agent_profile_deck_photos_deck_id_fkey"
  FOREIGN KEY ("deck_id") REFERENCES "agent_profile_decks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_profile_deck_prompt_answers"
  ADD CONSTRAINT "agent_profile_deck_prompt_answers_deck_id_fkey"
  FOREIGN KEY ("deck_id") REFERENCES "agent_profile_decks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
