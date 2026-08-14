#!/usr/bin/env node
/**
 * Import data/data.json (or photos/users/credentials.json) into local or remote D1.
 *
 * Usage:
 *   node scripts/import-d1.mjs --local
 *   node scripts/import-d1.mjs --remote
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dataPath = path.join(root, "data", "data.json");

const mode = process.argv.includes("--remote") ? "--remote" : "--local";

if (!fs.existsSync(dataPath)) {
  console.error("Missing data/data.json");
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const photos = data.Photo || [];
const users = data.User || [];
const credentials = data.Credential || [];

function sqlString(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

const statements = [];

statements.push("DELETE FROM Credential;");
statements.push("DELETE FROM User;");
statements.push("DELETE FROM Photo;");

for (const user of users) {
  statements.push(
    `INSERT INTO User (id, username, isAdmin) VALUES (${sqlString(user.id)}, ${sqlString(user.username)}, ${user.isAdmin ? 1 : 0});`
  );
}

for (const cred of credentials) {
  statements.push(
    `INSERT INTO Credential (id, credentialId, publicKey, counter, transports, userId, createdAt) VALUES (${sqlString(cred.id)}, ${sqlString(cred.credentialId)}, ${sqlString(cred.publicKey)}, ${Number(cred.counter) || 0}, ${sqlString(cred.transports)}, ${sqlString(cred.userId)}, ${sqlString(cred.createdAt)});`
  );
}

for (const photo of photos) {
  statements.push(
    `INSERT INTO Photo (id, key, color, imageHighRes, imageLowRes, imageX, imageY, clicks, createdAt) VALUES (${Number(photo.id)}, ${sqlString(photo.key)}, ${sqlString(photo.color)}, ${sqlString(photo.imageHighRes)}, ${sqlString(photo.imageLowRes)}, ${Number(photo.imageX)}, ${Number(photo.imageY)}, ${Number(photo.clicks) || 0}, ${sqlString(photo.createdAt)});`
  );
}

const sqlFile = path.join(root, "data", "import.sql");
fs.writeFileSync(sqlFile, statements.join("\n") + "\n");
console.log(`Wrote ${statements.length} statements to data/import.sql`);
console.log(`Importing ${users.length} users, ${credentials.length} credentials, ${photos.length} photos (${mode})...`);

const result = spawnSync(
  "npx",
  ["wrangler", "d1", "execute", "pixelbypixel-db", mode, "--file", sqlFile],
  { cwd: root, stdio: "inherit", shell: process.platform === "win32" }
);

process.exit(result.status ?? 1);
