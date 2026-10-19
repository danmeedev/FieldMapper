# Systematic implementation plan

Prepared 2026-10-19. Implementation has now been carried out; current phase status follows below.

Inputs: [BUG-REVIEW.md](BUG-REVIEW.md) (B01–B08), [UPDATE-REVIEW.md](UPDATE-REVIEW.md) (U01–U04), and user requirement R01 below. Findings retain their existing evidence levels; this plan does not turn source-inspection findings into confirmed device failures. Implement in small reviewable commits, preserving existing working-tree edits.

## R01 — AI configuration and visibility

User requirement: AI belongs behind its own configuration menu. No AI tools should appear until AI is configured and a real test request has succeeded.

Proposed implementation contract:

- Keep an AI Configuration entry under settings. It contains enable/disable, server-held credentials, model selection, Save, Test Connection, and a concise status/error. Operational AI panels, analysis buttons, contextual waypoint actions, and AI-only result entry points stay hidden by default until readiness is confirmed. Audit desktop, GPS PWA, Android, dynamic popup builders, and cached result views; do not hide ordinary weather/geology data simply because AI also uses it.
- Server is authoritative. Readiness states: disabled, needs-configuration, needs-test, testing, ready, and failed. UI starts hidden, including before JS initialization, preventing a startup flash. A saved key or successful health check never establishes readiness.
- Test the exact effective provider/key/model configuration with a small synthetic real inference request, never actual waypoint/photo data. A valid nonempty successful response establishes readiness; a mere HTTP 200 without usable content does not. Surface that the test makes a provider request and can incur a small charge. Test is explicitly user-triggered, not automatic on opening settings/startup.
- Store verification server-side, bound to the effective configuration revision/identity and test timestamp. Never expose the secret or a reusable secret fingerprint. Credential/model changes, disable, and effective environment-variable changes invalidate verification. An in-flight test for an older revision must not mark a newer configuration ready. Distinguish unset credentials from a masked UI placeholder; never save the placeholder as a key or echo an environment key into the JSON config.
- Return only sanitized settings/status to clients. Add a dedicated status/test API (final names selected during implementation); whitelist supported settings. Enforce readiness in the analysis endpoint as well as the UI, including calls from stale clients.
- Desktop and mobile refresh status on startup, server change/reconnect, settings changes, and immediately before analysis. Mobile follows the laptop's status; it does not store provider credentials or run a separate provider integration. Do not trust persisted client readiness when the laptop cannot be reached; proposed default is to hide tools until status can be confirmed again. This requires reconnect/status checks, not a paid test every launch.
- Auth/model/credential failures invalidate readiness and require a successful retest. A transient network failure is reported without overwriting verified configuration; hide tools while current readiness cannot be confirmed. Do not permanently erase credentials on a transient error. Existing cached AI results remain stored; hide AI-only access while gated unless the user later chooses a separate history policy.

Acceptance matrix: fresh install; disabled; key missing; saved but untested; wrong key; retired/unavailable model; timeout; rate limit; malformed/empty success response; successful test; reload; server restart; key/model/environment change; edit during test; reconnect to another laptop; offline mobile; direct analyze request before test. Only the active successfully tested configuration exposes tools or permits analysis. No key appears in client responses/logs.

## Phase 0 — Baseline and repeatable verification

1. Record current Git state and protect existing staged/unstaged work. Use an isolated worktree/checkout for implementation where practical; explicitly preserve relevant uncommitted source rather than assuming HEAD contains it.
2. Back up server JSON/photos/config, mobile IndexedDB/SQLite data, and the prior APK before live-data or upgrade testing. Keep secrets out of committed fixtures.
3. Turn B01–B08 reproductions into focused checks using synthetic records, temporary directories, mocked failed reads, and browser/device checks where needed. Capture before-change failures. Add only tests that verify meaningful behavior, not implementation details.
4. Record Node/JDK/SDK/build versions and actual Android device/API version. Recheck vendor versions/advisories before choosing update targets; review reports are dated snapshots.

Gate: known baseline, recoverable data, and explicit confirmed/rejected/deferred result for each finding. A rejected finding gets documented, not an unnecessary fix.

