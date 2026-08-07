const SESSION_COOKIE = "pbp_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function bytesToBase64Url(bytes) {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(str) {
  const pad = "=".repeat((4 - (str.length % 4)) % 4);
  const base64 = (str + pad).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacSign(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message)
  );
  return bytesToBase64Url(new Uint8Array(sig));
}

async function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}

/**
 * @param {string} secret
 * @param {{ userId: string, username: string }} payload
 */
export async function createSessionToken(secret, payload) {
  const body = {
    userId: payload.userId,
    username: payload.username,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const encoded = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(body)));
  const sig = await hmacSign(secret, encoded);
  return `${encoded}.${sig}`;
}

/**
 * @param {string} secret
 * @param {string | null | undefined} token
 */
export async function verifySessionToken(secret, token) {
  if (!token || !token.includes(".")) return null;
  const [encoded, sig] = token.split(".");
  if (!encoded || !sig) return null;
  const expected = await hmacSign(secret, encoded);
  if (!(await timingSafeEqual(sig, expected))) return null;
  try {
    const body = JSON.parse(new TextDecoder().decode(base64UrlToBytes(encoded)));
    if (!body?.userId || !body?.exp) return null;
    if (body.exp < Math.floor(Date.now() / 1000)) return null;
    return { userId: body.userId, username: body.username };
  } catch {
    return null;
  }
}

export function getSessionCookie(request) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function setSessionCookie(token) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/** @param {KVNamespace} kv */
export async function storeLoginChallenge(kv, userId, challenge) {
  await kv.put(`login-challenge:${userId}`, challenge, { expirationTtl: 120 });
}

/** @param {KVNamespace} kv */
export async function takeLoginChallenge(kv, userId) {
  const key = `login-challenge:${userId}`;
  const challenge = await kv.get(key);
  if (challenge) await kv.delete(key);
  return challenge;
}

export function base64URLStringToBuffer(base64URLString) {
  return base64UrlToBytes(base64URLString).buffer;
}

export function bufferToBase64URLString(buffer) {
  return bytesToBase64Url(new Uint8Array(buffer));
}
