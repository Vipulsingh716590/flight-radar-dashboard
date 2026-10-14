# Architecture

How Flight Radar India is put together: the moving parts, where data comes from, what
runs on the server and what runs in the browser. The diagrams are Mermaid, so GitHub
renders them inline.

For running and deploying see the [README](../README.md) and
[DEPLOYMENT.md](DEPLOYMENT.md).

## 1. Big picture

```mermaid
flowchart TB
  subgraph ext["External data (called by the server)"]
    adsb["adsb.fi<br/>live positions"]
    opensky["OpenSky<br/>fallback feed"]
    adsbdb["adsbdb<br/>callsign routes"]
    data["OurAirports + Natural Earth<br/>static datasets"]
  end

  subgraph render["Render: NestJS API + PostgreSQL"]
    ingest["Ingest<br/>poll + India filter"]
    routes["Route lookup<br/>kind + cache"]
    api["REST + SSE API<br/>auth, stats, replay"]
    db[("PostgreSQL<br/>history, users, airports")]
  end

  subgraph netlify["Netlify: Angular app (browser)"]
    spa["Map, flights, insights, airports"]
    pwa["PWA + browser storage"]
  end

  subgraph pub["Public APIs, no key (called by the browser)"]
    ofm["OpenFreeMap<br/>basemap"]
    terrain["AWS terrain<br/>3D elevation"]
    meteo["Open-Meteo<br/>weather + jet wind"]
    rain["RainViewer<br/>radar"]
    photos["Planespotters<br/>aircraft photos"]
    metar["metar.vatsim.net<br/>airport METAR"]
  end

  adsb --> ingest
  opensky --> ingest
  adsbdb --> routes
  data --> ingest
  ingest --> routes --> api
  api <--> db
  api -- "JSON + live stream" --> spa
  spa --- pwa
  ofm --> spa
  terrain --> spa
  meteo --> spa
  rain --> spa
  photos --> spa
  metar --> spa
```

The server fetches flight data once and shares it with everybody. Weather, photos, tiles
and METAR are fetched by each browser directly, so they never load the Render instance.

## 2. Live data cycle (every ~75 s)

```mermaid
sequenceDiagram
  participant P as Providers (adsb.fi, OpenSky)
  participant I as Ingest
  participant R as Route lookup (adsbdb)
  participant H as History (PostgreSQL)
  participant S as SSE stream
  participant B as Browser

  loop poll interval
    I->>P: 28 circular tiles (1 request/second)
    P-->>I: aircraft states
    I->>I: keep India + 50 km sea buffer
    I->>R: resolve callsigns (cached)
    R-->>I: origin / destination
    I->>H: store snapshot rows, hourly averages
    I->>S: publish snapshot
    S-->>B: "snapshot" event
  end
  B->>B: dead-reckon positions between events
```

Between two snapshots the browser moves each plane along its heading, so markers glide.
If every provider fails the last good snapshot is kept and the feed chip says so.

## 3. Repository layout

```
flight-radar-dashboard/
├─ backend/                    NestJS 12 API (ESM, vitest)
│  ├─ src/
│  │  ├─ ingest/               adsb.fi + OpenSky providers, tiling, poll loop
│  │  ├─ flights/              India filter, route lookup, flight kind, REST
│  │  ├─ stream/               Server-Sent Events
│  │  ├─ history/              snapshots, stats, per-flight track, replay
│  │  ├─ airports/             search, pins, arrivals/departures board
│  │  ├─ auth/                 login, JWT cookie, global guard, rate limits
│  │  ├─ db/                   TypeORM entities, migrations, data source
│  │  └─ config/               environment parsing and validation
│  ├─ data/                    India polygon, neighbours, pre-built buffered area
│  └─ scripts/                 build-india-area, embedded dev PostgreSQL
├─ frontend/                   Angular 22 app (standalone, signals, zoneless)
│  ├─ src/app/
│  │  ├─ core/                 api, live stream, replay, weather, METAR, solar,
│  │  │                        settings, watchlist, theme, PWA install
│  │  ├─ layout/               shell: rail / tab bar, top bar, search, themes
│  │  ├─ pages/                map page: tools, panels, emergency banner
│  │  ├─ map/                  MapLibre live map, flight card
│  │  ├─ kpi/ flights/ insights/ airports/ charts/ login/
│  ├─ public/                  manifest, service worker, icons, _headers
│  └─ scripts/                 runtime config, icons, prod-like server
├─ docs/                       ARCHITECTURE.md, DEPLOYMENT.md
├─ render.yaml  netlify.toml  docker-compose.yml  Caddyfile
└─ .github/workflows/          render-deploy.yml (deploy hook)
```

## 4. Backend modules

| Module | Responsibility |
| --- | --- |
| `ingest` | Polls providers in `PROVIDER_ORDER`, splits India into circular tiles, handles back-off |
| `flights` | Keeps only aircraft over India (+ sea buffer), classifies arrival / departure / domestic / overflight / unknown, resolves routes |
| `stream` | `GET /api/stream` (SSE): a snapshot on connect and after every refresh |
| `history` | Writes `flight_snapshots` and `stats_hourly`; serves stats, tracks and replay frames |
| `airports` | Search, map pins, live board for one airport |
| `auth` | Seed admin in `users`, httpOnly cookie, per-IP and per-email lockout |
| `db` | Entities and migrations (`flight_snapshots`, `stats_hourly`, `airports`, `users`) |

