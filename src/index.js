import { Hono } from "hono";
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import {
  listPhotos,
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
  const session = await getSession(c);
  let isAdmin = false;
  if (session) {
    const user = await getUserById(c.env.DB, session.userId);
    isAdmin = Boolean(user?.isAdmin);
  }
  const photos = deduplicatePhotosByCoordinates(await listPhotos(c.env.DB));
  return html(renderMain({ photos, isAdmin }));
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
    const lowResKey = `low-res/${contentHash}.jpg`;
    const highResKey = `high-res/${contentHash}.jpg`;

    await Promise.all([
      c.env.PHOTOS.put(lowResKey, lowResBuffer, {
        httpMetadata: { contentType: "image/jpeg" },
      }),
      c.env.PHOTOS.put(highResKey, highResBuffer, {
        httpMetadata: { contentType: "image/jpeg" },
      }),
    ]);

    const publicBase = (c.env.R2_PUBLIC_URL || "").replace(/\/$/, "");
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
      c.env.PHOTOS.delete(`high-res/${photo.key}.jpg`),
      c.env.PHOTOS.delete(`low-res/${photo.key}.jpg`),
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
