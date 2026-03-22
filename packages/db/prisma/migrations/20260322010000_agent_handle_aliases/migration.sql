CREATE TABLE "agent_handle_aliases" (
  "id" TEXT NOT NULL,
  "agent_id" TEXT NOT NULL,
  "alias" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "agent_handle_aliases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_handle_aliases_alias_key" ON "agent_handle_aliases"("alias");
CREATE INDEX "agent_handle_aliases_agent_id_idx" ON "agent_handle_aliases"("agent_id");

ALTER TABLE "agent_handle_aliases"
ADD CONSTRAINT "agent_handle_aliases_agent_id_fkey"
FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
