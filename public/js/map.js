// Initialize map
const map = L.map('map', {
  center: [39.5, -118.5], // Default: Nevada
  zoom: 12,
  zoomControl: true,
  maxZoom: 20
});

// Base tile layers (served locally from our server)
const baseLayers = {
  topo: L.tileLayer('/tiles/topo/{z}/{x}/{y}.png', {
    maxZoom: 16, maxNativeZoom: 16,
    attribution: 'USGS Topo'
  }),
  satellite: L.tileLayer('/tiles/satellite/{z}/{x}/{y}.jpg', {
    maxZoom: 20, maxNativeZoom: 16,
    attribution: 'USGS Imagery'
  }),
  'satellite-hd': L.tileLayer('/tiles/satellite-hd/{z}/{x}/{y}.jpg', {
    maxZoom: 20,
    attribution: 'ESRI World Imagery'
  }),
  'imagery-topo': L.tileLayer('/tiles/imagery-topo/{z}/{x}/{y}.jpg', {
    maxZoom: 16, maxNativeZoom: 16,
    attribution: 'USGS Imagery + Topo'
  }),
  blm: L.tileLayer('/tiles/blm/{z}/{x}/{y}.jpg', {
    maxZoom: 15,
    attribution: 'BLM Surface Management'
  }),
  'esri-topo': L.tileLayer('/tiles/esri-topo/{z}/{x}/{y}.jpg', {
    maxZoom: 19,
    attribution: 'ESRI World Topo'
  }),
  'esri-street': L.tileLayer('/tiles/esri-street/{z}/{x}/{y}.jpg', {
    maxZoom: 19,
    attribution: 'ESRI Street Map'
  }),
  natgeo: L.tileLayer('/tiles/natgeo/{z}/{x}/{y}.jpg', {
    maxZoom: 16,
    attribution: 'National Geographic'
  }),
  relief: L.tileLayer('/tiles/relief/{z}/{x}/{y}.jpg', {
    maxZoom: 13,
    attribution: 'ESRI Shaded Relief'
  }),
  terrain: L.tileLayer('/tiles/terrain/{z}/{x}/{y}.jpg', {
    maxZoom: 13,
    attribution: 'ESRI Terrain'
  })
};

// Add default layer
baseLayers.topo.addTo(map);
let activeBase = 'topo';

// Layer switching
document.querySelectorAll('input[name="base"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    map.removeLayer(baseLayers[activeBase]);
    activeBase = e.target.value;
    baseLayers[activeBase].addTo(map);
  });
});

// GPS marker
const gpsIcon = L.divIcon({
  className: 'gps-pulse',
  iconSize: [16, 16],
  iconAnchor: [8, 8]
});
let gpsMarker = null;
let accuracyCircle = null;
let trackLine = null;
let trackPoints = [];

// Waypoints
let waypoints = JSON.parse(localStorage.getItem('fieldmapper-waypoints') || '[]');
let waypointMarkers = [];

// Overlay layers
let claimsLayer = null;
let plssLayer = null;

// Load mining claims GeoJSON
fetch('/data/mining-claims.geojson')
  .then(r => r.ok ? r.json() : null)
  .then(data => {
    if (data && data.features) {
      claimsLayer = L.geoJSON(data, {
        style: {
          color: '#ff6600',
          weight: 2,
          fillColor: '#ff6600',
          fillOpacity: 0.15
        },
        onEachFeature: (feature, layer) => {
          const p = feature.properties;
          let popup = '<b>Mining Claim</b><br>';
          if (p.CASE_DISP) popup += `Status: ${p.CASE_DISP}<br>`;
          if (p.CLAIMANT) popup += `Claimant: ${p.CLAIMANT}<br>`;
          if (p.MINING_DIST) popup += `District: ${p.MINING_DIST}<br>`;
          if (p.CASE_TYPE_AB) popup += `Type: ${p.CASE_TYPE_AB}<br>`;
          if (p.MC_NAME) popup += `Name: ${p.MC_NAME}<br>`;
          layer.bindPopup(popup);
        }
      }).addTo(map);
    }
  })
  .catch(() => console.log('No mining claims data available'));

// Load PLSS sections
fetch('/data/plss-sections.geojson')
  .then(r => r.ok ? r.json() : null)
  .then(data => {
    if (data && data.features) {
      plssLayer = L.geoJSON(data, {
        style: {
          color: '#888',
          weight: 1,
          fillOpacity: 0,
          dashArray: '4,4'
        },
        onEachFeature: (feature, layer) => {
          const p = feature.properties;
          let label = '';
          if (p.FRSTDIVNO) label = `Sec ${p.FRSTDIVNO}`;
          if (p.TWNSHPNO && p.RANGENO) {
            label += ` T${p.TWNSHPNO}${p.TWNSHPDIR} R${p.RANGENO}${p.RANGEDIR}`;
          }
          if (label) layer.bindTooltip(label, { permanent: false, direction: 'center' });
        }
      });
      // Not added to map by default (checkbox unchecked)
    }
  })
  .catch(() => console.log('No PLSS data available'));

// Transparent overlay tile layers
const overlayTileLayers = {
  streets: L.tileLayer('/tiles/streets/{z}/{x}/{y}.png', { maxZoom: 18, attribution: 'ESRI', opacity: 0.9 }),
  labels: L.tileLayer('/tiles/labels/{z}/{x}/{y}.png', { maxZoom: 18, attribution: 'ESRI', opacity: 0.9 }),
  contours: L.tileLayer('/tiles/contours/{z}/{x}/{y}.png', { maxZoom: 16, attribution: 'USGS', opacity: 0.7 }),
  hydro: L.tileLayer('/tiles/hydro/{z}/{x}/{y}.png', { maxZoom: 16, attribution: 'USGS', opacity: 0.8 })
};

// Overlay toggles - GeoJSON
document.getElementById('overlay-claims').addEventListener('change', (e) => {
  if (claimsLayer) {
    if (e.target.checked) claimsLayer.addTo(map);
    else map.removeLayer(claimsLayer);
  }
  const leg = document.getElementById('legend-claims');
  if (leg) leg.style.display = e.target.checked ? 'block' : 'none';
});

document.getElementById('overlay-plss').addEventListener('change', (e) => {
  if (plssLayer) {
    if (e.target.checked) plssLayer.addTo(map);
    else map.removeLayer(plssLayer);
  }
  const leg = document.getElementById('legend-plss');
  if (leg) leg.style.display = e.target.checked ? 'block' : 'none';
});

// Show claims legend by default (claims checkbox is checked)
const claimsLeg = document.getElementById('legend-claims');
if (claimsLeg) claimsLeg.style.display = 'block';

// Overlay toggles - tile layers
['streets', 'labels', 'contours', 'hydro'].forEach(id => {
  document.getElementById(`overlay-${id}`).addEventListener('change', (e) => {
    if (e.target.checked) overlayTileLayers[id].addTo(map);
    else map.removeLayer(overlayTileLayers[id]);
    const leg = document.getElementById(`legend-${id}`);
    if (leg) leg.style.display = e.target.checked ? 'block' : 'none';
  });
});

// WebSocket connection for GPS
const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(`${wsProtocol}//${location.host}?role=map`);

const statusEl = document.getElementById('gps-status');
const coordsEl = document.getElementById('coords');
const accuracyEl = document.getElementById('accuracy');
const autoCenterCb = document.getElementById('auto-center');

ws.onopen = () => {
  statusEl.textContent = 'GPS: Waiting for phone...';
  statusEl.className = 'status disconnected';
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  if (data.type === 'gps') {
    const { lat, lon, accuracy, altitude, speed, heading } = data;

    statusEl.textContent = 'GPS: Connected';
    statusEl.className = 'status connected';
    coordsEl.textContent = `${lat.toFixed(6)}, ${lon.toFixed(6)}` +
      (altitude ? ` | ${(altitude * 3.28084).toFixed(0)} ft` : '');
    accuracyEl.textContent = accuracy ? `Accuracy: ${(accuracy * 3.28084).toFixed(0)} ft` : '';

    const latlng = [lat, lon];

    // Update GPS marker
    if (!gpsMarker) {
      gpsMarker = L.marker(latlng, { icon: gpsIcon, zIndexOffset: 1000 }).addTo(map);
      map.setView(latlng, 14);
    } else {
      gpsMarker.setLatLng(latlng);
    }

    // Accuracy circle
    if (accuracy) {
      if (!accuracyCircle) {
        accuracyCircle = L.circle(latlng, {
          radius: accuracy,
          color: '#2196f3',
          fillColor: '#2196f3',
          fillOpacity: 0.1,
          weight: 1
        }).addTo(map);
      } else {
        accuracyCircle.setLatLng(latlng);
        accuracyCircle.setRadius(accuracy);
      }
    }

    // Track
    if (document.getElementById('show-track').checked) {
      trackPoints.push(latlng);
      if (!trackLine) {
        trackLine = L.polyline(trackPoints, {
          color: '#2196f3',
          weight: 3,
          opacity: 0.7
        }).addTo(map);
      } else {
        trackLine.setLatLngs(trackPoints);
      }
    }

    // Auto-center
    if (autoCenterCb.checked) {
      map.panTo(latlng);
    }
  }

  // Waypoint from phone
  if (data.type === 'waypoint') {
    addWaypoint(data);
  }
};

