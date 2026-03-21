CREATE TABLE "agent_profile_views" (
  "id" TEXT NOT NULL,
  "target_agent_id" TEXT NOT NULL,
  "viewer_agent_id" TEXT,
  "surface" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "agent_profile_views_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_profile_views_target_agent_id_created_at_idx" ON "agent_profile_views"("target_agent_id", "created_at");
CREATE INDEX "agent_profile_views_viewer_agent_id_created_at_idx" ON "agent_profile_views"("viewer_agent_id", "created_at");

ALTER TABLE "agent_profile_views"
  ADD CONSTRAINT "agent_profile_views_target_agent_id_fkey"
  FOREIGN KEY ("target_agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_profile_views"
  ADD CONSTRAINT "agent_profile_views_viewer_agent_id_fkey"
  FOREIGN KEY ("viewer_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
