# Deploying Flight Radar India

Two supported setups. Pick one.

| | **A. One server** (Docker Compose) | **B. Netlify + Render** |
| --- | --- | --- |
| Frontend | nginx container | Netlify (static) |
| API | container | Render web service (Docker) |
| Database | PostgreSQL container | Render PostgreSQL |
| HTTPS | Caddy container, automatic | provided by Netlify / Render |
| Browser sees | one origin | two origins (cross-site cookie) |
| Best for | a VPS you control, simplest security model | no server to manage |

Everything below assumes you have run the project locally once (see the README).

## What is in the repo

| File | Purpose |
| --- | --- |
| `backend/Dockerfile` | API image (multi-stage, non-root, health check) |
| `frontend/Dockerfile` | web image: Angular build + nginx, `/api` proxied to the API |
| `frontend/nginx/*` | nginx config template, security headers (CSP), runtime `config.json` writer |
| `docker-compose.yml` | `postgres`, and with profiles `app` (`api`, `web`) and `tls` (`caddy`) |
| `Caddyfile` | HTTPS entry point for the `tls` profile |
| `.env.example` | variables for compose |
| `render.yaml` | Render Blueprint: API + database |
| `netlify.toml` | Netlify build, SPA redirect, headers |
| `frontend/public/config.json` | where the browser finds the API (`""` = same origin) |

## Variables

### API (`backend/.env`, compose `.env`, or the host's dashboard)

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | `postgres://user:pass@host:5432/db` |
| `DATABASE_SSL` | no | `off` (default), `require` (encrypt, certificate not checked), `verify` |
| `JWT_SECRET` | **yes in production** | 32+ characters. The server refuses to start without it |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | yes | The only account (no registration). Password 12+ characters. Or set `ADMIN_PASSWORD_HASH` (bcrypt) instead |
| `FRONTEND_ORIGIN` | yes | Exact origin of the dashboard (scheme + host + port). The only CORS origin |
| `COOKIE_SAMESITE` | no | `lax` (default). `none` only when frontend and API are on different *sites* |
| `COOKIE_SECURE` | no | Defaults to true in production and when SameSite is `none` |
| `TRUST_PROXY_HOPS` | no | Reverse proxies in front of the API. Needed for correct client IPs (login rate limit) |
| `SESSION_HOURS` | no | Default 8 |
| `AUTH_DISABLED` | no | `true` turns sign-in **off**. Local development only: the API refuses to start with it when `NODE_ENV=production` |
| `LOGIN_RATE_LIMIT` | no | `off` removes the failed-login lockout. Local only, refused in production |
| `INDIA_BUFFER_KM` | no | Default 50. If you change it, rebuild `data/india-buffered.geojson` with `node scripts/build-india-area.mjs <km>`, or start-up computes it (needs far more memory) |
| `LOGIN_MAX_ATTEMPTS`, `LOGIN_WINDOW_MINUTES` | no | Default 5 per 15 min per IP (email limit is 4x) |
| `POLL_INTERVAL_SECONDS` | no | Minimum 60, default 75 |
| `RETENTION_DAYS` | no | Snapshot rows older than this are deleted (default 7) |
| `PROVIDER_ORDER` | no | `adsbfi,opensky` |
| `OPENSKY_CLIENT_ID`, `OPENSKY_CLIENT_SECRET` | no | Raises OpenSky's daily quota |

Generate secrets:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

### Web image

| Variable | Default | Notes |
| --- | --- | --- |
| `API_UPSTREAM` | `http://api:3000` | Where nginx forwards `/api` |
| `API_BASE_URL` | empty | Only when the API is **not** reached through this nginx. Written to `config.json` at container start |

---

## A. One server with Docker Compose

Needs a machine with Docker and, for HTTPS, a DNS name pointing at it and ports 80/443 open.

```bash
cp .env.example .env
# edit .env: JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, POSTGRES_PASSWORD, PUBLIC_URL, DOMAIN

# Just the app, plain HTTP on 127.0.0.1:8080 (testing, or behind your own proxy):
docker compose --profile app up -d --build

# Public, with automatic HTTPS (also set PUBLIC_URL=https://<DOMAIN> and TRUST_PROXY_HOPS=2):
docker compose --profile app --profile tls up -d --build
```

Then open `PUBLIC_URL` and sign in. Check:

```bash
docker compose ps                         # api and web should be "healthy"
docker compose logs -f api                # "API on http://localhost:3000/api"
curl -s https://<DOMAIN>/api/health       # {"status":"ok"}
```

Notes:

