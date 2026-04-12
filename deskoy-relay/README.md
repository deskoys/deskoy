# Deskoy relay (feedback + bugs → Discord)

Lives **inside** this repo under `deskoy-relay/`. Vercel only deploys this folder; the Electron app is unchanged.

**Vercel import:** connect **this** Git repo → set **Root Directory** to **`deskoy-relay`** → Deploy.

Then:

1. **Environment variables** on that project: `DISCORD_FEEDBACK_WEBHOOK_URL`, `DISCORD_BUG_WEBHOOK_URL` → **Redeploy**.
2. **Domain** `api.deskoy.com` (or your API host) on that project + DNS CNAME.
3. Desktop relay URLs are in `src/index.ts` (`DESKOY_*_RELAY_URL` defaults). Rebuild the app after deploy.

**If you hate subdomains:** set `DESKOY_FEEDBACK_RELAY_URL` / `DESKOY_BUG_RELAY_URL` at build time (see `src/index.ts`).
