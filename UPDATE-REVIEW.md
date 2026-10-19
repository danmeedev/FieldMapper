# Update review: changes to assess before implementation

Reviewed 2026-10-19 against current source, both lockfiles, installed root dependencies, and primary vendor documentation. Original review did not change dependencies or application source; see implementation status below for subsequent work. This complements BUG-REVIEW.md; it is not authorization to implement updates.

## Priorities and actual code impact

| ID | Priority | Update | Expected changed files | Classification |
| --- | --- | --- | --- | --- |
| U01 | High | Replace retired Claude Sonnet 4 model | server/routes-ai.js; optionally config/settings; CLAUDE.md | Application code change required to restore the integration |
| U02 | High | Patch ws 8.19.0 to a maintained patched 8.x release | package-lock.json; package.json if raising minimum | Dependency update; application changes not established |
| U03 | Planned | Migrate Capacitor 6 to a supported newer platform | mobile-app package/lockfiles, Android Gradle/config/manifest; possible native/JS plugin adjustments | Coordinated build/config migration with behavioral changes |
| U04 | Optional | Assess Express 4 to 5 migration | root package/lockfiles; route/error-handling code only where compatibility review requires it | Optional migration; not an established current bug |

## U01 — AI model retirement requires a code update

Evidence: server/routes-ai.js:291 hardcodes `claude-sonnet-4-20250514` in the Messages request. Anthropic lists that model as retired June 15, 2026. Therefore the current direct Anthropic integration needs a supported model; a live paid request was not made in this review.

Proposed change to assess: replace the hardcoded model with a currently supported model and preferably make the selection configurable. The vendor currently lists `claude-sonnet-4-6` as active and recommends `claude-sonnet-5-5` as the Sonnet 4 replacement. Select using account availability, response quality, and cost at implementation time. Review the selected model's migration guidance before changing request parameters. The current code sends text/images with max_tokens 4096 and reads the first content block; verify both request and response handling with the chosen replacement.

Verification: first exercise success/error response handling with fixtures. Then, with permission for a paid API request, analyze a synthetic waypoint with and without a photo. Confirm text display, timeout/error handling, and acceptable result quality. No need to upload actual field data for this check.

