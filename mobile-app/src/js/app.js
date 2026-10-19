// Field Mapper - Main App Controller
// Handles tab switching, shared GPS, and initialization

// Pin presets (shared between views)
const PIN_PRESETS = {
  general:  { color: '#ff9800', icon: '\u{1F4CD}', label: 'General' },
  sample:   { color: '#4caf50', icon: '\u{1F9EA}', label: 'Sample' },
  geology:  { color: '#9c27b0', icon: '\u{1FAA8}', label: 'Geology' },
  hazard:   { color: '#f44336', icon: '\u26A0\uFE0F', label: 'Hazard' },
  camp:     { color: '#2196f3', icon: '\u26FA', label: 'Camp' },
  water:    { color: '#00bcd4', icon: '\u{1F4A7}', label: 'Water' },
  landmark: { color: '#ffc107', icon: '\u{1F3D4}\uFE0F', label: 'Landmark' },
  trail:    { color: '#795548', icon: '\u{1F97E}', label: 'Trail' },
  vehicle:  { color: '#607d8b', icon: '\u{1F697}', label: 'Vehicle' },
  mineral:  { color: '#e91e63', icon: '\u{1F48E}', label: 'Mineral' },
  wildlife: { color: '#8d6e63', icon: '\u{1F43E}', label: 'Wildlife' },
  vegetation:{ color: '#66bb6a', icon: '\u{1F33F}', label: 'Vegetation' },
  structure: { color: '#78909c', icon: '\u{1F3D7}\uFE0F', label: 'Structure' },
  boundary:  { color: '#ffab00', icon: '\u{1F6A9}', label: 'Boundary' },
  custom:    { color: '#9e9e9e', icon: '\u2B50', label: 'Custom' }
};

const CUSTOM_COLORS = ['#f44336','#e91e63','#9c27b0','#673ab7','#3f51b5','#2196f3','#00bcd4','#009688','#4caf50','#8bc34a','#ffc107','#ff9800','#ff5722','#795548','#607d8b','#ffffff'];

function getWpColor(wp) {
  return wp.color || (PIN_PRESETS[wp.category] || PIN_PRESETS.general).color;
}
function getWpIcon(wp) {
  return wp.pinIcon || (PIN_PRESETS[wp.category] || PIN_PRESETS.general).icon;
}

// --- Tab switching ---
let currentTab = 'gps';
let mapInitialized = false;
let weatherInitialized = false;
let gpsDataInitialized = false;

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));

  const viewId = `${tab}-view`;
  const viewEl = document.getElementById(viewId);
  if (viewEl) viewEl.classList.add('active');
  document.querySelector(`[data-tab="${tab}"]`)?.classList.add('active');

  if (tab === 'map') {
    if (!mapInitialized) {
      initMapView();
      mapInitialized = true;
    } else {
      setTimeout(() => window.fieldMap && window.fieldMap.invalidateSize(), 100);
    }
    loadMapWaypoints();
  }

  if (tab === 'gps') {
    refreshGpsList();
  }

  if (tab === 'gps-data') {
    if (!gpsDataInitialized) {
      initGpsDataView();
      gpsDataInitialized = true;
    }
  }

  if (tab === 'weather') {
    if (!weatherInitialized) {
      initWeatherView();
      weatherInitialized = true;
    }
  }
}

// --- Shared GPS ---
let gpsWatchId = null;
let currentPosition = null;
let gpsActive = false;

// GPS deduplication (Phase 1A) — prevents native + web double-firing
let _lastGpsTimestamp = 0;
let _lastGpsLat = 0;
let _lastGpsLon = 0;

