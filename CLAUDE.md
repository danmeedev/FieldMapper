# Field Mapper

Offline-first GPS field mapping application for mining prospecting and geological fieldwork.

## Architecture Overview

Four deployment targets sharing common concepts (waypoints, tiles, routes, photos):

1. **Laptop Server** (`server.js`) — Express + WebSocket server, the main hub
2. **Phone Web App** (`public/gps.html`) — PWA for field data collection via phone GPS
3. **Mobile App** (`mobile-app/`) — Capacitor-based Android app with offline maps, routes, weather, navigation
4. **Chromebook Server** (`chromebook-server.js`) — Lightweight field-only server (waypoints + photos, no maps)

### Data Flow

```
Phone (GPS/waypoints/photos)
  → WebSocket (live GPS streaming) → Laptop server → Map viewer (index.html)
  → HTTP POST /api/waypoint (sync) → Laptop server → data/waypoints.json + data/photos/

Chromebook (field collection)
  → Laptop pulls via /api/sync endpoint

Mobile App (standalone)
  → Syncs bidirectionally with laptop via sync-engine.js
  → Caches tiles in IndexedDB for offline use
```

## Key Files

### Server (Node.js)
- `server.js` — Entry point that registers feature modules in `server/`. Together they handle: tile proxy/cache, waypoint CRUD, route CRUD, GPS WebSocket relay, AI analysis via Claude API, environmental metadata enrichment (weather, elevation, sun position, magnetic declination), Chromebook sync, photo storage, GeoJSON overlays
- `server/routes-catalog.js` — Catalog CRUD: specimens + dig orders + sales orders (upsert-by-id, base64 photos → disk, basename-normalized). Cloned from `routes-routes.js`. `data/specimens.json`, `data/dig-orders.json`, and `data/orders.json`
- `server/routes-waypoints.js` — Waypoint upsert/delete/list, photo storage, HTTP GPS fallback, and map-client notifications.
- `server/routes-routes.js` — Route upsert/delete/list and export, including route-point photos.
- `server/routes-tracks.js` — Track-session storage/listing; existing ids are skipped.
- `server/routes-ai.js` — Claude analysis, environmental metadata, and API-key configuration.
- `server/tile-proxy.js` — Tile sources, disk cache/proxy, contours, cache statistics, and prefetch.
- `server/tombstones.js` — Shared delete-tombstone persistence; upserts clear tombstones.
- `chromebook-server.js` — Minimal HTTP server for field use on Chromebook (no Express, no tiles, no WebSocket streaming)
- `download-tiles.js` — Interactive CLI to pre-download map tiles for offline use
- `cache-leaflet.js` — Downloads Leaflet library files for offline use

### Laptop Web UI (`public/`)
- `index.html` — Map viewer with Leaflet, toolbar panels (Layers, Pins, Routes, Catalog, Dig Orders, Orders, Measure, Sync, AI, Settings)
- `js/ai-settings.js` — Dedicated AI configuration dialog and hidden-by-default readiness gating. Keep its desktop/mobile copies identical.
- `js/diagnostics.js` — Opt-in forwarding of client diagnostics to the laptop during review sessions.
- `js/map.js` — Desktop map logic: tile layers, waypoint markers, GPS tracking, route builder with road-snapping, measurement tool, AI analysis, coordinate search (decimal/DMS/UTM), GPX export, print route maps
- `js/catalog-pc.js` — Laptop full-CRUD catalog + dig orders + sales orders (server-backed via `/api/*`); duplicates the catalog vocab + listing/provenance/price generators from the mobile `catalog.js` (keep the two in sync)
- `css/style.css` — Dark theme styles for map UI
- `gps.html` — Phone-optimized GPS page (PWA). Inline JS handles: GPS tracking, waypoint form with categories/photos/sample fields, IndexedDB photo storage, WebSocket GPS streaming, sync to laptop, wake lock, service worker registration
- `sw.js` — Service worker for the GPS PWA: precaches the GPS page, manifest, and icons; navigation serves cached `gps.html` with a background refresh; other assets use cache-first; API calls use the network with an offline JSON fallback
- `manifest.json` — PWA manifest