## Phase 1 — Prevent sync and photo data loss (B01, B02, B03, B06)

Implement as separate commits in this order:

1. B01: distinguish failed snapshots from empty successful lists. Require a valid tombstone snapshot before reconciliation; stop the pass when it fails. Require valid per-type lists before writing that type; report failed types without pretending they succeeded. Test network/HTTP/JSON/schema errors, successful empty lists, newer server records, and deletion resurrection. Evaluate stale-write protection at server upsert separately; fixing failed reads alone does not solve every concurrent-sync race.
2. B02 + B06: give newly uploaded route photos collision-resistant names, normalize retained filename/URL references, and keep existing files readable. Update route display/export handling consistently. Verify remove/reorder/add across multiple points and repeated phone round trips; retained photo bytes must remain identical. Do not bulk-delete orphan files in this change. Inventory malformed historical references first; any repair is a separately backed-up migration.
3. B03: stage/validate fetched waypoint photos before reconciling the local set. Successful complete pulls replace the intended photo set, including empty sets. Partial download failures must not silently mark an incomplete set successful or destroy the last complete local copy. Verify 2→1 and 2→0 photos, failed downloads, retry, metadata edit, and resync without resurrection.

Likely files: mobile sync-engine.js/waypoint-store.js; server/routes-routes.js; public/js/map.js; export/photo helpers where needed.

Gate: failure-path tests pass and a synthetic desktop→phone→desktop cycle preserves current records, deletes, and photo contents.

## Phase 2 — Restore broken API/map behavior (B04, B05, B07, B08)

- B04: align CORS method declarations with actual supported API operations. Verify real separate-origin OPTIONS + DELETE from a browser/WebView, not just a raw HTTP request.
- B05: ensure contour requests reach the dedicated renderer before the generic tile handler. Verify cold cache, warm cache, upstream failure, and unaffected ordinary tiles.
- B07: use consistent id comparison for route export; test numeric, numeric-string, nonnumeric, and absent ids.
- B08: validate finite numeric coordinates and geographic bounds while accepting zero. Verify both zero axes, missing/null/NaN/out-of-range values, and HTTP GPS relay.

Gate: focused API checks and map/mobile smoke checks pass. Record outcomes against all four IDs.

## Phase 3 — Patch the WebSocket dependency (U02)

1. Recheck current maintainer advisories; choose a maintained patched ws 8.x satisfying all applicable fixes.
2. Change the minimum dependency if appropriate, regenerate the root lockfile, and verify resolved versions. Avoid unrelated package churn.
3. Run a dependency audit and classify results rather than applying automatic major upgrades.
4. Verify HTTP/HTTPS GPS streaming, reconnect, waypoint notifications, and representative payloads.

Gate: applicable ws advisories addressed, reproducible installation, and streaming checks pass. Keep this independent of Express migration.

## Phase 4 — AI configuration, model replacement, and UI gating (R01 + U01)

1. Inventory every existing AI entry point and config consumer across public/ and mobile-app/src/. Include inline GPS-page code and cached-analysis actions.
2. Implement server config validation, effective-config resolution, sanitized status, revision-bound test results, explicit test request, and backend analysis readiness checks. Preserve existing config keys/data and migrate old credentials to untested status.
3. Select a supported model after checking vendor documentation and account availability. Make it configurable rather than replacing one permanently hardcoded model with another. Check text/image request compatibility and robust response parsing.
4. Build the dedicated AI configuration menu; wire hidden-by-default desktop/mobile controls to server readiness. Remove the old scattered setup controls after migrating their consumers.
5. Exercise the full R01 matrix with provider fixtures. Run an explicit minimal real test from the configuration menu to establish genuine readiness. A mocked test verifies code but must never set real-user readiness. Do not make paid requests or transmit field data silently.
6. Verify normal mapping, collection, catalog, sync, and weather remain usable with AI disabled/unconfigured/offline. Update CLAUDE.md and UI help to match.

Gate: saved credentials alone never reveal tools; a successful real test does; changing effective config invalidates it; stale clients cannot bypass server gating. Text/photo analysis passes with the selected model where account access allows.

## Phase 5 — Coordinated Android modernization (U03)

