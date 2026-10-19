# Field Mapper

Offline-first GPS mapping for prospecting, geological observations, routes, and specimen-business records. A Windows laptop hosts the desktop browser app; Android collects field data and reconciles it with the laptop. Optional Claude analysis is hidden until the active AI configuration passes a real provider test.

**Beginner setup:** [QUICK-SETUP.md](QUICK-SETUP.md), or `START HERE.html` in the distribution. This README is the detailed user/developer reference.

## Contents

- [Distribution and requirements](#distribution-and-requirements)
- [Connections and offline operation](#connections-and-offline-operation)
- [PC app reference](#pc-app-reference)
- [Android app reference](#android-app-reference)
- [AI configuration and use](#ai-configuration-and-use)
- [Sync, storage, backup, and updates](#sync-storage-backup-and-updates)
- [Developer setup and builds](#developer-setup-and-builds)
- [Architecture and API](#architecture-and-api)
- [Troubleshooting and verification](#troubleshooting-and-verification)

## Distribution and requirements

```text
FieldMapper-1.1.0-Windows-Android/
  START HERE.html              Beginner guide, readable offline
  QUICK-SETUP.md / .html       Installation, hotspot, AI
  README.md / .html            Detailed reference
  BUILD-INFO.json              Runtime/build provenance
  THIRD-PARTY-NOTICES.md
  PC/
    Start Field Mapper.cmd    One-click server + default browser
    Open My Field Mapper Data.cmd
    launcher.cjs
    runtime/node.exe          Included Windows x64 runtime
    runtime/LICENSE
    app/                      Server/UI/production dependencies
  Android/
    FieldMapper-1.1.0.apk     Signed release APK
```

The combined ZIP, standalone APK, and SHA-256 list are built under dist/. End users do not run npm, Gradle, Python, or Android Studio. Extract the whole ZIP first. Requirements: Windows 10/11 x64 (Intel/AMD), a browser, and Android API 24+ (Android 7+). No native iOS/macOS package is included. Internet is needed for acquisition and uncached online resources, not installed GPS/local records/prepared maps.

The Windows launcher starts its included runtime, waits for server health, opens the default browser, prints LAN addresses, and retains a startup console. Starting it twice reopens an existing Field Mapper server. Keep the startup window open; Ctrl+C/closing it stops the app. Closing the browser alone does not. Data persists independently under `%LOCALAPPDATA%\Field Mapper` for that Windows user.

The friend package excludes source-checkout field data, photos, tiles, config/AI keys, certificates, logs, developer tools, and Android signing secrets. It starts with an empty personal dataset. Node/dependency licenses remain included; packaging does not change the application's licensing.

## Connections and offline operation

### Home Wi-Fi

Connect both devices to the same private LAN. Start PC Field Mapper and open `http://localhost:3000`. On Android: **Map → ☰ → Settings → Laptop Server URL → Save & Test**. Enter a laptop LAN URL such as `http://192.168.1.25:3000`, not the phone IP or localhost.

PC **Settings → Connect your Android phone** and the startup window list active IPv4 addresses by adapter. Choose shared Wi-Fi, not VPN/virtual adapters. Refresh after changing networks. Windows must permit inbound private-network traffic; guest Wi-Fi/client isolation can prevent access. The default server listens on network interfaces, so use trusted private Wi-Fi or your password-protected hotspot. No router port forwarding is required.

### Phone hotspot in the field

1. Enable the phone's Wi-Fi hotspot and note its name/password.
2. Connect the laptop to it.
3. Start the PC app **after** connecting; if already running, use PC Settings → Refresh Addresses.
4. Enter the laptop's new hotspot-side IP/port in Android Settings and Save & Test.
5. Use Android GPS → Sync to Laptop; keep the hotspot/server active during transfer.

A hotspot can supply the local LAN with no internet or cell coverage if your phone/carrier permits hotspot operation without mobile data/service. Test your exact device in that condition before relying on it. Local sync and live GPS do not require internet. Fresh maps, online routing, weather, and AI do. If hotspot operation is blocked without service, use another local network or collect on the phone and sync later.

The laptop address can change between Wi-Fi/hotspot sessions. The hotspot gateway is usually the phone, not the laptop URL to enter. `http://10.0.2.2:3000` is only for Android emulators. See [Google's hotspot guide](https://support.google.com/android/answer/9059108?hl=en) for device-dependent menus.

### Offline capability matrix

| Feature | Offline? | Requires local phone/laptop connection? |
| --- | --- | --- |
| Android GPS, marking, notes/photos, native recording | Yes, with reception/permissions | No |
| Downloaded Android maps/routes | Yes, for prepared layers/areas/zooms | No |
| Cached PC maps and existing PC records | Yes | No |
| Sync/live GPS on PC | Yes | Yes |
| New map/contour tiles | Needs internet | Each device fetches its own cache |
| Road snapping | Needs routing provider; direct-line fallback available | No |
| Weather/radar/wind refresh | Needs internet; cached forecast may display | No |
| AI test/new analysis | Laptop needs internet/provider access | Android also needs laptop |
| Local catalog listing/provenance/price helpers | Yes; rule-based, not AI | Only to sync records |

Tile caches are separate; record sync does not copy PC maps to Android. Prepare and inspect both devices offline at the intended layers/zooms. Bigger areas/zooms/more layers increase storage. Layer coverage, licensing, and availability vary; claim/access overlays are reference data rather than current land-access permission.

## PC app reference

The main screen is a Leaflet map. Upper-left status shows the phone GPS connection, position, and accuracy. Pan/zoom with mouse/touch. The coordinate box supports decimal, DMS, and UTM-style searches implemented by the app. Toolbar buttons open panels; the phone must be connected for live relay, but saved records remain available independently.

| Menu | Controls and workflow |
| --- | --- |
| **Layers** | Topo/street, satellite/imagery, relief, terrain, BLM base maps; streets, labels, contours, hydro, and optional local claims/PLSS overlays. Show/Clear Track controls the live trail. Center on GPS/Auto-center control following. Cached Tiles reports PC cache statistics. |
| **Pins** | Browse records; Drop Pin Here then click the map; inspect/edit/delete, change category/color, view pictures, Export GPX. The legend explains categories. |
| **Routes** | New Route, refresh/select/display, edit/delete, export, Print Map. Points carry labels, access, hazards, landmarks, directions, notes/photos where supported. |
| **Catalog** | Add/search/view/edit/delete specimens. Maintain SKU/site, physical/geological details, UV/condition/bucket, status/prices, photos/provenance, links. Listing/provenance helpers work locally. |
| **Orders** | Customer sales orders: customer/address, line items, quantities/prices, shipping/tax/discount/totals, payment/status, platform, fulfillment/tracking. Records transactions; does not process payments or publish listings. |
| **Dig Orders** | Collection-service jobs/inquiries: client, material/region/quality, budget/timeline, rate/days, deposit/balance, terms/status/notes/photos. Link specimens through their dig-order field. Distinct from sales Orders. |
| **Measure** | Click positions for distance; Undo/Clear manage temporary measurement points. This is not a saved navigation route. |
| **Sync** | Describes phone-driven sync and offers Reload Waypoints. Trigger reconciliation on Android; reload PC if an existing panel is stale. |
| **Settings** | Phone-connection URLs, Refresh Addresses, AI Configuration. |
| **AI** | Hidden until configured/tested; Analyze All Observations. Waypoint popups gain AI Analyze. Results appear in the analysis panel. |

### PC route and offline-map workflows

Routes → New Route: click to add points, drag to reposition, and edit access (any vehicle, UTV/ATV, foot, rope/climb, scramble), hazards, landmarks, directions, and notes. Use Undo Point, Snap to Roads, Clear, Save Route, or Cancel. Snapping requires an online service; direct segments can be used without it. Saved routes can be fitted, printed with the browser print dialog (including Save as PDF), and exported through available route/GPX actions.

Viewed map tiles cache to disk. Browse the desired area/layers/zooms online before leaving, or use the technical tile downloader for larger desktop areas. The clean package omits private claims/PLSS GeoJSON; supply those separately. Missing optional overlays can produce expected 404s.

## Android app reference

Five bottom tabs: **GPS**, **Data**, **Map**, **Weather**, **Catalog**. Data/maps are local. The laptop connection supplies sync, live relay, and AI. Native GPS recording is separate from the UI; screen-off/background behavior still depends on permissions and battery policy.

### GPS

Shows position, altitude/accuracy/speed when available, laptop status, unsynced count, and last sync.

- **Mark This Location:** current-fix form with title/category/notes/photos. Sample records expose sample ID/type, rock type, mineralization, alteration. Save Location commits locally; Cancel dismisses.
- **Sync to Laptop:** reconcile over configured LAN. Live GPS connection does not mean every saved record has synced; inspect results and unsynced indicators.
- **Marked Locations:** search/open details, view pictures, edit/add photos/delete. AI actions appear only when the connected laptop is verified ready.
- **Export All Data (JSON):** currently exports waypoint records only, despite the label. Excludes photo binaries, routes, catalog/orders, native tracks; it is not a complete backup/restore facility.

Allow precise location; wait outdoors for good reception. Camera/file selection varies with permissions/device. Use a manually dropped map pin when a current GPS fix is unsuitable.

### Data

GPS Data contains compass/heading and trip metrics: speed, altitude, distance, elevation changes as measurements become available. Start Trip/Reset affect trip-computer state. Record Track starts/stops a separate recorded session; resetting the trip is not the same as stopping recording. Android may open system location settings for background access. Stop when finished.

Export Track GPX exports the current track; Import GPX selects a compatible file. Recorded/imported sessions can be converted to routes with simplification/decision-point suggestions. Review generated points. Native points live in SQLite; web record/trip/route state uses IndexedDB. Check long-running behavior on actual hardware, including battery restrictions and app/process restarts.

### Map and ☰ menu

| Entry | Use |
| --- | --- |
| **Layers** | USGS topo/satellite/imagery+topo; ESRI topo/street/HD; NatGeo, relief/terrain/BLM. Streets/labels/contours/hydro/trails/ownership/radar/wind overlays (coverage varies). Show/Clear Track, Center on GPS, Auto-center. |
| **Pins** | Browse/select local points, inspect/edit, choose a navigation target; category/color legends. |
| **Routes** | New Route, saved routes, Convert Recorded Track, point editing/display/navigation, GPX export/geometry operations where offered. |
| **Measure** | Tap positions for distance; Undo/Clear. |
| **Drop Pin** | Save a waypoint at a chosen map position, with details/photos. |
| **Download Tiles** | Download Visible Area, or select saved route/buffer in miles/max zoom/layers for Download Route Corridor. Watch progress/size estimates; Cancel stops further fetching. |
| **Print Route Map** | Select a route for printable map/directions. Device/WebView printing capabilities vary. |
| **Backup to Laptop** | Runs full reconciliation including routes/catalog/orders/tracks. It propagates changes/deletes, so is not an immutable snapshot. |
| **Settings** | Laptop URL/Save & Test, AI Configuration, geofence toggle/radius. Proximity alerts default to 100 m and depend on JS GPS updates; they are not OS geofences guaranteed while UI is inactive. |

During navigation, compass/distance/ETA and previous/next controls guide the selected waypoint/route point. Compass opens the larger view; Stop ends navigation. This is field guidance rather than a full offline road turn-by-turn engine. Access/hazard annotations are user-entered and need field review.

### Weather

Refresh Weather uses current GPS. The implemented Weather tab fetches US National Weather Service forecast/hourly/alerts (`api.weather.gov`), mainly US coverage. It can show a stored forecast; check age, because refreshing needs internet. Weather overlays use their own services. AI metadata separately uses Open-Meteo/other sources; it is not the Weather tab implementation.

### Catalog

Segments: Specimens, Orders, Dig Orders; add/search/list/detail/edit/delete workflows. A specimen's unique internal id is distinct from its human SKU (`SITECODE-YY-NNN`). Site/access, geology, bucket/UV/condition, dimensions/weight, photos, acquisition/sales/provenance are editable. Waypoint linking snapshots location/geology so later waypoint changes do not rewrite provenance. Duplicate SKU badges can occur after offline multi-device entry; SKU is not record identity.

Listing/provenance/price helpers are local rule-based suggestions, not AI, marketplace publishing, or price verification. Sales Orders track customer/payment/items/fulfillment. Dig Orders track requested work/rates/deposits/terms. Both PC and Android edit these records; sync reconciles them in both directions.

## AI configuration and use

PC: **Settings → AI Configuration**. Android: **Map → ☰ → Settings → AI Configuration**, which configures the connected laptop. Prefer entering the key on the PC's localhost page on a trusted network.

Enable AI, enter an Anthropic provider key and supported Claude model, Save, then explicitly Test Connection. Default model: `claude-sonnet-4-6`; provider/account availability can change. Provider account/billing is separate. The test sends a small synthetic inference, can incur a small charge, and does not send field/photo data.

A nonempty successful provider response verifies the exact effective configuration and reveals tools. Saving credentials, testing the laptop URL, or having cached results is insufficient. Backend analysis also rejects unverified configurations. Key/model/enablement changes invalidate verification, including environment overrides; an old in-flight test cannot verify newer settings. Verification survives restart only when effective settings match.

PC AI → Analyze All Observations or waypoint AI Analyze requests analysis; Android GPS-list waypoint detail offers AI Analysis. Field notes, coordinates, samples/photos, and environmental metadata may be sent to Anthropic. Review that disclosure before use. The laptop needs internet/provider access; Android needs the laptop. Authentication/model errors, account limits, and outages are reported. Android cached results remain stored but AI-only controls are hidden while readiness cannot be confirmed; this is not offline AI on the phone.

Status/config APIs do not return the secret; Android does not persist it. A file-based key is in laptop config.json unless supplied by environment. Protect configuration/private backups. Results are interpretive help, not an assay, confirmed mineral identification, or an access determination.

## Sync, storage, backup, and updates

### Reconciliation

Android compares records by id for waypoints, routes, specimens, dig orders, sales orders. Latest updatedAt wins; tombstones propagate deletes. Equal timestamps do not resolve different content. Keep clocks reasonable and avoid editing the same record concurrently on two devices. Laptop UI writes through to JSON stores; localStorage is a cache, not the authoritative database.

Failed list/tombstone reads do not become empty datasets. Waypoint-photo pulls stage all downloads before atomically replacing record/images; failure preserves the old complete set. Route uploads use unique photo names and normalized references. Track sessions merge new ids both ways; existing ids are skipped, so local deletion does not imply server track deletion. Reconciliation is not immutable backup history or collaborative conflict resolution.

### Storage

| Installation | Location |
| --- | --- |
| Packaged Windows | `%LOCALAPPDATA%\Field Mapper` contains data/, tiles/, config.json, logs/ |
| Source checkout | data/, tiles/, config.json, optional certs/, unless environment overrides |
| Android | App-private IndexedDB records/photos/settings/tiles; SQLite native tracks |
| Legacy Chromebook collector | field-data/ waypoints/photos |

Server data files: waypoints.json, routes.json, specimens.json, dig-orders.json, orders.json, tracks.json, tombstones.json, photos/. Android uninstall/clear-storage can erase unsynced work. Moving a ZIP does not migrate developer-checkout data, another user's profile, or another PC.

### Backups and restoration

After successful sync, stop the PC server and copy its entire personal data folder to a private backup. This includes server records, photos, tombstones, maps, settings, logs, and possibly an API key. Copying while writes occur can produce inconsistent snapshots. Phone-only tile caches, measurements, and other unsynced local state are not included in a PC copy.

To restore, stop the app, preserve the current folder separately, then restore a known complete folder backup in its place. This is manual restoration, not merging; old records/tombstones may interact with unsynced phones. Do not restore old files over new field work blindly; plan reconciliation before reconnecting clients.

GET /api/backup exports waypoint/route/specimen/dig-order/order record JSON and counts, excluding photo binaries, tiles, track sessions, tombstones. Android's Export All Data label also is not a full backup. GPX exports preserve geometry/relevant GPX fields, not all app records/photos/business data. There is no general JSON restore screen. Sync and inspect destination records before uninstalling/upgrading.

### Updates and migration

Windows: stop the old server, extract the new package, run its launcher. The same Windows user's AppData folder is reused. Keep a backup/previous package and do not run versions simultaneously. To migrate a source checkout, stop both installations, back up both, and deliberately copy data/tiles/config to the packaged personal folder. Do not overwrite a populated destination without a migration decision.

Android: install a newer APK with the same application id/signing key and a higher versionCode over the release without uninstalling. The release key is persistent and private. Existing developer/debug builds have a different certificate and cannot accept this APK as an in-place update: back up/sync/export before any uninstall. Automatic cross-signature migration is not implemented. Release WebViews are not debug-enabled; keep the development emulator/debug APK for diagnostics.

### GitHub-delivered updates and persistence contract

Use GitHub Release ZIP/APK assets for end users. Optional automatic update checks are available under **Settings → App Updates** on both PC and Android. GitHub is the download/delivery channel; downloads require explicit approval and installation remains a separate user action. Installing a new PC package from another folder still uses the same Windows user's AppData store. Install a newer release APK over the installed release without uninstalling or clearing storage.

`release-contract.json` pins the public release certificate fingerprint, application id, WebView origin, and established database/data-folder names. Package builds run both the migration regressions and the extracted-package replacement/persistence test before declaring the ZIP ready. The Android config explicitly pins https://localhost so a framework default cannot silently move IndexedDB to another origin. Release and package builders verify the actual APK's certificate, app id and origin and refuse a mismatch. Existing 1.1.0 APKs use these same effective values.

A fresh GitHub Actions runner or another build PC must restore the **existing** private signing directory before running the release helper. The helper now fails rather than silently generating a new identity for this published project. Keep signing files/passwords in private backups or the CI secret store, never Git commits or downloadable Release assets. No GitHub workflow/secrets were configured by this task. Increment Android versionCode for each new release.

Every future schema change still needs an additive/data-preserving migration and upgrade tests. IndexedDB upgrades from versions 4/5 are tested for retained records/photos/settings; PC package tests replace the installation directory while retaining user data. Native SQLite remains version 1; its currently empty onUpgrade must be implemented if that schema changes. Do not claim arbitrary future schema changes are automatically safe.

Uninstalling Android, clearing app storage, deleting the PC personal data folder, switching Windows accounts, or changing Android identity/origin can lose or hide records. Those are not normal Release updates. Keep backups, and test an upgrade with populated databases before publishing it.

## Developer setup and builds

### Source setup

Use supported Node LTS 22+, npm, PowerShell 7 for Windows build scripts, Chrome for browser smoke tests. Android requires Java 21, SDK platform 36/build tools, Android Studio compatible with AGP 8.13.0, Gradle 8.14.3 (wrapper). Capacitor core/android/CLI are pinned to 8.4.3 with compatible v8 plugins; minimum Android API is 24. Web assets are vanilla classic scripts, with no web bundler.

```powershell
npm ci
npm start                         # http://localhost:3000
npm ci --prefix mobile-app
$env:JAVA_HOME = 'C:/Program Files/Android/Android Studio/jbr'
cd mobile-app
npm run sync -- android
npm run build                     # sync + Windows debug APK build
npm run open                      # Android Studio
```

Source startup optionally offers HTTPS 3443 if openssl/certificates are available. HTTPS generation failure no longer prevents HTTP/native Android use. The packaged launcher disables HTTPS and ships no private certificates. Legacy /gps.html browser GPS requires a secure context/appropriate trusted certificate; native APK is the beginner/offline path.

### Shareable package build

```powershell
npm ci
npm ci --prefix mobile-app
./scripts/build-package.ps1
# Repackage an already-current signed release APK:
./scripts/build-package.ps1 -SkipAndroidBuild
```

The builder downloads the latest official Node 22 Windows x64 archive, checks its SHA-256 against the official nodejs.org list, includes node.exe/LICENSE, installs production dependencies only in staging, renders both guides to offline HTML, adds the signed APK, and creates ZIP/APK/checksum artifacts in dist/. BUILD-INFO.json records runtime/build provenance. dist/ and .build-cache/ are ignored.

First release build generates a persistent local key/password record in `%LOCALAPPDATA%\FieldMapperBuild\signing`; later builds reuse it. Back it up privately: losing this identity prevents ordinary APK updates for existing release users. It never enters the repository or friend ZIP. The helper scopes/restores signing environment variables around Gradle, verifies the resulting APK with apksigner, and leaves a running debug emulator untouched. For an existing organization's release key, adapt the maintainer's signing configuration rather than generating a replacement identity.

Gradle reads FIELDMAPPER_KEYSTORE, FIELDMAPPER_STORE_PASSWORD, FIELDMAPPER_KEY_ALIAS, FIELDMAPPER_KEY_PASSWORD. A bare assembleRelease without signing environment can produce an unsigned output; use build-android-release.ps1 for verified distribution. Increase app versions/Android versionCode for subsequent releases.

### Environment

| Variable | Purpose |
| --- | --- |
| FIELDMAPPER_PORT | HTTP/WebSocket port, default 3000 |
| FIELDMAPPER_HTTPS_PORT | Optional HTTPS port, default 3443 |
| FIELDMAPPER_HTTPS=0 | Skip optional HTTPS/cert setup |
| FIELDMAPPER_DATA_DIR | Server JSON/photo directory override |
| FIELDMAPPER_TILES_DIR | PC tile-cache override |
| FIELDMAPPER_CONFIG_FILE | Configuration-file override |
| FIELDMAPPER_HOME | Portable launcher's personal root; default AppData Field Mapper |
| ANTHROPIC_API_KEY / ANTHROPIC_MODEL | Server-only AI overrides; changing them invalidates verification |
| FIELDMAPPER_REVIEW_LOGS=1 | Opt-in request/client diagnostic capture |
| FIELDMAPPER_AUTH_TOKEN | Backend Bearer requirement. Stock browser/mobile clients do not supply it; enabling it breaks ordinary access without an authenticated integration. Not beginner setup. |

### Tools and checks

```powershell
npm run download                  # Interactive PC tile downloader
node cache-leaflet.js             # Refresh vendored offline library assets
npm test                          # Disposable-data regression checks
npm run test:browser               # Isolated Chrome/UI/WebSocket tests
npm run test:package               # Verify the extracted ZIP with empty user data/no installed runtime
./scripts/start-review.ps1         # Logged PC/browser + Studio; emulator already running
```

Edit mobile-app/src/, then sync/rebuild; never edit generated copied Android assets. Native GPS code is under mobile-app/android/app/src/main/java/com/fieldmapper/app/. The release helper does not install over or erase the differently signed development emulator.

## Architecture and API

```text
Android GPS/offline records/maps/native SQLite tracks
  -> HTTP reconciliation/photos -> laptop JSON/photo stores
  -> WebSocket live GPS -> laptop browser map
Laptop browser -> server CRUD -> authoritative laptop records
Laptop server -> disk tile cache / optional weather, metadata, AI providers
```

server.js wires Express/ws plus server/ modules. Desktop: public/index.html, public/js/map.js. Native mobile frontend: mobile-app/src/. public/gps.html/sw.js provide a legacy GPS PWA; chromebook-server.js is a minimal field collector. CLAUDE.md is the coding map; these guides are user-facing.

| Group | Endpoints |
| --- | --- |
| Health/LAN addresses | GET /api/status |
| Waypoints/GPS | GET /api/waypoints; POST /api/waypoint; DELETE /api/waypoint/:id; POST /api/gps |
| Routes | GET /api/routes; POST /api/route; DELETE /api/route/:id; GET /api/export/route/:id |
| Specimens | GET /api/specimens; POST /api/specimen; DELETE /api/specimen/:id; GET /api/export/specimen/:id |
| Dig/sales orders | GET /api/digorders, /api/orders; POST /api/digorder, /api/order; DELETE singular endpoint/:id |
| Tracks/deletions | GET /api/track-sessions; POST /api/track-session; GET /api/tombstones |
| AI | GET/POST /api/config (sanitized read); GET /api/ai/status; POST /api/ai/test, /api/ai/analyze; GET /api/metadata |
| Maps/backup | /tiles/:layer/:z/:x/:y.png or .jpg; GET /api/cache-stats; POST /api/prefetch; GET /api/backup, /data/:file |
| Legacy collection sync | POST /api/sync pulls from Chromebook |

JSON/base64 image uploads become photo files served at /photos/. WebSocket ?role=gps streams fixes to map clients. JSON stores are local persistence rather than a multi-user transactional database. External services can change independently of the app.

## Troubleshooting and verification

| Symptom | Check |
| --- | --- |
| Launcher exits | Extract all; inspect startup log/runtime; port 3000 may be in use. |
| Packaged dataset empty | AppData is separate from developer-checkout data; migrate deliberately. |
| Phone cannot connect | LAN address/port, firewall/profile, VPN/guest isolation, hotspot restrictions, startup window. |
| Hotspot has no internet | Local sync may still work; uncached online services cannot. |
| Offline map blank | Wrong/unprepared area/layer/zoom; caches are separate. |
| GPS/background fails | Precise/foreground/background location, reception, battery restrictions, recording state. |
| Weather fails outside US | Current Weather tab uses NWS; worldwide coverage is not assumed. |
| Claims/PLSS missing | Supply local GeoJSON separately; clean package excludes private overlays. |
| AI hidden | Enable/configure/test effective laptop settings and verify phone reachability. |
| APK update rejected | Signing identity/versionCode, OS minimum, storage; preserve data before migration. |

Packaged startup logs: `%LOCALAPPDATA%\Field Mapper\logs`. Developer review artifacts: ignored .review-logs/, with latest-session.json pointing to active logs. Logs may contain field coordinates/names; treat them as private project data. BUG-REVIEW.md/UPDATE-REVIEW.md/REVIEW-TESTING.md record implementation evidence and remaining field/hardware acceptance checks.

Primary references: [Android hotspot setup](https://support.google.com/android/answer/9059108?hl=en), [Node release support](https://nodejs.org/en/about/previous-releases), [Capacitor migration](https://capacitorjs.com/docs/updating/8-0), [Anthropic model availability](https://platform.claude.com/docs/en/about-claude/model-deprecations). Recheck providers when changing integrations.


## Optional update checks

PC **Settings → App Updates** and Android **Map → menu → Settings → App Updates** have a persistent **Check automatically** switch and **Check now**. Each app checks at startup/resume and while visible, at most once per 24 hours after a successful check. Checks require internet; failed checks retry at most once a minute while visible. Disabling the switch prevents scheduled checks, including after restart; manual checks remain available. Preferences are local to each browser/device (clearing browser/app storage resets them).

A newer stable version opens an update notice. **Close** postpones it. **Download update…** asks for explicit confirmation for that version before opening the ZIP or APK download. Neither checks nor a restart download or install a package. The app never applies updates automatically. PC users stop the app, extract the replacement package and launch it; Android users approve the downloaded APK in the system installer. Preserve the existing application ID, signing key and storage origin, and never uninstall to update. User data remains outside the PC package; see the backup and persistence instructions above.

For release maintainers: edit `public/update-config.json` and `mobile-app/src/update-config.json` with the public `owner/repository`, branch and installed app version. They currently contain deliberate placeholders and produce **no GitHub requests**. Before each build, match both `currentVersion` values to package.json and the Android versionName. Publish the signed APK and Windows ZIP to GitHub Releases, then copy `update-manifest.example.json` to `update-manifest.json` on the configured branch, updating its stable three-part version and exact asset URLs. Publish assets before the manifest. Only HTTPS GitHub release downloads belonging to that repository are accepted. The selected branch is passed as `ref` to the [GitHub contents API](https://docs.github.com/en/rest/repos/contents#get-repository-content); no GitHub token is shipped. Private repositories are not supported. Keep release permissions restricted: the manifest and repository are the trust boundary. Android still checks the APK signature during installation.
