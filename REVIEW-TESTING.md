# Ready for user testing

PC app: http://localhost:3000

Android: Field Mapper is running in `Medium_Phone_API_36.1` (`emulator-5554`); Android Studio has the `mobile-app/android` project open. The app's laptop URL is set to `http://10.0.2.2:3000`. Existing emulator data was retained and backed up. A clearly named `[Review] background GPS smoke` session remains in the emulator; it is stopped and was not synced to laptop data by the smoke check.

## Suggested test sequence

1. On Android, mark a location with photos, then sync to the PC. Confirm the waypoint/photos on the PC.
2. Edit on the PC and sync on Android. Delete a test record on each side and verify the next sync propagates it.
3. Edit a route's photos: retain one, remove another, add a new one, and sync both ways. Confirm retained images do not change.
4. Try layers/contours, route export, catalog specimens, sales orders, and dig orders.
5. Record a short Android track, background the app, return, and stop. Verify points and elapsed stats. Emulator location controls can move the simulated phone.
6. Open Settings > AI Configuration. AI tools should initially be absent. Save enabled/key/model, then click Test Connection (a real provider request with a small possible charge). Tools should appear only after success. Change model or disable AI and confirm tools hide again. The Android menu is under Map > Settings. Credentials are stored on the laptop, not Android.

AI has no key configured, so no paid provider request was made during implementation. Mocked provider tests never marked the live app ready. The PC and Android remain useful with AI disabled.

## Logs for this running session

Current directory: `C:/Users/danme/New folder (2)/.review-logs/20261019-143922`

- `pc-server.log`: timestamped API/client/server events.
- `pc-server.error.log`: server stderr.
- `pc-browser.log`: browser console errors/warnings and failed requests.
- `android-logcat.log`: native GPS, Capacitor/WebView, and Android runtime logs; continues across app restarts.
- `android-logcat.error.log`: collector errors.

The pointer `.review-logs/latest-session.json` records process IDs and paths. Leave the server, browser logging process, and Android log collector open while testing. Tell Codex when the test is finished and describe anything unexpected; logs remain on disk for review. Logs can include test coordinates/record names and should be treated as local project data.

## Implementation verification

- 15 regression tests pass (`npm test`).
- Isolated Chrome checks cover desktop/mobile startup, AI visibility, HTTP/HTTPS WebSocket GPS relay, cross-origin sync/edit/delete, and uncaught JS errors (`npm run test:browser`).
- Both npm dependency audits are clean at the chosen versions.
- Android debug build succeeds; upgrade installation retained app data; native background/screen-off GPS recorded two points and approximately 71 m in the synthetic smoke test.
- APK: `mobile-app/android/app/build/outputs/apk/debug/app-debug.apk`.

Verification artifacts are under `.review-logs/`: regression.log, browser-smoke.log, root-audit.json, mobile-audit.json, android-build.log, and screenshots. Capacitor emits nonfatal early safe-area CSS warnings before the document exists; the rendered screen was inspected and system bars/layout are correct. External-service/TLS messages may also appear; distinguish them from application exceptions using timestamps and device/process IDs.

Express 5 remains intentionally deferred. Physical-phone/camera coverage, prolonged track recovery, provider-backed AI quality, and full field acceptance await testing; emulator smoke checks do not establish those results.

## Repeat later

With no other server on port 3000, run `./scripts/start-review.ps1` in PowerShell. It starts a new logged PC browser/session and opens Android Studio. Rebuild with `cd mobile-app; npm run build` after source changes, then install/run the resulting APK on the emulator. The current apps are already running; no restart is needed for this review.
