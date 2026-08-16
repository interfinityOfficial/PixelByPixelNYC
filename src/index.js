import { Hono } from "hono";
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import {
  listPhotos,
  listPhotosInBounds,
  getPhotoByKey,
  getPhotoById,
  createPhoto,
  updatePhotoCoords,
  deletePhoto,
  getUserById,
  getUserWithCredentials,
  getCredentialByCredentialId,
  updateCredentialCounter,
  deduplicatePhotosByCoordinates,
} from "./db.js";
import {
  createSessionToken,
  verifySessionToken,
  getSessionCookie,
  setSessionCookie,
  clearSessionCookie,
  storeLoginChallenge,
  takeLoginChallenge,
  base64URLStringToBuffer,
} from "./session.js";
import {
  renderMain,
  renderLogin,
  renderDashboard,
  html,
  json,
} from "./templates.js";

/**
 * @typedef {Object} Env
 * @property {D1Database} DB
 * @property {R2Bucket} PHOTOS
 * @property {KVNamespace} SESSIONS
 * @property {Fetcher} ASSETS
 * @property {string} SESSION_SECRET
 * @property {string} RP_ID
 * @property {string} RP_NAME
 * @property {string} R2_PUBLIC_URL
 */

/** @type {Hono<{ Bindings: Env }>} */
const app = new Hono();

async function getSession(c) {
  const secret = c.env.SESSION_SECRET;
  if (!secret) return null;
  const token = getSessionCookie(c.req.raw);
  return verifySessionToken(secret, token);
}

async function requireAdmin(c) {
  const session = await getSession(c);
  if (!session) return null;
  const user = await getUserById(c.env.DB, session.userId);
  if (!user || !user.isAdmin) return null;
  return user;
}

function originFor(c) {
  const rpID = c.env.RP_ID || "pixelbypixel.nyc";
  return `https://${rpID}`;
}

app.get("/", async (c) => {
  try {
    if (!c.env.DB) {
      console.error("Missing D1 binding env.DB");
      return json({ error: "Database not configured" }, { status: 500 });
    }
    const session = await getSession(c);
    let isAdmin = false;
    if (session) {
      const user = await getUserById(c.env.DB, session.userId);
      isAdmin = Boolean(user?.isAdmin);
    }
    const photos = deduplicatePhotosByCoordinates(await listPhotos(c.env.DB));
    return html(renderMain({ photos, isAdmin }));
  } catch (error) {
    console.error("GET / failed:", error);
    return json({ error: "Internal Server Error", detail: String(error) }, { status: 500 });
  }
});

app.get("/login/", async (c) => {
  const session = await getSession(c);
  if (session) {
    const user = await getUserById(c.env.DB, session.userId);
    if (user) return c.redirect("/dashboard/");
  }
  return html(renderLogin());
});

app.get("/dashboard/", async (c) => {
  const user = await requireAdmin(c);
  if (!user) return c.redirect("/login/");
  const photos = await listPhotos(c.env.DB);
  return html(renderDashboard({ user, photos }));
});

app.get("/logout/", async (c) => {
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": clearSessionCookie(),
    },
  });
});

app.get("/all-photos/", async (c) => {
  const photos = deduplicatePhotosByCoordinates(await listPhotos(c.env.DB));
  return json({ photos });
});

const MAP_MAX_X = 44;
const MAP_MAX_Y = 53;
const GALLERY_CARD_ASPECT = 4 / 3;
const GALLERY_PREVIEW_MAX_PHOTOS = 40;
const GALLERY_PREVIEW_ORIGINS = new Set([
  "https://inthecreating.com",
  "https://www.inthecreating.com",
  "https://local.inthecreating.com",
  "http://localhost:7758",
  "http://127.0.0.1:7758",
  "https://pixelbypixel.nyc",
  "https://www.pixelbypixel.nyc",
]);

function parseIntParam(value, fallback) {
  if (value == null || value === "") return fallback;
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : fallback;
}

