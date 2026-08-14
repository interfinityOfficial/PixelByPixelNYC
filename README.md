# Pixel by Pixel NYC

Cloudflare Workers app (Hono) with D1 metadata, R2 images, and browser-side image processing (compress + Vibrant + hash).

## Stack

- **Worker** — Hono routes + HTML templates in `views/`
- **D1** (`pixelbypixel-db`) — Photo / User / Credential
- **R2** — `high-res/` and `low-res/` objects (public CDN)
- **KV** — WebAuthn login challenges
- **Browser** — crop, compress, Vibrant color, SHA-256 hash, low-res canvas

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run db:import:local   # requires data/data.json
npm run dev
```

## Cloudflare setup (one-time)

```bash
npx wrangler login
bash scripts/bootstrap-cloudflare.sh
```

Then:

1. Paste `database_id` and KV `id` into `wrangler.jsonc`
2. Set `r2_buckets[0].bucket_name` to your **existing** R2 bucket
3. `npx wrangler secret put SESSION_SECRET`
4. `npm run db:migrate:remote && npm run db:import:remote`
5. Optional local deploy: `npm run deploy`

## Deploy from GitHub (Cloudflare dashboard)

Preferred flow:

1. Push this repo to GitHub
2. Dashboard → **Workers & Pages** → **Create** → **Import a repository**
3. Deploy command: `npx wrangler deploy`
4. Worker name must match `wrangler.jsonc` → `name` (`pixelbypixel`)
5. Confirm D1 / R2 / KV bindings + `SESSION_SECRET`
6. Attach custom domain `pixelbypixel.nyc` (WebAuthn `RP_ID` stays in sync)

There is also an optional GitHub Action in `.github/workflows/deploy.yml` if you prefer Actions over CF Builds.

## Data import

Keep exports in `data/` (gitignored). Expected shape: `data/data.json` with `Photo`, `User`, `Credential` arrays.

```bash
npm run db:import:remote
```

## Notes

- Legacy Express app: `server.js` (PM2). Do not use for new deploys.
- Image URLs keep `https://cdn.pixelbypixel.nyc/storage/...` via `R2_PUBLIC_URL`.
