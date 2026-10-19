// Geofence Alerts — notifies user when approaching saved waypoints
// Relies on: waypoint-store.js (getAllWaypoints, getSetting, saveSetting)
//            gps-data.js (haversineDistance)

let _gfEnabled = true;
let _gfRadiusM = 100;           // default alert radius in meters
let _gfCooldownMs = 5 * 60000;  // 5-minute cooldown per waypoint
let _gfWaypoints = [];           // cached waypoint list
let _gfLastAlerts = {};          // wpId -> timestamp of last alert
let _gfVisited = {};             // wpId -> true, for current session
let _gfLastLat = null;
let _gfLastLon = null;
let _gfAudioCtx = null;
let _gfToastTimer = null;
let _gfRefreshInterval = null;

// ---- Initialization ----

async function initGeofence() {
  // Load persisted settings
  const enabled = await getSetting('geofence-enabled');
  if (enabled !== null) _gfEnabled = !!enabled;

  const radius = await getSetting('geofence-radius');
  if (radius !== null && radius >= 25 && radius <= 500) _gfRadiusM = radius;

  // Load waypoints initially
  await _gfRefreshWaypoints();

  // Periodically refresh the waypoint list (picks up newly saved waypoints)
  _gfRefreshInterval = setInterval(_gfRefreshWaypoints, 30000);

  // Apply UI controls if they exist already
  _gfSyncUI();
}

async function _gfRefreshWaypoints() {
  try {
    _gfWaypoints = await getAllWaypoints();
  } catch (e) {
    _gfWaypoints = [];
  }
}

// ---- Core check — called on each GPS update ----

function checkGeofences(lat, lon) {
  if (!_gfEnabled) return;
  if (!_gfWaypoints || _gfWaypoints.length === 0) return;

  // Skip if position hasn't actually changed (stationary guard)
  if (_gfLastLat !== null && _gfLastLon !== null) {
    var moved = haversineDistance(_gfLastLat, _gfLastLon, lat, lon);
    if (moved < 2) return; // less than 2 m — considered stationary
  }
  _gfLastLat = lat;
  _gfLastLon = lon;

  var now = Date.now();

  for (var i = 0; i < _gfWaypoints.length; i++) {
    var wp = _gfWaypoints[i];
    if (wp.lat == null || wp.lon == null) continue;

    var dist = haversineDistance(lat, lon, wp.lat, wp.lon);
    if (dist > _gfRadiusM) continue;

    // Mark as visited
    _gfVisited[wp.id] = true;

    // Cooldown check
    if (_gfLastAlerts[wp.id] && (now - _gfLastAlerts[wp.id]) < _gfCooldownMs) continue;

    // Fire alert
    _gfLastAlerts[wp.id] = now;
    _gfFireAlert(wp, dist);
  }
}

// ---- Alert presentation ----

function _gfFireAlert(wp, distMeters) {
  var preset = (typeof PIN_PRESETS !== 'undefined' && PIN_PRESETS[wp.category])
    ? PIN_PRESETS[wp.category]
    : { icon: '', label: '' };

  var distStr;
  var distFt = distMeters * 3.28084;
  if (distFt < 528) {
    distStr = Math.round(distFt) + ' ft away';
  } else {
    distStr = (distMeters / 1609.34).toFixed(2) + ' mi away';
  }

  var name = wp.name || 'Waypoint';

  // Vibration
  if (navigator.vibrate) {
    try { navigator.vibrate([200, 100, 200]); } catch (e) {}
  }

  // Audio beep via Web Audio API
  _gfPlayBeep();

  // Show toast / banner
  _gfShowToast(wp, name, preset, distStr);
}

function _gfPlayBeep() {
  try {
    if (!_gfAudioCtx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      _gfAudioCtx = new AC();
    }
    var ctx = _gfAudioCtx;
    if (ctx.state === 'suspended') ctx.resume();

    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;       // A5
    gain.gain.value = 0.3;
    osc.connect(gain);
    gain.connect(ctx.destination);

    var t = ctx.currentTime;
    osc.start(t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.stop(t + 0.35);
  } catch (e) {}
}

function _gfShowToast(wp, name, preset, distStr) {
  // Remove existing geofence toast if any
  var existing = document.getElementById('geofence-toast');
  if (existing) existing.remove();
  if (_gfToastTimer) { clearTimeout(_gfToastTimer); _gfToastTimer = null; }

  var toast = document.createElement('div');
  toast.id = 'geofence-toast';
  toast.style.cssText =
    'position:fixed;top:12px;left:12px;right:12px;z-index:9500;' +
    'background:rgba(21,101,192,0.95);color:#fff;border-radius:10px;' +
    'padding:12px 14px;display:flex;align-items:center;gap:10px;' +
    'box-shadow:0 4px 20px rgba(0,0,0,0.5);cursor:pointer;' +
    'font-family:-apple-system,BlinkMacSystemFont,sans-serif;' +
    'animation:gfSlideIn 0.3s ease-out';

  toast.innerHTML =
    '<div style="font-size:28px;flex-shrink:0">' + (preset.icon || '📍') + '</div>' +
    '<div style="flex:1;min-width:0">' +
      '<div style="font-weight:bold;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
        _gfEscape(name) +
      '</div>' +
      '<div style="font-size:13px;opacity:0.85">' + distStr + '</div>' +
    '</div>' +
    '<div style="font-size:20px;opacity:0.6;flex-shrink:0">›</div>';

  // Tap to open waypoint detail
  toast.addEventListener('click', function () {
    toast.remove();
    if (_gfToastTimer) { clearTimeout(_gfToastTimer); _gfToastTimer = null; }
    if (typeof showWaypointDetail === 'function') {
      showWaypointDetail(wp.id);
    }
  });

  document.body.appendChild(toast);

  // Auto-dismiss after 5 seconds
  _gfToastTimer = setTimeout(function () {
    var el = document.getElementById('geofence-toast');
    if (el) el.remove();
    _gfToastTimer = null;
  }, 5000);
}

function _gfEscape(str) {
  var d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ---- CSS injection (once) ----

(function _gfInjectCSS() {
  if (document.getElementById('geofence-css')) return;
  var style = document.createElement('style');
  style.id = 'geofence-css';
  style.textContent =
    '@keyframes gfSlideIn{from{transform:translateY(-100%);opacity:0}to{transform:translateY(0);opacity:1}}';
  document.head.appendChild(style);
})();

// ---- Settings UI helpers ----

function _gfSyncUI() {
  var toggle = document.getElementById('geofence-toggle');
  if (toggle) toggle.checked = _gfEnabled;

  var slider = document.getElementById('geofence-radius-slider');
  var label  = document.getElementById('geofence-radius-label');
  if (slider) {
    slider.value = _gfRadiusM;
    if (label) label.textContent = _gfRadiusM + 'm';
  }
}

// Called from UI toggle
function setGeofenceEnabled(enabled) {
  _gfEnabled = !!enabled;
  saveSetting('geofence-enabled', _gfEnabled);
}

// Called from UI slider
function setGeofenceRadius(val) {
  val = parseInt(val, 10);
  if (isNaN(val) || val < 25) val = 25;
  if (val > 500) val = 500;
  _gfRadiusM = val;
  saveSetting('geofence-radius', _gfRadiusM);
  var label = document.getElementById('geofence-radius-label');
  if (label) label.textContent = _gfRadiusM + 'm';
}

// Get visited waypoints for the current session
function getGeofenceVisited() {
  return Object.keys(_gfVisited);
}

// Reset session visited list
function resetGeofenceVisited() {
  _gfVisited = {};
}
