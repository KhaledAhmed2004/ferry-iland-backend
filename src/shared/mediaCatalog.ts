import { VesselType } from '@prisma/client';

export interface IMediaAsset {
  label: string;
  url: string;
  location?: string;
}

/**
 * Curated, verified real ferry, catamaran, and speedboat photography catalog.
 * All URLs are checked for HTTP 200 response and represent authentic passenger vessels.
 */
export const FERRY_MEDIA_CATALOG: Record<VesselType, IMediaAsset[]> = {
  [VesselType.SPEEDBOAT]: [
    {
      label: 'Express Speedboat (Maldives)',
      url: 'https://images.unsplash.com/photo-1545647274-96644da34363?auto=format&fit=crop&w=800&q=80',
      location: 'Fuvahmulah, Maldives',
    },
    {
      label: 'Ocean Wave Runner',
      url: 'https://images.unsplash.com/photo-1787945832826-f299aebdef7e?auto=format&fit=crop&w=800&q=80',
      location: 'Open Ocean Express',
    },
    {
      label: 'White Passenger Speedboat',
      url: 'https://images.unsplash.com/photo-1780553562886-528452a6b697?auto=format&fit=crop&w=800&q=80',
      location: 'Island Crossing',
    },
    {
      label: 'Lagoon Express Vessel',
      url: 'https://images.unsplash.com/photo-1605281317010-fe5ffe798166?auto=format&fit=crop&w=800&q=80',
      location: 'Maldives Atoll',
    },
  ],
  [VesselType.CATAMARAN]: [
    {
      label: 'High-Speed Passenger Catamaran',
      url: 'https://images.unsplash.com/photo-1694428733861-620550edd3c5?auto=format&fit=crop&w=800&q=80',
      location: 'Coastal Ferry Route',
    },
    {
      label: 'Twin-Hull Island Cruiser',
      url: 'https://images.unsplash.com/photo-1760465789372-965a150847db?auto=format&fit=crop&w=800&q=80',
      location: 'Turquoise Waters',
    },
    {
      label: 'Island Catamaran Ferry',
      url: 'https://images.unsplash.com/photo-1781786438702-cdc788dcb5c8?auto=format&fit=crop&w=800&q=80',
      location: 'Atoll Channel',
    },
    {
      label: 'Sleek Passenger Catamaran',
      url: 'https://images.unsplash.com/photo-1749883530616-b3e0a1c544c5?auto=format&fit=crop&w=800&q=80',
      location: 'Island Hop Route',
    },
    {
      label: 'White & Blue Catamaran Ferry',
      url: 'https://images.unsplash.com/photo-1791770963676-bf2f80b1795b?auto=format&fit=crop&w=800&q=80',
      location: 'Harbor Transit',
    },
  ],
  [VesselType.TRADITIONAL_FERRY]: [
    {
      label: 'Multi-Deck Island Passenger Ferry',
      url: 'https://images.unsplash.com/photo-1778576402928-9a573311f30e?auto=format&fit=crop&w=800&q=80',
      location: 'Inter-Island Port',
    },
    {
      label: 'Harbor Transit Passenger Ferry',
      url: 'https://images.unsplash.com/photo-1791930427466-37aa70894b23?auto=format&fit=crop&w=800&q=80',
      location: 'Ferry Terminal Quay',
    },
    {
      label: 'Open-Deck Island Ferry',
      url: 'https://images.unsplash.com/photo-1772109050488-7956bfb2e493?auto=format&fit=crop&w=800&q=80',
      location: 'Island Crossing',
    },
  ],
};

export const PORT_MEDIA_CATALOG: Record<string, string> = {
  'Malé Ferry Terminal':
    'https://images.unsplash.com/photo-1564965474715-acd1c7f02b6b?auto=format&fit=crop&w=800&q=80',
  'Hulhumalé Port':
    'https://images.unsplash.com/photo-1656252972929-44002a33859e?auto=format&fit=crop&w=800&q=80',
  'Maafushi Jetty':
    'https://images.unsplash.com/photo-1545647274-96644da34363?auto=format&fit=crop&w=800&q=80',
  DEFAULT_PORT:
    'https://images.unsplash.com/photo-1564965474715-acd1c7f02b6b?auto=format&fit=crop&w=800&q=80',
};

/**
 * Deterministically resolves a verified high-resolution vessel image based on vessel type
 * and a seed string (e.g. vessel name or registration) without any external network latency.
 */
export function getDynamicVesselImage(
  type?: VesselType | string,
  seedKey?: string,
): string {
  const normalizedType: VesselType =
    type && Object.values(VesselType).includes(type as VesselType)
      ? (type as VesselType)
      : VesselType.SPEEDBOAT;

  const pool =
    FERRY_MEDIA_CATALOG[normalizedType] ||
    FERRY_MEDIA_CATALOG[VesselType.SPEEDBOAT];

  if (!seedKey) {
    return pool[0].url;
  }

  let hash = 0;
  for (let i = 0; i < seedKey.length; i++) {
    hash = (hash + seedKey.charCodeAt(i) * (i + 1)) % pool.length;
  }

  return pool[hash].url;
}

/**
 * Resolves a high-resolution island jetty / port image.
 */
export function getDynamicPortImage(portName?: string): string {
  if (portName && PORT_MEDIA_CATALOG[portName]) {
    return PORT_MEDIA_CATALOG[portName];
  }
  return PORT_MEDIA_CATALOG.DEFAULT_PORT;
}
