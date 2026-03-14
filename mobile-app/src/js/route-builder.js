// Route Builder - Create, edit, and manage routes with rich waypoint data
// Route points have labels, notes, access type, hazards, landmarks, photos

let routeBuilderActive = false;
let routeBuilderPoints = [];
let routeBuilderMarkers = [];
let routeBuilderLine = null;
let routeBuilderLabels = [];
let editingRouteId = null;

const ACCESS_TYPES = {
  any: { label: 'Any Vehicle', icon: '\u{1F697}', color: '#4caf50' },
  utv: { label: 'UTV/ATV', icon: '\u{1F6FB}', color: '#ff9800' },
  foot: { label: 'Foot Only', icon: '\u{1F97E}', color: '#2196f3' },
  rope: { label: 'Rope/Climb', icon: '\u{1FA22}', color: '#f44336' },
  scramble: { label: 'Scramble', icon: '\u26F0\uFE0F', color: '#9c27b0' }
};

function startRouteBuilder(map, existingRoute) {
  routeBuilderActive = true;
  editingRouteId = existingRoute ? existingRoute.id : null;
  routeBuilderPoints = [];
  routeBuilderMarkers = [];
  routeBuilderLabels = [];
  routeBuilderLine = null;

  map.getContainer().style.cursor = 'crosshair';

  // Show builder UI
  const overlay = document.getElementById('route-builder-overlay');
  if (overlay) overlay.style.display = 'block';
  document.getElementById('rb-point-count').textContent = '0';
  document.getElementById('rb-total-dist').textContent = '0 ft';
  document.getElementById('rb-point-list').innerHTML = '';

  if (existingRoute && existingRoute.points) {
    document.getElementById('rb-route-name').value = existingRoute.name || '';
    document.getElementById('rb-route-desc').value = existingRoute.description || '';
    // Load existing points
    existingRoute.points.forEach(pt => {
      const latlng = L.latLng(pt.lat, pt.lon);
      addRouteBuilderPoint(latlng, map, pt);
    });
  } else {
    document.getElementById('rb-route-name').value = '';
    document.getElementById('rb-route-desc').value = '';
  }

  // Map click handler
  window._rbClickHandler = function(e) {
    if (!routeBuilderActive) return;
    addRouteBuilderPoint(e.latlng, map);
  };
  map.on('click', window._rbClickHandler);

  updateRouteBuilderUI();
}

function stopRouteBuilder(map) {
  routeBuilderActive = false;
  editingRouteId = null;
  map.getContainer().style.cursor = '';

  if (window._rbClickHandler) {
    map.off('click', window._rbClickHandler);
    window._rbClickHandler = null;
  }

  // Clear ghost track if present
  removeGhostTrack(map);
  const snapBtn = document.getElementById('rb-snap-track-btn');
  if (snapBtn) snapBtn.style.display = 'none';

  // Clear markers
  routeBuilderMarkers.forEach(m => map.removeLayer(m));
  routeBuilderLabels.forEach(l => map.removeLayer(l));
  if (routeBuilderLine) map.removeLayer(routeBuilderLine);
  routeBuilderMarkers = [];
  routeBuilderLabels = [];
  routeBuilderLine = null;
  routeBuilderPoints = [];

  const overlay = document.getElementById('route-builder-overlay');
  if (overlay) overlay.style.display = 'none';
}

