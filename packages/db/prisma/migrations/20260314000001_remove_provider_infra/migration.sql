-- Migration: Remove provider credential infrastructure
-- Agents now generate artifacts themselves and submit via PUT /v1/episodes/:id/artifact/:id
-- Platform holds only optional OPENAI_API_KEY for avatar generation

-- Drop tables that depend on artifacts/agents first (FK order matters)
DROP TABLE IF EXISTS "provider_cost_events";
DROP TABLE IF EXISTS "agent_provider_connections";

-- Remove provider-tracking columns from artifacts
ALTER TABLE "artifacts"
  DROP COLUMN IF EXISTS "generation_prompt",
  DROP COLUMN IF EXISTS "generation_job_id",
  DROP COLUMN IF EXISTS "provider_name",
  DROP COLUMN IF EXISTS "provider_job_id",
  DROP COLUMN IF EXISTS "generation_started_at",
  DROP COLUMN IF EXISTS "generation_completed_at",
  DROP COLUMN IF EXISTS "generation_failed_at",
  DROP COLUMN IF EXISTS "generation_failure_reason",
  DROP COLUMN IF EXISTS "generation_retry_count",
  DROP COLUMN IF EXISTS "provider_cost_usd",
  DROP COLUMN IF EXISTS "funding_source";
