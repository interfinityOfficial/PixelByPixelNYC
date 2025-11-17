const express = require("express");
const ejs = require("ejs");
const multer = require("multer");
const sharp = require("sharp");
const path = require("path");
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { Vibrant } = require('node-vibrant/node');
const { PrismaClient } = require('@prisma/client');
const { createHash } = require('crypto');
const {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
} = require("@simplewebauthn/server");

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3003;
const prisma = new PrismaClient();

app.set('trust proxy', true);

// Helper function to decode base64url to buffer
function base64URLStringToBuffer(base64URLString) {
    // Convert from base64url to base64
    const base64 = base64URLString
        .replace(/-/g, '+')
        .replace(/_/g, '/');

    // Add padding if needed
    const paddedBase64 = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=');

    // Decode base64 to buffer
    return Buffer.from(paddedBase64, 'base64');
}

// Helper function to encode buffer to base64url string
function bufferToBase64URLString(buffer) {
    return buffer.toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

const session = require("express-session");

app.use(
    session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            secure: false,
            maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
        },
    })
);

const rpID = "pixelbypixel.nyc";
const origin = `https://${rpID}`;

let temporaryUsers = new Map();
let loginChallenges = new Map();

// Helper function to deduplicate photos by (X, Y) coordinates
function deduplicatePhotosByCoordinates(photos) {
    const coordinateMap = new Map();

    // Group photos by (X, Y) coordinates
    photos.forEach(photo => {
        const key = `${photo.imageX},${photo.imageY}`;
        if (!coordinateMap.has(key)) {
            coordinateMap.set(key, []);
        }
        coordinateMap.get(key).push(photo);
    });

    // For each coordinate group, randomly pick one photo
    const deduplicatedPhotos = [];
    for (const photosAtCoord of coordinateMap.values()) {
        if (photosAtCoord.length === 1) {
            deduplicatedPhotos.push(photosAtCoord[0]);
        } else {
            // Randomly pick one from duplicates
            const randomIndex = Math.floor(Math.random() * photosAtCoord.length);
            deduplicatedPhotos.push(photosAtCoord[randomIndex]);
        }
    }

    return deduplicatedPhotos;
}

const s3 = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    forcePathStyle: true,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

async function uploadToR2(buffer, key, contentType = 'image/jpeg') {
    const command = new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        ACL: 'public-read',
    });

    await s3.send(command);
    return `${process.env.R2_PUBLIC_URL}/${key}`;
}

const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024,
    },
    fileFilter: (req, file, cb) => {
        // Force file extension to be lowercase
        const ext = path.extname(file.originalname).toLowerCase();
        const name = path.basename(file.originalname, path.extname(file.originalname));
        // Check if file is an image
        if (file.mimetype.startsWith('image/')) {
            cb(null, `${name}${ext}`);
            console.log(`${name}${ext}`);
        } else {
            cb(new Error('Only image files are allowed!'), false);
        }
    }
});

app.set('view engine', 'ejs');

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ limit: '20mb', extended: true }));

app.get('/', async (req, res) => {
    let user = null;
    if (req.session.userId) {
        user = await prisma.user.findUnique({ where: { id: req.session.userId } });
    }
    let isAdmin = false;
    if (user) {
        isAdmin = user.isAdmin;
    }
    const photos = await prisma.photo.findMany();
    const deduplicatedPhotos = deduplicatePhotosByCoordinates(photos);
    res.render('main.ejs', { photos: deduplicatedPhotos, isAdmin: isAdmin });
});

app.get('/login/', async (req, res) => {
    if (req.session.userId) {
        user = await prisma.user.findUnique({ where: { id: req.session.userId } });
        if (user) {
            return res.redirect('/dashboard/');
        }
    }
    res.render('login.ejs');
});

// app.get('/signup/', async (req, res) => {
//     if (req.session.userId) {
//         user = await prisma.user.findUnique({ where: { id: req.session.userId } });
//         if (user) {
//             return res.redirect('/dashboard/');
//         }
//     }
//     res.render('signup.ejs');
// });