### Mobile App (`mobile-app/`)
Capacitor v8 Android app. Source in `mobile-app/src/`:
- `index.html` — 5-tab layout: GPS, Data, Map, Weather, Catalog
- `js/app.js` — Tab switching, shared GPS (web + native), lifecycle handlers for background tracking, wake lock
- `js/native-gps.js` — Capacitor bridge to native Android foreground service for persistent background GPS tracking
- `js/gpx-utils.js` — GPX import/export, Ramer-Douglas-Peucker track simplification, decision point detection (stops/turns/elevation), track operations (reverse/split/merge/trim)
- `js/waypoint-store.js` — IndexedDB-backed waypoint + route + settings persistence, plus catalog `specimens`, `digOrders`, and `orders` stores and their CRUD/label helpers (DB version 6)
- `js/tile-cache.js` — Custom Leaflet TileLayer that caches tiles in IndexedDB, direct fetch from tile servers (no server proxy needed). Includes contour, radar, wind layers. Route corridor download (buffer by X miles), multi-layer batch download, size estimation
- `js/sync-engine.js` — Bidirectional sync with the laptop hub. Phone-orchestrated **reconciliation** (`planReconcile`): per record id it compares phone vs laptop and resolves to create/update/delete in either direction by last-write-wins on `updatedAt`, with delete **tombstones** so deletes propagate instead of resurrecting. Covers waypoints, routes, specimens, dig orders, and sales orders (track-session sync merges new ids in both directions). Save convention: local writes set `synced=false` + bump `updatedAt`; `saveX(rec, {fromSync:true})` preserves the server's `updatedAt`. Local tombstones live in the `settings` store key `sync-tombstones`
- `js/gps-data.js` — Trip computer: speed, altitude, heading, distance, elevation gain/loss, track recording (native + web fallback), GPX import/export
- `js/gps-view.js` — GPS view UI (mark locations, recent list, sync controls)
- `js/map-view.js` — Map view with layers, pins, routes, tile download, navigation, coordinate search
- `js/route-builder.js` — Route creation with labeled points, access type, hazards, landmarks, directions, photos. Ghost track overlay, snap-to-track, reverse route, GPX export. Smart track-to-route conversion using RDP simplification + auto-detected decision points
- `js/navigation.js` — Compass-based navigation to waypoints/route points with bearing, distance, ETA
- `js/measure.js` — Distance measurement tool
- `js/weather.js` — Open-Meteo weather data (current conditions, forecast, hourly)
- `js/geofence.js` — Waypoint proximity alerts driven by shared JS GPS updates: configurable radius (100 m default), 5-minute per-waypoint cooldown, sound/vibration/toast, and session visited tracking. This uses JS location updates rather than Android OS geofencing.
- `js/catalog.js` — Rock-business catalog: specimen + dig-order + sales-order CRUD UI, SOP vocab (site codes, sort buckets, UV, conditions, rate tiers), offline listing/provenance/price generators, waypoint provenance link. See "Rock Specimen Catalog" below
- `css/app.css` — Mobile-optimized dark theme

### Data Storage
- `data/waypoints.json` — All synced waypoints (JSON array)
- `data/routes.json` — All routes with points
- `data/specimens.json` — Rock-business catalog specimens (synced)
- `data/dig-orders.json` — Dig-order service records (synced)
- `data/orders.json` — Sales orders (synced)
- `data/tracks.json` — Synced track sessions
- `data/tombstones.json` — Delete tombstones per type, for bidirectional delete sync
- `data/photos/` — Waypoint, route, specimen (`specimen-<id>-*`), and dig-order (`digorder-<id>-*`) photos (saved from base64)
- `field-data/` — Chromebook field data (waypoints.json + photos/)
- `tiles/` — Cached map tiles organized as `tiles/{layer}/{z}/{x}/{y}.{ext}`
- `config.json` — Server config (stores Anthropic API key)
- `certs/` — Auto-generated self-signed SSL certs for phone GPS access

