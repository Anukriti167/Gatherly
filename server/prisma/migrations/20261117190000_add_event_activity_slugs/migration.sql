-- Gatherly: add readable guest-website slugs.
-- Safe first-stage migration: nullable columns allow existing rows to remain intact.
-- Backfill slugs before changing either column to NOT NULL in a later migration.

ALTER TABLE `Event`
  ADD COLUMN `slug` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `Event_slug_key` ON `Event`(`slug`);

ALTER TABLE `Activity`
  ADD COLUMN `slug` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `Activity_eventId_slug_key` ON `Activity`(`eventId`, `slug`);
