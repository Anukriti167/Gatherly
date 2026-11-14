-- CreateEnum
CREATE TYPE "ApprovalKind" AS ENUM ('PUBLICATION', 'CHANGE_PROPOSAL');

-- CreateEnum
CREATE TYPE "ApprovalRoundStatus" AS ENUM ('OPEN', 'APPROVED', 'CHANGES_REQUESTED', 'SUPERSEDED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ApprovalDecisionType" AS ENUM ('APPROVE', 'REQUEST_CHANGES');

-- CreateTable
CREATE TABLE "ApprovalRound" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "kind" "ApprovalKind" NOT NULL,
    "status" "ApprovalRoundStatus" NOT NULL DEFAULT 'OPEN',
    "eventVersion" INTEGER NOT NULL,
    "initiatedById" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "ApprovalRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoundApprover" (
    "roundId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "RoundApprover_pkey" PRIMARY KEY ("roundId","userId")
);

-- CreateTable
CREATE TABLE "ApprovalDecision" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "decision" "ApprovalDecisionType" NOT NULL,
    "eventVersion" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApprovalRound_eventId_kind_status_idx" ON "ApprovalRound"("eventId", "kind", "status");

-- CreateIndex
CREATE INDEX "ApprovalDecision_roundId_approverId_idx" ON "ApprovalDecision"("roundId", "approverId");

-- AddForeignKey
ALTER TABLE "ApprovalRound" ADD CONSTRAINT "ApprovalRound_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRound" ADD CONSTRAINT "ApprovalRound_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoundApprover" ADD CONSTRAINT "RoundApprover_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "ApprovalRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoundApprover" ADD CONSTRAINT "RoundApprover_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "ApprovalRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Hand-written constraints ───────────────────────────────────────────────
-- At most one OPEN round of each kind per event (the "current" approval round).
CREATE UNIQUE INDEX "ApprovalRound_one_open_publication_round"
  ON "ApprovalRound" ("eventId")
  WHERE "status" = 'OPEN' AND "kind" = 'PUBLICATION';
