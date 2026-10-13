# Flight Radar India

Live air-traffic dashboard for India: planes currently airborne over India on a live map.

> **Status: built and deployed.** Live map, routes and tagging, sign-in, PostgreSQL history with
> charts and airport boards, container + hosting configuration. Running on Render (API,
> database) and Netlify (dashboard). [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) says what was and was
> not verified.

## Pages

| URL | Page |
| --- | --- |
| `/login` | Sign in |
| `/` | **Live map**: counters, map, flight card, colour-by, airport pins |
| `/flights` | Searchable, sortable table of every airborne flight |
| `/insights` | Charts: traffic by hour, busiest airports, airline share |
| `/airports`, `/airports/DEL` | Airport search and live arrivals/departures board (bookmarkable) |

### The app frame

- **Navigation rail** on the left (icon + label); on phones the same navigation becomes a
  **bottom tab bar**.
- **Top bar**: one search box for flights and airports, feed health (Live / partial / stale /
  sources down, with the age of the data), **light/dark theme** switch and the **account menu**
  (email, role, sign out). Locally with sign-in off it shows a "Login off" tag instead.
- **Themes**: Dark, Light and **Glass** (blue-grey, translucent panels, lime accent), picked from the
  palette button. The choice is remembered; without one the system preference decides. The map
  basemap and the charts follow the theme.
- **3D**: the map has a **2D / 3D / Globe** switch. *3D* tilts the map and adds terrain (free
  Terrarium elevation tiles from `s3.amazonaws.com`) and 3D buildings at high zoom; planes float
  above a ground shadow in proportion to their altitude band. *Globe* shows the earth as a sphere.
  *Follow in 3D* on the flight card is a chase camera that keeps the flight centred and looks along
  its heading (dragging the map stops it). Altitude is shown by band, not metre-accurate.
- **Phones**: the flight card is a bottom sheet with big origin/destination codes and a
  progress line; the Flights page shows route cards instead of a table.
- The live map is full-bleed: counters float over its top-left and the legend sits bottom-left.
  Three tools (**Settings**, **Weather**, **Filters**) are buttons at the top right on desktop and a
  floating dock at the bottom on phones; each opens a popover (desktop) or a bottom sheet
  (phones). On phones the 2D/3D/Globe switch is inside Settings, so nothing is pinned over the
  counters or the flight card, and the dock steps aside while a flight card is open.

Map features worth knowing:

- **Flight card** (click a plane, or pick a flight in search/table): airline, aircraft, origin and
  destination, trip progress, altitude, speed, vertical rate. When the position does not fit the
  callsign's route the card says so instead of drawing a progress bar.
- **Recorded path**: the selected flight's track from the last 6 hours, from PostgreSQL history.
- **Weather** (panel): a rain-radar overlay with a play/pause loop (RainViewer) and current
  conditions for the selected flight or the map centre: temperature, sky, wind, clouds, visibility,
  pressure, rain, and the wind at ~34,000 ft (Open-Meteo).
- **Filters** (panel): hide route types or altitude bands, or show only flights with a known route;
  the button shows how many filters are active and the panel "Showing X of Y". The selected flight
  always stays visible.
- **Emergency squawks**: flights squawking 7500 (hijack), 7600 (radio failure) or 7700 (general
  emergency) raise a red banner (click to open the flight), get a red ring on the map and a red
  line on the flight card. Emergencies are never hidden by filters.
- **Aircraft photo** on the flight card from Planespotters.net, with the photographer credit and a
  link back (looked up by ICAO24 hex, then by registration; many aircraft have no photo).
- **Saved flights** (star on the card, **Saved** tool): kept in this browser's localStorage, shown
  with a gold ring on the map and listed with their route, or "Not in range".
- **Units** (Settings): aviation (ft, kt, ft/min) or metric (m, km/h, m/s) on the flight card.
- **Share** on the flight card copies a link (`/?flight=<icao24>`) that opens the map on that flight.
- **My location** button centres the map on the device position (browser permission required).
- **Colour by** route type or altitude; **airport pins** (click for the board); live
  "aircraft in view" count.

## Layout

```
backend/              NestJS API: polls ADS-B feeds, filters to India, streams over SSE
  Dockerfile          API image
frontend/             Angular + MapLibre GL dashboard
  Dockerfile          web image (nginx, proxies /api)
  nginx/              nginx template, security headers, runtime config writer
docs/DEPLOYMENT.md    deployment guide, variables, troubleshooting
docker-compose.yml    postgres (+ api, web, caddy with profiles)
render.yaml           Render Blueprint (API + database)
netlify.toml          Netlify build and headers (frontend)
run-local.cmd         one-command local start on Windows (see stop-local.ps1)
```

## Run locally

Requires Node 22+ and a PostgreSQL database.

```bash
# PostgreSQL, option A: Docker
docker compose up -d postgres

# PostgreSQL, option B: no Docker - runs real PostgreSQL binaries from npm (dev only)
cd backend && npm install && npm run db:dev      # keep this terminal open
```

