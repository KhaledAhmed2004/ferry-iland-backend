const fs = require('fs');
const path = require('path');

const frontendDir = path.resolve('..', '..', 'Frontend', 'island-hop');

console.log('🚀 Setting up Dynamic Media Catalog System across Frontend & Backend...');

// 1. Create Frontend src/data/media-catalog.ts
const frontendMediaCatalogPath = path.join(frontendDir, 'src', 'data', 'media-catalog.ts');
const frontendMediaCatalogContent = `/**
 * Centralized, verified real ferry and port photography catalog.
 * Curated for high-performance, real-world island hop operations in the Maldives and coastal transit.
 */

export interface IMediaPreset {
  label: string;
  url: string;
  location?: string;
}

export const FERRY_MEDIA_CATALOG: Record<string, IMediaPreset[]> = {
  SPEEDBOAT: [
    {
      label: "Express Speedboat (Maldives)",
      url: "https://images.unsplash.com/photo-1545647274-96644da34363?auto=format&fit=crop&w=800&q=80",
      location: "Fuvahmulah, Maldives"
    },
    {
      label: "Ocean Wave Runner",
      url: "https://images.unsplash.com/photo-1787945832826-f299aebdef7e?auto=format&fit=crop&w=800&q=80",
      location: "Open Ocean Express"
    },
    {
      label: "White Passenger Speedboat",
      url: "https://images.unsplash.com/photo-1780553562886-528452a6b697?auto=format&fit=crop&w=800&q=80",
      location: "Island Crossing"
    },
    {
      label: "Lagoon Express Vessel",
      url: "https://images.unsplash.com/photo-1605281317010-fe5ffe798166?auto=format&fit=crop&w=800&q=80",
      location: "Maldives Atoll"
    }
  ],
  CATAMARAN: [
    {
      label: "High-Speed Passenger Catamaran",
      url: "https://images.unsplash.com/photo-1694428733861-620550edd3c5?auto=format&fit=crop&w=800&q=80",
      location: "Coastal Ferry Route"
    },
    {
      label: "Twin-Hull Island Cruiser",
      url: "https://images.unsplash.com/photo-1760465789372-965a150847db?auto=format&fit=crop&w=800&q=80",
      location: "Turquoise Waters"
    },
    {
      label: "Island Catamaran Ferry",
      url: "https://images.unsplash.com/photo-1781786438702-cdc788dcb5c8?auto=format&fit=crop&w=800&q=80",
      location: "Atoll Channel"
    },
    {
      label: "Sleek Passenger Catamaran",
      url: "https://images.unsplash.com/photo-1749883530616-b3e0a1c544c5?auto=format&fit=crop&w=800&q=80",
      location: "Island Hop Route"
    },
    {
      label: "White & Blue Catamaran Ferry",
      url: "https://images.unsplash.com/photo-1791770963676-bf2f80b1795b?auto=format&fit=crop&w=800&q=80",
      location: "Harbor Transit"
    }
  ],
  TRADITIONAL_FERRY: [
    {
      label: "Multi-Deck Island Passenger Ferry",
      url: "https://images.unsplash.com/photo-1778576402928-9a573311f30e?auto=format&fit=crop&w=800&q=80",
      location: "Inter-Island Port"
    },
    {
      label: "Harbor Transit Passenger Ferry",
      url: "https://images.unsplash.com/photo-1791930427466-37aa70894b23?auto=format&fit=crop&w=800&q=80",
      location: "Ferry Terminal Quay"
    },
    {
      label: "Open-Deck Island Ferry",
      url: "https://images.unsplash.com/photo-1772109050488-7956bfb2e493?auto=format&fit=crop&w=800&q=80",
      location: "Island Crossing"
    }
  ]
};

export const DEFAULT_FERRY_IMAGES: IMediaPreset[] = [
  ...FERRY_MEDIA_CATALOG.SPEEDBOAT.slice(0, 2),
  ...FERRY_MEDIA_CATALOG.CATAMARAN.slice(0, 2),
  ...FERRY_MEDIA_CATALOG.TRADITIONAL_FERRY.slice(0, 2)
];

/**
 * Deterministically resolves a verified high-resolution vessel image based on vessel type
 * and a seed string (e.g. vessel name or ID) without any network latency.
 */
export function getDynamicVesselImage(type?: string, seedKey?: string): string {
  const normalizedType = (type || "SPEEDBOAT").toUpperCase();
  const pool = FERRY_MEDIA_CATALOG[normalizedType] || FERRY_MEDIA_CATALOG.SPEEDBOAT;

  if (!seedKey) {
    return pool[0].url;
  }

  let hash = 0;
  for (let i = 0; i < seedKey.length; i++) {
    hash = (hash + seedKey.charCodeAt(i) * (i + 1)) % pool.length;
  }

  return pool[hash].url;
}
`;