## Tile Sources

Base layers and overlays from USGS, ESRI, BLM, and NOAA (availability differs by client; see `server/tile-proxy.js` and `mobile-app/src/js/tile-cache.js`):
- **Base**: USGS Topo, ESRI World Topo (z19), ESRI Street (z19), NatGeo, USGS Satellite, ESRI HD Satellite (z20), USGS Imagery+Topo, Shaded Relief, Terrain, BLM Surface Management
- **Overlays**: Streets/Roads, Place Names/Labels, Topo Contours (dynamic USGS export), Hydro, Hiking Trails, Land Ownership, NOAA Radar, Wind Speed
- On laptop: tiles cached to disk via `tiles/` directory, fetched on-demand from source and cached permanently
- On mobile: tiles cached to IndexedDB, fetched directly from tile servers

## API Endpoints (`server.js` and `server/` modules)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/waypoint` | Upsert waypoint by id with photos (from phone/mobile sync) |
| GET | `/api/waypoints` | Get all saved waypoints |
| DELETE | `/api/waypoint/:id` | Delete a waypoint (writes a sync tombstone) |
| GET | `/api/tombstones` | Delete-tombstones for all types `{type:{id:deletedAt}}` (drives bidirectional delete sync) |
| POST | `/api/gps` | HTTP GPS push (WebSocket fallback) |
| GET | `/api/status` | Server health check |
| GET | `/api/metadata` | Environmental data for a lat/lon (elevation, weather, sun, declination) |
| POST | `/api/ai/analyze` | AI geological analysis via Claude API (sends photos + field data + metadata) |
| POST/GET | `/api/config` | Whitelisted AI settings; GET returns sanitized state, never the key |
| GET | `/api/ai/status` | Current AI readiness, configuration flags, and verification timestamp |
| POST | `/api/ai/test` | Explicit small real inference test; successful verification enables AI tools |
| POST | `/api/sync` | Pull waypoints/photos from Chromebook |
| POST | `/api/route` | Save/update a route |
| GET | `/api/routes` | Get all routes |
| DELETE | `/api/route/:id` | Delete a route |
| GET | `/api/export/route/:id` | Export route with photo URLs |
| POST | `/api/specimen` | Save/update a catalog specimen (upsert by id, base64 photos → disk) |
| GET | `/api/specimens` | Get all specimens |
| DELETE | `/api/specimen/:id` | Delete a specimen |
| GET | `/api/export/specimen/:id` | Export specimen with photo URLs |
| POST | `/api/digorder` | Save/update a dig order (upsert by id) |
| GET | `/api/digorders` | Get all dig orders |
| DELETE | `/api/digorder/:id` | Delete a dig order |
| POST | `/api/order` | Save/update a sales order (upsert by id) |
| GET | `/api/orders` | Get all sales orders |
| DELETE | `/api/order/:id` | Delete a sales order (writes a tombstone) |
| GET | `/api/backup` | Export waypoints, routes, specimens, dig orders, and sales orders, with counts; excludes photos, tiles, track sessions, and tombstones |
| POST | `/api/prefetch` | Background prefetch tiles for an area |
| POST | `/api/track-session` | Save track session from mobile (skip if ID exists) |
| GET | `/api/track-sessions` | Get all synced track sessions |
| GET | `/api/cache-stats` | Tile cache statistics per layer |
| GET | `/tiles/:layer/:z/:x/:y.*` | Tile proxy (cache-first, then fetch from source) |
| GET | `/data/:file` | Serve GeoJSON overlay files |

## WebSocket Protocol

Connects on both HTTP (:3000) and HTTPS (:3443). Role-based:
- `?role=gps` — Phone sends `{ type: 'gps', lat, lon, accuracy, altitude, speed, heading }`
- Default (map viewer) — Receives GPS updates and waypoint notifications
- Messages: `{ type: 'gps' | 'waypoint' | 'sync-complete' }`

## AI Analysis

