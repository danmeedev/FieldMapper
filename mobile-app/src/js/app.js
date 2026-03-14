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

function startGPS() {
  if (gpsWatchId) return;

  const options = {
    enableHighAccuracy: true,
    timeout: 30000,
    maximumAge: 0
  };

  gpsWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      gpsActive = true;
      currentPosition = {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        altitude: pos.coords.altitude,
        speed: pos.coords.speed,
        heading: pos.coords.heading,
        timestamp: pos.timestamp
      };
      // Dispatch to all views
      if (typeof onGpsUpdate_gpsView === 'function') onGpsUpdate_gpsView(currentPosition);
      if (typeof onGpsUpdate_mapView === 'function') onGpsUpdate_mapView(currentPosition);
      if (typeof onGpsUpdate_gpsData === 'function') onGpsUpdate_gpsData(currentPosition);
      if (typeof onGpsUpdate_navigation === 'function') onGpsUpdate_navigation(currentPosition);
    },
    (err) => {
      gpsActive = false;
      if (typeof onGpsError_gpsView === 'function') onGpsError_gpsView(err);
    },
    options
  );
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

  // Start GPS
  startGPS();
  requestWakeLock();

  // Set up tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Initialize GPS view
  initGpsView();

  // Initialize navigation
  if (typeof initNavigation === 'function') initNavigation();

  // Show GPS tab by default
  switchTab('gps');
});