function clampInt(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function galleryPreviewCorsHeaders(origin) {
  if (!origin || !GALLERY_PREVIEW_ORIGINS.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function galleryPreviewResponse(c, data, status = 200) {
  return json(data, {
    status,
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=300",
      ...galleryPreviewCorsHeaders(c.req.header("Origin")),
    },
  });
}

/** Inclusive cell bounds for a focus pixel. padY=2 → 5 rows; padX covers a 4:3 card plus 1 cell of overscan. */
function galleryPreviewBounds(query) {
  const hasExplicit =
    query.minX != null &&
    query.maxX != null &&
    query.minY != null &&
    query.maxY != null;

  if (hasExplicit) {
    const minX = parseIntParam(query.minX, NaN);
    const maxX = parseIntParam(query.maxX, NaN);
    const minY = parseIntParam(query.minY, NaN);
    const maxY = parseIntParam(query.maxY, NaN);
    if ([minX, maxX, minY, maxY].some((n) => Number.isNaN(n))) {
      return { error: "minX, maxX, minY, and maxY must be integers" };
    }
    if (minX > maxX || minY > maxY) {
      return { error: "min bounds must be <= max bounds" };
    }
    return {
      minX: clampInt(minX, 0, MAP_MAX_X),
      maxX: clampInt(maxX, 0, MAP_MAX_X),
      minY: clampInt(minY, 0, MAP_MAX_Y),
      maxY: clampInt(maxY, 0, MAP_MAX_Y),
    };
  }

  const x = parseIntParam(query.x, 8);
  const y = parseIntParam(query.y, 31);
  const padY = Math.max(0, parseIntParam(query.padY, 2));
  const rows = padY * 2 + 1;
  const defaultPadX = Math.ceil((rows * GALLERY_CARD_ASPECT - 1) / 2) + 1;
  const padX = Math.max(0, parseIntParam(query.padX, defaultPadX));

  return {
    minX: clampInt(x - padX, 0, MAP_MAX_X),
    maxX: clampInt(x + padX, 0, MAP_MAX_X),
    minY: clampInt(y - padY, 0, MAP_MAX_Y),
    maxY: clampInt(y + padY, 0, MAP_MAX_Y),
  };
}

async function handleGalleryPreview(c) {
  if (c.req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Cache-Control": "public, max-age=86400",
        ...galleryPreviewCorsHeaders(c.req.header("Origin")),
      },
    });
  }

  if (!c.env.DB) {
    return galleryPreviewResponse(c, { error: "Database not configured" }, 500);
  }

  const bounds = galleryPreviewBounds(c.req.query());
  if (bounds.error) {
    return galleryPreviewResponse(c, { error: bounds.error }, 400);
  }

  const photos = deduplicatePhotosByCoordinates(
    await listPhotosInBounds(c.env.DB, bounds)
  ).slice(0, GALLERY_PREVIEW_MAX_PHOTOS);

  return galleryPreviewResponse(c, { bounds, photos });
}

app.on(["GET", "OPTIONS"], "/gallery-preview/", handleGalleryPreview);
app.on(["GET", "OPTIONS"], "/gallery-preview", handleGalleryPreview);