Uses the Claude Messages API with a configurable model (default `claude-sonnet-4-6`) for geological field analysis. Configuration is in Settings > AI Configuration. AI controls and analysis endpoints stay unavailable until AI is enabled, configured, and an explicit real Test Connection succeeds:
- Analyzes waypoint data, photos (sent as base64 images), and environmental metadata
- Environmental context includes: USGS DEM elevation, weather history/forecast (Open-Meteo), magnetic declination (NOAA), sun position (calculated), current conditions
- Provides: photo analysis, geological interpretation, mineralization assessment, regional mining context, weather impact, field recommendations

## Rock Specimen Catalog (Business)

A catalog for specimens taken home to sell, a dig-order service tracker, and customer sales orders. Implements the
"Rockhound Operations" SOP vocabulary embedded in the catalog code; the owner maintains the source SOP documents separately. Available on the mobile **Catalog** tab (segmented
Specimens / Dig Orders / Orders) and the laptop **Catalog**, **Dig Orders**, and **Orders** toolbar panels — full CRUD on
both, synced bidirectionally.

- **Specimen record** (`specimens` store / `data/specimens.json`): `id` (string `sp_<ts>_<rand>`,
  the real key), `label` (SKU `SITECODE-YY-NNN`), name, category, `siteCode`/`accessType` (SOP-1),
  `bucket` 0–3 (SOP-2 sort gate), `uv {response, color, photoRef}` (SOP-2), `condition`,
  mineralization[] + rockType/alteration/sampleType (reused from the GPS Mark form), dimensions (in)
  + weight (oz/lb), `status` lifecycle, price/sale fields, platform/listingUrl, `acquisition`,
  `digOrderId`, `provenanceStatement`, photos[], `waypointId`+snapshotted lat/lon.
- **Dig order record** (`digOrders` store / `data/dig-orders.json`): client, material, region,
  quality, budget, timeline, `rateTier` (SOP-5), dayRate/estDays, deposit fields, `status`
  lifecycle, terms, notes, preview photos[], links to specimens via `specimen.digOrderId`.
- **Sales order record** (`orders` store / `data/orders.json`): distinct from dig-service orders. Stores order number/date, customer contact/address, line items (optionally linked to specimens), shipping/tax/discount/total, platform, payment details, fulfillment status, carrier/tracking/shipped date, and notes. Both clients support CRUD, reconciliation, and backup; sales orders have no photos.
- **Label auto-gen** (`nextSpecimenLabel`): next sequential `SITECODE-YY-NNN` via a live store scan;
  the SKU is a human field, never identity (avoids offline multi-device collisions — surfaced as a
  non-blocking "dup SKU" badge).
- **Provenance is a snapshot**: linking a waypoint copies its lat/lon and inherits geology fields
  once, so deleting/moving the waypoint never corrupts catalog provenance.
- **Offline generators** (`generateListing`/`generateProvenance`/`suggestPrice`): produce the SOP-3
  eBay/Etsy title + body + pipe-delimited spec line, the provenance statement (Blanchard gets its
  specific story), and the bucket price band (+UV premium). Duplicated in `catalog.js` (mobile) and
  `catalog-pc.js` (laptop) — keep in sync.
- **Backwards compatibility**: IndexedDB v5 added `specimens`/`digOrders`; v6 adds `orders`. Upgrades create missing stores without deleting existing stores; specimen photos reuse the shared `photos` store with `sp_`/`do_` ref prefixes; catalog records use their own server JSON files and reconciliation descriptors.

## Tech Stack

