# Bug review: verification before fixes

Reviewed: 2026-10-19. Original status: findings only. Current implementation/verification status is recorded at the end of this document.

Scope: current working-tree server APIs, mobile reconciliation/storage, desktop route rendering, and tile routing. This is a focused review, not an exhaustive audit. Existing local edits are part of the reviewed source.

Evidence: read-only source inspection and Node checks using the actual source in VM contexts with in-memory filesystem/network substitutes. No production data was written, no live server was started, and no external API was called. Browser/Android workflows remain unverified. Reproduced means an isolated code path reproduced, not a complete device workflow. Use a disposable copy and synthetic records for the manual checks below.

## Priority overview

| ID | Priority | Finding | Evidence |
| --- | --- | --- | --- |
| B01 | High | Failed list fetch can overwrite newer server records | Isolated reproduction |
| B02 | High | Route photo filename collision overwrites retained image | Isolated reproduction |
| B03 | High | Pulled waypoint photo removal leaves stale local photos | Source inspection; device check pending |
| B04 | Medium | Cross-origin DELETE blocked by CORS policy | Source inspection; browser check pending |
| B05 | Medium | Generic tile handler shadows contour renderer | Express route matching reproduced |
| B06 | Medium | Route photo URLs survive upload and break desktop display | Storage reproduced; display verified by inspection |
| B07 | Low | Route export rejects string ids accepted by CRUD | Isolated reproduction |
| B08 | Low | HTTP GPS fallback rejects latitude/longitude zero | Isolated reproduction |

Priorities reflect likely data loss or broken behavior, not security severity. Each finding is pending user verification/triage before implementation.

## B01 — A failed server read becomes an empty authoritative list

- Location: `mobile-app/src/js/sync-engine.js:48-56`, `:273`; server upserts in `server/routes-waypoints.js:55-60` and analogous route/catalog handlers.
- Trigger: health check succeeds, then a record-list request returns 500, malformed JSON, or a network error while a subsequent POST succeeds.
- Actual: `fetchJsonSafe` returns null; `reconcileType` substitutes `[]`. A local record is planned as `push-create`, even when a newer server version exists. Server upsert replaces that newer record without a version check. A failed tombstone fetch similarly becomes `{}`, allowing deleted records to be pushed back when absent from the list.
- Evidence: mocked non-OK fetch with local `{id:1, updatedAt:10}` invoked push and returned `pushedCreated:1, errors:0`.
- Verify: create matching records with server timestamp 200 and phone timestamp 100 and different names. Fail only GET `/api/waypoints`, allow status and POST. Sync. Check whether the server now contains the older phone name and whether an error is reported. Separately fail GET `/api/tombstones` with a server-deleted record still present on the phone.
- Expected: an unsuccessful snapshot must stop reconciliation for the affected scope and report failure; it must not imply an empty dataset.

## B02 — Editing route photos can overwrite the image being retained

- Location: `server/routes-routes.js:27-43`.
- Trigger: a route point has uploaded photos A and B. Save an edit retaining B as a filename, removing A, and adding inline photo C.
- Actual: filenames depend on the new array index. B was originally `route-1-pt0-1.jpg`; C now occupies index 1 and overwrites that same file. Both references become `route-1-pt0-1.jpg` and both display C. Retained B is lost from that file.
- Evidence: actual handler with an in-memory filesystem produced `photos:["route-1-pt0-1.jpg","route-1-pt0-1.jpg"]`; file content was C.
- Verify: POST route id 1 with two base64 JPEG images. Read the saved filenames. POST the same route with `[secondSavedFilename, newBase64JPEG]`. Inspect returned stored record and both images using GET `/api/routes` and `/photos/...`.
- Expected: adding/reordering photos must preserve existing image content and distinct references.

## B03 — Pulling a shorter waypoint photo list leaves deleted photos behind

- Location: `mobile-app/src/js/sync-engine.js:118-139`; `mobile-app/src/js/waypoint-store.js:147-168`.
- Trigger: phone has photo indices 0 and 1. A newer server record has just one photo (or no photos).
- Actual: pull saves newly downloaded images starting at 0 but never clears old photos for that waypoint. Old index 1 remains. Push uses every result from `getPhotos(wp.id)`, so a later phone metadata edit can upload and restore the removed image. An empty server list leaves all local images intact. Failed downloads can also leave mixed old/new images.
- Evidence: inspected saveLocal, savePhoto, getPhotos, and waypoint push paths; browser IndexedDB reproduction pending.
- Verify: sync a two-photo waypoint to a test phone; remove one photo on the laptop and advance updatedAt; sync again. Inspect `getPhotos(id)` in the WebView console. Edit the waypoint name on the phone and sync; check whether the removed photo returns on the server. Repeat with zero server photos.
- Expected: a successful pull should reconcile the local photo set with the server set; a partial download should be surfaced and handled without silently mixing stale images.

## B04 — CORS excludes DELETE used by mobile reconciliation

