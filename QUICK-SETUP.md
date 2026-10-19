# Field Mapper — Quick Setup

**Get the app:** [Windows download](https://github.com/danmeedev/FieldMapper/releases/latest/download/FieldMapper-Windows-Android.zip) · [Android APK](https://github.com/danmeedev/FieldMapper/releases/latest/download/FieldMapper-Android.apk). These are ready-to-use builds; you do not need the GitHub source-code ZIP.

For Windows PCs and Android phones. The packaged apps do not require Node.js, programming tools, or Android Studio. For every menu and technical details, see [README](README.md).

## 1. What you need

- Windows 10/11 on a 64-bit Intel/AMD PC, with a browser.
- Android 7 or newer, with room for maps/photos.
- The Field Mapper Windows/Android ZIP, or its separate APK for the phone.
- Internet before the trip to download the package and maps. Prepared maps, GPS, and local syncing can work without internet; weather updates and AI cannot.

In the extracted package, open **START HERE.html** for an easy-to-read offline copy of this guide.

## 2. Start the PC app

1. Right-click the downloaded ZIP and choose **Extract All**. Finish extracting; do not run the app inside the ZIP window.
2. Open the extracted folder, then **PC**.
3. Double-click **Start Field Mapper.cmd** (Windows may hide `.cmd`).
4. A startup window appears and your usual browser opens the app. **Keep the startup window open.** The PC browser address is `http://localhost:3000`.
5. If Windows asks about network access, allow the app on your trusted private network. Your own phone hotspot can be marked private in Windows network settings.

No developer software or administrator account is normally required. If the browser does not open, enter `http://localhost:3000` yourself. Read any error in the startup window.

To stop, press **Ctrl+C** in that window or close it. Closing just the browser leaves the server running. Starting the launcher again reopens an already running app.

## 3. Install the Android app

1. Find **Android → FieldMapper-1.1.2.apk** in the package, or use the separate `FieldMapper-1.1.2-Android.apk`. They are the same app.
2. Transfer the APK to your phone using USB or your usual file-sharing service.
3. Open the APK from the phone's Files/Downloads app.
4. If asked, allow that Files app to install apps from this source, then install **Field Mapper**. You can turn off that source's install permission afterward. Use a trusted package and keep Google Play Protect enabled.
5. Open Field Mapper. Allow precise location for GPS and camera permission when adding photos. Starting a background track may open Android's location settings; choose the background access you want, then return to the app.
6. Outdoors, wait for the GPS position. Poor indoor reception is normal.

No USB debugging is needed. This is an Android APK, not an iPhone app. An existing developer/debug build may use a different signing certificate: read the README update section and back up its data before replacing it. Do not uninstall first just to get past an update error.

## 4. Connect at home

1. Put the laptop and phone on the **same private Wi-Fi network**; avoid guest networks that isolate devices.
2. Start the PC app. Click **Settings** and find **Connect your Android phone**. It lists addresses such as `http://192.168.1.25:3000`; your numbers will differ. The startup window lists them too.
3. Choose the address for the current Wi-Fi adapter, not a VPN or virtual adapter.
4. On Android, tap **Map → ☰ → Settings**. Enter that laptop address in **Laptop Server URL**, including `http://` and `:3000`, then tap **Save & Test**.
5. Go to **GPS → Sync to Laptop**. Check that it completes and records appear under **Pins** on the PC; reload the PC page if needed.

The phone needs the **laptop's** address, not the phone's address or `localhost`. `10.0.2.2` is for an Android emulator only. Refresh PC addresses after changing networks.

## 5. Prepare maps before your trip

Phone and PC map caches are separate. Syncing records does not copy downloaded maps between devices.

On Android, open **Map**, move to the field area, and choose the desired layer under **☰ → Layers**. Open **☰ → Download Tiles → Download Visible Area**. For a saved route, use **Route Corridor Download** and choose the route, buffer, maximum zoom, and layers. Wait for it to finish. More area, layers, and close-up zoom require more storage.

On the PC, browse the intended area/layers/zoom levels while online to cache tiles. A technical friend can use the larger-area tile downloader described in the README.

Before leaving, turn off internet briefly and inspect both devices at the zoom levels you intend to use. Blank areas still need downloading. Downloading only one layer does not prepare every layer.

## 6. In the field without a Wi-Fi router: use the phone hotspot

The hotspot creates a local network. **Local syncing does not need internet or cell coverage**, provided your phone allows its hotspot to operate without mobile data/service. Phone/carrier behavior varies: test your exact setup before the trip.

1. On the phone, open Android **Settings → Network/Connections → Hotspot/Tethering → Wi-Fi hotspot**. Names vary. Turn it on and note the network name/password.
2. On the laptop, connect to that hotspot from its Wi-Fi list. Windows may say **No internet**; local syncing can still work.
3. **After connecting the laptop, start Field Mapper on the laptop.** If already running, click PC **Settings → Refresh Addresses**.
4. Find the laptop's new Wi-Fi address in Settings/startup. It may differ from the address used at home.
5. On Android, update **Map → ☰ → Settings → Laptop Server URL** to that new laptop address, and tap **Save & Test**.
6. Open **GPS → Sync to Laptop**. Records can now sync and live phone GPS can appear on the PC.

Keep the hotspot and startup window open while connected. Use phone power for longer sessions. Fresh maps, road snapping, weather, and AI still require real internet: a hotspot without mobile data does not provide it.

If the phone refuses to run its hotspot without service, use another local network or collect on the phone alone and sync later. GPS and already-downloaded maps still work independently. At home, reconnect to home Wi-Fi and update the server address again. See [Google's hotspot guide](https://support.google.com/android/answer/9059108?hl=en) for device-dependent instructions.

## 7. Everyday use

- **Mark a place:** Android **GPS → Mark This Location**. Add title, category, notes/photos, then **Save Location**. Sample categories expose extra geology fields.
- **Record a path:** **Data → Record Track**. Stop when finished. Background recording needs suitable permissions and battery settings.
- **View/follow routes:** **Map → ☰ → Routes**. Open a saved route or create one; the README explains editing and compass navigation.
- **Collect without laptop:** save on the phone offline; sync when connected again.
- **Sync changes:** use **GPS → Sync to Laptop**. Changes and deletions can travel both ways; delete only records you intend to remove from both devices.

## 8. Enable and use optional AI

Everything above works with AI off. **AI tools stay hidden until a real connection test succeeds.**

1. With internet available on the laptop, open PC **Settings → AI Configuration**.
2. Enable AI. Enter an Anthropic API key from your own account and a supported Claude model. The prefilled model is a starting choice; provider/account availability can change.
3. Click **Save**, then **Test Connection**. Saving alone is insufficient. The test makes a small real Anthropic request and may incur a small charge; provider billing is separate.
4. After success, an **AI** button appears on the PC. Android uses that connected laptop's readiness.
5. On PC, choose a waypoint's **AI Analyze**, or **AI → Analyze All Observations**. On Android, open a marked location from the GPS list and tap **AI Analysis**.
6. Read the result alongside your own observations. Analysis can send field details and attached photos to Anthropic; submit only information you want sent there.

The laptop needs internet and Android must reach it. AI does not run offline on the phone. Changing key/model or disabling AI requires a successful retest before tools return. Configuration remains available while tools are hidden.

## 9. Back up and update

After syncing, double-click **PC → Open My Field Mapper Data.cmd**. Stop the PC app, then copy that entire **Field Mapper** data folder to a backup drive. It holds synced records/photos, laptop maps, settings, and possibly your AI key: keep it private. Do not clear Android app storage or uninstall before checking backups.

A newly extracted PC package uses the same Windows user's saved data folder. It does not automatically import a developer checkout or another PC's data. A newer Android APK signed with the same release key can update without uninstalling; a differently signed debug build needs a backed-up migration first.

The Android **Export All Data (JSON)** button currently exports waypoint records only. It does not back up photos, routes, catalog records, or native tracks. Prefer sync plus the PC folder backup for synced work.

## 10. Troubleshooting

| Problem | Try this |
| --- | --- |
| PC page does not open | Extract everything; keep startup window open; enter `http://localhost:3000`; read startup errors. |
| Phone cannot connect | Same Wi-Fi/hotspot; correct laptop IP with `http://` and `:3000`; restart/refresh after switching networks. Check Windows private-network permission. |
| Still cannot connect | A VPN, guest-network isolation, or phone hotspot restrictions may block local access. Try the correct Wi-Fi adapter on your own network. Do not disable the entire firewall. |
| No offline map | Download that area, layer, and zoom while online, on each device. |
| GPS waiting | Go outdoors; check precise location permission. |
| No AI button | Configure on PC, Save, pass Test Connection, and confirm phone-to-laptop access. |
| AI test fails | Check internet, provider key/model access/billing, and the error shown in configuration. |
| APK installation fails | Check Android 7+, storage, and signing/version compatibility. Back up before removing an old build. |

For detailed menus, storage, migration, developer builds, and logs, read [README](README.md).


## Checking for app updates

Open **Settings → App Updates** (on Android, open Map and its menu first). You can turn **Check automatically** off at any time, or press **Check now**. Checks need internet; they will not work in the field without an internet connection. Version 1.1.1 and newer check the Field Mapper GitHub release feed. If you have the original 1.1.0 download, install the latest release manually once to enable these checks.

When a new version is available, the app asks before opening its download. Choose **Close** to keep using your current version. Nothing installs automatically. On PC, close the running app, extract the new ZIP into a new folder, then use its Start Field Mapper file. On Android, download the new APK and approve installing it over the existing app. **Do not uninstall or clear storage.** Your saved data stays in place; keep a backup before upgrading.


### If Android says the update conflicts with an existing package

**Keep the old app installed. Do not clear storage.** This can happen if you first installed an early APK built on our development PC instead of a GitHub release.

For those early builds on **Android 13 or newer**, sync with your laptop first, stop any recording, then install the [one-time migration APK](https://github.com/danmeedev/FieldMapper/releases/download/v1.1.2/FieldMapper-1.1.2-Android-Migration.apk) over the existing app. Open it and confirm your records are there, then install the normal Android APK from the download link above. Future updates use the normal APK. If the migration also conflicts, stop and ask for help; an APK signed on a different PC needs a different recovery path. **Field Mapper Dev** is a separate developer app with separate data.