```bash
# API on http://localhost:3000 (runs migrations and seeds the admin + airports on start)
cd backend
cp .env.example .env     # then set JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, DATABASE_URL
npm install
npm run start:dev

# dashboard on http://localhost:4200
cd frontend
npm install
npm start
```

Open http://localhost:4200. The first data appears after the first sweep of India
(about 30-40 seconds); after that it refreshes every ~75 seconds.

Tests: `npm test` in `backend/` and `ng test --watch=false` in `frontend/`. The PostgreSQL
integration tests only run when `TEST_DATABASE_URL` is set (they use a throw-away schema):

```bash
TEST_DATABASE_URL=postgres://flightradar:flightradar@localhost:5432/flightradar npm test
```

## Run it in containers

```bash
cp .env.example .env        # JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, POSTGRES_PASSWORD
docker compose --profile app up -d --build        # http://localhost:8080
docker compose --profile app --profile tls up -d --build   # public, automatic HTTPS (set DOMAIN)
```

## Deploy

Two documented setups, with variables, steps, backups and troubleshooting in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md):

- **Netlify + Render** (what is running): static dashboard on Netlify, containerised API and
  PostgreSQL on Render's **free** plans (`render.yaml`, `netlify.toml`). Both rebuild
  automatically on every push to `main`. Different hosts mean a cross-site session cookie, which
  Safari blocks; custom domains under one parent domain are the reliable fix.
- **One server**: Docker Compose, with Caddy for HTTPS. One origin, the simplest security model.

Things learned the hard way, now baked into the repo:

- Images build on **Node 24** (npm 11): the lock files are written by npm 11 and npm 10 rejects
  them with `Missing: typescript@... from lock file`.
- A free Render instance has **512 MB RAM and a fraction of a CPU**. Buffering India's border at
  start-up needed more than 192 MB of heap, so the buffered area is **pre-built**
  (`backend/data/india-buffered.geojson`, `node backend/scripts/build-india-area.mjs`).
- The API prints start-up failures in full (`FATAL: the API could not start.`) so a hosted
  deploy never dies with only "exited with status 1".
- `ADMIN_EMAIL` must be a real email address and `ADMIN_PASSWORD` at least 12 characters, or the
  API refuses to start.

Production behaviour worth knowing: the API refuses to start without `JWT_SECRET`, the session
cookie is `Secure`, the dashboard is served with a strict Content-Security-Policy, and the browser
learns where the API is from `/config.json` at start-up (so one build fits any host).

## How it works

1. `IngestService` polls on a timer (never from the browser). It tries providers in
   `PROVIDER_ORDER` and falls back automatically when one is rate limited or failing.
2. **adsb.fi** is queried tile by tile (~28 circles of 250 NM, one request per 1.1 s,
   as its 1 req/s limit requires). **OpenSky** is the fallback and uses one bounding-box request.
