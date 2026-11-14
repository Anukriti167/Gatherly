-- CreateTable
CREATE TABLE "Guest" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "allActivities" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "Guest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestActivityAssignment" (
    "guestId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestActivityAssignment_pkey" PRIMARY KEY ("guestId","activityId")
);

-- CreateIndex
CREATE INDEX "Guest_eventId_removedAt_idx" ON "Guest"("eventId", "removedAt");

-- CreateIndex
CREATE INDEX "GuestActivityAssignment_activityId_idx" ON "GuestActivityAssignment"("activityId");

-- AddForeignKey
ALTER TABLE "Guest" ADD CONSTRAINT "Guest_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestActivityAssignment" ADD CONSTRAINT "GuestActivityAssignment_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestActivityAssignment" ADD CONSTRAINT "GuestActivityAssignment_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- FR-071: an email can appear only once among an event's current (non-removed) guests.
CREATE UNIQUE INDEX "Guest_one_active_email_per_event"
  ON "Guest" ("eventId", "email")
  WHERE "removedAt" IS NULL;
