#!/usr/bin/env bash
# Create Cloudflare D1 + KV and print IDs to paste into wrangler.jsonc
set -euo pipefail
cd "$(dirname "$0")/.."

echo "Creating D1 database 'pixelbypixel'..."
npx wrangler d1 create pixelbypixel

echo
echo "Creating KV namespace 'SESSIONS'..."
npx wrangler kv namespace create SESSIONS

echo
echo "Next:"
echo "1. Paste database_id and KV id into wrangler.jsonc"
echo "2. Set r2_buckets[0].bucket_name to your existing R2 bucket"
echo "3. npx wrangler secret put SESSION_SECRET"
echo "4. npm run db:migrate:remote && npm run db:import:remote"
echo "5. Connect the GitHub repo in Cloudflare dashboard (Workers Builds)"