- Location: `server.js:66-73`; remoteDelete implementations in `mobile-app/src/js/sync-engine.js`.
- Trigger: a browser/WebView on a different origin attempts to propagate a phone deletion to the laptop.
- Actual: preflight advertises only `GET, POST, OPTIONS`. Browser fetch for DELETE is blocked before the delete handler executes. Phone-to-server deletes fail while same-origin desktop deletes can work.
- Evidence: direct policy/caller mismatch. Actual Android WebView behavior still needs checking; a raw HTTP DELETE does not test browser CORS.
- Verify: from the mobile WebView or a separate-origin test page, delete a synthetic synced record and sync. Inspect OPTIONS response and console/network CORS error. Confirm server record remains and sync reports a delete error.
- Expected: permitted cross-origin API methods cover the operations required by supported clients.

## B05 — Contour tile requests never reach the contour generator

- Location: `server/tile-proxy.js:155-176`, `:204`; `public/js/map.js:145`.
- Trigger: request an uncached `/tiles/contours/10/20/30.png`.
- Actual: generic `/tiles/:layer/:z/:x/:y.png` is registered first and matches `layer=contours`. There is no TILE_SOURCES contours entry, so it responds with the empty PNG and never reaches the later specialized contour handler. Existing cached contour files can mask the bug.
- Evidence: Express route matching for this URL returned the generic route first and specialized route second. The generic handler ends the response rather than calling next.
- Verify: use an uncached valid coordinate in a disposable tile cache; enable desktop contour overlay. Inspect response/image and whether the contour export request/cache write occurs.
- Expected: contour requests reach the dedicated generator and produce/cache the contour image.

## B06 — Route photo URLs are stored verbatim, then prefixed as filenames

- Location: `mobile-app/src/js/sync-engine.js:168-170`; `server/routes-routes.js:40-41`, `:83-85`; `public/js/map.js:1255`.
- Trigger: pull a laptop route with photo filenames to mobile, then edit and push it back. Pull converts filenames to full HTTP URLs; push resolves those URLs unchanged.
- Actual: server preserves the HTTP URL as though it were a filename. Desktop rendering builds `/photos/http://host/photos/file.jpg`, a broken path. Export similarly prefixes `/photos/`. Absolute URLs can also retain an obsolete laptop address.
- Evidence: actual POST handler stored `http://old-host/photos/p.jpg` unchanged; desktop source prefixes any non-data URL with `/photos/`.
- Verify: create a route with a photo on laptop; sync to mobile, edit route name, sync back. Inspect the saved photo strings and desktop image request URL. A direct synthetic POST containing a full photo URL isolates the server/display contract.
- Expected: server/client agree on normalized photo references across a round trip.

## B07 — Export route lookup disagrees with CRUD id handling

- Location: `server/routes-routes.js:49`, `:73-75`.
- Trigger: a route has string id `"123"` or a nonnumeric id. Save/list/delete accept these ids using String comparisons, but export parses the path as a number and compares strictly.
- Actual: GET `/api/export/route/123` returns 404 for a stored id `"123"`.
- Evidence: actual export handler with an in-memory stored route `{id:"123", points:[]}` returned 404 `Route not found`.
- Verify: POST a synthetic route with string id `"123"`; confirm it appears in GET `/api/routes`, then request its export. Repeat with a nonnumeric id. Normal UI-generated numeric ids may not trigger this.
- Expected: export supports the same ids accepted by route CRUD.

## B08 — GPS fallback rejects valid coordinates on equator/prime meridian

- Location: `server/routes-waypoints.js:77-90`.
- Trigger: POST `/api/gps` with `{lat:0,lon:10}` or `{lat:10,lon:0}`.
- Actual: truthiness validation treats zero as missing and returns 400. WebSocket GPS does not use that check.
- Evidence: actual HTTP handler returned 400 `lat and lon required` for latitude zero.
- Verify: send both example payloads to a disposable server and compare with nonzero coordinates; check GPS viewer update.
- Expected: valid finite coordinates, including zero, are accepted; missing/out-of-range/invalid values are rejected.

## Verification record

For each ID, record device/browser, steps, observed result, expected result, and confirmed/rejected/deferred. No fixes are authorized by this report itself. Keep synthetic fixtures separate from field data, and retain a backup before any later live-data reproduction.

## Implementation status — 2026-10-19

B01–B08 are implemented in the current working tree. Verification: 15 automated regression tests plus real Chrome desktop/mobile integration checks. B04 includes actual separate-origin browser DELETE propagation. Photo tests verify retained bytes, removed references, complete replacement, and failed-download preservation. Contour routing is checked at the handler boundary; live upstream map availability still depends on the provider/network. Full field acceptance remains for user testing.

Additional fixes in the same paths: explicit empty waypoint photo uploads now remove server references rather than restoring old filenames; legacy sync timestamp marking now preserves the version actually pushed; native GPS is exposed on window so startup initializes the bridge.

Evidence: `.review-logs/regression.log`, `.review-logs/browser-smoke.log`, `.review-logs/android-build.log`. See REVIEW-TESTING.md for the running session and test sequence. Existing staged/unstaged work was preserved; no commits were made over it.