ws.onclose = () => {
  statusEl.textContent = 'GPS: Disconnected';
  statusEl.className = 'status disconnected';
  // Try reconnect
  setTimeout(() => location.reload(), 3000);
};

// Center on GPS button
document.getElementById('center-gps').addEventListener('click', () => {
  if (gpsMarker) map.setView(gpsMarker.getLatLng(), map.getZoom());
});

// Clear track
document.getElementById('clear-track').addEventListener('click', () => {
  trackPoints = [];
  if (trackLine) {
    map.removeLayer(trackLine);
    trackLine = null;
  }
});

// Show/hide track
document.getElementById('show-track').addEventListener('change', (e) => {
  if (!e.target.checked && trackLine) {
    map.removeLayer(trackLine);
  } else if (e.target.checked && trackLine) {
    trackLine.addTo(map);
  }
});

// Panel toggle system
const panels = ['layer-panel', 'wp-panel', 'sync-panel', 'ai-panel', 'settings-panel', 'routes-panel', 'measure-panel'];
const toggles = {
  'toggle-panel': 'layer-panel',
  'toggle-wp': 'wp-panel',
  'toggle-routes': 'routes-panel',
  'toggle-measure': 'measure-panel',
  'toggle-sync': 'sync-panel',
  'toggle-ai': 'ai-panel',
  'toggle-settings': 'settings-panel'
};

Object.entries(toggles).forEach(([btnId, panelId]) => {
  document.getElementById(btnId).addEventListener('click', () => {
    const panel = document.getElementById(panelId);
    const isVisible = panel.classList.contains('visible');
    // Close all panels
    panels.forEach(p => document.getElementById(p).classList.remove('visible'));
    document.querySelectorAll('.toolbar-btn').forEach(b => b.classList.remove('active'));
    // Toggle target
    if (!isVisible) {
      panel.classList.add('visible');
      document.getElementById(btnId).classList.add('active');
    }
  });
});

// -- Pin categories, colors, and icons --
const PIN_PRESETS = {
  general:  { color: '#ff9800', icon: '📍', label: 'General' },
  sample:   { color: '#4caf50', icon: '🧪', label: 'Sample' },
  geology:  { color: '#9c27b0', icon: '🪨', label: 'Geology' },
  hazard:   { color: '#f44336', icon: '⚠️', label: 'Hazard' },
  camp:     { color: '#2196f3', icon: '⛺', label: 'Camp' },
  water:    { color: '#00bcd4', icon: '💧', label: 'Water' },
  landmark: { color: '#ffc107', icon: '🏔️', label: 'Landmark' },
  trail:    { color: '#795548', icon: '🥾', label: 'Trail' },
  vehicle:  { color: '#607d8b', icon: '🚗', label: 'Vehicle' },
  mineral:  { color: '#e91e63', icon: '💎', label: 'Mineral' },
  wildlife: { color: '#8d6e63', icon: '🐾', label: 'Wildlife' },
  vegetation:{ color: '#66bb6a', icon: '🌿', label: 'Vegetation' },
  structure: { color: '#78909c', icon: '🏗️', label: 'Structure' },
  boundary:  { color: '#ffab00', icon: '🚩', label: 'Boundary' },
  custom:    { color: '#9e9e9e', icon: '⭐', label: 'Custom' }
};

const CUSTOM_COLORS = ['#f44336','#e91e63','#9c27b0','#673ab7','#3f51b5','#2196f3','#00bcd4','#009688','#4caf50','#8bc34a','#ffc107','#ff9800','#ff5722','#795548','#607d8b','#ffffff'];

// -- Waypoints --
function addWaypoint(wp) {
  const waypoint = {
    id: wp.id || Date.now(),
    lat: wp.lat,
    lon: wp.lon,
    name: wp.name || `WP-${waypoints.length + 1}`,
    notes: wp.notes || '',
    category: wp.category || 'general',
    color: wp.color || null,
    pinIcon: wp.pinIcon || null,
    samples: wp.samples || [],
    timestamp: wp.timestamp || new Date().toISOString(),
    altitude: wp.altitude || null,
    photos: wp.photos || []
  };

  waypoints.push(waypoint);
  saveWaypoints();
  renderWaypointMarker(waypoint);
  renderWaypointList();
}

function saveWaypoints() {
  localStorage.setItem('fieldmapper-waypoints', JSON.stringify(waypoints));
}

function getWpColor(wp) {
  return wp.color || (PIN_PRESETS[wp.category] || PIN_PRESETS.general).color;
}
function getWpIcon(wp) {
  return wp.pinIcon || (PIN_PRESETS[wp.category] || PIN_PRESETS.general).icon;
}

function renderWaypointMarker(wp) {
  const color = getWpColor(wp);
  const emoji = getWpIcon(wp);

  const icon = L.divIcon({
    className: 'wp-marker-icon',
    html: `<div style="width:26px;height:26px;background:${color};border:3px solid #fff;border-radius:50%;box-shadow:0 0 6px rgba(0,0,0,0.6);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:13px;line-height:1">${emoji}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13]
  });

  const marker = L.marker([wp.lat, wp.lon], { icon, interactive: true, bubblingMouseEvents: false }).addTo(map);

  const popupContent = buildPopupContent(wp);
  marker.bindPopup(popupContent, { maxWidth: 320, minWidth: 200 });
  waypointMarkers.push({ id: wp.id, marker });
}

function buildPopupContent(wp) {
  let popup = `<div style="max-width:300px">`;
  popup += `<b style="font-size:15px">${wp.name}</b>`;
  if (wp.category !== 'general') popup += ` <span style="color:#1976d2;font-size:12px">[${wp.category}]</span>`;
  popup += `<br><span style="color:#666;font-size:12px">${wp.lat.toFixed(6)}, ${wp.lon.toFixed(6)}</span>`;
  if (wp.altitude) popup += ` <span style="color:#666;font-size:12px">| ${(wp.altitude * 3.28084).toFixed(0)} ft</span>`;
  popup += '<br>';
  if (wp.notes) popup += `<p style="margin:8px 0;white-space:pre-wrap;font-size:13px">${wp.notes}</p>`;
  if (wp.samples && wp.samples.length > 0) {
    popup += '<div style="margin:6px 0;font-size:12px"><b>Samples:</b><br>';
    wp.samples.forEach(s => {
      popup += `${s.id}: ${s.type}`;
      if (s.rockType) popup += ` | ${s.rockType}`;
      if (s.mineralization) popup += ` | ${s.mineralization}`;
      if (s.alteration) popup += ` | alt: ${s.alteration}`;
      popup += '<br>';
    });
    popup += '</div>';
  }
  if (wp.photos && wp.photos.length > 0) {
    popup += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin:8px 0">';
    wp.photos.forEach(filename => {
      popup += `<a href="/photos/${filename}" target="_blank"><img src="/photos/${filename}" style="width:90px;height:90px;object-fit:cover;border-radius:4px;cursor:pointer;border:1px solid #ddd"></a>`;
    });
    popup += '</div>';
  }
  popup += `<div style="margin-top:6px;display:flex;justify-content:space-between;align-items:center;gap:4px">`;
  popup += `<small style="color:#999">${new Date(wp.timestamp).toLocaleString()}</small>`;
  popup += `<div style="display:flex;gap:4px">`;
  popup += `<button class="wp-popup-btn" style="background:#455a64" onclick="editWaypoint(${wp.id})">Edit</button>`;
  popup += `<button class="wp-popup-btn" onclick="analyzeWaypoint(${wp.id})">AI Analyze</button>`;
  popup += `</div></div></div>`;
  return popup;
}

function renderWaypointList() {
  renderLegend();
  const list = document.getElementById('waypoint-list');
  if (!list) return;
  list.innerHTML = '';

  // Show newest first
  const sorted = [...waypoints].reverse();
  document.getElementById('wp-count').textContent = waypoints.length;

  sorted.forEach(wp => {
    const color = getWpColor(wp);
    const emoji = getWpIcon(wp);
    const photoCount = (wp.photos && wp.photos.length > 0) ? ` | ${wp.photos.length} photo${wp.photos.length > 1 ? 's' : ''}` : '';

    const div = document.createElement('div');
    div.className = 'wp-list-item';
    div.innerHTML = `
      <div class="wp-list-color" style="background:${color};display:flex;align-items:center;justify-content:center;width:22px;height:22px;font-size:12px;border-radius:50%;border:2px solid #fff">${emoji}</div>
      <div class="wp-list-info">
        <div class="wp-list-name">${wp.name}</div>
        <div class="wp-list-detail">${wp.category} | ${new Date(wp.timestamp).toLocaleDateString()}${photoCount}</div>
        ${wp.notes ? `<div class="wp-list-notes">${wp.notes.substring(0, 80)}${wp.notes.length > 80 ? '...' : ''}</div>` : ''}
      </div>
      <button class="wp-list-delete" onclick="event.stopPropagation(); removeWaypoint(${wp.id})">X</button>
    `;
    div.addEventListener('click', () => {
      map.setView([wp.lat, wp.lon], 16);
      // Open the popup for this waypoint
      const entry = waypointMarkers.find(w => w.id === wp.id);
      if (entry) entry.marker.openPopup();
    });
    list.appendChild(div);
  });
}

// Render pin legend showing categories in use
function renderLegend() {
  const legendEl = document.getElementById('pin-legend');
  if (!legendEl) return;

  // Show all preset categories, highlight ones in use
  const usedCategories = new Set(waypoints.map(w => w.category));
  let html = '';
  Object.entries(PIN_PRESETS).forEach(([key, preset]) => {
    const inUse = usedCategories.has(key);
    const opacity = inUse ? '1' : '0.4';
    const count = waypoints.filter(w => w.category === key).length;
    html += `<div style="display:flex;align-items:center;gap:6px;opacity:${opacity}">`;
    html += `<span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;background:${preset.color};border-radius:50%;font-size:10px;border:2px solid #fff">${preset.icon}</span>`;
    html += `<span>${preset.label}${count ? ` (${count})` : ''}</span>`;
    html += `</div>`;
  });

  // Show custom colors if any
  const customColorPins = waypoints.filter(w => w.color);
  if (customColorPins.length > 0) {
    html += `<div style="margin-top:4px;font-size:11px;color:#aaa">${customColorPins.length} pin${customColorPins.length > 1 ? 's' : ''} with custom color</div>`;
  }

  legendEl.innerHTML = html;
}