function dispatchGpsUpdate(pos) {
  // Deduplicate: skip if within 500ms AND within ~3m of last update
  const now = pos.timestamp || Date.now();
  if (now - _lastGpsTimestamp < 500) {
    const dLat = Math.abs(pos.lat - _lastGpsLat);
    const dLon = Math.abs(pos.lon - _lastGpsLon);
    // ~3m ≈ 0.000027 degrees latitude
    if (dLat < 0.000027 && dLon < 0.000027) return;
  }
  _lastGpsTimestamp = now;
  _lastGpsLat = pos.lat;
  _lastGpsLon = pos.lon;

  gpsActive = true;
  currentPosition = pos;
  if (typeof onGpsUpdate_gpsView === 'function') onGpsUpdate_gpsView(currentPosition);
  if (typeof onGpsUpdate_mapView === 'function') onGpsUpdate_mapView(currentPosition);
  if (typeof onGpsUpdate_gpsData === 'function') onGpsUpdate_gpsData(currentPosition);
  if (typeof onGpsUpdate_navigation === 'function') onGpsUpdate_navigation(currentPosition);

  // Geofence proximity check
  if (typeof checkGeofences === 'function') checkGeofences(pos.lat, pos.lon);
}

function startGPS() {
  if (gpsWatchId) return;

  // If native GPS plugin is active and tracking, it will push updates
  // via NativeGps listeners. We still start web GPS as a fallback
  // for when native tracking is NOT running (live display still needs GPS).

  const options = {
    enableHighAccuracy: true,
    timeout: 30000,
    maximumAge: 0
  };

  gpsWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      // If native tracking is active, native updates take priority
      // but we still use web GPS for views that need it immediately
      const position = {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        altitude: pos.coords.altitude,
        speed: pos.coords.speed,
        heading: pos.coords.heading,
        timestamp: pos.timestamp
      };
      dispatchGpsUpdate(position);
    },
    (err) => {
      gpsActive = false;
      if (typeof onGpsError_gpsView === 'function') onGpsError_gpsView(err);
    },
    options
  );
}

// Handle app lifecycle for native tracking persistence
function setupLifecycleHandlers() {
  document.addEventListener('pause', () => {
    console.log('[App] Paused - native tracking continues in background');
    // Native foreground service keeps running, no action needed
  });

  document.addEventListener('resume', async () => {
    console.log('[App] Resumed');
    // Re-check native tracking status (might have been stopped from notification)
    if (window.NativeGps && NativeGps.isNative) {
      const status = await NativeGps.checkTracking();
      if (status.tracking) {
        console.log('[App] Native tracking still active, session:', status.sessionId);
        // Reconcile native points accumulated while backgrounded (Phase 1B)
        if (typeof reconcileNativePoints === 'function') {
          try { await reconcileNativePoints(); } catch (e) {
            console.warn('[App] Native reconciliation failed:', e);
          }
        }
      } else if (NativeGps.isTracking) {
        // Was tracking before pause but stopped (user tapped Stop in notification)
        NativeGps.isTracking = false;
        NativeGps.currentSessionId = null;
        if (typeof updateRecordButton === 'function') updateRecordButton();
      }
    }
    // Restart web GPS watch (Android may kill it on pause)
    if (!gpsWatchId) startGPS();
  });
}

// --- Wake Lock ---
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch (e) {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !wakeLock) requestWakeLock();
});

// --- Init ---
document.addEventListener('DOMContentLoaded', async () => {
  // Initialize database
  await openWpDB();
  await openTileDB();

  // Initialize native GPS tracking (must be before startGPS)
  if (window.NativeGps) {
    const nativeAvailable = await NativeGps.init();
    if (nativeAvailable) {
      // Register native GPS as an additional position source
      NativeGps.onLocationUpdate((pos) => {
        dispatchGpsUpdate(pos);
      });
    }
  }

  // Start web GPS (works alongside native for live display)
  startGPS();
  requestWakeLock();
  setupLifecycleHandlers();

  // Set up tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Initialize GPS view
  initGpsView();

  // Initialize geofence alerts
  if (typeof initGeofence === 'function') initGeofence();

  // Initialize navigation
  if (typeof initNavigation === 'function') initNavigation();

  // Show GPS tab by default
  switchTab('gps');
});
