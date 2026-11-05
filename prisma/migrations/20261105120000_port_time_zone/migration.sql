-- Spec 0003: every port carries the IANA time zone its trip times are shown and read in.

-- 1. Add nullable so existing rows survive.
ALTER TABLE "Port" ADD COLUMN "timeZone" TEXT;

-- 2. Backfill the six known ports by name.
UPDATE "Port" SET "timeZone" = 'America/Anguilla'      WHERE "name" = 'Blowing Point, Anguilla';
UPDATE "Port" SET "timeZone" = 'America/Marigot'       WHERE "name" = 'Marigot, Saint Martin';
UPDATE "Port" SET "timeZone" = 'America/Lower_Princes' WHERE "name" = 'Philipsburg, Sint Maarten';
UPDATE "Port" SET "timeZone" = 'America/Kralendijk'    WHERE "name" IN ('Fort Bay Harbor, Saba', 'Gallows Bay, Sint Eustatius');
UPDATE "Port" SET "timeZone" = 'America/St_Kitts'      WHERE "name" = 'Port Zante, St. Kitts';

-- 3. Any other port (one that exists only on another database) gets AST, the zone every
--    port in this region uses, so the NOT NULL step cannot fail. An admin can correct it.
UPDATE "Port" SET "timeZone" = 'America/Puerto_Rico'   WHERE "timeZone" IS NULL;

-- 4. Now require it.
ALTER TABLE "Port" ALTER COLUMN "timeZone" SET NOT NULL;