window.removeWaypoint = function(id) {
  waypoints = waypoints.filter(w => w.id !== id);
  saveWaypoints();
  const entry = waypointMarkers.find(w => w.id === id);
  if (entry) {
    map.removeLayer(entry.marker);
    waypointMarkers = waypointMarkers.filter(w => w.id !== id);
  }
  renderWaypointList();
};

// Edit waypoint (change name, category, color, notes)
window.editWaypoint = function(id) {
  const wp = waypoints.find(w => w.id === id);
  if (!wp) return;

  map.closePopup();

  const existing = document.getElementById('pin-form-popup');
  if (existing) existing.remove();

  const categoryOptions = Object.entries(PIN_PRESETS).map(([k, v]) =>
    `<option value="${k}" ${wp.category === k ? 'selected' : ''}>${v.icon} ${v.label}</option>`
  ).join('');

  const colorSwatches = CUSTOM_COLORS.map(c =>
    `<div class="pin-color-swatch" data-color="${c}" style="width:22px;height:22px;background:${c};border-radius:50%;cursor:pointer;border:2px solid ${wp.color === c ? '#fff' : 'transparent'}"></div>`
  ).join('');

  const form = document.createElement('div');
  form.id = 'pin-form-popup';
  form.innerHTML = `
    <h4 style="margin:0 0 8px 0;font-size:14px">Edit Pin</h4>
    <input id="pin-name" type="text" value="${wp.name}" style="width:100%;padding:6px;margin-bottom:6px;border:1px solid #444;border-radius:4px;background:#222;color:#fff;font-size:13px">
    <select id="pin-category" style="width:100%;padding:6px;margin-bottom:6px;border:1px solid #444;border-radius:4px;background:#222;color:#fff;font-size:13px">
      ${categoryOptions}
    </select>
    <div style="margin-bottom:6px">
      <div style="font-size:11px;color:#aaa;margin-bottom:4px">Custom Color</div>
      <div id="pin-colors" style="display:flex;flex-wrap:wrap;gap:4px">${colorSwatches}</div>
      <input type="hidden" id="pin-custom-color" value="${wp.color || ''}">
    </div>
    <textarea id="pin-notes" rows="3" style="width:100%;padding:6px;margin-bottom:8px;border:1px solid #444;border-radius:4px;background:#222;color:#fff;font-size:13px;resize:vertical">${wp.notes || ''}</textarea>
    <div style="display:flex;gap:6px">
      <button id="pin-save" style="flex:1;padding:8px;background:#4caf50;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:bold">Save</button>
      <button id="pin-cancel" style="flex:1;padding:8px;background:#666;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px">Cancel</button>
    </div>
  `;
  Object.assign(form.style, {
    position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
    zIndex: '2000', background: 'rgba(0,0,0,0.95)', color: '#fff', padding: '16px',
    borderRadius: '10px', width: '280px', boxShadow: '0 4px 20px rgba(0,0,0,0.5)'
  });
  document.body.appendChild(form);

  form.querySelectorAll('.pin-color-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      form.querySelectorAll('.pin-color-swatch').forEach(s => s.style.border = '2px solid transparent');
      swatch.style.border = '2px solid #fff';
      document.getElementById('pin-custom-color').value = swatch.dataset.color;
    });
  });

  document.getElementById('pin-save').addEventListener('click', () => {
    wp.name = document.getElementById('pin-name').value.trim() || wp.name;
    wp.category = document.getElementById('pin-category').value;
    wp.notes = document.getElementById('pin-notes').value.trim();
    wp.color = document.getElementById('pin-custom-color').value || null;
    saveWaypoints();
    // Re-render marker
    const entry = waypointMarkers.find(w => w.id === id);
    if (entry) {
      map.removeLayer(entry.marker);
      waypointMarkers = waypointMarkers.filter(w => w.id !== id);
    }
    renderWaypointMarker(wp);
    renderWaypointList();
    form.remove();
  });

  document.getElementById('pin-cancel').addEventListener('click', () => form.remove());
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') form.remove();
  });
};

// --- Drop pin mode: click map to place a pin ---
let dropPinMode = false;
let pendingPinLatLng = null;

const dropPinBtn = document.getElementById('drop-pin');
dropPinBtn.addEventListener('click', () => {
  // Toggle drop-pin mode
  dropPinMode = !dropPinMode;
  dropPinBtn.textContent = dropPinMode ? 'Click Map...' : 'Drop Pin Here';
  dropPinBtn.style.background = dropPinMode ? '#f44336' : '#2196f3';
  if (dropPinMode) {
    map.getContainer().style.cursor = 'crosshair';
  } else {
    map.getContainer().style.cursor = '';
  }
});

// Click on map to place pin
map.on('click', (e) => {
  if (!dropPinMode) return;

  pendingPinLatLng = e.latlng;
  dropPinMode = false;
  dropPinBtn.textContent = 'Drop Pin Here';
  dropPinBtn.style.background = '#2196f3';
  map.getContainer().style.cursor = '';

  showPinForm(e.latlng);
});

// Pin creation form (replaces prompt() dialogs)
function showPinForm(latlng) {
  // Remove any existing form
  const existing = document.getElementById('pin-form-popup');
  if (existing) existing.remove();

  const categoryOptions = Object.entries(PIN_PRESETS).map(([k, v]) =>
    `<option value="${k}">${v.icon} ${v.label}</option>`
  ).join('');

  const colorSwatches = CUSTOM_COLORS.map(c =>
    `<div class="pin-color-swatch" data-color="${c}" style="width:22px;height:22px;background:${c};border-radius:50%;cursor:pointer;border:2px solid transparent"></div>`
  ).join('');

  const form = document.createElement('div');
  form.id = 'pin-form-popup';
  form.innerHTML = `
    <h4 style="margin:0 0 8px 0;font-size:14px">New Pin</h4>
    <div style="font-size:11px;color:#aaa;margin-bottom:8px">${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}</div>
    <input id="pin-name" type="text" placeholder="Name" value="WP-${waypoints.length + 1}" style="width:100%;padding:6px;margin-bottom:6px;border:1px solid #444;border-radius:4px;background:#222;color:#fff;font-size:13px">
    <select id="pin-category" style="width:100%;padding:6px;margin-bottom:6px;border:1px solid #444;border-radius:4px;background:#222;color:#fff;font-size:13px">
      ${categoryOptions}
    </select>
    <div style="margin-bottom:6px">
      <div style="font-size:11px;color:#aaa;margin-bottom:4px">Custom Color (optional)</div>
      <div id="pin-colors" style="display:flex;flex-wrap:wrap;gap:4px">${colorSwatches}</div>
      <input type="hidden" id="pin-custom-color" value="">
    </div>
    <textarea id="pin-notes" placeholder="Notes (optional)" rows="3" style="width:100%;padding:6px;margin-bottom:8px;border:1px solid #444;border-radius:4px;background:#222;color:#fff;font-size:13px;resize:vertical"></textarea>
    <div style="display:flex;gap:6px">
      <button id="pin-save" style="flex:1;padding:8px;background:#4caf50;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:bold">Save</button>
      <button id="pin-cancel" style="flex:1;padding:8px;background:#666;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px">Cancel</button>
    </div>
  `;
  Object.assign(form.style, {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    zIndex: '2000',
    background: 'rgba(0,0,0,0.95)',
    color: '#fff',
    padding: '16px',
    borderRadius: '10px',
    width: '280px',
    boxShadow: '0 4px 20px rgba(0,0,0,0.5)'
  });

  document.body.appendChild(form);
  document.getElementById('pin-name').focus();
  document.getElementById('pin-name').select();

  // Color swatch selection
  form.querySelectorAll('.pin-color-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      form.querySelectorAll('.pin-color-swatch').forEach(s => s.style.border = '2px solid transparent');
      swatch.style.border = '2px solid #fff';
      document.getElementById('pin-custom-color').value = swatch.dataset.color;
    });
  });

  // When category changes, update the preview color (unless custom color set)
  document.getElementById('pin-category').addEventListener('change', () => {
    document.getElementById('pin-custom-color').value = '';
    form.querySelectorAll('.pin-color-swatch').forEach(s => s.style.border = '2px solid transparent');
  });

  document.getElementById('pin-save').addEventListener('click', () => {
    const name = document.getElementById('pin-name').value.trim() || `WP-${waypoints.length + 1}`;
    const category = document.getElementById('pin-category').value;
    const notes = document.getElementById('pin-notes').value.trim();
    const customColor = document.getElementById('pin-custom-color').value || null;
    addWaypoint({ lat: latlng.lat, lon: latlng.lng, name, category, notes, color: customColor });
    form.remove();
  });

  document.getElementById('pin-cancel').addEventListener('click', () => {
    form.remove();
  });

  // Enter to save, Escape to cancel
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') form.remove();
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
      document.getElementById('pin-save').click();
    }
  });
}