1. Confirm field-device compatibility and choose a stable supported Capacitor target using its migration guides. Recheck any minimum Android/API increase before proceeding; retain older-device support if required by the user's hardware.
2. Follow intervening major guides in order. Align core/platform/CLI and compatible official/community plugins. Coordinate Gradle/JDK/SDK/AndroidX changes, including location library compatibility.
3. Review the custom native GPS service/plugin, permissions, notification startup, background restrictions, WebView networking, and layout behavior for the chosen target. Change native/JS code only where the migration or tests establish a need.
4. Sync canonical src/ assets and produce a test APK. Test upgrade installation without losing data, GPS with screen off/backgrounded, process death/recovery, camera, wake lock, offline tiles, navigation, sync, catalog/orders, and AI gating.

Gate: real-device acceptance on the actual field phone. Compile success alone is insufficient. If hardware/API requirements or unavailable devices prevent verification, document the blocker and keep this phase deferred while retaining completed fixes.

## Phase 6 — Optional Express migration and remaining update assessment (U04)

1. Recheck Express 4 maintenance/advisory status. Decide whether Express 5 provides a justified benefit now; this was an optional finding, not a requirement to introduce a major upgrade.
2. If proceeding, review route syntax, middleware/body parsing, async error handling, static/MIME delivery, and listening behavior against the official migration guide. Change only incompatible code.
3. Run the server/API/photo/tile/WebSocket-adjacent smoke suite and all relevant regression checks.
4. For tile providers, Open-Meteo field names, Leaflet, and remaining libraries, first establish an actual availability/compatibility/advisory issue. Document evidence before adding migrations; avoid speculative endpoint replacements.

Gate: either a tested Express migration or an explicit deferred decision with rationale. Preserve the distinction between completed required work and optional work left open.

## Completion and tracking

| Scope | Delivery evidence |
| --- | --- |
| B01–B03, B06 | Before/after reproductions, no stale overwrite/resurrection, preserved photo bytes |
| B04–B05, B07–B08 | Browser/API/tile verification recorded per finding |
| U02 | Resolved patched dependency and streaming/audit results |
| U01 + R01 | Config/status/test flow, visibility matrix, real-test result without exposing credentials |
| U03 | Build/toolchain versions, actual device results, data-preserving upgrade |
| U04 | Tested migration or explicit justified deferral |

For each commit: link finding IDs, state behavior changed, record checks and limitations, and document rollback. Rollback must preserve newer field data; do not restore an old backup over new records automatically. Update both review files with confirmed/fixed/retested/deferred status and update CLAUDE.md after architectural changes. Final acceptance combines the focused regressions with one end-to-end offline collection→laptop sync→edit/delete→phone resync workflow, plus GPS/background and AI configuration tests relevant to completed phases.

## Phase status — 2026-10-19

0: Baseline patches, source/data/APK backup and emulator private-data backup saved in ignored `.review-backup/2026-10-19/`.
1–2: B01–B08 implemented and automated checks pass.
3: ws/server dependency patching complete; audit clean.
4: AI configuration and gating implemented and tested with fixtures; real provider verification intentionally remains unready until the user supplies credentials and explicitly runs Test Connection.
5: Capacitor 8.4.3 Android build and emulator install complete; foreground/background/screen-off native GPS smoke test passes. Physical-phone, camera, long-running process-recovery and field acceptance tests remain to be performed; do not equate the smoke check with complete hardware coverage.
6: Express 5 explicitly deferred; maintained Express 4 patched and audited. No unverified tile/weather changes applied.

PC browser, server, emulator, Android Studio and logging left running. See REVIEW-TESTING.md for user acceptance steps and log locations. No commits were created because the working tree already contains staged and unstaged user changes; local backups preserve the baseline for review and rollback.


### Optional update checking (2026-10-19)
Implemented PC/Android Settings → App Updates with persistent opt-out, manual checks, and daily successful-check throttling. Repository and branch remain placeholders. Metadata-only checks use a branch-specific GitHub manifest; only same-repository HTTPS release ZIP/APK assets are offered. A download requires explicit confirmation for the offered version; installation is manual and never automatic. Disabling checks invalidates pending automatic results. See README for publishing instructions and the example manifest.
