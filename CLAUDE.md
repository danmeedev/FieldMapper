# Field Mapper

Offline-first GPS field mapping application for mining prospecting and geological fieldwork.

## Architecture Overview

Three deployment targets sharing common concepts (waypoints, tiles, routes, photos):

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
- `server.js` — Main server (~1200 lines). Handles: tile proxy/cache, waypoint CRUD, route CRUD, GPS WebSocket relay, AI analysis via Claude API, environmental metadata enrichment (weather, elevation, sun position, magnetic declination), Chromebook sync, photo storage, GeoJSON overlays
- `chromebook-server.js` — Minimal HTTP server for field use on Chromebook (no Express, no tiles, no WebSocket streaming)
- `download-tiles.js` — Interactive CLI to pre-download map tiles for offline use
- `cache-leaflet.js` — Downloads Leaflet library files for offline use

### Laptop Web UI (`public/`)
- `index.html` — Map viewer with Leaflet, toolbar panels (Layers, Pins, Routes, Measure, Sync, AI, Settings)
- `js/map.js` — All map logic (~1800 lines): tile layers, waypoint markers, GPS tracking, route builder with road-snapping, measurement tool, AI analysis, coordinate search (decimal/DMS/UTM), GPX export, print route maps
- `css/style.css` — Dark theme styles for map UI
- `gps.html` — Phone-optimized GPS page (PWA). Inline JS handles: GPS tracking, waypoint form with categories/photos/sample fields, IndexedDB photo storage, WebSocket GPS streaming, sync to laptop, wake lock, service worker registration
- `sw.js` — Service worker for offline PWA support (cache-first for assets, network-only for API)
- `manifest.json` — PWA manifest

### Mobile App (`mobile-app/`)
Capacitor v6 Android app. Source in `mobile-app/src/`:
- `index.html` — 4-tab layout: GPS, Data, Map, Weather
- `js/app.js` — Tab switching, shared GPS via `navigator.geolocation.watchPosition`, wake lock
- `js/waypoint-store.js` — IndexedDB-backed waypoint + route + settings persistence
- `js/tile-cache.js` — Custom Leaflet TileLayer that caches tiles in IndexedDB, direct fetch from tile servers (no server proxy needed). Includes contour, radar, wind layers
- `js/sync-engine.js` — Bidirectional sync with laptop (push unsynced waypoints/routes, pull from laptop)
- `js/gps-data.js` — Trip computer: speed, altitude, heading, distance, elevation gain/loss, track recording
- `js/gps-view.js` — GPS view UI (mark locations, recent list, sync controls)
- `js/map-view.js` — Map view with layers, pins, routes, tile download, navigation, coordinate search
- `js/route-builder.js` — Route creation with labeled points, access type, hazards, landmarks, photos
- `js/navigation.js` — Compass-based navigation to waypoints/route points with bearing, distance, ETA
- `js/measure.js` — Distance measurement tool
- `js/weather.js` — Open-Meteo weather data (current conditions, forecast, hourly)
- `css/app.css` — Mobile-optimized dark theme

### Data Storage
- `data/waypoints.json` — All synced waypoints (JSON array)
- `data/routes.json` — All routes with points
- `data/photos/` — Waypoint and route point photos (saved from base64)
- `field-data/` — Chromebook field data (waypoints.json + photos/)
- `tiles/` — Cached map tiles organized as `tiles/{layer}/{z}/{x}/{y}.{ext}`
- `config.json` — Server config (stores Anthropic API key)
- `certs/` — Auto-generated self-signed SSL certs for phone GPS access

## Tile Sources

10 base layers + 4 overlays from USGS, ESRI, BLM, and NOAA:
- **Base**: USGS Topo, ESRI World Topo (z19), ESRI Street (z19), NatGeo, USGS Satellite, ESRI HD Satellite (z20), USGS Imagery+Topo, Shaded Relief, Terrain, BLM Surface Management
- **Overlays**: Streets/Roads, Place Names/Labels, Topo Contours (dynamic USGS export), Hydro, Hiking Trails, Land Ownership, NOAA Radar, Wind Speed
- On laptop: tiles cached to disk via `tiles/` directory, fetched on-demand from source and cached permanently
- On mobile: tiles cached to IndexedDB, fetched directly from tile servers