// Export waypoints as GPX
document.getElementById('export-waypoints').addEventListener('click', () => {
  if (waypoints.length === 0) { alert('No waypoints to export.'); return; }

  let gpx = '<?xml version="1.0" encoding="UTF-8"?>\n';
  gpx += '<gpx version="1.1" creator="FieldMapper">\n';

  waypoints.forEach(wp => {
    gpx += `  <wpt lat="${wp.lat}" lon="${wp.lon}">\n`;
    if (wp.altitude) gpx += `    <ele>${wp.altitude}</ele>\n`;
    gpx += `    <name>${escapeXml(wp.name)}</name>\n`;
    gpx += `    <time>${wp.timestamp}</time>\n`;
    if (wp.notes || wp.category !== 'general') {
      let desc = wp.category !== 'general' ? `[${wp.category}] ` : '';
      desc += wp.notes || '';
      if (wp.samples && wp.samples.length > 0) {
        desc += '\nSamples: ' + wp.samples.map(s => `${s.id} (${s.type}: ${s.description || ''})`).join(', ');
      }
      gpx += `    <desc>${escapeXml(desc)}</desc>\n`;
    }
    gpx += `  </wpt>\n`;
  });

  // Export track if exists
  if (trackPoints.length > 1) {
    gpx += '  <trk>\n    <name>Field Track</name>\n    <trkseg>\n';
    trackPoints.forEach(p => {
      gpx += `      <trkpt lat="${p[0]}" lon="${p[1]}"></trkpt>\n`;
    });
    gpx += '    </trkseg>\n  </trk>\n';
  }

  gpx += '</gpx>';

  const blob = new Blob([gpx], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fieldmapper-${new Date().toISOString().split('T')[0]}.gpx`;
  a.click();
  URL.revokeObjectURL(url);
});

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Export all data as JSON (for camp PC import)
function exportAllData() {
  const data = {
    waypoints,
    track: trackPoints,
    exportDate: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fieldmapper-data-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// Load saved waypoints from server on startup (these have photo filenames)
fetch('/api/waypoints')
  .then(r => r.ok ? r.json() : [])
  .then(serverWaypoints => {
    // Merge server waypoints (which have photo filenames) with any localStorage ones
    const existingIds = new Set(waypoints.map(w => w.id));
    serverWaypoints.forEach(wp => {
      if (!existingIds.has(wp.id)) {
        waypoints.push(wp);
      } else {
        // Update existing with server data (photos)
        const idx = waypoints.findIndex(w => w.id === wp.id);
        if (idx >= 0) waypoints[idx] = { ...waypoints[idx], ...wp };
      }
    });
    saveWaypoints();
    waypoints.forEach(wp => renderWaypointMarker(wp));
    renderWaypointList();
  })
  .catch(() => {
    // Offline or no server data, just use localStorage
    waypoints.forEach(wp => renderWaypointMarker(wp));
    renderWaypointList();
  });

// Keyboard shortcut: 'E' to export
document.addEventListener('keydown', (e) => {
  if (e.key === 'e' && !e.ctrlKey && document.activeElement.tagName !== 'INPUT') {
    exportAllData();
  }
});

// --- Background tile pre-fetching ---
// Only prefetch the ACTIVE layer (not all 3) and with a smaller radius
// Waits longer before prefetching to avoid hammering servers while browsing
let prefetchTimer = null;

function prefetchArea() {
  const center = map.getCenter();
  const zoom = map.getZoom();

  const n = Math.pow(2, zoom);
  const x = Math.floor((center.lng + 180) / 360 * n);
  const latRad = center.lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);

  // Only prefetch the layer you're currently viewing, radius 2 (not 3)
  fetch('/api/prefetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ layer: activeBase, z: zoom, x, y, radius: 2 })
  }).catch(() => {});
}

map.on('moveend', () => {
  clearTimeout(prefetchTimer);
  // Wait 3s after you stop panning (was 1s — less aggressive)
  prefetchTimer = setTimeout(prefetchArea, 3000);
});

// Load cache stats on startup
function loadCacheStats() {
  fetch('/api/cache-stats')
    .then(r => r.json())
    .then(stats => {
      const el = document.getElementById('cache-stats');
      if (el) {
        let html = '';
        for (const [layer, data] of Object.entries(stats)) {
          html += `${layer}: ${data.tiles} tiles (${data.sizeMB} MB)<br>`;
        }
        el.innerHTML = html;
      }
    })
    .catch(() => {});
}
loadCacheStats();
// Refresh stats periodically
setInterval(loadCacheStats, 30000);

// Handle sync-complete from WebSocket (phone synced new data)
ws.addEventListener('message', (event) => {
  try {
    const data = JSON.parse(event.data);
    if (data.type === 'sync-complete') {
      location.reload();
    }
  } catch (e) {}
});

// --- Settings ---
// Load current config
fetch('/api/config')
  .then(r => r.json())
  .then(config => {
    if (config.anthropicApiKeySet) {
      document.getElementById('api-key-input').placeholder = 'Key set (****' + config.anthropicApiKey.slice(-4) + ')';
    }
  })
  .catch(() => {});

document.getElementById('save-settings').addEventListener('click', async () => {
  const apiKey = document.getElementById('api-key-input').value.trim();
  if (!apiKey) { showStatus('settings-status', 'Enter an API key', 'error'); return; }

  try {
    await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anthropicApiKey: apiKey })
    });
    showStatus('settings-status', 'Settings saved!', 'success');
    document.getElementById('api-key-input').value = '';
    document.getElementById('api-key-input').placeholder = 'Key set (****' + apiKey.slice(-4) + ')';
  } catch (e) {
    showStatus('settings-status', 'Failed to save', 'error');
  }
});

// --- AI Analysis ---
window.analyzeWaypoint = async function(waypointId) {
  // Open AI panel and run analysis for this waypoint
  panels.forEach(p => document.getElementById(p).classList.remove('visible'));
  document.querySelectorAll('.toolbar-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('ai-panel').classList.add('visible');
  document.getElementById('toggle-ai').classList.add('active');

  await runAIAnalysis(waypointId);
};

document.getElementById('ai-analyze-all').addEventListener('click', () => {
  runAIAnalysis(null);
});

async function runAIAnalysis(waypointId) {
  const statusEl = document.getElementById('ai-status');
  const resultEl = document.getElementById('ai-result');
  const btn = document.getElementById('ai-analyze-all');

  btn.disabled = true;
  showStatus('ai-status', waypointId ? 'Analyzing waypoint with photos...' : 'Analyzing all observations...', 'loading');
  resultEl.classList.remove('show');

  try {
    const resp = await fetch('/api/ai/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ waypointId })
    });
    const result = await resp.json();

    if (result.error) {
      showStatus('ai-status', result.error, 'error');
    } else {
      showStatus('ai-status', 'Analysis complete', 'success');
      resultEl.innerHTML = markdownToHtml(result.analysis);
      resultEl.classList.add('show');
    }
  } catch (e) {
    showStatus('ai-status', `Analysis failed: ${e.message}`, 'error');
  }

  btn.disabled = false;
}

// Simple markdown to HTML
function markdownToHtml(md) {
  return md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
    .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
    .replace(/<\/ul>\s*<ul>/g, '')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>');
}

// Status helper
function showStatus(elementId, message, type) {
  const el = document.getElementById(elementId);
  el.textContent = message;
  el.className = `panel-status show ${type}`;
}

// --- Coordinate Search ---
// Supports: decimal degrees, DMS, DDM, UTM, MGRS-like, plus/minus, NSEW
function parseCoordinates(input) {
  const s = input.trim();
  if (!s) return null;

  // Try decimal degrees: "39.5, -118.5" or "39.5 -118.5" or "39.5N 118.5W"
  const dd = s.match(/^([+-]?\d+\.?\d*)\s*([NSns])?\s*[,;\s]+\s*([+-]?\d+\.?\d*)\s*([EWew])?$/);
  if (dd) {
    let lat = parseFloat(dd[1]);
    let lon = parseFloat(dd[3]);
    if (dd[2] && dd[2].toUpperCase() === 'S') lat = -Math.abs(lat);
    if (dd[4] && dd[4].toUpperCase() === 'W') lon = -Math.abs(lon);
    if (isValidLatLon(lat, lon)) return { lat, lon };
  }

  // Try "N39.5 W118.5" or "N 39.5, W 118.5"
  const dd2 = s.match(/^([NSns])\s*(\d+\.?\d*)\s*[,;\s]+\s*([EWew])\s*(\d+\.?\d*)$/);
  if (dd2) {
    let lat = parseFloat(dd2[2]);
    let lon = parseFloat(dd2[4]);
    if (dd2[1].toUpperCase() === 'S') lat = -lat;
    if (dd2[3].toUpperCase() === 'W') lon = -lon;
    if (isValidLatLon(lat, lon)) return { lat, lon };
  }

  // Try DMS: 39°30'00"N 118°30'00"W  or  39 30 00 N, 118 30 00 W
  const dms = s.match(/(\d+)[°\s]+(\d+)['\s]+(\d+\.?\d*)["\s]*([NSns])[\s,]+(\d+)[°\s]+(\d+)['\s]+(\d+\.?\d*)["\s]*([EWew])/);
  if (dms) {
    let lat = parseInt(dms[1]) + parseInt(dms[2]) / 60 + parseFloat(dms[3]) / 3600;
    let lon = parseInt(dms[5]) + parseInt(dms[6]) / 60 + parseFloat(dms[7]) / 3600;
    if (dms[4].toUpperCase() === 'S') lat = -lat;
    if (dms[8].toUpperCase() === 'W') lon = -lon;
    if (isValidLatLon(lat, lon)) return { lat, lon };
  }

  // Try DMS without NSEW: 39°30'00" -118°30'00" or 39 30 00, -118 30 00
  const dms2 = s.match(/([+-]?\d+)[°\s]+(\d+)['\s]+(\d+\.?\d*)["\s]*[,;\s]+\s*([+-]?\d+)[°\s]+(\d+)['\s]+(\d+\.?\d*)/);
  if (dms2) {
    let lat = Math.abs(parseInt(dms2[1])) + parseInt(dms2[2]) / 60 + parseFloat(dms2[3]) / 3600;
    let lon = Math.abs(parseInt(dms2[4])) + parseInt(dms2[5]) / 60 + parseFloat(dms2[6]) / 3600;
    if (parseInt(dms2[1]) < 0) lat = -lat;
    if (parseInt(dms2[4]) < 0) lon = -lon;
    if (isValidLatLon(lat, lon)) return { lat, lon };
  }

  // Try DDM (degrees decimal minutes): 39°30.5'N 118°30.5'W  or  39 30.5 N, 118 30.5 W
  const ddm = s.match(/(\d+)[°\s]+(\d+\.?\d*)['\s]*([NSns])[\s,]+(\d+)[°\s]+(\d+\.?\d*)['\s]*([EWew])/);
  if (ddm) {
    let lat = parseInt(ddm[1]) + parseFloat(ddm[2]) / 60;
    let lon = parseInt(ddm[4]) + parseFloat(ddm[5]) / 60;
    if (ddm[3].toUpperCase() === 'S') lat = -lat;
    if (ddm[6].toUpperCase() === 'W') lon = -lon;
    if (isValidLatLon(lat, lon)) return { lat, lon };
  }

  // Try UTM: "11S 583960 4371800" or "11N 583960 4371800"
  const utm = s.match(/^(\d{1,2})\s*([A-Za-z])\s+(\d+\.?\d*)\s+(\d+\.?\d*)$/);
  if (utm) {
    const zone = parseInt(utm[1]);
    const letter = utm[2].toUpperCase();
    const easting = parseFloat(utm[3]);
    const northing = parseFloat(utm[4]);
    if (zone >= 1 && zone <= 60 && easting > 100000 && easting < 900000) {
      const result = utmToLatLon(zone, letter, easting, northing);
      if (result && isValidLatLon(result.lat, result.lon)) return result;
    }
  }

  return null;
}

function isValidLatLon(lat, lon) {
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

// UTM to Lat/Lon conversion
function utmToLatLon(zone, letter, easting, northing) {
  const isNorth = letter >= 'N';
  const a = 6378137; // WGS84 semi-major axis
  const f = 1 / 298.257223563;
  const e = Math.sqrt(2 * f - f * f);
  const e2 = e * e / (1 - e * e);
  const k0 = 0.9996;
  const x = easting - 500000;
  const y = isNorth ? northing : northing - 10000000;

  const M = y / k0;
  const mu = M / (a * (1 - e * e / 4 - 3 * e * e * e * e / 64));
  const e1 = (1 - Math.sqrt(1 - e * e)) / (1 + Math.sqrt(1 - e * e));

  const phi1 = mu + (3 * e1 / 2 - 27 * e1 * e1 * e1 / 32) * Math.sin(2 * mu)
    + (21 * e1 * e1 / 16 - 55 * e1 * e1 * e1 * e1 / 32) * Math.sin(4 * mu)
    + (151 * e1 * e1 * e1 / 96) * Math.sin(6 * mu);

  const N1 = a / Math.sqrt(1 - e * e * Math.sin(phi1) * Math.sin(phi1));
  const T1 = Math.tan(phi1) * Math.tan(phi1);
  const C1 = e2 * Math.cos(phi1) * Math.cos(phi1);
  const R1 = a * (1 - e * e) / Math.pow(1 - e * e * Math.sin(phi1) * Math.sin(phi1), 1.5);
  const D = x / (N1 * k0);

  const lat = phi1 - (N1 * Math.tan(phi1) / R1) * (
    D * D / 2
    - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * e2) * D * D * D * D / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * e2 - 3 * C1 * C1) * D * D * D * D * D * D / 720
  );

  const lon0 = (zone - 1) * 6 - 180 + 3; // central meridian
  const lon = lon0 + (
    D
    - (1 + 2 * T1 + C1) * D * D * D / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * e2 + 24 * T1 * T1) * D * D * D * D * D / 120
  ) / Math.cos(phi1);

  return { lat: lat * 180 / Math.PI, lon: lon * 180 / Math.PI };
}

// Search bar handlers
const coordInput = document.getElementById('coord-input');
const coordGoBtn = document.getElementById('coord-go');

function goToCoordinates() {
  const result = parseCoordinates(coordInput.value);
  if (result) {
    map.setView([result.lat, result.lon], Math.max(map.getZoom(), 14));
    // Drop a temporary marker
    const tempMarker = L.circleMarker([result.lat, result.lon], {
      radius: 8, color: '#ff0', fillColor: '#ff0', fillOpacity: 0.8, weight: 2
    }).addTo(map);
    tempMarker.bindPopup(
      `<b>Search Result</b><br>${result.lat.toFixed(6)}, ${result.lon.toFixed(6)}<br>` +
      `<button class="wp-popup-btn" style="background:#4caf50;margin-top:4px" onclick="dropPinAt(${result.lat}, ${result.lon})">Drop Pin Here</button>`
    ).openPopup();
    // Remove temp marker after 60s
    setTimeout(() => map.removeLayer(tempMarker), 60000);
    coordInput.style.borderColor = '#4caf50';
    setTimeout(() => coordInput.style.borderColor = '#555', 2000);
  } else {
    coordInput.style.borderColor = '#f44336';
    setTimeout(() => coordInput.style.borderColor = '#555', 2000);
  }
}

coordGoBtn.addEventListener('click', goToCoordinates);
coordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') goToCoordinates();
});

// Quick drop pin at coordinates from search
window.dropPinAt = function(lat, lon) {
  map.closePopup();
  showPinForm(L.latLng(lat, lon));
};

// =============================================
// ROUTES
// =============================================
let routesData = [];
let routeLayers = []; // { id, polyline, markers[] }

const ACCESS_TYPES = {
  any: { label: 'Any Vehicle', icon: '🚗', color: '#4caf50' },
  utv: { label: 'UTV/ATV', icon: '🛻', color: '#ff9800' },
  foot: { label: 'Foot Only', icon: '🥾', color: '#2196f3' },
  rope: { label: 'Rope/Climb', icon: '🪢', color: '#f44336' },
  scramble: { label: 'Scramble', icon: '⛰️', color: '#9c27b0' }
};

async function loadRoutes() {
  try {
    const resp = await fetch('/api/routes');
    routesData = await resp.json();
  } catch (e) { routesData = []; }
  renderRouteList();
  // Auto-show all routes on the map
  routesData.forEach(route => {
    if (!routeLayers.some(r => String(r.id) === String(route.id))) {
      showRouteOnMap(route);
    }
  });
  renderRouteList(); // re-render to update Show/Hide buttons
}

function renderRouteList() {
  const list = document.getElementById('route-list');
  if (!list) return;
  list.innerHTML = '';
  if (routesData.length === 0) {
    list.innerHTML = '<p class="panel-help">No routes yet. Create routes on the mobile app and backup to laptop.</p>';
    return;
  }
  routesData.forEach(route => {
    const pts = route.points ? route.points.length : 0;
    const div = document.createElement('div');
    div.className = 'route-list-item';
    const shown = routeLayers.some(r => String(r.id) === String(route.id));
    div.innerHTML = `
      <div style="flex:1;min-width:0">
        <div style="font-weight:bold;font-size:13px">${route.name}</div>
        <div style="font-size:11px;color:#999">${pts} points | ${new Date(route.created || route.id).toLocaleDateString()}</div>
      </div>
      <div class="route-actions">
        <button style="background:${shown ? '#f44336' : '#4caf50'}" onclick="toggleRouteOnMap('${route.id}')">${shown ? 'Hide' : 'Show'}</button>
        <button style="background:#1976d2" onclick="editRoute('${route.id}')">Edit</button>
        <button style="background:#7b1fa2" onclick="printRoute('${route.id}')">Print</button>
        <button style="background:#d32f2f" onclick="deleteRoute('${route.id}')">X</button>
      </div>`;
    list.appendChild(div);
  });
}

window.toggleRouteOnMap = function(routeId) {
  const rid = String(routeId);
  const existing = routeLayers.find(r => String(r.id) === rid);
  if (existing) {
    // Remove from map
    map.removeLayer(existing.polyline);
    existing.markers.forEach(m => map.removeLayer(m));
    routeLayers = routeLayers.filter(r => String(r.id) !== rid);
    renderRouteList();
    return;
  }
  const route = routesData.find(r => String(r.id) === rid);
  if (!route || !route.points || route.points.length === 0) return;
  showRouteOnMap(route);
  fitRouteOnMap(route.id);
  renderRouteList();
};

function showRouteOnMap(route) {
  // Use snapped road geometry if available, otherwise straight lines between points
  const latlngs = route.snappedGeometry && route.snappedGeometry.length > 0
    ? route.snappedGeometry
    : route.points.map(p => [p.lat, p.lon]);
  const hasSnap = route.snappedGeometry && route.snappedGeometry.length > 0;
  const polyline = L.polyline(latlngs, {
    color: '#ff5722', weight: 4, opacity: 0.8,
    dashArray: hasSnap ? null : '8,6'
  }).addTo(map);

  const markers = route.points.map((pt, i) => {
    const access = ACCESS_TYPES[pt.accessType] || ACCESS_TYPES.any;
    const marker = L.circleMarker([pt.lat, pt.lon], {
      radius: 8, color: access.color, fillColor: access.color, fillOpacity: 0.8, weight: 2
    }).addTo(map);
    let popup = `<b>${pt.label || `Point ${i + 1}`}</b><br>`;
    popup += `<span style="color:${access.color}">${access.icon} ${access.label}</span><br>`;
    popup += `<small>${pt.lat.toFixed(6)}, ${pt.lon.toFixed(6)}</small><br>`;
    if (pt.hazards) popup += `<span style="color:#f44336">⚠️ ${pt.hazards}</span><br>`;
    if (pt.landmarks) popup += `<span>🏔️ ${pt.landmarks}</span><br>`;
    if (pt.notes) popup += `<p style="margin:4px 0;font-size:12px">${pt.notes}</p>`;
    if (pt.photos && pt.photos.length > 0) {
      popup += '<div style="display:flex;gap:4px;margin:4px 0">';
      pt.photos.forEach(url => {
        const src = url.startsWith('data:') ? url : `/photos/${url}`;
        popup += `<img src="${src}" style="width:60px;height:60px;object-fit:cover;border-radius:4px">`;
      });
      popup += '</div>';
    }
    marker.bindPopup(popup, { maxWidth: 280 });
    return marker;
  });

  routeLayers.push({ id: route.id, polyline, markers });
}

function fitRouteOnMap(routeId) {
  const entry = routeLayers.find(r => String(r.id) === String(routeId));
  if (entry) map.fitBounds(entry.polyline.getBounds(), { padding: [40, 40] });
}

window.deleteRoute = async function(routeId) {
  if (!confirm('Delete this route?')) return;
  const rid = String(routeId);
  try {
    await fetch(`/api/route/${rid}`, { method: 'DELETE' });
    // Remove from map if shown
    const existing = routeLayers.find(r => String(r.id) === rid);
    if (existing) {
      map.removeLayer(existing.polyline);
      existing.markers.forEach(m => map.removeLayer(m));
      routeLayers = routeLayers.filter(r => String(r.id) !== rid);
    }
    routesData = routesData.filter(r => String(r.id) !== rid);
    renderRouteList();
  } catch (e) {
    alert('Failed to delete route');
  }
};

// Refresh routes
document.getElementById('refresh-routes')?.addEventListener('click', loadRoutes);
// Load routes on startup
loadRoutes();

// =============================================
// PRINTABLE ROUTE MAP
// =============================================
window.printRoute = function(routeId) {
  const route = routesData.find(r => String(r.id) === String(routeId));
  if (!route) return;
  generatePrintMap(route);
};

document.getElementById('print-route-btn')?.addEventListener('click', () => {
  if (routesData.length === 0) { alert('No routes available. Backup routes from the mobile app first.'); return; }
  if (routesData.length === 1) { generatePrintMap(routesData[0]); return; }
  // Let user pick
  const names = routesData.map((r, i) => `${i + 1}. ${r.name}`).join('\n');
  const pick = prompt(`Select route number:\n${names}`);
  if (!pick) return;
  const idx = parseInt(pick) - 1;
  if (idx >= 0 && idx < routesData.length) generatePrintMap(routesData[idx]);
});

function generatePrintMap(route) {
  const pts = route.points || [];
  if (pts.length === 0) { alert('Route has no points'); return; }

  // Calculate bounds for static map
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  pts.forEach(p => {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  });
  const centerLat = (minLat + maxLat) / 2;
  const centerLon = (minLon + maxLon) / 2;
  const span = Math.max(maxLat - minLat, maxLon - minLon);
  let zoom = 14;
  if (span > 0.1) zoom = 11;
  else if (span > 0.05) zoom = 12;
  else if (span > 0.01) zoom = 13;

  // ESRI static map export
  const mapUrl = `https://services.arcgisonline.com/arcgis/rest/services/World_Topo_Map/MapServer/export?bbox=${minLon - 0.005},${minLat - 0.005},${maxLon + 0.005},${maxLat + 0.005}&bboxSR=4326&size=800,600&format=png&f=image`;

  // Total distance
  let totalDist = 0;
  for (let i = 1; i < pts.length; i++) {
    totalDist += haversineDist(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon);
  }

  // Nearby waypoints
  const nearbyWps = waypoints.filter(wp => {
    return pts.some(p => haversineDist(p.lat, p.lon, wp.lat, wp.lon) < 500);
  });

  let html = `<div class="print-header">
    <h1>${route.name}</h1>
    <p>${pts.length} waypoints | ${formatPrintDist(totalDist)} total | Generated ${new Date().toLocaleDateString()}</p>
  </div>`;

  html += `<div id="print-map" style="width:100%;height:500px;border:1px solid #ccc;border-radius:4px;margin:10px 0"></div>`;

  // Point table
  html += `<table class="print-point-table">
    <thead><tr><th>#</th><th>Label</th><th>Coordinates</th><th>Access</th><th>Directions</th><th>Details</th></tr></thead><tbody>`;
  pts.forEach((pt, i) => {
    const access = ACCESS_TYPES[pt.accessType] || ACCESS_TYPES.any;
    const dist = i > 0 ? formatPrintDist(haversineDist(pts[i - 1].lat, pts[i - 1].lon, pt.lat, pt.lon)) : '--';
    const details = [];
    if (pt.hazards) details.push(`<span style="color:#c00">⚠ ${pt.hazards}</span>`);
    if (pt.landmarks) details.push(`Look for: ${pt.landmarks}`);
    if (pt.notes) details.push(pt.notes);
    html += `<tr>
      <td>${i + 1}</td>
      <td><b>${pt.label || `Point ${i + 1}`}</b></td>
      <td style="font-family:monospace;font-size:11px">${pt.lat.toFixed(6)}, ${pt.lon.toFixed(6)}<br><small>${dist} from prev</small></td>
      <td style="color:${access.color}">${access.icon} ${access.label}</td>
      <td>${pt.directions || '--'}</td>
      <td>${details.join('<br>') || '--'}</td>
    </tr>`;
  });
  html += '</tbody></table>';

  // Nearby waypoints
  if (nearbyWps.length > 0) {
    html += `<h3 style="margin-top:16px">Nearby Waypoints (within 500m)</h3>`;
    html += `<table class="print-point-table"><thead><tr><th>Name</th><th>Category</th><th>Coordinates</th><th>Notes</th></tr></thead><tbody>`;
    nearbyWps.forEach(wp => {
      html += `<tr><td>${wp.name}</td><td>${wp.category}</td><td style="font-family:monospace;font-size:11px">${wp.lat.toFixed(6)}, ${wp.lon.toFixed(6)}</td><td>${wp.notes || '--'}</td></tr>`;
    });
    html += '</tbody></table>';
  }

  // Legend
  html += `<div class="print-legend">
    <div class="print-legend-item"><span style="display:inline-block;width:20px;height:3px;background:#ff5722;border-radius:1px"></span> Route Path</div>`;
  Object.entries(ACCESS_TYPES).forEach(([k, v]) => {
    html += `<div class="print-legend-item"><span style="display:inline-block;width:12px;height:12px;background:${v.color};border-radius:50%"></span> ${v.icon} ${v.label}</div>`;
  });
  html += '</div>';

  document.getElementById('print-content').innerHTML = html;
  document.getElementById('print-overlay').style.display = 'block';

  // Build interactive Leaflet map with route drawn on it
  setTimeout(() => {
    const printMap = L.map('print-map', { zoomControl: true, attributionControl: false });
    L.tileLayer('https://services.arcgisonline.com/arcgis/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18
    }).addTo(printMap);

    // Draw route line (solid red) - use snapped road path if available
    const latlngs = route.snappedGeometry && route.snappedGeometry.length > 0
      ? route.snappedGeometry
      : pts.map(p => [p.lat, p.lon]);
    L.polyline(latlngs, { color: '#ff5722', weight: 4, opacity: 0.9 }).addTo(printMap);

    // Add numbered markers at each point
    pts.forEach((pt, i) => {
      const access = ACCESS_TYPES[pt.accessType] || ACCESS_TYPES.any;
      const icon = L.divIcon({
        className: '',
        html: `<div style="width:22px;height:22px;background:${access.color};color:#fff;border:2px solid #fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;box-shadow:0 1px 4px rgba(0,0,0,0.5)">${i + 1}</div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      });
      L.marker([pt.lat, pt.lon], { icon }).addTo(printMap)
        .bindTooltip(pt.label || `Point ${i + 1}`, { direction: 'top' });
    });

    // Fit to route bounds
    const bounds = L.latLngBounds(latlngs);
    printMap.fitBounds(bounds, { padding: [30, 30] });
  }, 100);
}

function haversineDist(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatPrintDist(meters) {
  const ft = meters * 3.28084;
  if (ft < 1000) return `${ft.toFixed(0)} ft`;
  return `${(meters * 0.000621371).toFixed(2)} mi`;
}

// =============================================
// MEASURE TOOL
// =============================================
let measureActive = false;
let measurePoints = [];
let measureLine = null;
let measureMarkers = [];
let measureLabels = [];

document.getElementById('start-measure')?.addEventListener('click', () => {
  measureActive = !measureActive;
  const btn = document.getElementById('start-measure');
  if (measureActive) {
    btn.textContent = 'Stop Measuring';
    btn.style.background = '#f44336';
    map.getContainer().style.cursor = 'crosshair';
    measurePoints = [];
    clearMeasure();
  } else {
    btn.textContent = 'Start Measuring';
    btn.style.background = '#2196f3';
    map.getContainer().style.cursor = '';
  }
});

document.getElementById('clear-measure')?.addEventListener('click', clearMeasure);

function clearMeasure() {
  if (measureLine) { map.removeLayer(measureLine); measureLine = null; }
  measureMarkers.forEach(m => map.removeLayer(m));
  measureLabels.forEach(l => map.removeLayer(l));
  measureMarkers = [];
  measureLabels = [];
  measurePoints = [];
  const r = document.getElementById('measure-result');
  if (r) r.textContent = '';
  const info = document.getElementById('measure-info');
  if (info) info.style.display = 'none';
}

map.on('click', (e) => {
  if (!measureActive) return;
  if (dropPinMode) return;

  measurePoints.push(e.latlng);
  const m = L.circleMarker(e.latlng, { radius: 5, color: '#fff', fillColor: '#ff5722', fillOpacity: 1, weight: 2 }).addTo(map);
  measureMarkers.push(m);

  if (measurePoints.length > 1) {
    if (measureLine) map.removeLayer(measureLine);
    measureLine = L.polyline(measurePoints, { color: '#ff5722', weight: 3, dashArray: '6,4' }).addTo(map);

    // Segment label
    const prev = measurePoints[measurePoints.length - 2];
    const curr = measurePoints[measurePoints.length - 1];
    const segDist = haversineDist(prev.lat, prev.lng, curr.lat, curr.lng);
    const midLat = (prev.lat + curr.lat) / 2;
    const midLng = (prev.lng + curr.lng) / 2;
    const label = L.marker([midLat, midLng], {
      icon: L.divIcon({ className: 'measure-label', html: formatPrintDist(segDist), iconSize: [60, 16], iconAnchor: [30, 8] })
    }).addTo(map);
    measureLabels.push(label);
  }

  // Total distance
  let total = 0;
  for (let i = 1; i < measurePoints.length; i++) {
    total += haversineDist(measurePoints[i - 1].lat, measurePoints[i - 1].lng, measurePoints[i].lat, measurePoints[i].lng);
  }
  const r = document.getElementById('measure-result');
  if (r) r.innerHTML = `<b>Total:</b> ${formatPrintDist(total)} (${measurePoints.length} points)`;

  const info = document.getElementById('measure-info');
  if (info) { info.textContent = `Total: ${formatPrintDist(total)}`; info.style.display = 'block'; }
});

// Escape to stop measuring
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && measureActive) {
    measureActive = false;
    const btn = document.getElementById('start-measure');
    if (btn) { btn.textContent = 'Start Measuring'; btn.style.background = '#2196f3'; }
    map.getContainer().style.cursor = '';
  }
  if (e.key === 'Escape' && routeBuilderActive) {
    cancelRouteBuilder();
  }
});

// =============================================
// ROUTE BUILDER (PC) - with road snapping & edit
// =============================================
let routeBuilderActive = false;
let rbPoints = []; // { lat, lon, label, notes, accessType, hazards, landmarks, photos, marker }
let rbPolylines = []; // snapped road segments between points
let rbEditingIndex = -1;
let rbEditingRouteId = null; // set when editing an existing route

document.getElementById('new-route-pc')?.addEventListener('click', () => startRouteBuilder());
document.getElementById('rb-save')?.addEventListener('click', saveRouteBuilder);
document.getElementById('rb-cancel')?.addEventListener('click', cancelRouteBuilder);

function startRouteBuilder(existingRoute) {
  routeBuilderActive = true;
  rbEditingIndex = -1;
  rbEditingRouteId = existingRoute ? existingRoute.id : null;

  // Clean any previous builder state
  rbPoints.forEach(p => { if (p.marker) map.removeLayer(p.marker); });
  rbPolylines.forEach(pl => map.removeLayer(pl));
  rbPoints = [];
  rbPolylines = [];

  document.getElementById('route-builder-pc').style.display = 'block';
  document.getElementById('rb-name').value = existingRoute ? existingRoute.name : `Route ${new Date().toLocaleDateString()}`;
  document.getElementById('rb-point-count').textContent = '0 points';
  document.getElementById('rb-points-list').innerHTML = '';
  document.getElementById('rb-title').textContent = existingRoute ? 'Edit Route' : 'New Route';
  map.getContainer().style.cursor = 'crosshair';

  // Close side panels
  panels.forEach(p => document.getElementById(p).classList.remove('visible'));
  document.querySelectorAll('.toolbar-btn').forEach(b => b.classList.remove('active'));

  // If editing existing, hide it from display layer and load its points
  if (existingRoute) {
    const existing = routeLayers.find(r => String(r.id) === String(existingRoute.id));
    if (existing) {
      map.removeLayer(existing.polyline);
      existing.markers.forEach(m => map.removeLayer(m));
      routeLayers = routeLayers.filter(r => String(r.id) !== String(existingRoute.id));
    }
    // Load points into builder
    if (existingRoute.points) {
      existingRoute.points.forEach((pt, i) => {
        addRbPoint(pt.lat, pt.lon, pt);
      });
      rebuildRbPolylines();
    }
  }
}

window.editRoute = function(routeId) {
  const route = routesData.find(r => String(r.id) === String(routeId));
  if (!route) return;
  startRouteBuilder(route);
};

function cancelRouteBuilder() {
  routeBuilderActive = false;
  document.getElementById('route-builder-pc').style.display = 'none';
  map.getContainer().style.cursor = '';
  rbPoints.forEach(p => { if (p.marker) map.removeLayer(p.marker); });
  rbPolylines.forEach(pl => map.removeLayer(pl));
  rbPoints = [];
  rbPolylines = [];
  // If we were editing, re-show the original route
  if (rbEditingRouteId) {
    const route = routesData.find(r => String(r.id) === String(rbEditingRouteId));
    if (route) showRouteOnMap(route);
    renderRouteList();
    rbEditingRouteId = null;
  }
}

function addRbPoint(lat, lon, data) {
  const pt = {
    lat, lon,
    label: (data && data.label) || `Point ${rbPoints.length + 1}`,
    notes: (data && data.notes) || '',
    accessType: (data && data.accessType) || 'any',
    hazards: (data && data.hazards) || '',
    landmarks: (data && data.landmarks) || '',
    directions: (data && data.directions) || '',
    photos: (data && data.photos) || [],
    snappedPath: null // road geometry to NEXT point
  };

  const access = ACCESS_TYPES[pt.accessType] || ACCESS_TYPES.any;
  const marker = L.circleMarker([lat, lon], {
    radius: 8, color: access.color, fillColor: access.color, fillOpacity: 0.8, weight: 2, draggable: false
  }).addTo(map);

  marker.on('contextmenu', (ev) => {
    L.DomEvent.stopPropagation(ev);
    const idx = rbPoints.findIndex(p => p.marker === marker);
    if (idx >= 0) openPointEditor(idx);
  });

  marker.bindTooltip(pt.label, { permanent: false, direction: 'top' });
  pt.marker = marker;
  rbPoints.push(pt);
  updateRbPointsList();
}

// Click to add route points
map.on('click', (e) => {
  if (!routeBuilderActive) return;
  if (dropPinMode || measureActive) return;

  addRbPoint(e.latlng.lat, e.latlng.lng);

  // Snap road between this point and previous
  if (rbPoints.length > 1) {
    snapSegment(rbPoints.length - 2);
  }
});

// OSRM road snapping between two consecutive points
async function snapSegment(fromIdx) {
  const snapEnabled = document.getElementById('rb-snap-roads')?.checked;
  const from = rbPoints[fromIdx];
  const to = rbPoints[fromIdx + 1];
  if (!from || !to) return;

  // Remove old polyline for this segment
  if (from._polyline) { map.removeLayer(from._polyline); }

  if (snapEnabled) {
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson`;
      const resp = await fetch(url);
      const data = await resp.json();
      if (data.code === 'Ok' && data.routes && data.routes[0]) {
        const coords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
        from.snappedPath = coords;
        const pl = L.polyline(coords, { color: '#ff5722', weight: 4, opacity: 0.8 }).addTo(map);
        from._polyline = pl;
        rbPolylines.push(pl);
        return;
      }
    } catch (e) {
      console.log('OSRM snap failed, using straight line:', e.message);
    }
  }

  // Fallback: straight line
  from.snappedPath = [[from.lat, from.lon], [to.lat, to.lon]];
  const pl = L.polyline(from.snappedPath, { color: '#ff5722', weight: 3, opacity: 0.8, dashArray: '6,4' }).addTo(map);
  from._polyline = pl;
  rbPolylines.push(pl);
}

// Rebuild all polyline segments (after edit/delete/reorder)
async function rebuildRbPolylines() {
  rbPolylines.forEach(pl => map.removeLayer(pl));
  rbPolylines = [];
  rbPoints.forEach(p => { p._polyline = null; p.snappedPath = null; });
  for (let i = 0; i < rbPoints.length - 1; i++) {
    await snapSegment(i);
  }
}

function updateRbPointsList() {
  document.getElementById('rb-point-count').textContent = `${rbPoints.length} points`;

  const list = document.getElementById('rb-points-list');
  list.innerHTML = '';
  rbPoints.forEach((pt, i) => {
    const access = ACCESS_TYPES[pt.accessType] || ACCESS_TYPES.any;
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.1);cursor:pointer';
    div.innerHTML = `<span style="font-size:10px;color:#888;width:18px">${i + 1}</span><span style="color:${access.color}">${access.icon}</span> <span style="flex:1">${pt.label}</span><small style="color:#888">${pt.lat.toFixed(4)}, ${pt.lon.toFixed(4)}</small>`;
    div.addEventListener('click', () => openPointEditor(i));
    list.appendChild(div);
  });

  // Update marker styles
  rbPoints.forEach(pt => {
    const access = ACCESS_TYPES[pt.accessType] || ACCESS_TYPES.any;
    pt.marker.setStyle({ color: access.color, fillColor: access.color });
    pt.marker.setTooltipContent(pt.label);
  });
}

function openPointEditor(idx) {
  rbEditingIndex = idx;
  const pt = rbPoints[idx];
  document.getElementById('pe-label').value = pt.label;
  document.getElementById('pe-access').value = pt.accessType;
  document.getElementById('pe-hazards').value = pt.hazards || '';
  document.getElementById('pe-landmarks').value = pt.landmarks || '';
  const dirEl = document.getElementById('pe-directions');
  if (dirEl) dirEl.value = pt.directions || '';
  document.getElementById('pe-notes').value = pt.notes || '';
  document.getElementById('point-editor-pc').style.display = 'block';
  // Center map on this point
  map.panTo([pt.lat, pt.lon]);
}

document.getElementById('pe-save')?.addEventListener('click', () => {
  if (rbEditingIndex < 0) return;
  const pt = rbPoints[rbEditingIndex];
  pt.label = document.getElementById('pe-label').value.trim() || pt.label;
  pt.accessType = document.getElementById('pe-access').value;
  pt.hazards = document.getElementById('pe-hazards').value.trim();
  pt.landmarks = document.getElementById('pe-landmarks').value.trim();
  const dirSaveEl = document.getElementById('pe-directions');
  if (dirSaveEl) pt.directions = dirSaveEl.value.trim();
  pt.notes = document.getElementById('pe-notes').value.trim();
  document.getElementById('point-editor-pc').style.display = 'none';
  rbEditingIndex = -1;
  updateRbPointsList();
});

document.getElementById('pe-delete')?.addEventListener('click', async () => {
  if (rbEditingIndex < 0) return;
  const pt = rbPoints[rbEditingIndex];
  if (pt.marker) map.removeLayer(pt.marker);
  rbPoints.splice(rbEditingIndex, 1);
  document.getElementById('point-editor-pc').style.display = 'none';
  rbEditingIndex = -1;
  updateRbPointsList();
  await rebuildRbPolylines();
});

document.getElementById('pe-cancel')?.addEventListener('click', () => {
  document.getElementById('point-editor-pc').style.display = 'none';
  rbEditingIndex = -1;
});

async function saveRouteBuilder() {
  const name = document.getElementById('rb-name').value.trim();
  if (!name) { alert('Enter a route name'); return; }
  if (rbPoints.length < 2) { alert('Add at least 2 points'); return; }

  // Build snapped geometry for storage (full road path)
  const snappedGeometry = [];
  for (let i = 0; i < rbPoints.length; i++) {
    if (i > 0 && rbPoints[i - 1].snappedPath) {
      // Add intermediate road points (skip first to avoid duplicates)
      rbPoints[i - 1].snappedPath.slice(1).forEach(c => snappedGeometry.push(c));
    } else if (i === 0) {
      snappedGeometry.push([rbPoints[i].lat, rbPoints[i].lon]);
    }
  }

  // Calculate total distance using snapped path
  let totalDist = 0;
  for (let i = 1; i < snappedGeometry.length; i++) {
    totalDist += haversineDist(snappedGeometry[i - 1][0], snappedGeometry[i - 1][1], snappedGeometry[i][0], snappedGeometry[i][1]);
  }

  const route = {
    id: rbEditingRouteId || Date.now(),
    name,
    description: '',
    points: rbPoints.map(p => ({
      lat: p.lat, lon: p.lon, label: p.label, notes: p.notes, directions: p.directions || '',
      accessType: p.accessType, hazards: p.hazards, landmarks: p.landmarks, photos: p.photos || []
    })),
    snappedGeometry, // full road-traced path for display
    totalDistance: totalDist,
    created: new Date().toISOString()
  };

  try {
    const resp = await fetch('/api/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(route)
    });
    if (resp.ok) {
      rbPoints.forEach(p => { if (p.marker) map.removeLayer(p.marker); });
      rbPolylines.forEach(pl => map.removeLayer(pl));
      rbPoints = [];
      rbPolylines = [];
      routeBuilderActive = false;
      rbEditingRouteId = null;
      document.getElementById('route-builder-pc').style.display = 'none';
      map.getContainer().style.cursor = '';
      await loadRoutes();
      fitRouteOnMap(route.id);
    } else {
      alert('Failed to save route');
    }
  } catch (e) {
    alert('Error saving route: ' + e.message);
  }
}