app.get('/dashboard/', async (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login/');
    }
    user = await prisma.user.findUnique({ where: { id: req.session.userId } });
    if (!user) {
        return res.redirect('/login/');
    }
    if (!user.isAdmin) {
        return res.status(403).json({ error: "Forbidden" });
    }
    const photos = await prisma.photo.findMany({
        orderBy: {
            createdAt: 'desc',
        },
    });
    res.render('dashboard.ejs', { user: user, photos: photos });
});

app.get('/logout/', async (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.post('/upload/', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image file provided' });
        }

        const inputBuffer = req.file.buffer;
        const timestamp = Date.now();
        const originalName = path.parse(req.file.originalname).name;

        // Create canonical high-res buffer first for deterministic hashing
        const highResBuffer = await sharp(inputBuffer)
            .resize(1500, null, { withoutEnlargement: true })
            .jpeg({ quality: 70 })
            .toBuffer();

        // Compute SHA-256 of the canonical buffer to dedupe
        const contentHash = createHash('sha256').update(highResBuffer).digest('hex');

        // If an identical image already exists, return it (skip uploads and processing)
        const existing = await prisma.photo.findUnique({ where: { key: contentHash } });
        if (existing) {
            return res.json({ success: true, duplicate: true, photo: existing });
        }

        const lowResBuffer = await sharp(inputBuffer)
            .resize(200, null, { withoutEnlargement: true })
            .jpeg({ quality: 60 })
            .toBuffer();

        // Use the content hash as the filename to ensure stable keys
        const lowResKey = `low-res/${contentHash}.jpg`;
        const highResKey = `high-res/${contentHash}.jpg`;

        const [lowResUrl, highResUrl] = await Promise.all([
            uploadToR2(lowResBuffer, lowResKey),
            uploadToR2(highResBuffer, highResKey)
        ]);

        const palette = await Vibrant.from(inputBuffer).getPalette();
        const vibrantColor = palette.Vibrant?.hex || palette.Muted?.hex;

        const { imageX, imageY } = req.body;
        if (!imageX || !imageY) {
            throw new Error('imageX and imageY are required');
        }
        const photo = await prisma.photo.create({
            data: {
                key: contentHash,
                color: vibrantColor,
                imageHighRes: highResUrl,
                imageLowRes: lowResUrl,
                imageX: parseInt(imageX),
                imageY: parseInt(imageY),
                clicks: 0
            }
        });

        res.json({
            success: true,
            message: 'Image processed, uploaded, and saved to database successfully',
            photo
        });

    } catch (error) {
        console.error('Error processing image:', error);
        res.status(500).json({ error: 'Failed to process image' });
    }
});

app.get('/all-photos/', async (req, res) => {
    const photos = await prisma.photo.findMany();
    const deduplicatedPhotos = deduplicatePhotosByCoordinates(photos);
    res.json({ photos: deduplicatedPhotos });
});

app.post('/update-photo/', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const user = await prisma.user.findUnique({ where: { id: req.session.userId } });
    if (!user) {
        return res.status(401).json({ error: 'User not found' });
    }
    if (!user.isAdmin) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    const { photoId, x, y } = req.body;

    if (!photoId || isNaN(x) || isNaN(y)) {
        return res.status(400).json({ error: 'Photo ID, X, and Y are required' });
    }
    const photo = await prisma.photo.update({
        where: { id: parseInt(photoId) },
        data: { imageX: parseInt(x), imageY: parseInt(y) },
    });
    res.json({ success: true });
});

app.post('/delete-photo/', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const user = await prisma.user.findUnique({ where: { id: req.session.userId } });
    if (!user) {
        return res.status(401).json({ error: 'User not found' });
    }
    if (!user.isAdmin) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    try {
        const { photoId } = req.body;
        const photo = await prisma.photo.findUnique({ where: { id: parseInt(photoId) } });
        if (!photo) {
            return res.status(404).json({ error: 'Photo not found' });
        }

        await prisma.photo.delete({ where: { id: parseInt(photoId) } });

        await s3.send(new DeleteObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: `high-res/${photo.key}.jpg`,
        }));
        await s3.send(new DeleteObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: `low-res/${photo.key}.jpg`,
        }));
        return res.json({ success: true });
    } catch (error) {
        console.error('Error deleting photo:', error);
        return res.status(500).json({ error: 'Failed to delete photo' });
    }
});