function addRouteBuilderPoint(latlng, map, existingData) {
  const idx = routeBuilderPoints.length;
  const point = {
    lat: latlng.lat,
    lon: latlng.lng,
    alt: existingData?.alt != null ? existingData.alt : null,
    label: existingData?.label || `Point ${idx + 1}`,
    notes: existingData?.notes || '',
    accessType: existingData?.accessType || 'any',
    hazards: existingData?.hazards || '',
    landmarks: existingData?.landmarks || '',
    directions: existingData?.directions || '',
    photos: existingData?.photos || []
  };
  routeBuilderPoints.push(point);

  // Add numbered marker
  const access = ACCESS_TYPES[point.accessType] || ACCESS_TYPES.any;
  const marker = L.marker(latlng, {
    icon: L.divIcon({
      className: 'rb-point-marker',
      html: `<div style="width:28px;height:28px;background:${access.color};border:3px solid #fff;border-radius:50%;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold;box-shadow:0 0 6px rgba(0,0,0,0.5)">${idx + 1}</div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    }),
    draggable: true,
    zIndexOffset: 2000
  }).addTo(map);

  marker.on('dragend', () => {
    const pos = marker.getLatLng();
    routeBuilderPoints[idx].lat = pos.lat;
    routeBuilderPoints[idx].lon = pos.lng;
    updateRouteBuilderLine(map);
    updateRouteBuilderUI();
  });

  marker.on('click', (e) => {
    L.DomEvent.stopPropagation(e);
    showPointEditor(idx);
  });

  routeBuilderMarkers.push(marker);

  // Label
  const label = L.marker(latlng, {
    icon: L.divIcon({
      className: 'rb-label',
      html: `<div class="rb-label-text">${point.label}</div>`,
      iconSize: [120, 20],
      iconAnchor: [-5, 10]
    }),
    interactive: false
  }).addTo(map);
  routeBuilderLabels.push(label);

  updateRouteBuilderLine(map);
  updateRouteBuilderUI();
}

function updateRouteBuilderLine(map) {
  if (routeBuilderLine) map.removeLayer(routeBuilderLine);
  if (routeBuilderPoints.length < 2) { routeBuilderLine = null; return; }

  const latlngs = routeBuilderPoints.map(p => [p.lat, p.lon]);
  routeBuilderLine = L.polyline(latlngs, {
    color: '#00e676', weight: 4, opacity: 0.8, dashArray: '10,6'
  }).addTo(map);
}

function updateRouteBuilderUI() {
  document.getElementById('rb-point-count').textContent = routeBuilderPoints.length;

  let totalDist = 0;
  for (let i = 1; i < routeBuilderPoints.length; i++) {
    totalDist += haversineDistance(
      routeBuilderPoints[i-1].lat, routeBuilderPoints[i-1].lon,
      routeBuilderPoints[i].lat, routeBuilderPoints[i].lon
    );
  }
  document.getElementById('rb-total-dist').textContent = formatRouteDistance(totalDist);

  // Render elevation profile if any points have altitude data
  const hasAlt = routeBuilderPoints.some(p => p.alt != null && !isNaN(p.alt));
  if (hasAlt && routeBuilderPoints.length >= 2) {
    renderElevationProfile(routeBuilderPoints, 'rb-elev-profile');
  } else {
    const epCanvas = document.getElementById('rb-elev-profile');
    if (epCanvas) epCanvas.style.display = 'none';
  }

  // Update point list
  const list = document.getElementById('rb-point-list');
  list.innerHTML = '';
  routeBuilderPoints.forEach((pt, i) => {
    const access = ACCESS_TYPES[pt.accessType] || ACCESS_TYPES.any;
    let segDist = '';
    if (i > 0) {
      const d = haversineDistance(routeBuilderPoints[i-1].lat, routeBuilderPoints[i-1].lon, pt.lat, pt.lon);
      segDist = ` (${formatRouteDistance(d)})`;
    }
    const div = document.createElement('div');
    div.className = 'rb-point-item';
    div.innerHTML = `
      <div class="rb-point-num" style="background:${access.color}">${i + 1}</div>
      <div class="rb-point-info">
        <div class="rb-point-label">${pt.label}</div>
        <div class="rb-point-meta">${access.icon} ${access.label}${segDist}${pt.hazards ? ' \u26A0\uFE0F' : ''}${pt.photos.length ? ' \u{1F4F7}' + pt.photos.length : ''}</div>
        ${pt.notes ? `<div class="rb-point-notes">${pt.notes}</div>` : ''}
      </div>
      <div class="rb-point-actions">
        <button class="rb-edit-btn" onclick="showPointEditor(${i})">Edit</button>
        <button class="rb-del-btn" onclick="removeRoutePoint(${i})">X</button>
      </div>
    `;
    list.appendChild(div);
  });
}

window.showPointEditor = function(idx) {
  const pt = routeBuilderPoints[idx];
  if (!pt) return;

  const editor = document.getElementById('point-editor-overlay');
  if (!editor) return;
  editor.style.display = 'block';
  editor.dataset.pointIndex = idx;

  document.getElementById('pe-title').textContent = `Point ${idx + 1}`;
  document.getElementById('pe-coords').textContent = `${pt.lat.toFixed(6)}, ${pt.lon.toFixed(6)}`;
  document.getElementById('pe-label').value = pt.label;
  document.getElementById('pe-notes').value = pt.notes;
  document.getElementById('pe-access').value = pt.accessType;
  document.getElementById('pe-hazards').value = pt.hazards;
  document.getElementById('pe-landmarks').value = pt.landmarks;
  const dirEl = document.getElementById('pe-directions');
  if (dirEl) dirEl.value = pt.directions || '';

  // Show existing photos
  const strip = document.getElementById('pe-photo-strip');
  strip.innerHTML = '';
  pt.photos.forEach((dataUrl, i) => {
    const div = document.createElement('div');
    div.style.cssText = 'position:relative;display:inline-block';
    div.innerHTML = `<img src="${dataUrl}" style="width:60px;height:60px;object-fit:cover;border-radius:4px;border:1px solid #444"><button onclick="removePointPhoto(${idx},${i})" style="position:absolute;top:-4px;right:-4px;background:red;color:#fff;border:none;border-radius:50%;width:18px;height:18px;font-size:10px;cursor:pointer">X</button>`;
    strip.appendChild(div);
  });
};

window.savePointEdit = function() {
  const editor = document.getElementById('point-editor-overlay');
  const idx = parseInt(editor.dataset.pointIndex);
  const pt = routeBuilderPoints[idx];
  if (!pt) return;

  pt.label = document.getElementById('pe-label').value.trim() || `Point ${idx + 1}`;
  pt.notes = document.getElementById('pe-notes').value.trim();
  pt.accessType = document.getElementById('pe-access').value;
  pt.hazards = document.getElementById('pe-hazards').value.trim();
  pt.landmarks = document.getElementById('pe-landmarks').value.trim();
  const dirEl = document.getElementById('pe-directions');
  if (dirEl) pt.directions = dirEl.value.trim();

  // Update marker color
  const access = ACCESS_TYPES[pt.accessType] || ACCESS_TYPES.any;
  const map = window.fieldMap;
  if (map && routeBuilderMarkers[idx]) {
    routeBuilderMarkers[idx].setIcon(L.divIcon({
      className: 'rb-point-marker',
      html: `<div style="width:28px;height:28px;background:${access.color};border:3px solid #fff;border-radius:50%;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold;box-shadow:0 0 6px rgba(0,0,0,0.5)">${idx + 1}</div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    }));
    // Update label
    if (routeBuilderLabels[idx]) {
      routeBuilderLabels[idx].setIcon(L.divIcon({
        className: 'rb-label',
        html: `<div class="rb-label-text">${pt.label}</div>`,
        iconSize: [120, 20],
        iconAnchor: [-5, 10]
      }));
    }
  }

  editor.style.display = 'none';
  updateRouteBuilderUI();
};

