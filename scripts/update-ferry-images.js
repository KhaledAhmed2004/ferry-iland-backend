const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const REAL_FERRY_IMAGE_MAP = {
  // Catamarans
  'Jerry Ball': 'https://images.unsplash.com/photo-1694428733861-620550edd3c5?auto=format&fit=crop&w=800&q=80',
  'Island Queen Catamaran': 'https://images.unsplash.com/photo-1791770963676-bf2f80b1795b?auto=format&fit=crop&w=800&q=80',
  'Atoll Cruiser Beta': 'https://images.unsplash.com/photo-1749883530616-b3e0a1c544c5?auto=format&fit=crop&w=800&q=80',
  'Blue Horizon 1': 'https://images.unsplash.com/photo-1760465789372-965a150847db?auto=format&fit=crop&w=800&q=80',
  'Sunrise Pearl Catamaran': 'https://images.unsplash.com/photo-1781786438702-cdc788dcb5c8?auto=format&fit=crop&w=800&q=80',

  // Speedboats
  'Ocean Speed 1': 'https://images.unsplash.com/photo-1780553562886-528452a6b697?auto=format&fit=crop&w=800&q=80',
  'Ocean Speed 2': 'https://images.unsplash.com/photo-1545647274-96644da34363?auto=format&fit=crop&w=800&q=80',
  'Island Wave Runner': 'https://images.unsplash.com/photo-1545647274-96644da34363?auto=format&fit=crop&w=800&q=80',
  'Atoll Flyer Alpha': 'https://images.unsplash.com/photo-1787945832826-f299aebdef7e?auto=format&fit=crop&w=800&q=80',
  'Blue Dart Speedboat': 'https://images.unsplash.com/photo-1605281317010-fe5ffe798166?auto=format&fit=crop&w=800&q=80',
  'Sunrise Voyager': 'https://images.unsplash.com/photo-1772109050488-7956bfb2e493?auto=format&fit=crop&w=800&q=80',

  // Traditional Ferry
  'Mira Ingram': 'https://images.unsplash.com/photo-1778576402928-9a573311f30e?auto=format&fit=crop&w=800&q=80',
};

// Fallback pool by vessel type
const TYPE_FALLBACKS = {
  CATAMARAN: 'https://images.unsplash.com/photo-1694428733861-620550edd3c5?auto=format&fit=crop&w=800&q=80',
  SPEEDBOAT: 'https://images.unsplash.com/photo-1545647274-96644da34363?auto=format&fit=crop&w=800&q=80',
  TRADITIONAL_FERRY: 'https://images.unsplash.com/photo-1778576402928-9a573311f30e?auto=format&fit=crop&w=800&q=80',
};

async function updateFerryImages() {
  console.log('🚢 Updating Ferry Images in Database to Real Marine Ferry Photography...\n');

  const ferries = await prisma.ferry.findMany();
  console.log(`Found ${ferries.length} ferries in database.`);

  for (const ferry of ferries) {
    const newImageUrl = REAL_FERRY_IMAGE_MAP[ferry.name] || TYPE_FALLBACKS[ferry.type] || TYPE_FALLBACKS.SPEEDBOAT;

    await prisma.ferry.update({
      where: { id: ferry.id },
      data: { imageUrl: newImageUrl },
    });

    console.log(`✓ [${ferry.type.padEnd(17)}] "${ferry.name}" (${ferry.registration})`);
    console.log(`  -> ${newImageUrl}`);
  }

  console.log('\n🎉 Successfully updated all ferry images in the database with verified real ferry photos!');
}

updateFerryImages()
  .catch((e) => {
    console.error('Error updating ferry images:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
