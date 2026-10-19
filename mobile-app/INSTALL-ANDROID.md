# Installing Field Mapper on an Android Phone (sideload)

This guides you through getting the **Field Mapper** app onto your own Android phone
**without** publishing to the Play Store. It is a personal/private "debug" build that
you install directly (sideload). No Google account, developer account, or store listing
is involved.

- **App ID:** `com.fieldmapper.app`  ·  **Name:** Field Mapper
- **Android required:** 7.0+ (minSdk 24); built against Android 16 (SDK 36)
- **Build type:** debug APK, signed with the local debug keystore (fine for personal use)
- **Platform:** Android only. There is no iOS project set up (`mobile-app/ios/` does not exist),
  so iPhone is not supported without additional Capacitor/iOS setup on a Mac.

There are two ways to do this. **Path A** is the simplest (use the prebuilt APK or build one,
then copy it to the phone). **Path B** uses Android Studio and is best if you'll be making
changes and reinstalling often.

---

## Prerequisites

You only need these on the **laptop**, not the phone.

- **Node.js** (already installed — used for `npx cap sync`).
- **JDK 21 or newer** — required by Capacitor 8 / the Android Gradle Plugin. **Android Studio bundles
  a compatible JDK** (JDK 21) at `C:\Program Files\Android\Android Studio\jbr`, so you usually don't
  need a separate install. For **command-line** builds you must point Gradle at it by setting
  `JAVA_HOME` (see "Set JAVA_HOME" below) — otherwise `gradlew` fails with
  *"JAVA_HOME is not set and no 'java' command could be found"*. Android Studio's own Run/Build
  (Path B) uses the bundled JDK automatically.
- **Android SDK** — either:
  - **Android Studio** (recommended; includes the SDK, `adb`, and an emulator), or
  - the **command-line tools** + **platform-tools** (`adb`) if you prefer no IDE.
- A **USB cable** (for `adb install`) — or any way to copy a file to the phone (USB file transfer,
  cloud drive, email to yourself, etc.) if you install the APK manually.

> If `adb` isn't on your PATH, it lives at
> `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe` after installing Android Studio.

---

## Step 1 — Sync the latest web code into the Android project

Any time the app's web code changes (HTML/CSS/JS under `mobile-app/src/`, including the catalog
feature), copy it into the native project first:

```powershell
cd "C:\Users\danme\New folder (2)\mobile-app"
npm install          # first time only
npm run sync         # = npx cap sync  (copies src/ into android/ and syncs plugins)
```

If you skip this, the APK you build will contain the **old** web assets.

---

## Path A — Build an APK and copy it to the phone (simplest)

### A0. Set JAVA_HOME (one time, for command-line builds)

`gradlew` needs to know where Java is. Point it at Android Studio's bundled JDK. Permanently
(takes effect in **new** terminals):

```powershell
setx JAVA_HOME "C:\Program Files\Android\Android Studio\jbr"
```

