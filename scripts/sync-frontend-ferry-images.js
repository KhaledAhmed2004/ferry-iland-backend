const fs = require('fs');
const path = require('path');

const frontendDir = path.resolve('..', '..', 'Frontend', 'island-hop');

console.log('Synchronizing Real Ferry Images to Frontend:', frontendDir);

// 1. Update models.ts (Add image and vesselType to ISearchedTrip and ITripDetail)
const modelsPath = path.join(frontendDir, 'src', 'types', 'models.ts');
if (fs.existsSync(modelsPath)) {
  let modelsCode = fs.readFileSync(modelsPath, 'utf8');

  // Update ISearchedTrip
  if (!modelsCode.includes('image?: string | null;')) {
    modelsCode = modelsCode.replace(
      'export interface ISearchedTrip {\n  tripId: string;\n  operator: string;\n  vessel: string;\n  departureTime: string;\n  arrivalTime: string;\n  duration: string;\n  availableSeats: number;\n  pricePerAdult: number;\n  pricePerChild: number;\n  totalPrice: number;\n}',
      'export interface ISearchedTrip {\n  tripId: string;\n  operator: string;\n  vessel: string;\n  departureTime: string;\n  arrivalTime: string;\n  duration: string;\n  availableSeats: number;\n  pricePerAdult: number;\n  pricePerChild: number;\n  totalPrice: number;\n  image?: string | null;\n  vesselType?: string;\n}'
    );
  }

  // Update ITripDetail
  if (!modelsCode.includes('vesselType?: string;\n  image?: string | null;')) {
    modelsCode = modelsCode.replace(
      'vesselType?: string;\n  departurePort: string;',
      'vesselType?: string;\n  image?: string | null;\n  departurePort: string;'
    );
  }

  fs.writeFileSync(modelsPath, modelsCode, 'utf8');
  console.log('✓ Updated Frontend src/types/models.ts');
}

// 2. Update FerryCard.tsx (Real Ferry images as defaults and fallback)
const ferryCardPath = path.join(frontendDir, 'src', 'components', 'widgets', 'booking', 'FerryCard.tsx');
if (fs.existsSync(ferryCardPath)) {
  let ferryCardCode = fs.readFileSync(ferryCardPath, 'utf8');

  const oldFerryImagesBlock = `const FERRY_IMAGES = [
  "https://images.unsplash.com/photo-1544551763-46a013bb70d5?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1569263979104-865ab7cd8d13?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1505705694340-019e1e335916?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=800&q=80"
];`;

  const newFerryImagesBlock = `const FERRY_IMAGES = [
  "https://images.unsplash.com/photo-1545647274-96644da34363?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1694428733861-620550edd3c5?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1787945832826-f299aebdef7e?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1760465789372-965a150847db?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1780553562886-528452a6b697?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1778576402928-9a573311f30e?auto=format&fit=crop&w=800&q=80"
];`;

  if (ferryCardCode.includes(oldFerryImagesBlock)) {
    ferryCardCode = ferryCardCode.replace(oldFerryImagesBlock, newFerryImagesBlock);
  }

  // Ensure imageSrc correctly prioritizes trip.image
  const oldImageSrc = `const imageSrc = "image" in trip && trip.image ? trip.image : FERRY_IMAGES[imageIndex];`;
  const newImageSrc = `const imageSrc = ("image" in trip && trip.image) ? trip.image : FERRY_IMAGES[imageIndex];`;
  ferryCardCode = ferryCardCode.replace(oldImageSrc, newImageSrc);

  fs.writeFileSync(ferryCardPath, ferryCardCode, 'utf8');
  console.log('✓ Updated Frontend src/components/widgets/booking/FerryCard.tsx');
}

// 3. Update operator ferries page.tsx presets
const operatorFerriesPath = path.join(frontendDir, 'src', 'app', '(operator-dashboard)', 'dashboard', 'operator', 'ferries', 'page.tsx');
if (fs.existsSync(operatorFerriesPath)) {
  let operatorFerriesCode = fs.readFileSync(operatorFerriesPath, 'utf8');

  const oldPresetsRegex = /export const DEFAULT_FERRY_IMAGES = \[[\s\S]*?\];/;
  const newPresets = `export const DEFAULT_FERRY_IMAGES = [
  {
    label: "Express Speedboat (Maldives)",
    url: "https://images.unsplash.com/photo-1545647274-96644da34363?auto=format&fit=crop&w=600&q=80"
  },
  {
    label: "High-Speed Catamaran",
    url: "https://images.unsplash.com/photo-1694428733861-620550edd3c5?auto=format&fit=crop&w=600&q=80"
  },
  {
    label: "Ocean Wave Runner",
    url: "https://images.unsplash.com/photo-1787945832826-f299aebdef7e?auto=format&fit=crop&w=600&q=80"
  },
  {
    label: "Passenger Catamaran Cruiser",
    url: "https://images.unsplash.com/photo-1760465789372-965a150847db?auto=format&fit=crop&w=600&q=80"
  },
  {
    label: "Inter-Island Passenger Ferry",
    url: "https://images.unsplash.com/photo-1778576402928-9a573311f30e?auto=format&fit=crop&w=600&q=80"
  },
  {
    label: "Maldivian Lagoon Cruiser",
    url: "https://images.unsplash.com/photo-1605281317010-fe5ffe798166?auto=format&fit=crop&w=600&q=80"
  }
];`;

  if (oldPresetsRegex.test(operatorFerriesCode)) {
    operatorFerriesCode = operatorFerriesCode.replace(oldPresetsRegex, newPresets);
    fs.writeFileSync(operatorFerriesPath, operatorFerriesCode, 'utf8');
    console.log('✓ Updated Frontend operator ferries/page.tsx DEFAULT_FERRY_IMAGES presets');
  }
}

// 4. Update data/ferries.ts mock data
const ferriesDataPath = path.join(frontendDir, 'src', 'data', 'ferries.ts');
if (fs.existsSync(ferriesDataPath)) {
  let ferriesDataCode = fs.readFileSync(ferriesDataPath, 'utf8');

  ferriesDataCode = ferriesDataCode.replace(
    'https://images.unsplash.com/photo-1544551763-46a013bb70d5?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1545647274-96644da34363?auto=format&fit=crop&w=800&q=80'
  );
  ferriesDataCode = ferriesDataCode.replace(
    'https://images.unsplash.com/photo-1569263979104-865ab7cd8d13?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1694428733861-620550edd3c5?auto=format&fit=crop&w=800&q=80'
  );
  ferriesDataCode = ferriesDataCode.replace(
    'https://images.unsplash.com/photo-1505705694340-019e1e335916?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1787945832826-f299aebdef7e?auto=format&fit=crop&w=800&q=80'
  );

  fs.writeFileSync(ferriesDataPath, ferriesDataCode, 'utf8');
  console.log('✓ Updated Frontend src/data/ferries.ts mock data');
}

console.log('\n🎉 Frontend synchronization complete!');
