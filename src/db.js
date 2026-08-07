/** @param {D1Database} db */
export async function listPhotos(db) {
  const { results } = await db
    .prepare(
      `SELECT id, key, color, imageHighRes, imageLowRes, imageX, imageY, clicks, createdAt
       FROM Photo ORDER BY createdAt DESC`
    )
    .all();
  return (results || []).map(normalizePhoto);
}

/** @param {D1Database} db */
export async function getPhotoByKey(db, key) {
  const row = await db
    .prepare(
      `SELECT id, key, color, imageHighRes, imageLowRes, imageX, imageY, clicks, createdAt
       FROM Photo WHERE key = ?`
    )
    .bind(key)
    .first();
  return row ? normalizePhoto(row) : null;
}

/** @param {D1Database} db */
export async function getPhotoById(db, id) {
  const row = await db
    .prepare(
      `SELECT id, key, color, imageHighRes, imageLowRes, imageX, imageY, clicks, createdAt
       FROM Photo WHERE id = ?`
    )
    .bind(id)
    .first();
  return row ? normalizePhoto(row) : null;
}

/** @param {D1Database} db */
export async function createPhoto(db, photo) {
  const result = await db
    .prepare(
      `INSERT INTO Photo (key, color, imageHighRes, imageLowRes, imageX, imageY, clicks, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now'))
       RETURNING id, key, color, imageHighRes, imageLowRes, imageX, imageY, clicks, createdAt`
    )
    .bind(
      photo.key,
      photo.color,
      photo.imageHighRes,
      photo.imageLowRes,
      photo.imageX,
      photo.imageY
    )
    .first();
  return normalizePhoto(result);
}

/** @param {D1Database} db */
export async function updatePhotoCoords(db, id, x, y) {
  await db
    .prepare(`UPDATE Photo SET imageX = ?, imageY = ? WHERE id = ?`)
    .bind(x, y, id)
    .run();
}

/** @param {D1Database} db */
export async function deletePhoto(db, id) {
  await db.prepare(`DELETE FROM Photo WHERE id = ?`).bind(id).run();
}

/** @param {D1Database} db */
export async function getUserById(db, id) {
  const row = await db
    .prepare(`SELECT id, username, isAdmin FROM User WHERE id = ?`)
    .bind(id)
    .first();
  return row ? normalizeUser(row) : null;
}

/** @param {D1Database} db */
export async function getUserByUsername(db, username) {
  const row = await db
    .prepare(`SELECT id, username, isAdmin FROM User WHERE username = ?`)
    .bind(username)
    .first();
  return row ? normalizeUser(row) : null;
}

/** @param {D1Database} db */
export async function getUserWithCredentials(db, username) {
  const user = await getUserByUsername(db, username);
  if (!user) return null;
  const { results } = await db
    .prepare(
      `SELECT id, credentialId, publicKey, counter, transports, userId, createdAt
       FROM Credential WHERE userId = ?`
    )
    .bind(user.id)
    .all();
  return { ...user, credentials: results || [] };
}

/** @param {D1Database} db */
export async function getCredentialByCredentialId(db, credentialId) {
  return await db
    .prepare(
      `SELECT id, credentialId, publicKey, counter, transports, userId, createdAt
       FROM Credential WHERE credentialId = ?`
    )
    .bind(credentialId)
    .first();
}

/** @param {D1Database} db */
export async function updateCredentialCounter(db, id, counter) {
  await db
    .prepare(`UPDATE Credential SET counter = ? WHERE id = ?`)
    .bind(counter, id)
    .run();
}

function normalizePhoto(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    key: row.key,
    color: row.color,
    imageHighRes: row.imageHighRes,
    imageLowRes: row.imageLowRes,
    imageX: Number(row.imageX),
    imageY: Number(row.imageY),
    clicks: Number(row.clicks ?? 0),
    createdAt: row.createdAt,
  };
}

function normalizeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    isAdmin: Boolean(row.isAdmin),
  };
}

/** Deduplicate photos by (X, Y), randomly keep one per cell */
export function deduplicatePhotosByCoordinates(photos) {
  const coordinateMap = new Map();
  for (const photo of photos) {
    const key = `${photo.imageX},${photo.imageY}`;
    if (!coordinateMap.has(key)) coordinateMap.set(key, []);
    coordinateMap.get(key).push(photo);
  }
  const deduplicated = [];
  for (const group of coordinateMap.values()) {
    if (group.length === 1) {
      deduplicated.push(group[0]);
    } else {
      deduplicated.push(group[Math.floor(Math.random() * group.length)]);
    }
  }
  return deduplicated;
}