- `POSTGRES_PASSWORD` must be URL-safe (letters, digits, `-`, `_`) because it is placed in a URL.
- `TRUST_PROXY_HOPS`: `1` with nginx alone, `2` with Caddy in front.
- Over plain HTTP on a LAN address the browser will not store the `Secure` session cookie.
  Use `localhost`, HTTPS, or (testing only) `COOKIE_SECURE=false`.

### Updating

```bash
git pull
docker compose --profile app up -d --build
```

Schema changes are applied automatically at start-up by migrations.

### Backup and restore

```bash
docker compose exec -T postgres pg_dump -U flightradar flightradar | gzip > backup-$(date +%F).sql.gz
gunzip -c backup-2026-10-11.sql.gz | docker compose exec -T postgres psql -U flightradar flightradar
```

`flight_snapshots` is the bulk of the data (about 190 rows per poll, ~1.3 million rows for the
default 7 days). Lower `RETENTION_DAYS` on a small disk.

---

## B. Netlify (frontend) + Render (API + database)

This is the setup that is running. Both services deploy from the same GitHub repository.

### 1. Render: API and database (free plans)

1. Push the repository to GitHub.
2. Open <https://render.com/deploy?repo=https://github.com/OWNER/REPO> (or **New -> Blueprint**).
   Sign in (GitHub is easiest) and authorise Render for the repository.
3. The Blueprint (`render.yaml`) creates `flightradar-api` (Docker web service) and
   `flightradar-db` (PostgreSQL). Render also asks for three values:

   | Variable | Value | Notes |
   | --- | --- | --- |
   | `ADMIN_EMAIL` | your email | **Must look like `name@domain.tld`**, no spaces or quotes |
   | `ADMIN_PASSWORD` | a long password | **At least 12 characters**; it protects a public site |
   | `FRONTEND_ORIGIN` | the dashboard's exact origin | e.g. `https://your-site.netlify.app`, no trailing `/` |

   If any of these is skipped or wrong the API stops at start-up with a clear `FATAL` line in the
   logs. Fix it under the service's **Environment** tab and use **Save, rebuild, and deploy**
   (typing a value is not enough; the button saves it).
4. The first build takes a few minutes. When the service is **Live**, open
   `https://<service>.onrender.com/api/health`: it must answer `{"status":"ok"}`.

**Auto-deploy**: the service is set to *Auto-Deploy: On Commit* (`autoDeployTrigger: commit` in
`render.yaml`), but for a service created from a public repo URL Render may have no GitHub
webhook, so pushes do not deploy (observed here). The fallback is
`.github/workflows/render-deploy.yml`: on every push that touches `backend/**` it calls the
service's **Deploy Hook**. One-time setup: Render -> service -> *Settings -> Deploy Hook* -> copy
the URL; GitHub -> repo *Settings -> Secrets and variables -> Actions* -> new secret
`RENDER_DEPLOY_HOOK`. Without the secret the workflow fails (red) so a missing secret is not overlooked.
**Manual Deploy -> Deploy latest commit** always works too.

**Free plan behaviour**: the service sleeps after ~15 minutes without requests. The background
poller stops with it (history gaps) and the next request needs 30-60 s to wake it. The free
database is time-limited by Render. For continuous data change both `plan:` lines in
`render.yaml` to paid plans.

### 2. Netlify: dashboard

1. **Add new project -> Import from Git**, choose the repository and branch `main`.
2. Nothing to type: `netlify.toml` supplies the build (base `frontend`, `npm ci --include=dev &&
   npm run build`, publish `dist/frontend/browser`, Node 24) **and the API address**
   (`API_BASE_URL`, written into `config.json` during the build). Change that value if your API
   host differs.