Source: [Anthropic model deprecations and replacements](https://platform.claude.com/docs/en/about-claude/model-deprecations).

## U02 — WebSocket patch update is justified by an installed-version match

Evidence: root package-lock.json and installed node_modules/ws/package.json both contain 8.19.0. The manifest range `^8.16.0` permits newer 8.x, but a lockfile-based install retains the locked version. Both server WebSocket endpoints instantiate WebSocketServer with default options.

The maintainer's high-severity memory-exhaustion advisory includes ws 8.19.0; the patched 8.x version is 8.21.0. The maintainer also published an uninitialized-memory disclosure advisory. Review both and select a maintained release containing all applicable fixes rather than assuming 8.21.0 is the newest available release.

Proposed change to assess: update the lockfile and raise the minimum ws version if desired. This is a dependency change; no application source rewrite is currently demonstrated as necessary. No full npm audit or registry-wide outdated check was run, so this is not a complete security inventory.

Verification: install in an isolated writable checkout; check the resolved version and audit result. Verify GPS sender/viewer connections over HTTP and HTTPS, disconnect/reconnect behavior, waypoint notifications, and representative message sizes. Do not run denial-of-service proofs against the user's working server.

Sources: [Memory-exhaustion advisory and patched versions](https://github.com/websockets/ws/security/advisories/GHSA-96hv-2xvq-fx4p), [Memory-disclosure advisory](https://github.com/websockets/ws/security/advisories/GHSA-58qx-3vcg-4xpx).

## U03 — Capacitor/Android upgrade changes more than dependency numbers

Evidence: mobile lockfile has Capacitor core/android/cli 6.2.1 and Geolocation 6.1.1; keep-awake is 5.0.1. Android currently uses minimum SDK 22, compile/target SDK 34, Android Gradle Plugin 8.2.1, and play-services-location 21.0.1. There is a custom GpsTrackingPlugin/GpsTrackingService plus SQLite tracking persistence.

The stable Capacitor 8 migration guide calls for minimum SDK 24, compile/target SDK 36, updated AndroidX libraries, Gradle tooling updates, and manifest adjustments. Its Geolocation plugin also changes timeout application and offers an Android watch interval option. A minimum SDK increase would drop support for Android versions below API 24; confirm the actual field phone is supported before selecting this migration.

Proposed change to assess: follow each intervening major migration guide, align Capacitor platform/CLI packages and compatible official/community plugins, and update Android configuration as a coordinated change. Inspect the custom GPS plugin against the destination APIs; do not assume it must be rewritten or that manifest declarations alone prove runtime compatibility. Do not use preview documentation to choose a production upgrade target.

Verification: build a disposable APK from synced web assets; test install/upgrade preserving IndexedDB and SQLite data, camera, wake lock, offline maps, same-WiFi sync, GPS permissions, tracking with screen off/backgrounded, process restart, session recovery, and export. Check Android layout/insets on the target phone after the target SDK increase. Keep a copy of the previous APK and data backup. No APK or native build was attempted in this review.

Source: [Stable Capacitor 8 migration guide](https://capacitorjs.com/docs/updating/8-0).

## U04 — Express 5 is optional and needs a compatibility pass

Evidence: root lockfile and installed Express are 4.22.1, even though the manifest minimum is ^4.18.2. Do not report the manifest minimum as the installed version. Express 5 changes route matching, rejected-promise handling, and other request/response behavior; the app registers tile patterns and async network handlers that deserve checks during migration.

Proposed change to assess: consider separately from the urgent ws patch. There is no finding here that Express 4.22.1 specifically forces application changes. A full dependency audit and Express 4 maintenance check remain pending. If choosing Express 5, inspect the migration guide and modify only incompatible call sites. The local Node v22.17.0 satisfies Express 5's documented Node >=18 requirement, but deployment machines need their own runtime checks.

Verification: assert all API registrations, tile URLs including contour paths, static asset delivery, JSON body handling, async upstream failure responses, and photo/export endpoints. Retest the existing B01-B08 findings independently; a framework upgrade does not establish that they are fixed.

Source: [Express 5 migration guide](https://expressjs.com/en/guide/migrating-5/).

## Items not established as requiring updates

- Tile-provider replacement: endpoints are present in source, but this review did not establish that any specific provider is retired. Do not replace basemaps solely because the URLs look old; check availability, licensing, attribution, zoom limits, and offline caching compatibility first.
- Open-Meteo field renames: older field spellings appear in the AI metadata module, but this review did not prove they have stopped working. Verify representative responses before changing both query names and response parsing together.
- Leaflet, AndroidX, Google location, TypeScript, and all transitive packages: not a complete current-version/advisory audit. Coordinate Android library updates with U03 rather than independently selecting arbitrary latest versions.

Recommended sequencing: verify and triage BUG-REVIEW.md data-integrity findings; address U01 and U02 in separate small changes; plan U03 against the actual device; keep U04 independent. Record confirmed/deferred/rejected and test evidence per item before implementing broad migrations.

## R01 — AI setup and verified availability (user requirement, 2026-10-19)

Put AI configuration behind its own configuration menu. Do not show AI tools in the UI until AI is configured and a real test request succeeds. Saving a key alone is insufficient. Apply this to desktop, phone PWA, and Android wherever AI actions/results are exposed. Keep the setup entry accessible so AI can be enabled. See IMPLEMENTATION-PLAN.md for the proposed state model, verification rules, and rollout.

## Implementation status — 2026-10-19

- U01 + R01: implemented dedicated AI configuration, sanitized server status, explicit real-test endpoint, configurable active model (default claude-sonnet-4-6), revision-bound persisted verification, hidden-by-default desktop/mobile tools, and backend readiness enforcement. Automated provider fixtures test failures/success/reconfiguration; no real provider call was made because no key is configured. A real successful Test Connection remains required before tools appear in the user's UI.
- U02: installed ws 8.22.0 and patched Express 4.22.3/transitive dependencies. Root audit is clean; HTTP/HTTPS WebSocket relay is included in browser integration verification.
- U03: upgraded core/android/CLI together to pinned Capacitor 8.4.3, compatible version-8 plugins, SDK 36/minimum 24, Java 21, Gradle 8.14.3/AGP 8.13.0, AndroidX and Google location 21.3.0. Selected 8.4.3 after 8.5.3's iOS tooling dependency introduced an audit finding irrelevant to this Android-only app. Both final package audits are clean. Debug APK built and installed over the emulator app without clearing its data. Native background/screen-off GPS recorded two synthetic points and was stopped afterward.
- U04: explicitly deferred Express 5. Patched Express 4 and its dependencies now audit cleanly; a major framework migration provides no demonstrated requirement for this review and remains a separate optional task.
- External tile/weather replacements remain unproven and were not made speculatively. Physical-phone and prolonged field testing remain user acceptance work.


### Optional update checking (2026-10-19)
Implemented PC/Android Settings → App Updates with persistent opt-out, manual checks, and daily successful-check throttling. Repository and branch remain placeholders. Metadata-only checks use a branch-specific GitHub manifest; only same-repository HTTPS release ZIP/APK assets are offered. A download requires explicit confirmation for the offered version; installation is manual and never automatic. Disabling checks invalidates pending automatic results. See README for publishing instructions and the example manifest.