3. `RouteLookupService` resolves origin/destination per callsign in the background via
   [adsbdb.com](https://www.adsbdb.com) (cached, one request at a time, only airline-style callsigns).
   Flights are then tagged `arrival` / `departure` / `domestic` / `overflight` / `unknown`
   using the OurAirports list of Indian airports. An unknown route is never guessed.
4. `FlightsService` keeps only positions inside the India polygon (Natural Earth, India
   point of view) plus a 50 km sea buffer that never extends over neighbouring land, and
   deduplicates by ICAO24.
5. `HistoryService` stores each cycle in PostgreSQL: one `flight_snapshots` row per flight
   (kept `RETENTION_DAYS`, default 7) and a running average per hour in `stats_hourly` (kept
   forever). Cycles with missing tiles, or whose routes are still being looked up, are kept out
   of the hourly averages so a restart does not distort the charts.
6. The latest snapshot is pushed to all browsers over `GET /api/stream` (SSE).
7. The browser moves each plane forward from its last fix using speed and heading, so
   markers glide between refreshes (capped at 3 minutes).

## Sign-in

The only account is the **seed admin** from `backend/.env` (`ADMIN_EMAIL` + `ADMIN_PASSWORD`
or `ADMIN_PASSWORD_HASH`). There is no registration. The backend refuses to start without it.
Generate a hash instead of keeping a plain password in the file:

```bash
node -e "require('bcryptjs').hash(process.argv[1],12).then(console.log)" "your-long-password"
```

- Session = JWT (HS256, 8 h) in an **httpOnly** cookie; JavaScript cannot read it.
- Roles `admin` / `viewer` are enforced by the backend (`@Roles()`). The seed admin is written to
  the `users` table on start (and updated when `.env` changes); with no registration there are
  no viewer accounts yet.
- Login is rate limited: 5 failures per IP and 20 per email per 15 min, then HTTP 429.
- **Local only:** `AUTH_DISABLED=true` in `backend/.env` skips sign-in completely (the header shows
  "Login off"), and `LOGIN_RATE_LIMIT=off` removes the lockout. Both are refused when
  `NODE_ENV=production`, so a deployed API can never start with them. Remove the line (or set
  `false`) and restart the API to bring the login back.
- Every endpoint except `/api/auth/login`, `/api/auth/logout` and `/api/health` needs the cookie,
  including the SSE stream (which also ends when the session expires).
- Different sites for frontend and API (Netlify + Render): set `COOKIE_SAMESITE=none` (HTTPS only)
  and `FRONTEND_ORIGIN`; behind a proxy set `TRUST_PROXY_HOPS=1`.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/stream` | SSE: `snapshot` event on connect and after every refresh |
| `GET /api/flights/live` | Latest flights as JSON |
| `GET /api/stats/summary` | Counts + provider health |
| `GET /api/stats/hourly?hours=24` | Average flights per hour (max 168 h) |
| `GET /api/stats/top-airports?hours=24&limit=10` | Busiest Indian airports |
| `GET /api/stats/airlines?hours=24&limit=8` | Airline share by distinct aircraft |
| `GET /api/airports?search=del` | Airport search |
| `GET /api/airports/pins` | Airports with an IATA code (map pins) |
| `GET /api/flights/:icao24/track?hours=6` | Recorded positions of one aircraft |
| `GET /api/airports/:code` | Live arrivals/departures board (IATA or ICAO) |
| `POST /api/auth/login` | Public. Sets the session cookie |
| `POST /api/auth/logout` | Public. Clears the cookie |
| `GET /api/auth/me` | Current user (used by the SPA on load) |
| `GET /api/health` | Public liveness probe, nothing else |

## Data sources and terms

- **adsb.fi** open data API: personal, non-commercial use only; credit
  [adsb.fi](https://adsb.fi). 1 request/second limit.
- **OpenSky Network**: optional fallback. Anonymous access is ~400 credits/day (a full
  India query costs 4), so set `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET` for 4000/day.
- **airplanes.live** now requires approval from its operators before API use, so it is not
  wired in. The provider interface (`backend/src/ingest/aircraft.ts`) makes adding it easy.
- Basemap: OpenFreeMap (OpenStreetMap data). Map borders are as drawn by OSM.
- **Terrain**: Terrarium elevation tiles (`s3.amazonaws.com/elevation-tiles-prod`), 3D view only.
- **Weather**, called from the browser, no API key:
  - [Open-Meteo](https://open-meteo.com) `api.open-meteo.com/v1/forecast`: current conditions and
    the 250 hPa wind. Free for non-commercial use; credit Open-Meteo.
  - [RainViewer](https://www.rainviewer.com/api.html) `api.rainviewer.com/public/weather-maps.json`
    plus `tilecache.rainviewer.com` radar tiles (free tiles are limited to zoom 7 and are scaled
    up beyond that). Credit RainViewer.
- **Aircraft photos**: [Planespotters.net public API](https://www.planespotters.net/photo/api)
  `api.planespotters.net/pub/photos/{hex|reg}/...`, images from `t.plnspttrs.net`. Photos remain the
  photographers' property; the card shows the credit and links to the photo page.
  These hosts must be allowed by the Content-Security-Policy (`frontend/public/_headers`,
  `frontend/nginx/security-headers.conf`, `netlify.toml`); the Permissions-Policy allows
  `geolocation=(self)` for the location button.

## Known limitations

- ADS-B only: aircraft without a transponder, military flights and gaps in receiver
  coverage are missing, so counts are lower than the true number of aircraft.
- Routes come from a callsign -> route table (adsbdb), not from the aircraft. They can be
  wrong for re-used callsigns or re-routed flights, and about 20-35% of flights have none.
- **Delayed flights** cannot be computed: free ADS-B feeds carry no schedule data. The card
  shows N/A until a schedule source is chosen.
- The route cache is in memory and is rebuilt after a restart (about a minute).
- Sessions cannot be revoked server-side before they expire (stateless JWT); logging out only
  clears the browser cookie. Rate limiter and sessions assume a single backend instance.
- The live view starts empty after a restart until the first sweep finishes; history survives
  restarts.
- "Busiest airports" and "Airline share" count *distinct aircraft seen airborne with that route*,
  not landings: a flight still hours from its destination is included. Hourly averages are only
  as good as the route data available when each cycle ran.
- `npm run db:dev` is for machines without Docker only. It is not for production.
- **Free hosting limits**: a free Render service sleeps after ~15 minutes without requests (the
  poller stops, so history has gaps, and the first request takes 30-60 s); the free database is
  time-limited by Render. For continuous data use paid plans (`plan:` in `render.yaml`).
- Netlify and Render are different sites, so the browser stores the session cookie as a
  third-party cookie (`COOKIE_SAMESITE=none`). Safari and strict privacy settings block that.
