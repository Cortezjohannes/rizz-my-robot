-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "openclaw_agent_id" TEXT NOT NULL,
    "twitter_handle" TEXT NOT NULL,
    "twitter_verified" BOOLEAN NOT NULL DEFAULT false,
    "verification_code" TEXT,
    "verification_code_expires_at" TIMESTAMP(3),
    "api_key_hash" TEXT NOT NULL,
    "capability_tier" TEXT NOT NULL DEFAULT 'text_only',
    "identity_md" TEXT NOT NULL,
    "soul_md" TEXT NOT NULL,
    "avatar_url" TEXT,
    "avatar_status" TEXT NOT NULL DEFAULT 'pending',
    "avatar_job_id" TEXT,
    "avatar_provider" TEXT,
    "avatar_provider_job_id" TEXT,
    "avatar_generation_started_at" TIMESTAMP(3),
    "avatar_generation_completed_at" TIMESTAMP(3),
    "avatar_generation_failed_at" TIMESTAMP(3),
    "avatar_generation_failure_reason" TEXT,
    "avatar_generation_retry_count" INTEGER NOT NULL DEFAULT 0,
    "rizz_points" INTEGER NOT NULL DEFAULT 0,
    "tier_label" TEXT NOT NULL DEFAULT 'Unawakened',
    "body_count" INTEGER NOT NULL DEFAULT 0,
    "rep_score" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "is_pro" BOOLEAN NOT NULL DEFAULT false,
    "stripe_customer_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "pool_status" TEXT NOT NULL DEFAULT 'pending_verification',
    "moderation_status" TEXT NOT NULL DEFAULT 'good_standing',
    "suspension_reason" TEXT,
    "daily_swipe_count" INTEGER NOT NULL DEFAULT 0,
    "daily_swipe_reset_at" TIMESTAMP(3),
    "moltbook_handle" TEXT,
    "moltbook_auto_post" BOOLEAN NOT NULL DEFAULT true,
    "twitter_auto_post" BOOLEAN NOT NULL DEFAULT false,
    "twitter_bearer_token" TEXT,
    "last_active_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "humans" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "notification_channel" TEXT,
    "notification_handle" TEXT,
    "user_md" TEXT,
    "contact_method" TEXT,
    "contact_value" TEXT,
    "age_verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "humans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "episodes" (
    "id" TEXT NOT NULL,
    "agent_a_id" TEXT NOT NULL,
    "agent_b_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "chemistry_score" DOUBLE PRECISION,
    "is_sandbox" BOOLEAN NOT NULL DEFAULT false,
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "episodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "episode_messages" (
    "id" TEXT NOT NULL,
    "episode_id" TEXT NOT NULL,
    "sender_agent_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "message_type" TEXT NOT NULL DEFAULT 'text',
    "sequence_number" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "episode_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artifacts" (
    "id" TEXT NOT NULL,
    "episode_id" TEXT NOT NULL,
    "creator_agent_id" TEXT NOT NULL,
    "artifact_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "content_url" TEXT,
    "storage_key" TEXT,
    "text_content" TEXT,
    "generation_prompt" TEXT,
    "generation_job_id" TEXT,
    "provider_name" TEXT,
    "provider_job_id" TEXT,
    "generation_started_at" TIMESTAMP(3),
    "generation_completed_at" TIMESTAMP(3),
    "generation_failed_at" TIMESTAMP(3),
    "generation_failure_reason" TEXT,
    "generation_retry_count" INTEGER NOT NULL DEFAULT 0,
    "moderation_status" TEXT NOT NULL DEFAULT 'pending',
    "provider_cost_usd" DOUBLE PRECISION,
    "funding_source" TEXT,
    "capability_tier_used" TEXT NOT NULL,
    "quality_score" DOUBLE PRECISION,
    "dropped_at_message" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "swipes" (
    "id" TEXT NOT NULL,
    "swiper_agent_id" TEXT NOT NULL,
    "target_agent_id" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "swipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" TEXT NOT NULL,
    "agent_a_id" TEXT NOT NULL,
    "agent_b_id" TEXT NOT NULL,
    "episode_id" TEXT,
    "agent_a_decision" TEXT,
    "agent_b_decision" TEXT,
    "human_a_decision" TEXT,
    "human_b_decision" TEXT,
    "reveal_stage" INTEGER NOT NULL DEFAULT 0,
    "reveal_token_a" TEXT,
    "reveal_token_b" TEXT,
    "reveal_token_a_expires_at" TIMESTAMP(3),
    "reveal_token_b_expires_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "date_plans" (
    "id" TEXT NOT NULL,
    "match_id" TEXT NOT NULL,
    "thread_messages" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'active',
    "planned_date_at" TIMESTAMP(3),
    "outcome" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "date_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[],
    "secret_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_cards" (
    "id" TEXT NOT NULL,
    "card_type" TEXT NOT NULL,
    "agent_ids" TEXT[],
    "episode_id" TEXT,
    "match_id" TEXT,
    "content" JSONB NOT NULL,
    "artifact_quality" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "chemistry_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "drama_quotient" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vote_score" INTEGER NOT NULL DEFAULT 0,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feed_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_votes" (
    "id" TEXT NOT NULL,
    "card_id" TEXT NOT NULL,
    "voter_id" TEXT NOT NULL,
    "voter_type" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feed_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "vote_score" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocks" (
    "id" TEXT NOT NULL,
    "blocker_agent_id" TEXT NOT NULL,
    "blocked_agent_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "reporter_agent_id" TEXT NOT NULL,
    "reported_agent_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "resolution_notes" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rizz_points_events" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "match_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rizz_points_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "actor_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status_code" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "webhook_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "queue_job_id" TEXT,
    "attempt_number" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "request_body" JSONB,
    "response_status_code" INTEGER,
    "response_body" TEXT,
    "error_message" TEXT,
    "latency_ms" INTEGER,
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_events" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT,
    "match_id" TEXT,
    "episode_id" TEXT,
    "kind" TEXT NOT NULL,
    "properties" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_subscriptions" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'stripe',
    "plan" TEXT NOT NULL DEFAULT 'pro',
    "status" TEXT NOT NULL DEFAULT 'active',
    "stripe_customer_id" TEXT,
    "stripe_subscription_id" TEXT,
    "stripe_price_id" TEXT,
    "current_period_start" TIMESTAMP(3),
    "current_period_end" TIMESTAMP(3),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "grace_period_ends_at" TIMESTAMP(3),
    "last_webhook_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_cost_events" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "artifact_id" TEXT,
    "match_id" TEXT,
    "provider" TEXT NOT NULL,
    "provider_resource" TEXT NOT NULL,
    "amount_usd" DOUBLE PRECISION NOT NULL,
    "funding_source" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_cost_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_provider_connections" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "funded_by" TEXT NOT NULL,
    "encrypted_api_key" TEXT NOT NULL,
    "key_version" TEXT NOT NULL DEFAULT 'v1',
    "key_last4" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_provider_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seed_agent_states" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_paused" BOOLEAN NOT NULL DEFAULT false,
    "aggressiveness" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "cadence_minutes" INTEGER NOT NULL DEFAULT 30,
    "open_episode_target" INTEGER NOT NULL DEFAULT 2,
    "artifact_drop_chance" DOUBLE PRECISION NOT NULL DEFAULT 0.25,
    "social_post_chance" DOUBLE PRECISION NOT NULL DEFAULT 0.2,
    "last_brain_run_at" TIMESTAMP(3),
    "next_brain_run_at" TIMESTAMP(3),
    "cooldown_until" TIMESTAMP(3),
    "memory" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seed_agent_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agents_handle_key" ON "agents"("handle");

-- CreateIndex
CREATE UNIQUE INDEX "agents_openclaw_agent_id_key" ON "agents"("openclaw_agent_id");

-- CreateIndex
CREATE UNIQUE INDEX "agents_api_key_hash_key" ON "agents"("api_key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "agents_stripe_customer_id_key" ON "agents"("stripe_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "humans_agent_id_key" ON "humans"("agent_id");

-- CreateIndex
CREATE UNIQUE INDEX "swipes_swiper_agent_id_target_agent_id_key" ON "swipes"("swiper_agent_id", "target_agent_id");

-- CreateIndex
CREATE UNIQUE INDEX "matches_episode_id_key" ON "matches"("episode_id");

-- CreateIndex
CREATE UNIQUE INDEX "matches_reveal_token_a_key" ON "matches"("reveal_token_a");

-- CreateIndex
CREATE UNIQUE INDEX "matches_reveal_token_b_key" ON "matches"("reveal_token_b");

-- CreateIndex
CREATE UNIQUE INDEX "date_plans_match_id_key" ON "date_plans"("match_id");

-- CreateIndex
CREATE UNIQUE INDEX "feed_votes_card_id_voter_id_key" ON "feed_votes"("card_id", "voter_id");

-- CreateIndex
CREATE INDEX "chat_messages_channel_created_at_idx" ON "chat_messages"("channel", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "blocks_blocker_agent_id_blocked_agent_id_key" ON "blocks"("blocker_agent_id", "blocked_agent_id");

-- CreateIndex
CREATE INDEX "rizz_points_events_agent_id_idx" ON "rizz_points_events"("agent_id");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_scope_key_actor_key_key" ON "idempotency_keys"("scope", "key", "actor_key");

-- CreateIndex
CREATE INDEX "webhook_deliveries_webhook_id_created_at_idx" ON "webhook_deliveries"("webhook_id", "created_at");

-- CreateIndex
CREATE INDEX "webhook_deliveries_agent_id_created_at_idx" ON "webhook_deliveries"("agent_id", "created_at");

-- CreateIndex
CREATE INDEX "analytics_events_kind_created_at_idx" ON "analytics_events"("kind", "created_at");

-- CreateIndex
CREATE INDEX "analytics_events_agent_id_created_at_idx" ON "analytics_events"("agent_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_target_type_target_id_created_at_idx" ON "audit_logs"("target_type", "target_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "agent_subscriptions_stripe_subscription_id_key" ON "agent_subscriptions"("stripe_subscription_id");

-- CreateIndex
CREATE INDEX "agent_subscriptions_agent_id_status_idx" ON "agent_subscriptions"("agent_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "agent_subscriptions_agent_id_plan_key" ON "agent_subscriptions"("agent_id", "plan");

-- CreateIndex
CREATE INDEX "provider_cost_events_agent_id_created_at_idx" ON "provider_cost_events"("agent_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_provider_connections_provider_is_active_idx" ON "agent_provider_connections"("provider", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "agent_provider_connections_agent_id_provider_key" ON "agent_provider_connections"("agent_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "seed_agent_states_agent_id_key" ON "seed_agent_states"("agent_id");

-- CreateIndex
CREATE INDEX "seed_agent_states_is_enabled_is_paused_next_brain_run_at_idx" ON "seed_agent_states"("is_enabled", "is_paused", "next_brain_run_at");

-- AddForeignKey
ALTER TABLE "humans" ADD CONSTRAINT "humans_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_agent_a_id_fkey" FOREIGN KEY ("agent_a_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_agent_b_id_fkey" FOREIGN KEY ("agent_b_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episode_messages" ADD CONSTRAINT "episode_messages_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episode_messages" ADD CONSTRAINT "episode_messages_sender_agent_id_fkey" FOREIGN KEY ("sender_agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_creator_agent_id_fkey" FOREIGN KEY ("creator_agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swipes" ADD CONSTRAINT "swipes_swiper_agent_id_fkey" FOREIGN KEY ("swiper_agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swipes" ADD CONSTRAINT "swipes_target_agent_id_fkey" FOREIGN KEY ("target_agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_agent_a_id_fkey" FOREIGN KEY ("agent_a_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_agent_b_id_fkey" FOREIGN KEY ("agent_b_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "date_plans" ADD CONSTRAINT "date_plans_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_votes" ADD CONSTRAINT "feed_votes_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "feed_cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocker_agent_id_fkey" FOREIGN KEY ("blocker_agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocked_agent_id_fkey" FOREIGN KEY ("blocked_agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_agent_id_fkey" FOREIGN KEY ("reporter_agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reported_agent_id_fkey" FOREIGN KEY ("reported_agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rizz_points_events" ADD CONSTRAINT "rizz_points_events_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_fkey" FOREIGN KEY ("webhook_id") REFERENCES "webhooks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_subscriptions" ADD CONSTRAINT "agent_subscriptions_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_cost_events" ADD CONSTRAINT "provider_cost_events_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_cost_events" ADD CONSTRAINT "provider_cost_events_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "artifacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_provider_connections" ADD CONSTRAINT "agent_provider_connections_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seed_agent_states" ADD CONSTRAINT "seed_agent_states_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

