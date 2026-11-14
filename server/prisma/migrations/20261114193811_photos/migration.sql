-- CreateEnum
CREATE TYPE "PhotoStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'REMOVED');

-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "activityId" TEXT,
    "fullKey" TEXT NOT NULL,
    "thumbKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "caption" TEXT,
    "status" "PhotoStatus" NOT NULL,
    "uploadedByUserId" TEXT,
    "uploadedByGuestId" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Photo_fullKey_key" ON "Photo"("fullKey");

-- CreateIndex
CREATE UNIQUE INDEX "Photo_thumbKey_key" ON "Photo"("thumbKey");

-- CreateIndex
CREATE INDEX "Photo_eventId_status_createdAt_idx" ON "Photo"("eventId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Photo_uploadedByGuestId_status_idx" ON "Photo"("uploadedByGuestId", "status");

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_uploadedByGuestId_fkey" FOREIGN KEY ("uploadedByGuestId") REFERENCES "Guest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