- **Runtime**: Node.js
- **Server**: Express 4.22.3, ws 8.22.0 (WebSocket)
- **Frontend**: Vanilla JS, Leaflet 1.9.4 (vendored in `public/lib/`)
- **Mobile**: Capacitor 8.4.3, native plugins (Geolocation, Camera, KeepAwake, Network, Preferences), custom native GPS tracking plugin (foreground service + SQLite)
- **Native Android** (`mobile-app/android/.../com/fieldmapper/app/`): `GpsTrackingService.java` (foreground service with FusedLocationProvider), `TrackingDatabase.java` (SQLite for track persistence), `GpsTrackingPlugin.java` (Capacitor plugin bridge), `MainActivity.java` (plugin registration)
- **Storage**: JSON files (server), localStorage + IndexedDB (browser/mobile)
- **External APIs**: USGS, ESRI ArcGIS, BLM GIS, Open-Meteo, NOAA, Anthropic Claude
- **SSL**: Auto-generated self-signed certs via openssl (required for phone GPS over HTTPS)

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `FIELDMAPPER_PORT` | 3000 | HTTP server port |
| `FIELDMAPPER_HTTPS_PORT` | 3443 | HTTPS server port |
| `ANTHROPIC_API_KEY` | (none) | Claude API key (overrides config.json) |
| `FIELDMAPPER_AUTH_TOKEN` | (none) | Optional Bearer token for /api/* auth |

## Development

```bash
npm install          # Install express + ws
npm start            # Start laptop server on :3000 (HTTP) and :3443 (HTTPS)
npm run download     # Interactive tile downloader
node cache-leaflet.js       # Download Leaflet for offline use
node chromebook-server.js   # Start lightweight Chromebook server
```

Mobile app (PowerShell):
```powershell
cd mobile-app
npm install
npm run sync        # Copy src/ web assets and sync native plugins
npm run open        # Open Android Studio
# npm run build now syncs Android assets and compiles the debug APK
# To compile from PowerShell after syncing:
cd android
.\gradlew.bat assembleDebug
```

The Capacitor config is `mobile-app/capacitor.config.ts`, with `webDir: src`. Edit `mobile-app/src/` and sync before building; do not edit copied Android web assets. See `mobile-app/INSTALL-ANDROID.md` for JDK/SDK setup and sideloading. Only an Android native project is present.

Run `npm test` for regression checks and `npm run test:browser` for isolated Chrome integration checks. The browser tests require installed Google Chrome on Windows. Android uses Java 21, SDK 36, Gradle 8.14.3, and minimum Android API 24 (Android 7+). Frontend scripts are classic scripts loaded in HTML order; shared globals and ordering matter.

## Waypoint Categories

general, sample, geology, hazard, water, camp, landmark, trail, vehicle, mineral, wildlife, vegetation, structure, boundary, custom — each with a color and emoji icon.

## Important Patterns

- **Offline-first**: Everything is designed to work without internet. Tiles, waypoints, routes all cached locally. Sync happens when devices are on the same WiFi.
- **Home base = the server**: the laptop is "home base" where field data is deposited. The laptop web UI does full CRUD **directly against the server API** for all synced record types — waypoints (`POST /api/waypoint`, `DELETE /api/waypoint/:id`), routes, catalog specimens, dig orders, and sales orders — so `data/*.json` is the single source of truth. Its `localStorage` is only an offline cache; on startup it loads from the server (authoritative) and migrates any laptop-only pins up. The phone is an offline client that reconciles with home base.
- **Bidirectional sync (reconciliation)**: Pressing Sync on the phone reconciles each record type against the laptop by id — last-write-wins on `updatedAt`, with delete tombstones so deletes propagate. The server upserts by id (never appends) and records a tombstone on DELETE; re-creating/updating an id clears it. Because the laptop now writes through to the server, a waypoint/route/specimen/dig-order/sales-order created, edited, or deleted on the laptop syncs to the phone (and vice-versa).
- **No build step**: All frontend code is vanilla JS, no bundler or transpilation.
- **Modular server**: `server.js` wires feature modules in `server/`; change feature APIs in the relevant module.
- **Photo handling**: Photos are captured as base64 data URLs on phone, stored in IndexedDB, then sent to server which saves them as files on disk.
- **Tile caching strategy**: Laptop uses filesystem cache (`tiles/` dir), mobile uses IndexedDB. Both fetch-on-demand and cache permanently. Mobile supports route corridor downloads (buffer zone around route points).
- **GPS streaming**: Phone streams GPS to laptop in real-time via WebSocket, with HTTP POST fallback.
- **Background GPS**: Android foreground service (`GpsTrackingService`) uses `FusedLocationProviderClient` and survives app backgrounding, screen off, and WebView destruction. Track data stored in SQLite (independent of IndexedDB) and synced to JS layer via Capacitor plugin bridge.
- **Track-to-Route workflow**: Recorded tracks can be converted to routes using Ramer-Douglas-Peucker simplification (preserves shape). Auto-detects decision points (stops >30s, turns >60°, elevation changes >30m). Ghost track overlay shows original path during route editing. Points can be snapped to the original track path.

## Review Sessions and Logging

Run `./scripts/start-review.ps1` in PowerShell with the emulator already running to start the PC server/browser, open Android Studio, and capture logs. Session details are in ignored `.review-logs/latest-session.json`; do not commit logs, profiles, or backups. The emulator reaches the laptop at `http://10.0.2.2:3000`.

`FIELDMAPPER_REVIEW_LOGS=1` enables request/client logging without request bodies or query strings; normal startup leaves client-log ingestion disabled. `FIELDMAPPER_DATA_DIR`, `FIELDMAPPER_CONFIG_FILE`, and `FIELDMAPPER_TILES_DIR` support isolated tests. `ANTHROPIC_MODEL` optionally overrides the configured model; changing effective credentials/model invalidates AI readiness. Source-of-truth edits remain in mobile-app/src; run sync and rebuild after changes.

## Distribution and User Documentation

README.md is the detailed PC/Android user/developer reference; QUICK-SETUP.md is the beginner installation, same-LAN/hotspot, offline-map, and AI guide. scripts/render-docs.cjs renders offline HTML with working heading links. Keep documented menu names aligned with the actual HTML and dynamic UI.

scripts/build-package.ps1 creates a Windows x64/Android distribution ZIP and standalone signed APK in ignored dist/. The PC launcher in packaging/ bundles a checksum-verified official Node runtime and production dependencies. It uses the Windows user's LocalAppData Field Mapper folder for records/tiles/config/logs, opens the default browser, and handles repeat starts. It sets FIELDMAPPER_HTTPS=0, so no OpenSSL installation or shared private certificate is needed. Optional source HTTPS remains available for the legacy browser GPS page; failure does not block native Android/HTTP.

The PC Settings panel lists current adapter URLs via /api/status connectionUrls. Users connect both devices to a private Wi-Fi or phone hotspot, then enter the laptop's address in Android Map Settings. Local syncing needs LAN reachability, not internet; hotspot-without-service support depends on device/carrier.

scripts/build-android-release.ps1 signs using a persistent private identity under LocalAppData/FieldMapperBuild/signing, restores build environment afterward, and verifies the APK. Never distribute the key/password files. Version 1.1.0 has Android versionCode 2. Release APKs cannot update differently signed debug builds in place; preserve their data before migration. tests/package-smoke.cjs verifies the extracted ZIP, private-data exclusion, empty-profile startup without installed Node/OpenSSL, external storage, and repeat startup.

## Update Persistence Contract

release-contract.json pins the published Android certificate/app id/origin and storage names. Never change these as incidental refactoring. scripts/verify-release.ps1 checks APK signature/app id/embedded WebView origin before packaging. Fresh build machines/CI must restore the existing private signing directory; generating a new identity is blocked for this published project. Android hostname localhost + scheme https are explicitly pinned in capacitor.config.ts to preserve IndexedDB origin. PC releases use the same Windows user's external AppData directory. Upgrade tests cover replacing the PC installation directory with retained data and Android IndexedDB v4/v5 additive upgrades; future SQLite/schema changes require real migrations and populated-data tests. Uninstall/clear-storage is never a normal update step.


### Optional update checking (2026-10-19)
Implemented PC/Android Settings → App Updates with persistent opt-out, manual checks, and daily successful-check throttling. Repository and branch remain placeholders. Metadata-only checks use a branch-specific GitHub manifest; only same-repository HTTPS release ZIP/APK assets are offered. A download requires explicit confirmation for the offered version; installation is manual and never automatic. Disabling checks invalidates pending automatic results. See README for publishing instructions and the example manifest.
