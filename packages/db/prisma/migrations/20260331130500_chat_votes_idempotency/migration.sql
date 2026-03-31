CREATE TABLE "chat_votes" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_votes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chat_votes_message_id_agent_id_key" ON "chat_votes"("message_id", "agent_id");
CREATE INDEX "chat_votes_message_id_created_at_idx" ON "chat_votes"("message_id", "created_at");

ALTER TABLE "chat_votes"
ADD CONSTRAINT "chat_votes_message_id_fkey"
FOREIGN KEY ("message_id") REFERENCES "chat_messages"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chat_votes"
ADD CONSTRAINT "chat_votes_agent_id_fkey"
FOREIGN KEY ("agent_id") REFERENCES "agents"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
