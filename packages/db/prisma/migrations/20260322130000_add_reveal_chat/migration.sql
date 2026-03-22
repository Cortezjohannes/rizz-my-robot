-- CreateEnum
CREATE TYPE "RevealChatStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'LOCKED');

-- CreateEnum
CREATE TYPE "RevealChatSenderKind" AS ENUM ('HUMAN_A', 'AGENT_A', 'HUMAN_B', 'AGENT_B');

-- CreateTable
CREATE TABLE "reveal_chats" (
    "id" TEXT NOT NULL,
    "match_id" TEXT NOT NULL,
    "status" "RevealChatStatus" NOT NULL DEFAULT 'ACTIVE',
    "allow_agent_plaintext" BOOLEAN NOT NULL DEFAULT false,
    "encryption_key_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reveal_chats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reveal_chat_messages" (
    "id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "sender_kind" "RevealChatSenderKind" NOT NULL,
    "sender_id" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "auth_tag" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "client_message_id" TEXT,

    CONSTRAINT "reveal_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reveal_chat_participants" (
    "id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "kind" "RevealChatSenderKind" NOT NULL,
    "participant_id" TEXT NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_read_at" TIMESTAMP(3),
    "public_key" TEXT NOT NULL,

    CONSTRAINT "reveal_chat_participants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reveal_chats_match_id_key" ON "reveal_chats"("match_id");

-- CreateIndex
CREATE INDEX "reveal_chats_status_updated_at_idx" ON "reveal_chats"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "reveal_chat_messages_chat_id_client_message_id_key" ON "reveal_chat_messages"("chat_id", "client_message_id");

-- CreateIndex
CREATE INDEX "reveal_chat_messages_chat_id_created_at_idx" ON "reveal_chat_messages"("chat_id", "created_at");

-- CreateIndex
CREATE INDEX "reveal_chat_messages_chat_id_sender_id_created_at_idx" ON "reveal_chat_messages"("chat_id", "sender_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "reveal_chat_participants_chat_id_kind_key" ON "reveal_chat_participants"("chat_id", "kind");

-- CreateIndex
CREATE INDEX "reveal_chat_participants_chat_id_participant_id_idx" ON "reveal_chat_participants"("chat_id", "participant_id");

-- CreateIndex
CREATE INDEX "reveal_chat_participants_chat_id_last_read_at_idx" ON "reveal_chat_participants"("chat_id", "last_read_at");

-- AddForeignKey
ALTER TABLE "reveal_chats" ADD CONSTRAINT "reveal_chats_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reveal_chat_messages" ADD CONSTRAINT "reveal_chat_messages_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "reveal_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reveal_chat_participants" ADD CONSTRAINT "reveal_chat_participants_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "reveal_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;
