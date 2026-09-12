# REELSMAKER admin backend (Cloudflare Worker)

This Worker stores the site's editable content in a Cloudflare KV namespace and
exposes it to the public site (`index.html`) and the hidden admin panel
(`panel-r7k2q9.html`).

## Deploy

1. Install Wrangler if you don't have it: `npm install -g wrangler`
2. Log in: `wrangler login`
3. Create the KV namespace:
   ```
   cd worker
   wrangler kv namespace create CONTENT_KV
   ```
   Copy the `id` it prints into `wrangler.toml` (replace `REPLACE_WITH_KV_NAMESPACE_ID`).
4. Set the two secrets:
   ```
   wrangler secret put ADMIN_PASSWORD
   wrangler secret put SESSION_SECRET
   ```
   - `ADMIN_PASSWORD` is the password used to log into the admin panel — pick something strong.
   - `SESSION_SECRET` is a random string used to sign login sessions (e.g. run `openssl rand -hex 32` and paste the result).
5. Deploy:
   ```
   wrangler deploy
   ```
   Wrangler prints the Worker's URL, something like `https://reelsmaker-admin.<your-subdomain>.workers.dev`.

## After deploying

Send the deployed Worker URL back and it gets wired into both:
- `index.html` — the `WORKER_URL` constant near the top of the main `<script>` block, so the live site pulls saved edits.
- `panel-r7k2q9.html` — the `WORKER_URL` constant near the top of its `<script>` block, so the admin panel can log in and save.

Until that URL is set, the site shows the built-in default copy and the admin
panel runs in a demo mode that doesn't persist changes.

## Notes

- CORS is locked to `https://arsanukaef.ru` and `https://www.arsanukaef.ru` in
  `src/index.js` (`corsHeaders`). Add any other domain you serve the site from there.
- The admin login has no rate limiting. The password should be long/random since
  anyone who finds the Worker URL can attempt logins against it.
- Session tokens are signed with `SESSION_SECRET` and expire after 12 hours
  (`TOKEN_TTL_SECONDS` in `src/index.js`).