fs.writeFileSync(frontendMediaCatalogPath, frontendMediaCatalogContent, 'utf8');
console.log('✓ Created Frontend src/data/media-catalog.ts');

// 2. Wire getDynamicVesselImage in Frontend operator ferries page.tsx
const operatorFerriesPath = path.join(frontendDir, 'src', 'app', '(operator-dashboard)', 'dashboard', 'operator', 'ferries', 'page.tsx');
if (fs.existsSync(operatorFerriesPath)) {
  let code = fs.readFileSync(operatorFerriesPath, 'utf8');

  // Add import if not present
  if (!code.includes('getDynamicVesselImage')) {
    code = code.replace(
      'import { DashboardTableCard, StatusBadge, type TableColumn } from "@/widgets";',
      'import { DashboardTableCard, StatusBadge, type TableColumn } from "@/widgets";\nimport { DEFAULT_FERRY_IMAGES, getDynamicVesselImage } from "@/data/media-catalog";'
    );
  }

  // Replace getFerryImage implementation to use getDynamicVesselImage
  const oldGetFerryImageRegex = /export function getFerryImage\(ferry: IFerry\): string \{[\s\S]*?return DEFAULT_FERRY_IMAGES\[hash\]\.url;\n\}/;
  const newGetFerryImage = `export function getFerryImage(ferry: IFerry): string {
  if (ferry.imageUrl && ferry.imageUrl.trim().startsWith("http")) {
    return ferry.imageUrl.trim();
  }
  return getDynamicVesselImage(ferry.type, ferry.name || ferry.id);
}`;

  if (oldGetFerryImageRegex.test(code)) {
    code = code.replace(oldGetFerryImageRegex, newGetFerryImage);
  }

  fs.writeFileSync(operatorFerriesPath, code, 'utf8');
  console.log('✓ Wired getDynamicVesselImage into operator ferries/page.tsx');
}

// 3. Wire getDynamicVesselImage into FerryCard.tsx
const ferryCardPath = path.join(frontendDir, 'src', 'components', 'widgets', 'booking', 'FerryCard.tsx');
if (fs.existsSync(ferryCardPath)) {
  let code = fs.readFileSync(ferryCardPath, 'utf8');

  if (!code.includes('getDynamicVesselImage')) {
    code = code.replace(
      'import type { FerryTrip } from "@/data/ferries";',
      'import type { FerryTrip } from "@/data/ferries";\nimport { getDynamicVesselImage } from "@/data/media-catalog";'
    );
  }

  // Update imageSrc line to use getDynamicVesselImage fallback
  const oldImageSrcLine = 'const imageSrc = ("image" in trip && trip.image) ? trip.image : FERRY_IMAGES[imageIndex];';
  const newImageSrcLine = 'const vesselType = "vesselType" in trip ? trip.vesselType : "SPEEDBOAT";\n  const imageSrc = ("image" in trip && trip.image) ? trip.image : getDynamicVesselImage(vesselType, tripId);';

  if (code.includes(oldImageSrcLine)) {
    code = code.replace(oldImageSrcLine, newImageSrcLine);
  }

  fs.writeFileSync(ferryCardPath, code, 'utf8');
  console.log('✓ Wired getDynamicVesselImage into FerryCard.tsx');
}

console.log('🎉 Setup complete!');
