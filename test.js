const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    // Insert a test photo
    const photo = await prisma.photo.create({
        data: {
            color: '#ffffff',
            imageHighRes: 'https://example.com/photo.jpg',
            imageLowRes: 'https://example.com/photo.jpg',
            imageX: 1,
            imageY: 1,
            clicks: 0,
        },
    });
    console.log('Inserted photo:', photo);

    // Fetch all photos
    const photos = await prisma.photo.findMany();
    console.log('All photos:', photos);
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());