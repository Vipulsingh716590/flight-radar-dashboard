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

### 1. Push the repository to GitHub/GitLab

Render and Netlify deploy from a Git repository.

### 2. Render: API and database

1. Render dashboard -> **New -> Blueprint**, choose the repository. It reads `render.yaml`.
2. Fill the prompted values: `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `FRONTEND_ORIGIN` (you can use a
   placeholder now and correct it after step 3).
3. Wait for the deploy and open `https://<service>.onrender.com/api/health`.

`render.yaml` uses Render's **free** plans, which is right for trying the app out. A free web
service sleeps when idle (the poller stops, so history has gaps until the next request wakes it),
and a free database is time-limited and deleted after that period. For continuous data change the
two `plan:` lines to paid plans (check Render's current plan names) and redeploy.

### 3. Netlify: frontend

1. **Add new site -> Import from Git**, pick the repository. `netlify.toml` supplies the build.
2. Site settings -> Environment variables: `API_BASE_URL=https://<service>.onrender.com`.
3. Deploy, then put the final site URL into Render's `FRONTEND_ORIGIN` (exact origin, no trailing
   slash) and redeploy the API.
4. If your API host is not `*.onrender.com`, edit `connect-src` in `netlify.toml` (the
   Content-Security-Policy would otherwise block calls to it).

### The cross-site cookie caveat (read this)

With two different hosts, the session cookie is a *third-party* cookie from the browser's point of
view (`COOKIE_SAMESITE=none`). It works in Chrome and Firefox today, but **Safari (and browsers
with strict privacy settings) block it**, so sign-in appears to succeed and then the dashboard
bounces back to the login page.

The reliable fix is to put both under one parent domain, e.g. `radar.example.com` (Netlify) and
`api.example.com` (Render custom domain). They are then the *same site*:

1. Add the custom domains in both dashboards.
2. `API_BASE_URL=https://api.example.com`, `FRONTEND_ORIGIN=https://radar.example.com`.
3. Set `COOKIE_SAMESITE=lax` on the API and update `connect-src` in `netlify.toml`.

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
| Map is blank | Basemap tiles blocked (CSP `img-src`/`connect-src` must allow `tiles.openfreemap.org`) |
| 429 on login | Rate limit; wait the `Retry-After` seconds, or see `LOGIN_*` settings |

## What was and was not verified

Verified on a development machine **without Docker**:

- the compiled API starts with `NODE_ENV=production`, applies migrations and serves requests;
- the production Angular build under the exact security headers (CSP) used by nginx/Netlify:
  sign-in, live map, airport pins, stream;
- same-origin mode (proxy) and cross-origin mode (`apiBaseUrl` + CORS + credentials);
- `40-runtime-config.sh`, the compose and Render YAML, `netlify.toml` and the nginx template
  parse and behave as intended (`frontend/scripts/serve-prod-like.mjs` reproduces the headers).

**Not verified:** building the Docker images, `docker compose up`, the nginx container itself,
Caddy certificate issuance, and the Render/Netlify deploys. Expect to read build logs on the
first run; the likeliest issues are listed above.