app.post("/upload/", async (c) => {
  try {
    let form;
    try {
      form = await c.req.formData();
    } catch {
      return json({ error: "Expected multipart form data" }, { status: 400 });
    }
    const highRes = form.get("highRes");
    const lowRes = form.get("lowRes");
    const color = String(form.get("color") || "");
    const clientKey = String(form.get("key") || "");
    const imageX = parseInt(String(form.get("imageX") || ""), 10);
    const imageY = parseInt(String(form.get("imageY") || ""), 10);

    if (!(highRes instanceof File) || !(lowRes instanceof File)) {
      return json({ error: "highRes and lowRes image files are required" }, { status: 400 });
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
      return json({ error: "Valid color hex is required" }, { status: 400 });
    }
    if (Number.isNaN(imageX) || Number.isNaN(imageY)) {
      return json({ error: "imageX and imageY are required" }, { status: 400 });
    }
    if (highRes.size > 2 * 1024 * 1024 || lowRes.size > 512 * 1024) {
      return json({ error: "Image too large" }, { status: 400 });
    }

    const highResBuffer = await highRes.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", highResBuffer);
    const contentHash = [...new Uint8Array(hashBuffer)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    if (clientKey && clientKey !== contentHash) {
      return json({ error: "Content hash mismatch" }, { status: 400 });
    }

    const existing = await getPhotoByKey(c.env.DB, contentHash);
    if (existing) {
      return json({ success: true, duplicate: true, photo: existing });
    }

    const lowResBuffer = await lowRes.arrayBuffer();
    // Match legacy S3 uploads: objects live under storage/ inside the "storage" bucket
    const lowResKey = `storage/low-res/${contentHash}.jpg`;
    const highResKey = `storage/high-res/${contentHash}.jpg`;

    await Promise.all([
      c.env.PHOTOS.put(lowResKey, lowResBuffer, {
        httpMetadata: { contentType: "image/jpeg" },
      }),
      c.env.PHOTOS.put(highResKey, highResBuffer, {
        httpMetadata: { contentType: "image/jpeg" },
      }),
    ]);

    const publicBase = (c.env.R2_PUBLIC_URL || "https://cdn.pixelbypixel.nyc").replace(
      /\/$/,
      ""
    );
    const photo = await createPhoto(c.env.DB, {
      key: contentHash,
      color: color.toLowerCase(),
      imageHighRes: `${publicBase}/${highResKey}`,
      imageLowRes: `${publicBase}/${lowResKey}`,
      imageX,
      imageY,
    });

    return json({
      success: true,
      message: "Image uploaded and saved successfully",
      photo,
    });
  } catch (error) {
    console.error("Error processing image:", error);
    return json({ error: "Failed to process image" }, { status: 500 });
  }
});

app.post("/update-photo/", async (c) => {
  const user = await requireAdmin(c);
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const body = await c.req.json();
  const { photoId, x, y } = body;
  if (!photoId || isNaN(x) || isNaN(y)) {
    return json({ error: "Photo ID, X, and Y are required" }, { status: 400 });
  }
  await updatePhotoCoords(c.env.DB, parseInt(photoId, 10), parseInt(x, 10), parseInt(y, 10));
  return json({ success: true });
});

app.post("/delete-photo/", async (c) => {
  const user = await requireAdmin(c);
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { photoId } = await c.req.json();
    const photo = await getPhotoById(c.env.DB, parseInt(photoId, 10));
    if (!photo) return json({ error: "Photo not found" }, { status: 404 });

    await deletePhoto(c.env.DB, photo.id);
    await Promise.all([
      c.env.PHOTOS.delete(`storage/high-res/${photo.key}.jpg`),
      c.env.PHOTOS.delete(`storage/low-res/${photo.key}.jpg`),
    ]);
    return json({ success: true });
  } catch (error) {
    console.error("Error deleting photo:", error);
    return json({ error: "Failed to delete photo" }, { status: 500 });
  }
});

app.post("/login-request/", async (c) => {
  const { username } = await c.req.json();
  const user = await getUserWithCredentials(c.env.DB, username);
  if (!user) return json({ error: "User not found" }, { status: 404 });

  const rpID = c.env.RP_ID || "pixelbypixel.nyc";
  const options = await generateAuthenticationOptions({
    timeout: 60000,
    rpID,
    allowCredentials: user.credentials.map((cred) => ({
      id: cred.credentialId,
      type: "public-key",
    })),
    userVerification: "preferred",
  });

  await storeLoginChallenge(c.env.SESSIONS, user.id, options.challenge);
  return json({ options, userId: user.id });
});

app.post("/login-response/", async (c) => {
  const { userId, authenticationResponse } = await c.req.json();
  const user = await getUserById(c.env.DB, userId);
  if (!user) return json({ error: "User not found" }, { status: 404 });

  const expectedChallenge = await takeLoginChallenge(c.env.SESSIONS, userId);
  if (!expectedChallenge) {
    return json({ error: "No login challenge found" }, { status: 400 });
  }

  const cred = await getCredentialByCredentialId(
    c.env.DB,
    authenticationResponse.id
  );
  if (!cred) return json({ error: "Credential not found" }, { status: 404 });

  try {
    const verification = await verifyAuthenticationResponse({
      response: authenticationResponse,
      expectedChallenge,
      expectedOrigin: originFor(c),
      expectedRPID: c.env.RP_ID || "pixelbypixel.nyc",
      credential: {
        id: cred.credentialId,
        publicKey: new Uint8Array(base64URLStringToBuffer(cred.publicKey)),
        counter: Number(cred.counter) || 0,
        transports: cred.transports ? JSON.parse(cred.transports) : undefined,
      },
    });

    if (!verification.verified) {
      return json({ ok: false });
    }

    await updateCredentialCounter(
      c.env.DB,
      cred.id,
      verification.authenticationInfo.newCounter
    );

    const token = await createSessionToken(c.env.SESSION_SECRET, {
      userId: user.id,
      username: user.username,
    });

    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": setSessionCookie(token),
      },
    });
  } catch (err) {
    console.error(err);
    return json({ error: err.message }, { status: 400 });
  }
});

// Fall through to static assets for CSS/JS/images
app.all("*", async (c) => {
  if (!c.env.ASSETS) {
    return c.notFound();
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
