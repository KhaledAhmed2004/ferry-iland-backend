-- The client does not want port time zones: drop the column added by 20261105120000_port_time_zone.
ALTER TABLE "Port" DROP COLUMN "timeZone";
