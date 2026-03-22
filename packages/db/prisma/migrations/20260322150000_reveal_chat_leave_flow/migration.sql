-- CreateEnum
CREATE TYPE "RevealChatLeaveReason" AS ENUM ('HUMAN_INITIATED', 'AGENT_FOLLOWED', 'CHAT_ENDED', 'TIMEOUT');

-- CreateEnum
CREATE TYPE "RevealChatEndReason" AS ENUM ('BOTH_HUMANS_LEFT', 'OPERATOR_CLOSED', 'TIMEOUT');

-- AlterTable
ALTER TABLE "reveal_chats"
ADD COLUMN "ended_at" TIMESTAMP(3),
ADD COLUMN "end_reason" "RevealChatEndReason";

-- AlterTable
ALTER TABLE "reveal_chat_participants"
ADD COLUMN "left_at" TIMESTAMP(3),
ADD COLUMN "left_reason" "RevealChatLeaveReason";