3. If the site is created as *private* (Netlify's default for new sites in some plans), set
   **Project configuration -> Access & security -> Visitor access** to public, otherwise every
   request returns 401 with a Netlify login redirect.
4. Put the site's final URL into Render's `FRONTEND_ORIGIN` (exact origin) and redeploy the API.
5. Every push to `main` now rebuilds the dashboard.

**Without Git** (Netlify Drop): build locally and upload the folder.

```bash
cd frontend
API_BASE_URL=https://<service>.onrender.com npm run build
# then drag frontend/dist/frontend/browser (or a zip of its contents) onto the Netlify Deploys page
```

`_redirects` and `_headers` live in `frontend/public`, so deep links and the security headers
also work for uploads (`netlify.toml` is ignored by manual deploys).

### The cross-site cookie caveat (read this)

With two different hosts, the session cookie is a *third-party* cookie from the browser's point of
view (`COOKIE_SAMESITE=none`, set in `render.yaml`). It works in Chrome and Firefox today, but
**Safari (and browsers with strict privacy settings) block it**, so sign-in appears to succeed and
the dashboard then bounces back to the login page.

The reliable fix is one parent domain, e.g. `radar.example.com` (Netlify) and
`api.example.com` (Render custom domain): they are then the *same site*.

1. Add the custom domains in both dashboards.
2. `API_BASE_URL` in `netlify.toml` -> `https://api.example.com`, `FRONTEND_ORIGIN` ->
   `https://radar.example.com`.
3. Set `COOKIE_SAMESITE=lax` on the API and update `connect-src` in `netlify.toml` and
   `frontend/public/_headers`.

Option A avoids the problem entirely because the browser only talks to one origin.

---

## Security checklist

- [ ] `JWT_SECRET` is random, 32+ characters, and not shared between environments.
- [ ] `ADMIN_PASSWORD` is unique and long (or use `ADMIN_PASSWORD_HASH`).
- [ ] Only HTTPS is exposed publicly. The database port is not published beyond `127.0.0.1`.
- [ ] `FRONTEND_ORIGIN` is exactly the public dashboard origin (not `*`, not extra origins).
- [ ] `TRUST_PROXY_HOPS` matches the number of proxies, otherwise the login limiter sees the
      proxy's address for everyone (or trusts a spoofed header).
- [ ] No secret is committed: `.env` files are git-ignored; only `*.env.example` is tracked.
- [ ] Backups of PostgreSQL exist and a restore has been tried once.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| API exits at start: `JWT_SECRET is required` | `NODE_ENV=production` without `JWT_SECRET` |
| API exits: `DATABASE_URL is not set` / connection refused | Database not up, wrong URL, or needs `DATABASE_SSL=require` |
| Login works, then back at the login page | Cookie not stored: HTTP on a non-localhost address, wrong `FRONTEND_ORIGIN`, or Safari with cross-site cookies |
| Browser console: CORS error | `FRONTEND_ORIGIN` differs from the page origin by scheme/host/port |
| Console: "Refused to connect ... Content Security Policy" | API origin missing from `connect-src` (cross-origin setup) |
| Dashboard loads but stays "Connecting…" | A proxy buffers the stream. nginx and Caddy configs here disable buffering; check any extra proxy |
| Weather panel says it could not be loaded / no radar | CSP `connect-src` must allow `api.open-meteo.com`, `api.rainviewer.com` and `api.planespotters.net`, `img-src` must allow `tilecache.rainviewer.com` and `t.plnspttrs.net` (already in the shipped headers); the services are free and may rate-limit |
| Map is blank | Basemap tiles blocked (CSP `img-src`/`connect-src` must allow `tiles.openfreemap.org`; the 3D terrain also needs `s3.amazonaws.com`) |
| 429 on login | Rate limit; wait the `Retry-After` seconds, or see `LOGIN_*` settings |
| Render build: `npm ci ... Missing: typescript@... from lock file` | Image uses npm 10; the Dockerfiles must use `node:24-alpine` (npm 11) |
| Render: `Exited with status 1` right after "Starting Nest application" | Read the log lines above it. `FATAL: ... ADMIN_EMAIL is not a valid email address`, `ADMIN_PASSWORD must be at least 12 characters`, or `... is not set` |
| Render: start-up dies with no message, or "heap out of memory" | Not enough RAM for the host (512 MB). The buffered India area must ship as `data/india-buffered.geojson` |
| Netlify: every URL answers 401 "Login Redirect" | Site visibility is private; set Visitor access to public |
| Netlify: login says it cannot reach the server | `config.json` still has `"apiBaseUrl": ""`: the build ran without `API_BASE_URL`; check `/config.json` on the site |
| Netlify build fails at `ng: not found` | `NODE_ENV=production` made `npm ci` skip dev dependencies; the build uses `npm ci --include=dev` |
| Netlify: "Account credit usage exceeded" | The Netlify account is out of credits; deploys stay blocked until credits are added |
| First request to the API takes a minute | Free Render instance was asleep |

## What was and was not verified

**Verified on the live deployment** (Render free plan + Netlify):

- the backend Docker image builds on Render and the API starts, migrates the database and seeds the
  admin;
- sign-in from the Netlify origin (CORS with credentials, `SameSite=none` cookie), the live
  stream, and the map;
- start-up memory: the API starts with a 96 MB heap limit locally (it failed above 192 MB before
  the buffered area was pre-built).

**Verified locally without Docker**: the production Angular build under the exact security headers
of nginx/Netlify, same-origin and cross-origin modes, `40-runtime-config.sh`, and the compose /
Render / Netlify files parse.

**Not verified**: `frontend/Dockerfile` and the nginx container, `docker compose up`, and Caddy
certificate issuance.