## API Endpoints (server.js)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/waypoint` | Save waypoint with photos (from phone/mobile sync) |
| GET | `/api/waypoints` | Get all saved waypoints |
| POST | `/api/gps` | HTTP GPS push (WebSocket fallback) |
| GET | `/api/status` | Server health check |
| GET | `/api/metadata` | Environmental data for a lat/lon (elevation, weather, sun, declination) |
| POST | `/api/ai/analyze` | AI geological analysis via Claude API (sends photos + field data + metadata) |
| POST/GET | `/api/config` | Server config (API key storage) |
| POST | `/api/sync` | Pull waypoints/photos from Chromebook |
| POST | `/api/route` | Save/update a route |
| GET | `/api/routes` | Get all routes |
| DELETE | `/api/route/:id` | Delete a route |
| GET | `/api/export/route/:id` | Export route with photo URLs |
| GET | `/api/backup` | Export all waypoints + routes |
| POST | `/api/prefetch` | Background prefetch tiles for an area |
| GET | `/api/cache-stats` | Tile cache statistics per layer |
| GET | `/tiles/:layer/:z/:x/:y.*` | Tile proxy (cache-first, then fetch from source) |
| GET | `/data/:file` | Serve GeoJSON overlay files |

## WebSocket Protocol

Connects on both HTTP (:3000) and HTTPS (:3443). Role-based:
- `?role=gps` — Phone sends `{ type: 'gps', lat, lon, accuracy, altitude, speed, heading }`
- Default (map viewer) — Receives GPS updates and waypoint notifications
- Messages: `{ type: 'gps' | 'waypoint' | 'sync-complete' }`

## AI Analysis

Uses Claude API (`claude-sonnet-4-20250514`) for geological field analysis:
- Analyzes waypoint data, photos (sent as base64 images), and environmental metadata
- Environmental context includes: USGS DEM elevation, weather history/forecast (Open-Meteo), magnetic declination (NOAA), sun position (calculated), current conditions
- Provides: photo analysis, geological interpretation, mineralization assessment, regional mining context, weather impact, field recommendations

## Tech Stack

- **Runtime**: Node.js
- **Server**: Express 4.18, ws 8.16 (WebSocket)
- **Frontend**: Vanilla JS, Leaflet 1.9.4 (vendored in `public/lib/`)
- **Mobile**: Capacitor 6, native plugins (Geolocation, Camera, KeepAwake, Network, Preferences)
- **Storage**: JSON files (server), localStorage + IndexedDB (browser/mobile)
- **External APIs**: USGS, ESRI ArcGIS, BLM GIS, Open-Meteo, NOAA, Anthropic Claude
- **SSL**: Auto-generated self-signed certs via openssl (required for phone GPS over HTTPS)

## Development

```bash
npm install          # Install express + ws
npm start            # Start laptop server on :3000 (HTTP) and :3443 (HTTPS)
npm run download     # Interactive tile downloader
node cache-leaflet.js       # Download Leaflet for offline use
node chromebook-server.js   # Start lightweight Chromebook server
```

Mobile app:
```bash
cd mobile-app
npm install
npx cap sync         # Sync web assets to Android project
npx cap open android # Open in Android Studio
```

## Waypoint Categories

general, sample, geology, hazard, water, camp, landmark, trail, vehicle, mineral, wildlife, vegetation, structure, boundary, custom — each with a color and emoji icon.

## Important Patterns

- **Offline-first**: Everything is designed to work without internet. Tiles, waypoints, routes all cached locally. Sync happens when devices are on the same WiFi.
- **No build step**: All frontend code is vanilla JS, no bundler or transpilation.
- **Single-file server**: `server.js` contains all server logic in one file.
- **Photo handling**: Photos are captured as base64 data URLs on phone, stored in IndexedDB, then sent to server which saves them as files on disk.
- **Tile caching strategy**: Laptop uses filesystem cache (`tiles/` dir), mobile uses IndexedDB. Both fetch-on-demand and cache permanently.
- **GPS streaming**: Phone streams GPS to laptop in real-time via WebSocket, with HTTP POST fallback.
