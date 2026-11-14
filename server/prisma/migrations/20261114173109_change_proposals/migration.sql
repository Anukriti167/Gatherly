-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('OPEN', 'APPLIED', 'WITHDRAWN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ProposalDecisionType" AS ENUM ('APPROVE', 'OBJECT');

-- CreateTable
CREATE TABLE "ChangeProposal" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "proposerId" TEXT NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "closedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "ChangeProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalRevision" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalApprover" (
    "proposalId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "ProposalApprover_pkey" PRIMARY KEY ("proposalId","userId")
);

-- CreateTable
CREATE TABLE "ProposalDecision" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "decision" "ProposalDecisionType" NOT NULL,
    "proposalVersion" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalComment" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChangeProposal_eventId_status_idx" ON "ChangeProposal"("eventId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalRevision_proposalId_version_key" ON "ProposalRevision"("proposalId", "version");

-- CreateIndex
CREATE INDEX "ProposalDecision_proposalId_approverId_idx" ON "ProposalDecision"("proposalId", "approverId");

-- CreateIndex
CREATE INDEX "ProposalComment_proposalId_createdAt_idx" ON "ProposalComment"("proposalId", "createdAt");

-- AddForeignKey
ALTER TABLE "ChangeProposal" ADD CONSTRAINT "ChangeProposal_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeProposal" ADD CONSTRAINT "ChangeProposal_proposerId_fkey" FOREIGN KEY ("proposerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalRevision" ADD CONSTRAINT "ProposalRevision_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "ChangeProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalRevision" ADD CONSTRAINT "ProposalRevision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalApprover" ADD CONSTRAINT "ProposalApprover_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "ChangeProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalApprover" ADD CONSTRAINT "ProposalApprover_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalDecision" ADD CONSTRAINT "ProposalDecision_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "ChangeProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalDecision" ADD CONSTRAINT "ProposalDecision_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalComment" ADD CONSTRAINT "ProposalComment_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "ChangeProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalComment" ADD CONSTRAINT "ProposalComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
