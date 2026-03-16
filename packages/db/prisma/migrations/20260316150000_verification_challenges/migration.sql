-- AlterTable: add verification challenge counters to agents
ALTER TABLE "agents" ADD COLUMN "verification_challenges_passed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "agents" ADD COLUMN "verification_challenges_failed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "agents" ADD COLUMN "verification_suspended_until" TIMESTAMP(3);

-- CreateTable: verification_challenges
CREATE TABLE "verification_challenges" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "challenge_type" TEXT NOT NULL,
    "challenge_text" TEXT NOT NULL,
    "expected_answer" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "verification_challenges_code_key" ON "verification_challenges"("code");

-- CreateIndex
CREATE INDEX "verification_challenges_agent_id_status_idx" ON "verification_challenges"("agent_id", "status");

-- AddForeignKey
ALTER TABLE "verification_challenges" ADD CONSTRAINT "verification_challenges_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
