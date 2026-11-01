const fs = require('fs');
const path = require('path');

const frontendDir = path.resolve('..', '..', 'Frontend', 'island-hop');

console.log('🚀 Applying full system alignment across Frontend & Backend...');
console.log('Target Frontend Directory:', frontendDir);

// 1. Update models.ts to include departurePort & destinationPort in ISearchedTrip
const modelsPath = path.join(frontendDir, 'src', 'types', 'models.ts');
if (fs.existsSync(modelsPath)) {
  let modelsContent = fs.readFileSync(modelsPath, 'utf8');
  if (!modelsContent.includes('departurePort?: string;')) {
    modelsContent = modelsContent.replace(
      'export interface ISearchedTrip {\n  tripId: string;',
      `export interface ISearchedTrip {\n  tripId: string;\n  departurePort?: string;\n  departurePortId?: string;\n  destinationPort?: string;\n  destinationPortId?: string;`
    );
    fs.writeFileSync(modelsPath, modelsContent, 'utf8');
    console.log('✓ Updated src/types/models.ts with port fields in ISearchedTrip');
  } else {
    console.log('ℹ src/types/models.ts already has port fields');
  }
}

// 2. Update FerryCard.tsx
const ferryCardPath = path.join(frontendDir, 'src', 'components', 'widgets', 'booking', 'FerryCard.tsx');
if (fs.existsSync(ferryCardPath)) {
  let ferryCardContent = fs.readFileSync(ferryCardPath, 'utf8');

  // Replace numeric count and port resolution
  const oldPortLogic = `  const tripId = "tripId" in trip ? trip.tripId : trip.id;
  const operatorName = trip.operator;
  const vesselName = "vessel" in trip ? trip.vessel : trip.vesselName;
  const price = "pricePerAdult" in trip ? trip.pricePerAdult : trip.price;
  const departurePort = fromPortName || ("departurePort" in trip ? trip.departurePort : params.from);
  const arrivalPort = toPortName || ("arrivalPort" in trip ? trip.arrivalPort : params.to);
  const availableSeats = trip.availableSeats;`;

  const newPortLogic = `  const adults = parseInt(params.adults || "1", 10) || 1;
  const children = parseInt(params.children || "0", 10) || 0;
  const totalCount = adults + children;

  const tripId = "tripId" in trip ? trip.tripId : trip.id;
  const operatorName = trip.operator;
  const vesselName = "vessel" in trip ? trip.vessel : trip.vesselName;
  const price = "pricePerAdult" in trip ? trip.pricePerAdult : trip.price;
  const departurePort = ("departurePort" in trip && trip.departurePort) || fromPortName || params.from;
  const arrivalPort = ("destinationPort" in trip && trip.destinationPort) || ("arrivalPort" in trip && trip.arrivalPort) || toPortName || params.to;
  const availableSeats = trip.availableSeats;`;

  if (ferryCardContent.includes(oldPortLogic)) {
    ferryCardContent = ferryCardContent.replace(oldPortLogic, newPortLogic);
  }

  // Update reviewUrl to include adults and children
  const oldReviewUrl = `  const reviewUrl = \`/book/\${tripId}/review?passengers=\${numericCount}&departureDate=\${encodeURIComponent(
    params.departureDate
  )}&from=\${encodeURIComponent(departurePort)}&to=\${encodeURIComponent(arrivalPort)}&tripType=\${
    params.tripType
  }\${params.tripType === "round-trip" && params.returnDate ? \`&returnDate=\${encodeURIComponent(params.returnDate)}\` : ""}\`;`;

  const newReviewUrl = `  const reviewUrl = \`/book/\${tripId}/review?passengers=\${totalCount}&adults=\${adults}&children=\${children}&departureDate=\${encodeURIComponent(
    params.departureDate
  )}&from=\${encodeURIComponent(departurePort)}&to=\${encodeURIComponent(arrivalPort)}&tripType=\${
    params.tripType
  }\${params.tripType === "round-trip" && params.returnDate ? \`&returnDate=\${encodeURIComponent(params.returnDate)}\` : ""}\`;`;

  if (ferryCardContent.includes(oldReviewUrl)) {
    ferryCardContent = ferryCardContent.replace(oldReviewUrl, newReviewUrl);
  }

  fs.writeFileSync(ferryCardPath, ferryCardContent, 'utf8');
  console.log('✓ Updated src/components/widgets/booking/FerryCard.tsx');
}

// 3. Update BookingResultsList.tsx to pass trip ports
const resultsListPath = path.join(frontendDir, 'src', 'components', 'widgets', 'booking', 'BookingResultsList.tsx');
if (fs.existsSync(resultsListPath)) {
  let resultsListContent = fs.readFileSync(resultsListPath, 'utf8');

  const oldOutboundMap = `          {outboundTrips.map((trip) => (
            <FerryCard
              key={trip.tripId}
              trip={trip}
              fromPortName={params.from}
              toPortName={params.to}
            />
          ))}`;

  const newOutboundMap = `          {outboundTrips.map((trip) => (
            <FerryCard
              key={trip.tripId}
              trip={trip}
              fromPortName={trip.departurePort || params.from}
              toPortName={trip.destinationPort || params.to}
            />
          ))}`;

  if (resultsListContent.includes(oldOutboundMap)) {
    resultsListContent = resultsListContent.replace(oldOutboundMap, newOutboundMap);
  }

  const oldReturnMap = `            {returnTrips.map((trip) => (
              <FerryCard
                key={trip.tripId}
                trip={trip}
                fromPortName={params.to}
                toPortName={params.from}
              />
            ))}`;

  const newReturnMap = `            {returnTrips.map((trip) => (
              <FerryCard
                key={trip.tripId}
                trip={trip}
                fromPortName={trip.departurePort || params.to}
                toPortName={trip.destinationPort || params.from}
              />
            ))}`;

  if (resultsListContent.includes(oldReturnMap)) {
    resultsListContent = resultsListContent.replace(oldReturnMap, newReturnMap);
  }

  fs.writeFileSync(resultsListPath, resultsListContent, 'utf8');
  console.log('✓ Updated src/components/widgets/booking/BookingResultsList.tsx');
}

console.log('🎉 Full system alignment applied successfully!');