function randomId() {
    return Math.random().toString(36).slice(2);
}

// Signup
// app.post("/signup-request/", async (req, res) => {
//     const { username } = req.body;
//     const existingUser = await prisma.user.findUnique({ where: { username } });
//     if (existingUser) {
//         return res.status(400).json({ error: "Username unavailable" });
//     }

//     const tempUser = { id: randomId(), username, credentials: [] };
//     temporaryUsers.set(tempUser.id, tempUser);

//     const options = await generateRegistrationOptions({
//         rpName: "Pixel by Pixel NYC",
//         rpID,
//         userID: new TextEncoder().encode(tempUser.id),
//         userName: username,
//         timeout: 60000,
//         attestationType: "none",
//         authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
//     });

//     tempUser.currentChallenge = options.challenge;
//     res.json(options);
// });

// app.post("/signup-response/", async (req, res) => {
//     const { userId, attestationResponse } = req.body;
//     // Decode base64url userId back to original string
//     const originalUserId = new TextDecoder().decode(base64URLStringToBuffer(userId));
//     const user = temporaryUsers.get(originalUserId);
//     if (!user) {
//         return res.status(400).json({ error: "Temporary user not found" });
//     }

//     try {
//         const verification = await verifyRegistrationResponse({
//             response: attestationResponse,
//             expectedChallenge: user.currentChallenge,
//             expectedOrigin: origin,
//             expectedRPID: rpID,
//         });

//         if (verification.verified) {
//             const dbUser = await prisma.user.create({
//                 data: {
//                     username: user.username,
//                     isAdmin: true,
//                 },
//             });

//             const cred = verification.registrationInfo.credential;
//             await prisma.credential.create({
//                 data: {
//                     userId: dbUser.id,
//                     credentialId: cred.id,
//                     publicKey: bufferToBase64URLString(Buffer.from(cred.publicKey)),
//                     counter: cred.counter,
//                     transports: JSON.stringify(cred.transports),
//                 },
//             });

//             temporaryUsers.delete(originalUserId);

//             req.session.userId = dbUser.id;
//             req.session.username = dbUser.username;
//         }

//         res.json({ ok: verification.verified });
//     } catch (err) {
//         console.error(err);
//         res.status(400).json({ error: err.message });
//     }
// });

// Login
app.post("/login-request/", async (req, res) => {
    const { username } = req.body;
    const user = await prisma.user.findUnique({
        where: { username },
        include: { credentials: true }
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    const options = await generateAuthenticationOptions({
        timeout: 60000,
        rpID,
        allowCredentials: user.credentials.map(c => ({
            id: c.credentialId,
            type: "public-key",
        })),
        userVerification: "preferred",
    });

    loginChallenges.set(user.id, options.challenge);
    res.json({ options: options, userId: user.id });
});

app.post("/login-response/", async (req, res) => {
    const { userId, authenticationResponse } = req.body;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const expectedChallenge = loginChallenges.get(userId);
    if (!expectedChallenge) return res.status(400).json({ error: "No login challenge found" });

    const cred = await prisma.credential.findUnique({ where: { credentialId: authenticationResponse.id } });
    if (!cred) return res.status(404).json({ error: "Credential not found" });

    try {
        const verification = await verifyAuthenticationResponse({
            response: authenticationResponse,
            expectedChallenge,
            expectedOrigin: origin,
            expectedRPID: rpID,
            credential: {
                id: base64URLStringToBuffer(cred.credentialId),
                publicKey: base64URLStringToBuffer(cred.publicKey),
                counter: cred.counter,
                transports: cred.transports ? JSON.parse(cred.transports) : [],
            },
        });

        if (verification.verified) {
            await prisma.credential.update({
                where: { id: cred.id },
                data: { counter: verification.authenticationInfo.newCounter },
            });
            loginChallenges.delete(userId);

            req.session.userId = user.id;
            req.session.username = user.username;
        }

        res.json({ ok: verification.verified });
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: err.message });
    }
});

app.use(express.static('public'));

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});