Or just for the current PowerShell window:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
```

(Skip this if you build via Android Studio in Path B — it uses the bundled JDK automatically.)

### A1. Build the debug APK

```powershell
cd "C:\Users\danme\New folder (2)\mobile-app\android"
.\gradlew.bat assembleDebug
```

The APK lands at:

```
mobile-app\android\app\build\outputs\apk\debug\app-debug.apk
```

> A prebuilt `app-debug.apk` may already exist there from an earlier build. If you want the
> **current** code (with the catalog feature), run Step 1 + `assembleDebug` again to refresh it.

### A2a. Install over USB with adb (fastest)

1. On the phone, enable **Developer options**: Settings → About phone → tap **Build number** 7 times.
2. In Settings → **System → Developer options**, turn on **USB debugging**.
3. Plug the phone into the laptop. Accept the "Allow USB debugging?" prompt on the phone.
4. Confirm the phone is seen, then install:

```powershell
adb devices            # should list your device
adb install -r "C:\Users\danme\New folder (2)\mobile-app\android\app\build\outputs\apk\debug\app-debug.apk"
```

`-r` reinstalls/updates in place, keeping existing app data. (If you ever switch between a
debug and a differently-signed build, uninstall first: `adb uninstall com.fieldmapper.app`.)

### A2b. Install manually (no adb)

1. Copy `app-debug.apk` to the phone (USB file transfer, Google Drive, email, etc.).
2. On the phone, open the file with a file manager and tap it.
3. Android will ask to allow installing from this source — enable **"Allow from this source"**
   (Settings → Apps → Special access → **Install unknown apps**), then tap **Install**.

---

## Path B — Run/install from Android Studio (best for iterating)

```powershell
cd "C:\Users\danme\New folder (2)\mobile-app"
npm run sync
npm run open         # = npx cap open android  (opens Android Studio)
```

In Android Studio:

1. Let Gradle sync finish (first open downloads dependencies — can take a few minutes).
2. Connect the phone over USB with **USB debugging** on (see Path A2a, steps 1–3), or start an emulator.
3. Pick your device in the toolbar dropdown and click **Run ▶**. It builds, installs, and launches.

To produce a shareable file instead of running: **Build → Build Bundle(s) / APK(s) → Build APK(s)**,
then use the "locate" link to find `app-debug.apk`.

---

## Step 2 — Grant permissions on first launch

When the app starts, allow the permissions it requests — they map to features:

| Permission | Why |
|---|---|
| **Location** (allow **"While using"**, then **"Always/Allow all the time"** for background tracking) | GPS, marking waypoints, background track recording |
| **Camera** | Photos for waypoints, route points, and **catalog specimens** |
| **Notifications** | The persistent notification for background GPS tracking |
| Photos/media | Importing existing images |

Background location is what lets the foreground service keep recording a track with the screen off.

---

## Step 3 — Connect to the laptop server (optional, for sync)

The app works fully offline, but to sync waypoints, routes, tracks, **specimens, and dig orders**
to/from the laptop hub:

1. Put the **phone and laptop on the same Wi-Fi**.
2. On the laptop, run `npm start` (from the repo root) and note the LAN URL it prints, e.g.
   `http://192.168.1.50:3000`. Use the **`http://…:3000`** address (not `https`) for local sync.
3. In the app: **Map → ☰ menu → Settings → Laptop Server URL**, paste the URL, tap **Save & Test**.
4. Sync from the **GPS tab → "Sync to Laptop"**. The status line reports specimens and dig orders
   pushed/pulled alongside waypoints and routes.

---

## Updating the app after code changes

The web layer has no build step, but the APK is a snapshot — to get new code onto the phone:

```powershell
cd "C:\Users\danme\New folder (2)\mobile-app"
npm run sync                                   # copy latest src/ into android/
cd android
.\gradlew.bat assembleDebug                    # rebuild the APK
adb install -r app\build\outputs\apk\debug\app-debug.apk   # reinstall in place
```

(Or just press **Run ▶** again in Android Studio.) App data (your IndexedDB waypoints, specimens,
dig orders, cached tiles) is preserved across a reinstall of the same debug build.

---

## Optional: wireless install (Android 11+)

Avoid the cable after the first pairing:

1. Phone → Developer options → **Wireless debugging** → on → **Pair device with pairing code**.
2. On the laptop: `adb pair <phone-ip>:<pair-port>` (enter the code), then
   `adb connect <phone-ip>:<connect-port>`.
3. Now `adb install -r …` works over Wi-Fi.

---

## Troubleshooting

- **`adb: no devices/emulators found`** — re-check USB debugging is on, try a different cable/port,
  and accept the authorization prompt on the phone. `adb kill-server && adb start-server` can help.
- **"App not installed" on manual install** — usually a signature clash with an older copy.
  `adb uninstall com.fieldmapper.app` (or remove the app on the phone) and install again.
- **`JAVA_HOME is not set and no 'java' command could be found`** — set `JAVA_HOME` to Android
  Studio's bundled JDK and reopen the terminal (see "Set JAVA_HOME" / Step A0):
  `setx JAVA_HOME "C:\Program Files\Android\Android Studio\jbr"`.
- **Other Gradle/JDK errors** — confirm JDK 17+ (the bundled one is 21). In Android Studio:
  Settings → Build, Execution, Deployment → Build Tools → Gradle → **Gradle JDK**.
- **First Gradle build is very slow** — it downloads dependencies once; later builds are fast.
- **Maps/weather blank** — that's network; tiles load when online and are cached for offline use.
  Sync needs the laptop reachable on the same Wi-Fi.
- **Can't sync** — make sure you used the `http://…:3000` LAN URL and both devices are on the same
  network (some guest/public Wi-Fi blocks device-to-device traffic).
