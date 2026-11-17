-- Routes become platform-wide (admin managed). Operators no longer own routes; a trip's
-- operator is its ferry's operator. One route per port pair.

-- 1. Merge duplicate routes for the same port pair (different operators used to have
--    their own copy). Keep the oldest, move every schedule onto it, drop the rest.
WITH ranked AS (
  SELECT "id",
         FIRST_VALUE("id") OVER (
           PARTITION BY "departurePortId", "destinationPortId"
           ORDER BY "createdAt", "id"
         ) AS "keepId"
  FROM "Route"
)
UPDATE "Schedule" s
SET "routeId" = r."keepId"
FROM ranked r
WHERE s."routeId" = r."id" AND r."id" <> r."keepId";

DELETE FROM "Route" rt
USING (
  SELECT "id",
         FIRST_VALUE("id") OVER (
           PARTITION BY "departurePortId", "destinationPortId"
           ORDER BY "createdAt", "id"
         ) AS "keepId"
  FROM "Route"
) r
WHERE rt."id" = r."id" AND r."id" <> r."keepId";

-- 2. Drop route ownership.
DROP INDEX IF EXISTS "Route_operatorId_departurePortId_destinationPortId_key";
DROP INDEX IF EXISTS "Route_operatorId_idx";
ALTER TABLE "Route" DROP CONSTRAINT IF EXISTS "Route_operatorId_fkey";
ALTER TABLE "Route" DROP COLUMN "operatorId";

-- 3. One route per port pair.
CREATE UNIQUE INDEX "Route_departurePortId_destinationPortId_key" ON "Route"("departurePortId", "destinationPortId");
