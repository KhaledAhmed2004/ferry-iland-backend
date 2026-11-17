/**
 * Default description for a seeded route. Route descriptions are mandatory (admin form and
 * POST /routes), so the seed and backfill scripts use this when a route has none.
 */
export function describeRoute(fromPort: string, toPort: string, durationMinutes: number): string {
  return (
    `Passenger ferry from ${fromPort} to ${toPort}, about ${durationMinutes} minutes at sea. ` +
    `This is an international crossing, so bring a valid passport for immigration.`
  );
}