### API surface

| Endpoint | Purpose |
| --- | --- |
| `GET /api/stream` | SSE snapshots |
| `GET /api/flights/live` | Latest flights as JSON |
| `GET /api/flights/:icao24/track` | Recorded path of one aircraft |
| `GET /api/stats/hourly`, `top-airports`, `airlines` | Insights charts |
| `GET /api/airports`, `/pins`, `/:code` | Search, pins, board |
| `GET /api/replay/range`, `GET /api/replay` | Recorded traffic frames for playback |
| `POST /api/auth/login`, `logout`, `GET /api/auth/me` | Session |
| `GET /api/health` | Liveness probe |

## 5. Database

| Table | Content | Kept |
| --- | --- | --- |
| `flight_snapshots` | One row per flight per poll cycle | `RETENTION_DAYS` |
| `stats_hourly` | Running hourly averages | forever |
| `airports` | Indian airports (OurAirports) | forever |
| `users` | Seed admin (bcrypt hash) | forever |

## 6. Frontend structure

```mermaid
flowchart LR
  shell["Shell<br/>rail, top bar, search"] --> map["Map page"]
  shell --> flights["Flights page"]
  shell --> insights["Insights page"]
  shell --> airports["Airports page"]

  map --> live["Live map<br/>MapLibre: 2D, 3D, globe"]
  map --> card["Flight card<br/>photo, follow, share"]
  map --> tools["Tool panels<br/>settings, weather,<br/>filters, saved, replay"]

  stream["FlightStream (SSE)"] --> live
  stream --> flights
  api["Api (HTTP)"] --> insights
  api --> airports
  api --> replay["Replay service"] --> live
  weather["Weather service<br/>Open-Meteo, RainViewer, METAR"] --> tools
  weather --> airports
  settings["MapSettings, Watchlist, Theme"] --> live
  settings --> tools
```

State is held in signals in small root services (`FlightStream`, `MapSettings`,
`FlightSelection`, `Replay`, `Watchlist`, `ThemeService`); components read them and the
map reacts through effects.

## 7. Data sources

| Source | Called by | Key | Used for | Terms |
| --- | --- | --- | --- | --- |
| adsb.fi open data | server | no | live positions (primary) | non-commercial, credit, 1 req/s |
| OpenSky Network | server | optional | fallback positions | anonymous ~400 credits/day |
| adsbdb | server | no | callsign to route | free; routes can be wrong |
| OurAirports | build/seed | no | airport list, pins, search | public domain |
| Natural Earth | build/seed | no | India polygon, neighbours mask | public domain |
| OpenFreeMap | browser | no | basemap tiles | OSM attribution |
| AWS terrain tiles | browser | no | 3D elevation | open data |
| Open-Meteo | browser | no | conditions, 250 hPa wind | non-commercial |
| RainViewer | browser | no | radar overlay | credit, zoom 7 |
| Planespotters | browser | no | aircraft photos | photographer credit |
| metar.vatsim.net | browser | no | airport METAR | unofficial mirror of NOAA |

Hosts that the browser calls are allow-listed in the Content-Security-Policy
(`frontend/public/_headers`, `frontend/nginx/security-headers.conf`, `netlify.toml`).

## 8. Deployment

```mermaid
flowchart LR
  dev["git push main"] --> gh["GitHub"]
  gh -- "auto-build" --> nl["Netlify<br/>frontend"]
  gh -- "Actions + deploy hook<br/>or manual deploy" --> rd["Render<br/>API + PostgreSQL"]
  nl -- "API_BASE_URL<br/>(config.json)" --> rd
  user["Browser"] --> nl
  user -- "cookie auth, SSE" --> rd
```

- The frontend reads the API origin from `/config.json` at run time, so the same build
  works against any backend.
- Auth uses an httpOnly cookie; across sites (Netlify to Render) it needs
  `COOKIE_SAMESITE=none` and CORS for the Netlify origin.
- Render's free instance sleeps after about 15 minutes; the first request wakes it.

## 9. Security notes

- Every API route except login, logout and health is behind a global JWT guard.
- `AUTH_DISABLED` and `LOGIN_RATE_LIMIT=off` are refused when `NODE_ENV=production`.
- The service worker never caches `/api`, `/config.json` or cross-origin requests.
- Browser-direct calls (weather, photos, METAR) reveal the visitor's IP to those services;
  nothing from them is sent to the backend.

## 10. Known limits

- ADS-B only: aircraft without a transponder and receiver gaps are missing.
- Routes are callsign-derived; 20-35 % of flights have none and some are wrong.
- Delayed flights cannot be computed from free feeds (no schedule data).
- Replay and trails reflect what the backend recorded; gaps appear when it was down.
- Single backend instance assumed (in-memory route cache, rate limiter, sessions).