window.cancelPointEdit = function() {
  document.getElementById('point-editor-overlay').style.display = 'none';
};

window.addPointPhoto = function() {
  document.getElementById('pe-photo-input').click();
};

window.handlePointPhoto = function(input) {
  const editor = document.getElementById('point-editor-overlay');
  const idx = parseInt(editor.dataset.pointIndex);
  const pt = routeBuilderPoints[idx];
  if (!pt) return;

  for (const file of input.files) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX = 1200;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = h * MAX / w; w = MAX; } else { w = w * MAX / h; h = MAX; }
        }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        pt.photos.push(dataUrl);

        const strip = document.getElementById('pe-photo-strip');
        const div = document.createElement('div');
        div.style.cssText = 'position:relative;display:inline-block';
        div.innerHTML = `<img src="${dataUrl}" style="width:60px;height:60px;object-fit:cover;border-radius:4px;border:1px solid #4caf50">`;
        strip.appendChild(div);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }
  input.value = '';
};

window.removePointPhoto = function(ptIdx, photoIdx) {
  const pt = routeBuilderPoints[ptIdx];
  if (pt) {
    pt.photos.splice(photoIdx, 1);
    showPointEditor(ptIdx); // refresh
  }
};

window.removeRoutePoint = function(idx) {
  const map = window.fieldMap;
  if (!map) return;

  routeBuilderPoints.splice(idx, 1);
  const m = routeBuilderMarkers.splice(idx, 1)[0];
  if (m) map.removeLayer(m);
  const l = routeBuilderLabels.splice(idx, 1)[0];
  if (l) map.removeLayer(l);

  // Re-number remaining markers
  routeBuilderMarkers.forEach((marker, i) => {
    const access = ACCESS_TYPES[routeBuilderPoints[i].accessType] || ACCESS_TYPES.any;
    marker.setIcon(L.divIcon({
      className: 'rb-point-marker',
      html: `<div style="width:28px;height:28px;background:${access.color};border:3px solid #fff;border-radius:50%;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold;box-shadow:0 0 6px rgba(0,0,0,0.5)">${i + 1}</div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    }));
  });

  updateRouteBuilderLine(map);
  updateRouteBuilderUI();
};

window.undoRoutePoint = function() {
  if (routeBuilderPoints.length === 0) return;
  removeRoutePoint(routeBuilderPoints.length - 1);
};

window.saveRouteBuilder = async function() {
  const map = window.fieldMap;
  if (!map) return;

  const name = document.getElementById('rb-route-name').value.trim();
  if (!name) { alert('Enter a route name'); return; }
  if (routeBuilderPoints.length < 2) { alert('Add at least 2 points'); return; }

  let totalDist = 0;
  for (let i = 1; i < routeBuilderPoints.length; i++) {
    totalDist += haversineDistance(
      routeBuilderPoints[i-1].lat, routeBuilderPoints[i-1].lon,
      routeBuilderPoints[i].lat, routeBuilderPoints[i].lon
    );
  }

  const route = {
    id: editingRouteId || Date.now(),
    name,
    description: document.getElementById('rb-route-desc').value.trim(),
    points: routeBuilderPoints.map(p => ({
      lat: p.lat, lon: p.lon, alt: p.alt,
      label: p.label, notes: p.notes, directions: p.directions || '',
      accessType: p.accessType, hazards: p.hazards,
      landmarks: p.landmarks, photos: p.photos
    })),
    totalDistance: totalDist,
    createdAt: new Date().toISOString()
  };

  await saveRoute(route);
  stopRouteBuilder(map);
  loadMapRoutes();
};

window.cancelRouteBuilder = function() {
  const map = window.fieldMap;
  if (map) {
    removeGhostTrack(map);
    stopRouteBuilder(map);
  }
};

/**
 * Reverse all route points (for return trip).
 */
window.reverseRouteBuilder = function() {
  if (routeBuilderPoints.length < 2) return;
  const map = window.fieldMap;
  if (!map) return;

  // Reverse the data
  routeBuilderPoints.reverse();

  // Swap start/end labels
  routeBuilderPoints.forEach((pt, i) => {
    if (i === 0 && pt.label === 'End') pt.label = 'Start';
    else if (i === routeBuilderPoints.length - 1 && pt.label === 'Start') pt.label = 'End';
  });

  // Rebuild markers on map
  routeBuilderMarkers.forEach(m => map.removeLayer(m));
  routeBuilderLabels.forEach(l => map.removeLayer(l));
  routeBuilderMarkers = [];
  routeBuilderLabels = [];

  const savedPoints = routeBuilderPoints.slice();
  routeBuilderPoints = [];

  savedPoints.forEach(pt => {
    addRouteBuilderPoint(L.latLng(pt.lat, pt.lon), map, pt);
  });
};

/**
 * Export current route builder points as GPX.
 */
window.exportRouteGpx = function() {
  if (!window.GpxUtils || routeBuilderPoints.length < 2) return;
  const name = document.getElementById('rb-route-name').value || 'Route';
  const gpx = GpxUtils.exportRouteGpx(routeBuilderPoints, name);
  GpxUtils.downloadFile(gpx, `${name.replace(/[^a-z0-9]/gi, '_')}.gpx`);
};

/**
 * Snap all route builder points to the closest point on the ghost track.
 */
window.snapAllToTrack = function() {
  if (!ghostTrackPoints || routeBuilderPoints.length === 0) return;
  const map = window.fieldMap;
  if (!map) return;

  routeBuilderPoints.forEach((pt, i) => {
    const snapped = snapToGhostTrack(pt.lat, pt.lon);
    pt.lat = snapped.lat;
    pt.lon = snapped.lon;

    // Update marker position
    if (routeBuilderMarkers[i]) {
      routeBuilderMarkers[i].setLatLng([snapped.lat, snapped.lon]);
    }
    if (routeBuilderLabels[i]) {
      routeBuilderLabels[i].setLatLng([snapped.lat, snapped.lon]);
    }
  });

  updateRouteBuilderLine(map);
  updateRouteBuilderUI();
};

/**
 * Render an elevation profile as a filled area chart on a canvas element.
 * @param {Array} points - Route points with lat, lon, alt properties
 * @param {string} canvasId - ID of the canvas element to draw on
 */
function renderElevationProfile(points, canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  // Filter to points that have altitude data
  const withAlt = points.filter(p => p.alt != null && !isNaN(p.alt));
  if (withAlt.length < 2) {
    canvas.style.display = 'none';
    return;
  }

  canvas.style.display = 'block';
  const ctx = canvas.getContext('2d');

  // Use devicePixelRatio for sharp rendering
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  const W = rect.width;
  const H = rect.height;

  // Calculate cumulative distances (in meters) for all points, keeping only
  // those with altitude data. We walk the full points array to get real
  // distances even if some intermediate points lack alt.
  const data = []; // { dist, alt }
  let cumDist = 0;
  let prevIdx = null;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      cumDist += haversineDistance(
        points[i - 1].lat, points[i - 1].lon,
        points[i].lat, points[i].lon
      );
    }
    if (points[i].alt != null && !isNaN(points[i].alt)) {
      data.push({ dist: cumDist, alt: points[i].alt });
    }
  }

  const totalDist = data[data.length - 1].dist;
  const alts = data.map(d => d.alt);
  const minElev = Math.min(...alts);
  const maxElev = Math.max(...alts);
  const elevRange = maxElev - minElev || 1; // avoid division by zero

  // Layout constants
  const padLeft = 42;
  const padRight = 8;
  const padTop = 14;
  const padBottom = 18;
  const chartW = W - padLeft - padRight;
  const chartH = H - padTop - padBottom;

  // Map data point to canvas coordinates
  function toX(dist) { return padLeft + (dist / (totalDist || 1)) * chartW; }
  function toY(alt) { return padTop + chartH - ((alt - minElev) / elevRange) * chartH; }

  // Dark background
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, W, H);

  // Grid lines (3 horizontal)
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 2; i++) {
    const y = padTop + (chartH / 2) * i;
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(W - padRight, y);
    ctx.stroke();
  }

  // Filled area under the elevation line
  ctx.beginPath();
  ctx.moveTo(toX(data[0].dist), toY(data[0].alt));
  for (let i = 1; i < data.length; i++) {
    ctx.lineTo(toX(data[i].dist), toY(data[i].alt));
  }
  // Close down to baseline
  ctx.lineTo(toX(data[data.length - 1].dist), padTop + chartH);
  ctx.lineTo(toX(data[0].dist), padTop + chartH);
  ctx.closePath();

  const grad = ctx.createLinearGradient(0, padTop, 0, padTop + chartH);
  grad.addColorStop(0, 'rgba(76, 175, 80, 0.6)');
  grad.addColorStop(1, 'rgba(76, 175, 80, 0.1)');
  ctx.fillStyle = grad;
  ctx.fill();

  // Elevation line on top
  ctx.beginPath();
  ctx.moveTo(toX(data[0].dist), toY(data[0].alt));
  for (let i = 1; i < data.length; i++) {
    ctx.lineTo(toX(data[i].dist), toY(data[i].alt));
  }
  ctx.strokeStyle = '#4caf50';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Labels
  ctx.font = '10px sans-serif';
  ctx.textBaseline = 'middle';

  // Min / Max elevation labels (in feet)
  const maxFt = Math.round(maxElev * 3.28084);
  const minFt = Math.round(minElev * 3.28084);
  ctx.fillStyle = '#aaa';
  ctx.textAlign = 'right';
  ctx.fillText(`${maxFt}'`, padLeft - 3, padTop + 4);
  ctx.fillText(`${minFt}'`, padLeft - 3, padTop + chartH - 2);

  // Total distance label (bottom right)
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#888';
  ctx.fillText(formatRouteDistance(totalDist), W - padRight, padTop + chartH + 3);

  // "0" label (bottom left)
  ctx.textAlign = 'left';
  ctx.fillText('0', padLeft, padTop + chartH + 3);

  // Title
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#666';
  ctx.font = '9px sans-serif';
  ctx.fillText('Elevation Profile', padLeft, 2);
}

function formatRouteDistance(meters) {
  const ft = meters * 3.28084;
  if (ft < 1000) return `${ft.toFixed(0)} ft`;
  return `${(meters * 0.000621371).toFixed(2)} mi`;
}

// ========== ROUTE DISPLAY ON MAP ==========
let mapRouteLines = [];
let mapRouteMarkers = [];

async function loadMapRoutes() {
  const map = window.fieldMap;
  if (!map) return;

  // Clear existing
  mapRouteLines.forEach(l => map.removeLayer(l));
  mapRouteMarkers.forEach(m => map.removeLayer(m));
  mapRouteLines = [];
  mapRouteMarkers = [];

  const routes = await getAllRoutes();
  const list = document.getElementById('route-list');
  if (list) {
    list.innerHTML = '';
    routes.forEach(r => {
      const div = document.createElement('div');
      div.className = 'rb-route-item';
      div.innerHTML = `
        <div style="flex:1;min-width:0">
          <div style="font-weight:bold;font-size:13px">${r.name}</div>
          <div style="font-size:11px;color:#888">${r.points.length} pts | ${formatRouteDistance(r.totalDistance || 0)}${r.description ? ' | ' + r.description.substring(0, 40) : ''}</div>
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0">
          <button class="rb-nav-btn" onclick="startMapNavigation(${r.id})">Nav</button>
          <button class="rb-edit-route-btn" onclick="editExistingRoute(${r.id})">Edit</button>
          <button class="rb-del-route-btn" onclick="deleteRouteFromList(${r.id})">X</button>
        </div>
      `;
      list.appendChild(div);
    });
  }

  // Draw routes on map
  routes.forEach(r => {
    if (!r.points || r.points.length < 2) return;
    const latlngs = r.points.map(p => [p.lat, p.lon]);
    const line = L.polyline(latlngs, {
      color: '#00e676', weight: 3, opacity: 0.6
    }).addTo(map);
    line.bindPopup(`<b>${r.name}</b><br>${r.points.length} points | ${formatRouteDistance(r.totalDistance || 0)}<br><button onclick="startMapNavigation(${r.id})" style="margin-top:4px;padding:4px 10px;background:#00897b;color:#fff;border:none;border-radius:4px;cursor:pointer">Navigate</button>`);
    mapRouteLines.push(line);

    // Show point markers (small)
    r.points.forEach((pt, i) => {
      const access = ACCESS_TYPES[pt.accessType] || ACCESS_TYPES.any;
      const m = L.circleMarker([pt.lat, pt.lon], {
        radius: 5, color: access.color, fillColor: access.color,
        fillOpacity: 0.8, weight: 2
      }).addTo(map);
      m.bindTooltip(`${i+1}. ${pt.label}`, { direction: 'right', offset: [8, 0] });
      mapRouteMarkers.push(m);
    });
  });
}

window.editExistingRoute = async function(routeId) {
  const routes = await getAllRoutes();
  const route = routes.find(r => r.id === routeId);
  if (!route) return;
  const map = window.fieldMap;
  if (!map) return;
  startRouteBuilder(map, route);
};

window.deleteRouteFromList = async function(routeId) {
  if (!confirm('Delete this route?')) return;
  await deleteRoute(routeId);
  loadMapRoutes();
};

// ========== MAP NAVIGATION MODE ==========
let mapNavActive = false;
let mapNavRoute = null;
let mapNavIndex = 0;
let mapNavLine = null;
let mapNavPointMarkers = [];
let mapNavCurrentMarker = null;

window.startMapNavigation = async function(routeId) {
  const routes = await getAllRoutes();
  const route = routes.find(r => r.id === routeId);
  if (!route || !route.points || route.points.length < 1) return;

  const map = window.fieldMap;
  if (!map) return;

  // Close any panels
  document.querySelectorAll('.side-panel').forEach(p => p.classList.remove('visible'));

  mapNavActive = true;
  mapNavRoute = route;
  mapNavIndex = 0;

  // Draw route
  const latlngs = route.points.map(p => [p.lat, p.lon]);
  mapNavLine = L.polyline(latlngs, {
    color: '#00e676', weight: 5, opacity: 0.9
  }).addTo(map);

  // Point markers
  route.points.forEach((pt, i) => {
    const access = ACCESS_TYPES[pt.accessType] || ACCESS_TYPES.any;
    const m = L.marker([pt.lat, pt.lon], {
      icon: L.divIcon({
        className: 'rb-point-marker',
        html: `<div style="width:24px;height:24px;background:${i === 0 ? '#00e676' : access.color};border:2px solid #fff;border-radius:50%;color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;box-shadow:0 0 4px rgba(0,0,0,0.4)">${i+1}</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      }),
      zIndexOffset: 1500
    }).addTo(map);
    mapNavPointMarkers.push(m);
  });

  // Show nav panel
  const panel = document.getElementById('map-nav-panel');
  if (panel) panel.style.display = 'block';
  document.getElementById('map-nav-route-name').textContent = route.name;

  updateMapNavDisplay();

  // Fit to route
  map.fitBounds(mapNavLine.getBounds(), { padding: [40, 40] });
};

window.stopMapNavigation = function() {
  const map = window.fieldMap;
  if (!map) return;

  mapNavActive = false;
  if (mapNavLine) { map.removeLayer(mapNavLine); mapNavLine = null; }
  mapNavPointMarkers.forEach(m => map.removeLayer(m));
  mapNavPointMarkers = [];
  if (mapNavCurrentMarker) { map.removeLayer(mapNavCurrentMarker); mapNavCurrentMarker = null; }
  mapNavRoute = null;

  const panel = document.getElementById('map-nav-panel');
  if (panel) panel.style.display = 'none';
};

window.mapNavNext = function() {
  if (!mapNavRoute) return;
  if (mapNavIndex < mapNavRoute.points.length - 1) {
    mapNavIndex++;
    updateMapNavDisplay();
  }
};

window.mapNavPrev = function() {
  if (!mapNavRoute) return;
  if (mapNavIndex > 0) {
    mapNavIndex--;
    updateMapNavDisplay();
  }
};

window.mapNavFullscreen = function() {
  if (!mapNavRoute) return;
  navigateRoute(mapNavRoute.id);
};

function updateMapNavDisplay() {
  if (!mapNavRoute || !mapNavRoute.points[mapNavIndex]) return;

  const pt = mapNavRoute.points[mapNavIndex];
  const access = ACCESS_TYPES[pt.accessType] || ACCESS_TYPES.any;
  const map = window.fieldMap;

  // Update current point highlighting
  mapNavPointMarkers.forEach((m, i) => {
    const a = ACCESS_TYPES[mapNavRoute.points[i].accessType] || ACCESS_TYPES.any;
    const isCurrent = i === mapNavIndex;
    m.setIcon(L.divIcon({
      className: 'rb-point-marker',
      html: `<div style="width:${isCurrent ? 32 : 24}px;height:${isCurrent ? 32 : 24}px;background:${isCurrent ? '#ffeb3b' : a.color};border:${isCurrent ? 3 : 2}px solid #fff;border-radius:50%;color:${isCurrent ? '#000' : '#fff'};display:flex;align-items:center;justify-content:center;font-size:${isCurrent ? 14 : 11}px;font-weight:bold;box-shadow:0 0 ${isCurrent ? 10 : 4}px rgba(0,0,0,${isCurrent ? 0.7 : 0.4})">${i+1}</div>`,
      iconSize: [isCurrent ? 32 : 24, isCurrent ? 32 : 24],
      iconAnchor: [isCurrent ? 16 : 12, isCurrent ? 16 : 12]
    }));
  });

  // Scroll to point
  if (map) map.panTo([pt.lat, pt.lon]);

  // Update info panel
  document.getElementById('map-nav-point-num').textContent = `${mapNavIndex + 1} / ${mapNavRoute.points.length}`;
  document.getElementById('map-nav-point-label').textContent = pt.label;
  document.getElementById('map-nav-access').innerHTML = `<span style="color:${access.color}">${access.icon} ${access.label}</span>`;

  // Distance from current GPS
  let distText = '';
  if (currentPosition) {
    const dist = haversineDistance(currentPosition.lat, currentPosition.lon, pt.lat, pt.lon);
    const brng = bearingTo(currentPosition.lat, currentPosition.lon, pt.lat, pt.lon);
    distText = `${formatRouteDistance(dist)} | ${brng.toFixed(0)}\u00B0 ${headingToCardinal(brng)}`;
  }
  document.getElementById('map-nav-distance').textContent = distText || '--';

  // Directions/notes/hazards/landmarks
  let infoHtml = '';
  if (pt.directions) infoHtml += `<div class="nav-info-row directions" style="color:#81c784;font-weight:bold">\u{1F9ED} ${pt.directions}</div>`;
  if (pt.hazards) infoHtml += `<div class="nav-info-row hazard">\u26A0\uFE0F <b>Hazard:</b> ${pt.hazards}</div>`;
  if (pt.landmarks) infoHtml += `<div class="nav-info-row landmark">\u{1F3D4}\uFE0F <b>Look for:</b> ${pt.landmarks}</div>`;
  if (pt.notes) infoHtml += `<div class="nav-info-row">\u{1F4DD} ${pt.notes}</div>`;

  // Photos
  if (pt.photos && pt.photos.length > 0) {
    infoHtml += `<div style="display:flex;gap:4px;margin-top:4px;overflow-x:auto">`;
    pt.photos.forEach((url, i) => {
      infoHtml += `<img src="${url}" onclick="showFullPhoto('nav-route',${i})" style="width:50px;height:50px;object-fit:cover;border-radius:4px;flex-shrink:0;cursor:pointer">`;
    });
    infoHtml += `</div>`;
  }

  document.getElementById('map-nav-info').innerHTML = infoHtml;

  // Navigation buttons state
  document.getElementById('map-nav-prev-btn').disabled = mapNavIndex === 0;
  document.getElementById('map-nav-next-btn').disabled = mapNavIndex >= mapNavRoute.points.length - 1;
}

// Update nav panel distance on GPS update
function onGpsUpdate_mapNav(pos) {
  if (!mapNavActive || !mapNavRoute) return;
  const pt = mapNavRoute.points[mapNavIndex];
  if (!pt) return;

  const dist = haversineDistance(pos.lat, pos.lon, pt.lat, pt.lon);
  const brng = bearingTo(pos.lat, pos.lon, pt.lat, pt.lon);
  document.getElementById('map-nav-distance').textContent =
    `${formatRouteDistance(dist)} | ${brng.toFixed(0)}\u00B0 ${headingToCardinal(brng)}`;

  // Auto-advance when within 20m
  if (dist < 20 && mapNavIndex < mapNavRoute.points.length - 1) {
    mapNavIndex++;
    updateMapNavDisplay();
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  }
}

// ========== CONVERT RECORDED TRACK TO ROUTE ==========
window.showTrackToRoute = async function() {
  let sessions = await getAllTrackSessions();

  // Also include native GPS sessions if available
  if (window.NativeGps && NativeGps.isNative) {
    try {
      const nativeSessions = await NativeGps.getSessions();
      nativeSessions.forEach(ns => {
        // Avoid duplicates — native sessions have numeric IDs
        if (!sessions.find(s => s.id === ns.id)) {
          sessions.push({
            id: ns.id,
            name: ns.name || 'Native Track',
            startTime: ns.startTime,
            endTime: ns.endTime,
            points: null, // loaded on demand in convertTrackToRoute
            pointCount: ns.pointCount,
            distance: 0,
            native: true
          });
        }
      });
    } catch(e) { console.warn('Failed to load native sessions:', e); }
  }

  if (sessions.length === 0) { alert('No recorded tracks found. Record a track from the Data tab first.'); return; }

  const overlay = document.createElement('div');
  overlay.id = 'track-picker-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:8000;background:#1a1a1a;overflow-y:auto;padding:12px;padding-bottom:80px';

  let html = `<h2 style="text-align:center;font-size:18px;margin-bottom:12px">Convert Track to Route</h2>`;
  html += `<p style="font-size:12px;color:#888;margin-bottom:12px">Select a recorded track to convert. Points will be simplified and you can edit labels/notes.</p>`;

  sessions.forEach(s => {
    const pts = s.points ? s.points.length : (s.pointCount || 0);
    const dist = s.distance ? formatRouteDistance(s.distance) : '--';
    const date = new Date(s.startTime).toLocaleString();
    const badge = s.native ? ' <span style="background:#00897b;color:#fff;padding:1px 5px;border-radius:3px;font-size:10px">BG</span>' : '';
    html += `<div class="rb-route-item" style="cursor:pointer" onclick="convertTrackToRoute(${s.id})">
      <div style="flex:1"><div style="font-weight:bold">${s.name}${badge}</div><div style="font-size:11px;color:#888">${pts} points | ${dist} | ${date}</div></div>
    </div>`;
  });

  html += `<button class="btn btn-cancel" onclick="document.getElementById('track-picker-overlay').remove()" style="margin-top:12px">Cancel</button>`;
  overlay.innerHTML = html;
  document.body.appendChild(overlay);
};

// Ghost track layer — shows the original recorded track as a faded
// line underneath the route being edited, so you can see where you
// actually walked/drove and snap route points to it.
let ghostTrackLayer = null;
let ghostTrackPoints = null;

function showGhostTrack(map, points) {
  removeGhostTrack(map);
  ghostTrackPoints = points;
  const latlngs = points.map(p => [p.lat, p.lon || p.lng]);
  ghostTrackLayer = L.polyline(latlngs, {
    color: '#00bcd4',
    weight: 3,
    opacity: 0.4,
    dashArray: '8,6',
    interactive: false
  }).addTo(map);

  // Show snap-to-track button
  const snapBtn = document.getElementById('rb-snap-track-btn');
  if (snapBtn) snapBtn.style.display = 'block';
}

function removeGhostTrack(map) {
  if (ghostTrackLayer && map) {
    map.removeLayer(ghostTrackLayer);
    ghostTrackLayer = null;
  }
  ghostTrackPoints = null;
}

/**
 * Find the closest point on the ghost track to a given lat/lon.
 * Used for snapping route points to the recorded path.
 */
function snapToGhostTrack(lat, lon) {
  if (!ghostTrackPoints || ghostTrackPoints.length === 0) return { lat, lon };

  let minDist = Infinity;
  let closest = ghostTrackPoints[0];

  for (const p of ghostTrackPoints) {
    const pLon = p.lon || p.lng;
    const dlat = p.lat - lat;
    const dlon = pLon - lon;
    const d = dlat * dlat + dlon * dlon;
    if (d < minDist) {
      minDist = d;
      closest = p;
    }
  }
  return { lat: closest.lat, lon: closest.lon || closest.lng };
}

window.convertTrackToRoute = async function(sessionId) {
  // Try native sessions first, then IndexedDB sessions
  let raw = null;
  let sessionName = 'Converted Track';

  if (window.NativeGps && NativeGps.isNative) {
    try {
      const nativePoints = await NativeGps.getSessionPoints(sessionId);
      if (nativePoints && nativePoints.length >= 2) {
        raw = nativePoints.map(p => ({ lat: p.lat, lon: p.lng, alt: p.alt, t: p.timestamp }));
        const sessions = await NativeGps.getSessions();
        const s = sessions.find(s => s.id === sessionId);
        if (s) sessionName = s.name;
      }
    } catch(e) {}
  }

  if (!raw) {
    const sessions = await getAllTrackSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session || !session.points || session.points.length < 2) return;
    raw = session.points;
    sessionName = session.name || sessionName;
  }

  // Remove picker
  const picker = document.getElementById('track-picker-overlay');
  if (picker) picker.remove();

  // Smart simplification using Ramer-Douglas-Peucker
  // epsilon=15m preserves turns and switchbacks, removes straight-line redundancy
  let simplified = window.GpxUtils ? GpxUtils.simplifyTrack(raw, 15) : raw;

  // Auto-detect decision points (stops, sharp turns, elevation changes)
  let decisionPoints = [];
  if (window.GpxUtils) {
    decisionPoints = GpxUtils.detectDecisionPoints(raw, {
      stopDurationMs: 30000,
      turnAngle: 60,
      elevChangeM: 30
    });
  }

  // Merge decision points into simplified set (they may not overlap)
  const simplifiedSet = new Set(simplified.map(p => `${p.lat},${p.lon || p.lng}`));
  decisionPoints.forEach(dp => {
    const key = `${dp.point.lat},${dp.point.lon || dp.point.lng}`;
    if (!simplifiedSet.has(key)) {
      simplified.push(dp.point);
      simplified._decisionInfo = simplified._decisionInfo || {};
      simplified._decisionInfo[simplified.length - 1] = dp;
    }
  });

  // Sort by original track order (by timestamp or index)
  simplified.sort((a, b) => (a.t || 0) - (b.t || 0));

  // Generate labels for decision points
  const routePoints = simplified.map((p, i) => {
    let label = '';
    let notes = '';

    if (i === 0) {
      label = 'Start';
    } else if (i === simplified.length - 1) {
      label = 'End';
    } else {
      // Check if this is a detected decision point
      const dp = decisionPoints.find(d =>
        Math.abs(d.point.lat - p.lat) < 0.00001 &&
        Math.abs((d.point.lon || d.point.lng) - (p.lon || p.lng)) < 0.00001
      );
      if (dp) {
        if (dp.type === 'stop') {
          label = 'Stop';
          notes = `Stopped for ${Math.round(dp.duration / 60000)} min`;
        } else if (dp.type === 'turn') {
          label = `Turn (${Math.round(dp.angle)}°)`;
          notes = 'Sharp turn detected';
        } else if (dp.type === 'elevation') {
          label = dp.elevChange > 0 ? 'Climb' : 'Descent';
          notes = `${Math.round(Math.abs(dp.elevChange) * 3.28084)} ft ${dp.elevChange > 0 ? 'gain' : 'drop'}`;
        }
      } else {
        label = `Point ${i + 1}`;
      }
    }

    return {
      lat: p.lat, lon: p.lon || p.lng,
      label, notes, accessType: 'any', hazards: '', landmarks: '',
      directions: '', photos: []
    };
  });

  const route = {
    id: null,
    name: sessionName,
    description: 'Converted from recorded track (RDP simplified)',
    points: routePoints
  };

  // Switch to map tab, show ghost track, and start builder
  switchTab('map');
  setTimeout(() => {
    const map = window.fieldMap;
    if (map) {
      showGhostTrack(map, raw);
      startRouteBuilder(map, route);
      map.fitBounds(L.latLngBounds(raw.map(p => [p.lat, p.lon || p.lng])), { padding: [30, 30] });
    }
  }, 300);
};
