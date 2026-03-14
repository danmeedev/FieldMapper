// Map View - Leaflet map with cached tiles, waypoint pins, overlays
// Adapted from public/js/map.js to use tile-cache.js and waypoint-store.js

let mapWaypoints = [];
let mapWaypointMarkers = [];
let mapGpsMarker = null;
let mapAccuracyCircle = null;
let mapTrackLine = null;
let mapTrackPoints = [];
let activeBase = 'topo';

function initMapView() {
  const map = L.map('map', {
    center: [39.5, -118.5],
    zoom: 12,
    zoomControl: true,
    maxZoom: 20
  });
  window.fieldMap = map;

  // Base layers using cached tiles
  const baseLayers = {
    topo: createCachedTileLayer('topo', { attribution: 'USGS Topo' }),
    satellite: createCachedTileLayer('satellite', { attribution: 'USGS Imagery' }),
    'satellite-hd': createCachedTileLayer('satellite-hd', { attribution: 'ESRI HD Imagery' }),
    'imagery-topo': createCachedTileLayer('imagery-topo', { attribution: 'USGS Imagery+Topo' }),
    blm: createCachedTileLayer('blm', { attribution: 'BLM Surface Mgmt' }),
    'esri-topo': createCachedTileLayer('esri-topo', { attribution: 'ESRI World Topo' }),
    'esri-street': createCachedTileLayer('esri-street', { attribution: 'ESRI Street' }),
    natgeo: createCachedTileLayer('natgeo', { attribution: 'National Geographic' }),
    relief: createCachedTileLayer('relief', { attribution: 'Shaded Relief' }),
    terrain: createCachedTileLayer('terrain', { attribution: 'Terrain' })
  };

  baseLayers.topo.addTo(map);

  // Overlay layers
  const overlayLayers = {
    streets: createCachedTileLayer('streets', { opacity: 0.9 }),
    labels: createCachedTileLayer('labels', { opacity: 0.9 }),
    contours: createContourLayer({ opacity: 0.7 }),
    hydro: createCachedTileLayer('hydro', { opacity: 0.8 }),
    trails: createCachedTileLayer('trails', { opacity: 0.8 }),
    land: createCachedTileLayer('land-ownership', { opacity: 0.5 }),
    radar: createRadarLayer({ opacity: 0.6 }),
    wind: createWindLayer({ opacity: 0.5 })
  };

  // Base layer switching
  document.querySelectorAll('input[name="base"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      map.removeLayer(baseLayers[activeBase]);
      activeBase = e.target.value;
      baseLayers[activeBase].addTo(map);
    });
  });

  // Overlay toggles
  ['streets', 'labels', 'contours', 'hydro', 'trails', 'land', 'radar', 'wind'].forEach(id => {
    const el = document.getElementById(`overlay-${id}`);
    if (el) el.addEventListener('change', (e) => {
      if (e.target.checked) overlayLayers[id].addTo(map);
      else map.removeLayer(overlayLayers[id]);
    });
  });

  // GPS marker
  const gpsIcon = L.divIcon({
    className: 'gps-pulse',
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });

  // GPS updates for map
  window.onGpsUpdate_mapView = function(pos) {
    const latlng = [pos.lat, pos.lon];

    // Update GPS status display with coords
    const statusEl = document.getElementById('map-gps-status');
    const coordsEl = document.getElementById('map-coords');
    if (statusEl) statusEl.textContent = `${pos.lat.toFixed(6)}, ${pos.lon.toFixed(6)}`;
    if (coordsEl) {
      let detail = '';
      if (pos.altitude) detail += `Elev: ${(pos.altitude * 3.28084).toFixed(0)}ft`;
      if (pos.accuracy) detail += `${detail ? ' | ' : ''}Acc: ${(pos.accuracy * 3.28084).toFixed(0)}ft`;
      if (pos.speed && pos.speed > 0.2) detail += `${detail ? ' | ' : ''}${(pos.speed * 2.237).toFixed(1)}mph`;
      coordsEl.textContent = detail;
    }

    if (!mapGpsMarker) {
      mapGpsMarker = L.marker(latlng, { icon: gpsIcon, zIndexOffset: 1000 }).addTo(map);
      map.setView(latlng, 14);
    } else {
      mapGpsMarker.setLatLng(latlng);
    }

    if (pos.accuracy) {
      if (!mapAccuracyCircle) {
        mapAccuracyCircle = L.circle(latlng, {
          radius: pos.accuracy, color: '#2196f3', fillColor: '#2196f3', fillOpacity: 0.1, weight: 1
        }).addTo(map);
      } else {
        mapAccuracyCircle.setLatLng(latlng);
        mapAccuracyCircle.setRadius(pos.accuracy);
      }
    }

    // Track
    const showTrack = document.getElementById('show-track');
    if (showTrack && showTrack.checked) {
      mapTrackPoints.push(latlng);
      if (!mapTrackLine) {
        mapTrackLine = L.polyline(mapTrackPoints, { color: '#2196f3', weight: 3, opacity: 0.7 }).addTo(map);
      } else {
        mapTrackLine.setLatLngs(mapTrackPoints);
      }
    }

    // Auto-center
    const autoCenter = document.getElementById('auto-center');
    if (autoCenter && autoCenter.checked) map.panTo(latlng);

    // Update map navigation panel distance
    if (typeof onGpsUpdate_mapNav === 'function') onGpsUpdate_mapNav(pos);
  };

  // Panel toggles (hamburger menu)
  const panels = ['map-layers-panel', 'map-pins-panel', 'map-settings-panel', 'map-download-panel', 'map-routes-panel'];
  const toggleMap = {
    'toggle-layers': 'map-layers-panel',
    'toggle-pins': 'map-pins-panel',
    'toggle-routes': 'map-routes-panel',
    'toggle-map-settings': 'map-settings-panel',
    'toggle-download': 'map-download-panel'
  };

  Object.entries(toggleMap).forEach(([btnId, panelId]) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener('click', () => {
      const panel = document.getElementById(panelId);
      const isVisible = panel.classList.contains('visible');
      panels.forEach(p => { const el = document.getElementById(p); if (el) el.classList.remove('visible'); });
      document.querySelectorAll('.map-menu-item').forEach(b => b.classList.remove('active'));
      closeMapMenu();
      if (!isVisible) { panel.classList.add('visible'); btn.classList.add('active'); }
    });
  });

  // Close panels when clicking map
  map.on('click', () => {
    if (!dropPinMode && !measureMode && !routeBuilderActive) {
      panels.forEach(p => { const el = document.getElementById(p); if (el) el.classList.remove('visible'); });
      closeMapMenu();
    }
  });

  // Center GPS button
  const centerBtn = document.getElementById('center-gps');
  if (centerBtn) centerBtn.addEventListener('click', () => {
    if (mapGpsMarker) map.setView(mapGpsMarker.getLatLng(), map.getZoom());
  });

  // Clear track
  const clearTrack = document.getElementById('clear-track');
  if (clearTrack) clearTrack.addEventListener('click', () => {
    mapTrackPoints = [];
    if (mapTrackLine) { map.removeLayer(mapTrackLine); mapTrackLine = null; }
  });

  // Show/hide track
  const showTrack = document.getElementById('show-track');
  if (showTrack) showTrack.addEventListener('change', (e) => {
    if (!e.target.checked && mapTrackLine) map.removeLayer(mapTrackLine);
    else if (e.target.checked && mapTrackLine) mapTrackLine.addTo(map);
  });

  // Drop pin mode
  let dropPinMode = false;

  window.triggerDropPin = function() {
    closeMapMenu();
    dropPinMode = !dropPinMode;
    map.getContainer().style.cursor = dropPinMode ? 'crosshair' : '';
    const menuBtn = document.getElementById('map-drop-pin-menu');
    if (menuBtn) menuBtn.style.color = dropPinMode ? '#f44336' : '#fff';
  };

  map.on('click', (e) => {
    if (!dropPinMode) return;
    dropPinMode = false;
    map.getContainer().style.cursor = '';
    const menuBtn = document.getElementById('map-drop-pin-menu');
    if (menuBtn) menuBtn.style.color = '#fff';
    showMapPinForm(e.latlng, map);
  });

  // Coordinate search
  const coordInput = document.getElementById('coord-input');
  const coordGo = document.getElementById('coord-go');
  if (coordInput && coordGo) {
    function goToCoords() {
      const result = parseCoordinates(coordInput.value);
      if (result) {
        map.setView([result.lat, result.lon], Math.max(map.getZoom(), 14));
        const tempMarker = L.circleMarker([result.lat, result.lon], {
          radius: 8, color: '#ff0', fillColor: '#ff0', fillOpacity: 0.8, weight: 2
        }).addTo(map);
        tempMarker.bindPopup(`<b>Search</b><br>${result.lat.toFixed(6)}, ${result.lon.toFixed(6)}`).openPopup();
        setTimeout(() => map.removeLayer(tempMarker), 60000);
        coordInput.style.borderColor = '#4caf50';
      } else {
        coordInput.style.borderColor = '#f44336';
      }
      setTimeout(() => coordInput.style.borderColor = '#555', 2000);
    }
    coordGo.addEventListener('click', goToCoords);
    coordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') goToCoords(); });
  }

  // Download area for offline
  const downloadBtn = document.getElementById('download-area-btn');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', async () => {
      const bounds = map.getBounds();
      const zoom = map.getZoom();
      const maxZ = Math.min(zoom + 2, 16);
      const statusEl = document.getElementById('download-status');

      downloadBtn.disabled = true;
      statusEl.textContent = 'Calculating tiles...';

      try {
        await downloadArea(activeBase, bounds, Math.max(zoom - 1, 1), maxZ, (done, total) => {
          statusEl.textContent = `Downloading: ${done}/${total} tiles...`;
        });
        statusEl.textContent = 'Download complete!';
      } catch (e) {
        statusEl.textContent = `Error: ${e.message}`;
      }
      downloadBtn.disabled = false;
    });
  }

  // Corridor download
  const corridorBtn = document.getElementById('dl-corridor-btn');
  const cancelDlBtn = document.getElementById('dl-cancel-btn');
  let dlControl = { cancelled: false };

  // Populate route selector and layer checkboxes when download panel opens
  const toggleDownload = document.getElementById('toggle-download');
  if (toggleDownload) {
    const origClick = toggleDownload.onclick;
    toggleDownload.addEventListener('click', async () => {
      // Populate routes
      const routeSelect = document.getElementById('dl-route-select');
      if (routeSelect) {
        const routes = await getAllRoutes();
        routeSelect.innerHTML = '<option value="">Select a route...</option>';
        routes.forEach(r => {
          routeSelect.innerHTML += `<option value="${r.id}">${r.name} (${r.points ? r.points.length : 0} pts)</option>`;
        });
      }
      // Populate layer checkboxes
      const layerList = document.getElementById('dl-layers-list');
      if (layerList && layerList.children.length === 0) {
        const layers = [
          { id: 'topo', name: 'USGS Topo' },
          { id: 'esri-topo', name: 'ESRI Topo' },
          { id: 'satellite-hd', name: 'ESRI Satellite HD' },
          { id: 'esri-street', name: 'ESRI Street' },
          { id: 'blm', name: 'BLM Surface Mgmt' }
        ];
        layers.forEach(l => {
          const checked = (l.id === activeBase) ? 'checked' : '';
          layerList.innerHTML += `<label style="display:block;padding:2px 0"><input type="checkbox" class="dl-layer-cb" value="${l.id}" ${checked}> ${l.name}</label>`;
        });
      }
    });
  }

  // Update estimate when selections change
  document.addEventListener('change', (e) => {
    if (e.target.matches('#dl-route-select, #dl-buffer, #dl-max-zoom, .dl-layer-cb')) {
      updateCorridorEstimate();
    }
  });

  async function updateCorridorEstimate() {
    const routeId = document.getElementById('dl-route-select')?.value;
    if (!routeId) { document.getElementById('dl-estimate').textContent = ''; return; }

    const routes = await getAllRoutes();
    const route = routes.find(r => String(r.id) === routeId);
    if (!route || !route.points) return;

    const buffer = parseFloat(document.getElementById('dl-buffer')?.value || 1);
    const maxZoom = parseInt(document.getElementById('dl-max-zoom')?.value || 15);
    const layerCbs = document.querySelectorAll('.dl-layer-cb:checked');
    const sourceIds = Array.from(layerCbs).map(cb => cb.value);

    if (sourceIds.length === 0) {
      document.getElementById('dl-estimate').textContent = 'Select at least one layer';
      return;
    }

    const est = estimateCorridorDownload(route.points, buffer, 10, maxZoom, sourceIds);
    document.getElementById('dl-estimate').textContent =
      `~${est.tileCount.toLocaleString()} tiles (~${est.estimatedMB} MB) across ${sourceIds.length} layer(s)`;
  }

  if (corridorBtn) {
    corridorBtn.addEventListener('click', async () => {
      const routeId = document.getElementById('dl-route-select')?.value;
      if (!routeId) { alert('Select a route first'); return; }

      const routes = await getAllRoutes();
      const route = routes.find(r => String(r.id) === routeId);
      if (!route || !route.points || route.points.length < 2) return;

      const buffer = parseFloat(document.getElementById('dl-buffer')?.value || 1);
      const maxZoom = parseInt(document.getElementById('dl-max-zoom')?.value || 15);
      const layerCbs = document.querySelectorAll('.dl-layer-cb:checked');
      const sourceIds = Array.from(layerCbs).map(cb => cb.value);

      if (sourceIds.length === 0) { alert('Select at least one layer'); return; }

      const statusEl = document.getElementById('download-status');
      dlControl = { cancelled: false };
      corridorBtn.disabled = true;
      corridorBtn.textContent = 'Downloading...';
      cancelDlBtn.style.display = 'block';

      try {
        const result = await downloadRouteCorridor(sourceIds, route.points, buffer, 10, maxZoom,
          (done, total, phase) => {
            const pct = Math.round(done / total * 100);
            statusEl.textContent = `${done}/${total} tiles (${pct}%) — ${phase}`;
          }, dlControl);

        if (result.cancelled) {
          statusEl.textContent = `Cancelled after ${result.done} tiles`;
        } else {
          statusEl.textContent = `Complete! ${result.done} tiles downloaded`;
        }
      } catch (e) {
        statusEl.textContent = `Error: ${e.message}`;
      }

      corridorBtn.disabled = false;
      corridorBtn.textContent = 'Download Route Corridor';
      cancelDlBtn.style.display = 'none';
    });
  }

  if (cancelDlBtn) {
    cancelDlBtn.addEventListener('click', () => {
      dlControl.cancelled = true;
      cancelDlBtn.style.display = 'none';
    });
  }

  // Settings - laptop URL
  const saveSettingsBtn = document.getElementById('save-map-settings');
  if (saveSettingsBtn) {
    getSetting('laptopUrl').then(url => {
      if (url) document.getElementById('laptop-url-input').value = url;
    });

    saveSettingsBtn.addEventListener('click', async () => {
      const urlInput = document.getElementById('laptop-url-input');
      let url = urlInput.value.trim();
      const statusEl = document.getElementById('map-settings-status');

      if (!url) { statusEl.textContent = 'Enter a URL'; return; }

      // Auto-add protocol if missing
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'http://' + url;
        urlInput.value = url;
      }
      // Remove trailing slash
      url = url.replace(/\/+$/, '');

      await saveSetting('laptopUrl', url);
      statusEl.textContent = 'Saved! Testing connection...';
      statusEl.style.color = '#ffc107';

      const ok = await checkLaptopConnection();
      if (ok) {
        statusEl.textContent = 'Connected! GPS streaming started.';
        statusEl.style.color = '#4caf50';
        // Update the GPS view server display
        const urlDisplay = document.getElementById('gps-server-url-display');
        if (urlDisplay) urlDisplay.innerHTML = `Server: <b>${url}</b>`;
        // Start WebSocket GPS streaming now that we have a URL
        connectWS();
      } else {
        statusEl.textContent = 'Saved, but cannot reach server. Check URL and WiFi.';
        statusEl.style.color = '#f44336';
      }
    });
  }

  // Initialize measure tool
  if (typeof initMeasureTool === 'function') initMeasureTool(map);

  // Route builder buttons
  const newRouteBtn = document.getElementById('new-route-btn');
  if (newRouteBtn) newRouteBtn.addEventListener('click', () => startRouteBuilder(map));

  const trackToRouteBtn = document.getElementById('track-to-route-btn');
  if (trackToRouteBtn) trackToRouteBtn.addEventListener('click', () => showTrackToRoute());

  // Legend toggle for overlay layers
  const legendOverlays = {
    'overlay-land': 'legend-land',
    'overlay-trails': 'legend-trails',
    'overlay-radar': 'legend-radar',
    'overlay-wind': 'legend-wind',
    'overlay-contours': 'legend-contours'
  };
  Object.entries(legendOverlays).forEach(([checkId, legendId]) => {
    const cb = document.getElementById(checkId);
    if (cb) {
      cb.addEventListener('change', () => {
        const legendEl = document.getElementById(legendId);
        if (legendEl) legendEl.style.display = cb.checked ? 'block' : 'none';
      });
    }
  });

  // Cache stats
  getCacheStats().then(stats => {
    const el = document.getElementById('map-cache-stats');
    if (el) el.textContent = `${stats.totalTiles} tiles cached`;
  });

  // Load waypoints and routes
  loadMapWaypoints();
  if (typeof loadMapRoutes === 'function') loadMapRoutes();
}

async function loadMapWaypoints() {
  const map = window.fieldMap;
  if (!map) return;

  // Clear existing markers
  mapWaypointMarkers.forEach(entry => map.removeLayer(entry.marker));
  mapWaypointMarkers = [];

  mapWaypoints = await getAllWaypoints();

  for (const wp of mapWaypoints) {
    const color = getWpColor(wp);
    const emoji = getWpIcon(wp);

    const icon = L.divIcon({
      className: 'wp-marker-icon',
      html: `<div style="width:26px;height:26px;background:${color};border:3px solid #fff;border-radius:50%;box-shadow:0 0 6px rgba(0,0,0,0.6);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:13px">${emoji}</div>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13]
    });

    const marker = L.marker([wp.lat, wp.lon], { icon, interactive: true, bubblingMouseEvents: false }).addTo(map);

    // Build popup content with photos
    const popupContent = await buildWpPopupContent(wp);
    marker.bindPopup(popupContent, { maxWidth: 300, minWidth: 220, className: 'wp-popup' });

    mapWaypointMarkers.push({ id: wp.id, marker });
  }

  renderMapPinList();
}

async function buildWpPopupContent(wp) {
  const preset = PIN_PRESETS[wp.category] || PIN_PRESETS.general;
  const photos = await getPhotos(wp.id);

  let html = `<div class="wp-popup-content" style="max-width:280px">`;
  html += `<div style="font-weight:bold;font-size:15px;margin-bottom:4px">${wp.name}</div>`;
  html += `<div style="font-size:12px;color:#1976d2;margin-bottom:4px">${preset.icon} ${preset.label}</div>`;
  html += `<div style="font-family:monospace;font-size:11px;color:#666;margin-bottom:4px">${wp.lat.toFixed(6)}, ${wp.lon.toFixed(6)}</div>`;

  if (wp.altitude) {
    html += `<div style="font-size:11px;color:#888">Elev: ${(wp.altitude * 3.28084).toFixed(0)} ft`;
    if (wp.accuracy) html += ` | Acc: ${(wp.accuracy * 3.28084).toFixed(0)} ft`;
    html += `</div>`;
  }

  if (wp.notes) {
    html += `<div style="margin:6px 0;font-size:13px;line-height:1.4;color:#333">${wp.notes}</div>`;
  }

  // Sample data
  if (wp.samples && wp.samples.length > 0) {
    const s = wp.samples[0];
    html += `<div style="margin:6px 0;padding:6px;background:#f5f5f5;border-radius:4px;font-size:12px">`;
    html += `<b>Sample ${s.id}</b> (${s.type})`;
    if (s.rockType) html += `<br>Rock: ${s.rockType}`;
    if (s.mineralization) html += `<br>Mineralization: ${s.mineralization}`;
    if (s.alteration) html += `<br>Alteration: ${s.alteration}`;
    html += `</div>`;
  }

  // Photos
  if (photos.length > 0) {
    html += `<div style="display:flex;flex-wrap:wrap;gap:4px;margin:6px 0">`;
    photos.forEach((p, i) => {
      html += `<img src="${p.dataUrl}" onclick="showFullPhoto('${wp.id}', ${i})" style="width:80px;height:60px;object-fit:cover;border-radius:4px;cursor:pointer;border:1px solid #ddd">`;
    });
    html += `</div>`;
  }

  html += `<div style="font-size:11px;color:#999;margin:4px 0">${new Date(wp.timestamp).toLocaleString()}</div>`;
  html += `<div style="display:flex;gap:4px;margin-top:6px;flex-wrap:wrap">`;
  html += `<button class="wp-popup-btn" onclick="showEditWaypoint(${wp.id})" style="background:#1976d2">Edit</button>`;
  html += `<button class="wp-popup-btn" onclick="showAddPhotos(${wp.id})" style="background:#7b1fa2">Photos</button>`;
  html += `<button class="wp-popup-btn" onclick="navigateTo(${wp.id})" style="background:#00897b">Navigate</button>`;
  html += `<button class="wp-popup-btn" onclick="deleteMapPin(${wp.id})" style="background:#d32f2f">Delete</button>`;
  html += `</div>`;
  html += `</div>`;

  return html;
}

// Full-screen photo viewer
window.showFullPhoto = function(wpId, index) {
  getPhotos(parseInt(wpId)).then(photos => {
    if (!photos[index]) return;

    const overlay = document.createElement('div');
    overlay.id = 'photo-fullscreen';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:10000;background:rgba(0,0,0,0.95);display:flex;align-items:center;justify-content:center;flex-direction:column';

    let currentIdx = index;

    function render() {
      overlay.innerHTML = `
        <div style="position:absolute;top:10px;right:10px;display:flex;gap:10px;z-index:10001">
          <span style="color:#fff;font-size:14px">${currentIdx + 1} / ${photos.length}</span>
          <button onclick="document.getElementById('photo-fullscreen').remove()" style="background:#d32f2f;color:#fff;border:none;border-radius:50%;width:36px;height:36px;font-size:20px;cursor:pointer">X</button>
        </div>
        <img src="${photos[currentIdx].dataUrl}" style="max-width:95%;max-height:85%;object-fit:contain;border-radius:4px">
        ${photos.length > 1 ? `
        <div style="margin-top:10px;display:flex;gap:10px">
          <button onclick="window._photoNav(-1)" style="padding:8px 20px;background:#333;color:#fff;border:none;border-radius:4px;font-size:16px">&lt; Prev</button>
          <button onclick="window._photoNav(1)" style="padding:8px 20px;background:#333;color:#fff;border:none;border-radius:4px;font-size:16px">Next &gt;</button>
        </div>` : ''}
      `;
    }

    window._photoNav = function(dir) {
      currentIdx = (currentIdx + dir + photos.length) % photos.length;
      render();
    };

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    render();
    document.body.appendChild(overlay);
  });
};

// Edit waypoint
window.showEditWaypoint = function(id) {
  const map = window.fieldMap;
  if (map) map.closePopup();

  getWaypoint(id).then(async wp => {
    if (!wp) return;

    const photos = await getPhotos(wp.id);
    const preset = PIN_PRESETS[wp.category] || PIN_PRESETS.general;
    const cats = Object.entries(PIN_PRESETS).map(([k, v]) =>
      `<option value="${k}" ${k === wp.category ? 'selected' : ''}>${v.icon} ${v.label}</option>`
    ).join('');

    const overlay = document.createElement('div');
    overlay.id = 'edit-wp-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:8000;background:#1a1a1a;overflow-y:auto;padding:12px;padding-bottom:80px';

    let photoHtml = '';
    if (photos.length > 0) {
      photoHtml = `<div style="display:flex;flex-wrap:wrap;gap:6px;margin:6px 0">`;
      photos.forEach((p, i) => {
        photoHtml += `<div style="position:relative"><img src="${p.dataUrl}" style="width:70px;height:70px;object-fit:cover;border-radius:6px;border:1px solid #444"><button class="edit-photo-delete" data-photo-id="${p.id}" style="position:absolute;top:-4px;right:-4px;background:red;color:#fff;border:none;border-radius:50%;width:20px;height:20px;font-size:12px;cursor:pointer">X</button></div>`;
      });
      photoHtml += `</div>`;
    }

    overlay.innerHTML = `
      <h2 style="text-align:center;font-size:18px;margin-bottom:10px">Edit Location</h2>
      <div style="text-align:center;font-family:monospace;font-size:13px;color:#aaa;margin-bottom:12px">${wp.lat.toFixed(6)}, ${wp.lon.toFixed(6)}</div>

      <div class="form-group">
        <label>Title</label>
        <input type="text" id="edit-wp-title" value="${wp.name || ''}">
      </div>

      <div class="form-group">
        <label>Category</label>
        <select id="edit-wp-cat" style="width:100%;padding:10px;border:1px solid #444;border-radius:6px;background:#222;color:#fff;font-size:14px">${cats}</select>
      </div>

      <div class="form-group">
        <label>Notes / Description</label>
        <textarea id="edit-wp-notes" style="min-height:80px">${wp.notes || ''}</textarea>
      </div>

      <div class="form-group">
        <label>Photos (${photos.length})</label>
        ${photoHtml}
        <input type="file" id="edit-photo-input" accept="image/*" multiple style="display:none">
        <button class="btn btn-photo" id="edit-add-photo-btn">Add Photo</button>
        <div id="edit-new-photos" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px"></div>
      </div>

      <button class="btn btn-save" id="edit-wp-save">Save Changes</button>
      <button class="btn btn-cancel" id="edit-wp-cancel">Cancel</button>
    `;

    document.body.appendChild(overlay);

    let newPhotos = [];

    // Delete existing photo
    overlay.querySelectorAll('.edit-photo-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const photoId = btn.dataset.photoId;
        await deletePhoto(photoId);
        // Update photo count on waypoint
        const remaining = await getPhotos(wp.id);
        wp.photoCount = remaining.length;
        await saveWaypoint(wp);
        btn.parentElement.remove();
      });
    });

    // Add new photos
    document.getElementById('edit-add-photo-btn').addEventListener('click', () => {
      document.getElementById('edit-photo-input').click();
    });

    document.getElementById('edit-photo-input').addEventListener('change', (e) => {
      for (const file of e.target.files) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX = 1600;
            let w = img.width, h = img.height;
            if (w > MAX || h > MAX) {
              if (w > h) { h = h * MAX / w; w = MAX; } else { w = w * MAX / h; h = MAX; }
            }
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            newPhotos.push(dataUrl);

            const strip = document.getElementById('edit-new-photos');
            const div = document.createElement('div');
            div.style.cssText = 'position:relative';
            div.innerHTML = `<img src="${dataUrl}" style="width:70px;height:70px;object-fit:cover;border-radius:6px;border:1px solid #4caf50">`;
            strip.appendChild(div);
          };
          img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
      }
      e.target.value = '';
    });

    // Save
    document.getElementById('edit-wp-save').addEventListener('click', async () => {
      wp.name = document.getElementById('edit-wp-title').value.trim() || wp.name;
      wp.category = document.getElementById('edit-wp-cat').value;
      wp.notes = document.getElementById('edit-wp-notes').value.trim();
      wp.synced = false; // Mark for re-sync

      // Save new photos
      const existingPhotos = await getPhotos(wp.id);
      let nextIndex = existingPhotos.length;
      for (const dataUrl of newPhotos) {
        await savePhoto(wp.id, nextIndex++, dataUrl);
      }
      wp.photoCount = nextIndex;

      await saveWaypoint(wp);
      overlay.remove();
      loadMapWaypoints();
      refreshGpsList();
    });

    // Cancel
    document.getElementById('edit-wp-cancel').addEventListener('click', () => overlay.remove());
  });
};

// Quick add photos to existing waypoint
window.showAddPhotos = function(id) {
  const map = window.fieldMap;
  if (map) map.closePopup();

  // Just open edit form focused on photos
  showEditWaypoint(id);
};

function renderMapPinList() {
  const list = document.getElementById('map-pin-list');
  if (!list) return;
  list.innerHTML = '';

  const countEl = document.getElementById('map-pin-count');
  if (countEl) countEl.textContent = mapWaypoints.length;

  const sorted = [...mapWaypoints].reverse();
  sorted.forEach(wp => {
    const color = getWpColor(wp);
    const emoji = getWpIcon(wp);
    const div = document.createElement('div');
    div.className = 'wp-list-item';
    div.innerHTML = `
      <div class="legend-dot" style="background:${color}">${emoji}</div>
      <div style="flex:1;min-width:0">
        <div class="wp-list-name">${wp.name}</div>
        <div class="wp-list-detail">${wp.category} | ${new Date(wp.timestamp).toLocaleDateString()}${wp.photoCount ? ' | ' + wp.photoCount + ' photo' + (wp.photoCount > 1 ? 's' : '') : ''}</div>
      </div>
      <button class="wp-list-delete" onclick="event.stopPropagation(); deleteMapPin(${wp.id})">X</button>
    `;
    div.addEventListener('click', () => {
      const map = window.fieldMap;
      map.setView([wp.lat, wp.lon], 16);
      const entry = mapWaypointMarkers.find(w => w.id === wp.id);
      if (entry) entry.marker.openPopup();
    });
    list.appendChild(div);
  });

  // Legend
  renderMapLegend();
}

function renderMapLegend() {
  const el = document.getElementById('map-legend');
  if (!el) return;
  const used = new Set(mapWaypoints.map(w => w.category));
  el.innerHTML = '';
  Object.entries(PIN_PRESETS).forEach(([key, p]) => {
    const count = mapWaypoints.filter(w => w.category === key).length;
    const opacity = used.has(key) ? 1 : 0.4;
    el.innerHTML += `<div class="legend-row" style="opacity:${opacity}"><div class="legend-dot" style="background:${p.color}">${p.icon}</div>${p.label}${count ? ` (${count})` : ''}</div>`;
  });
}

window.deleteMapPin = async function(id) {
  if (!confirm('Delete this pin?')) return;
  await deleteWaypoint(id);
  loadMapWaypoints();
  refreshGpsList();
};

function showMapPinForm(latlng, map) {
  const existing = document.getElementById('map-pin-form');
  if (existing) existing.remove();

  const cats = Object.entries(PIN_PRESETS).map(([k, v]) => `<option value="${k}">${v.icon} ${v.label}</option>`).join('');
  const colors = CUSTOM_COLORS.map(c => `<div class="pin-swatch" data-color="${c}" style="width:22px;height:22px;background:${c};border-radius:50%;cursor:pointer;border:2px solid transparent"></div>`).join('');

  const form = document.createElement('div');
  form.id = 'map-pin-form';
  form.innerHTML = `
    <h4 style="margin:0 0 6px">New Pin</h4>
    <div style="font-size:11px;color:#aaa;margin-bottom:6px">${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}</div>
    <input id="mpf-name" type="text" placeholder="Name" value="WP-${mapWaypoints.length + 1}" style="width:100%;padding:6px;margin-bottom:6px;border:1px solid #444;border-radius:4px;background:#222;color:#fff;font-size:13px">
    <select id="mpf-cat" style="width:100%;padding:6px;margin-bottom:6px;border:1px solid #444;border-radius:4px;background:#222;color:#fff;font-size:13px">${cats}</select>
    <div style="margin-bottom:6px"><div style="font-size:11px;color:#aaa;margin-bottom:4px">Color</div><div style="display:flex;flex-wrap:wrap;gap:3px">${colors}</div><input type="hidden" id="mpf-color" value=""></div>
    <textarea id="mpf-notes" placeholder="Notes" rows="2" style="width:100%;padding:6px;margin-bottom:6px;border:1px solid #444;border-radius:4px;background:#222;color:#fff;font-size:13px;resize:none"></textarea>
    <input type="file" id="mpf-photo-input" accept="image/*" multiple style="display:none">
    <button id="mpf-add-photo" style="width:100%;padding:6px;margin-bottom:6px;background:#1565c0;color:#fff;border:none;border-radius:4px;font-size:13px">Add Photo</button>
    <div id="mpf-photo-strip" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px"></div>
    <div style="display:flex;gap:6px">
      <button id="mpf-save" style="flex:1;padding:8px;background:#4caf50;color:#fff;border:none;border-radius:4px;font-weight:bold;font-size:13px">Save</button>
      <button id="mpf-cancel" style="flex:1;padding:8px;background:#666;color:#fff;border:none;border-radius:4px;font-size:13px">Cancel</button>
    </div>
  `;
  Object.assign(form.style, {
    position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
    zIndex: '2000', background: 'rgba(0,0,0,0.95)', color: '#fff', padding: '14px',
    borderRadius: '10px', width: '270px', boxShadow: '0 4px 20px rgba(0,0,0,0.5)'
  });
  document.getElementById('map-view').appendChild(form);

  document.getElementById('mpf-name').focus();

  let pinPhotos = [];

  form.querySelectorAll('.pin-swatch').forEach(s => {
    s.addEventListener('click', () => {
      form.querySelectorAll('.pin-swatch').forEach(x => x.style.border = '2px solid transparent');
      s.style.border = '2px solid #fff';
      document.getElementById('mpf-color').value = s.dataset.color;
    });
  });

  document.getElementById('mpf-add-photo').addEventListener('click', () => {
    document.getElementById('mpf-photo-input').click();
  });

  document.getElementById('mpf-photo-input').addEventListener('change', (e) => {
    for (const file of e.target.files) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX = 1600;
          let w = img.width, h = img.height;
          if (w > MAX || h > MAX) {
            if (w > h) { h = h * MAX / w; w = MAX; } else { w = w * MAX / h; h = MAX; }
          }
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          pinPhotos.push(canvas.toDataURL('image/jpeg', 0.8));
          const strip = document.getElementById('mpf-photo-strip');
          strip.innerHTML = pinPhotos.map(d => `<img src="${d}" style="width:50px;height:50px;object-fit:cover;border-radius:4px">`).join('');
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  });

  document.getElementById('mpf-save').addEventListener('click', async () => {
    const wp = {
      id: Date.now(),
      lat: latlng.lat,
      lon: latlng.lng,
      name: document.getElementById('mpf-name').value.trim() || `WP-${mapWaypoints.length + 1}`,
      category: document.getElementById('mpf-cat').value,
      color: document.getElementById('mpf-color').value || null,
      notes: document.getElementById('mpf-notes').value.trim(),
      timestamp: new Date().toISOString(),
      synced: false,
      photoCount: pinPhotos.length
    };

    // Save photos
    for (let i = 0; i < pinPhotos.length; i++) {
      await savePhoto(wp.id, i, pinPhotos[i]);
    }

    await saveWaypoint(wp);
    form.remove();
    loadMapWaypoints();
    refreshGpsList();
  });

  document.getElementById('mpf-cancel').addEventListener('click', () => form.remove());
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') form.remove();
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') document.getElementById('mpf-save').click();
  });
}

// --- Hamburger menu ---
window.toggleMapMenu = function() {
  const menu = document.getElementById('map-menu-dropdown');
  if (menu) menu.classList.toggle('open');
};

function closeMapMenu() {
  const menu = document.getElementById('map-menu-dropdown');
  if (menu) menu.classList.remove('open');
}

// --- Backup all data to laptop ---
window.backupAllData = async function() {
  closeMapMenu();
  const serverUrl = await getSetting('laptopUrl');
  if (!serverUrl) { alert('Set laptop server URL in Settings first.'); return; }

  const statusToast = document.createElement('div');
  statusToast.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.9);color:#fff;padding:20px 30px;border-radius:10px;z-index:9999;font-size:14px;text-align:center';
  statusToast.textContent = 'Backing up...';
  document.body.appendChild(statusToast);

  try {
    // Backup routes
    const routes = await getAllRoutes();
    let routesSynced = 0;
    for (const route of routes) {
      const resp = await fetch(`${serverUrl}/api/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(route)
      });
      if (resp.ok) routesSynced++;
    }

    // Also sync waypoints
    const result = await syncToLaptop((done, total) => {
      statusToast.textContent = `Syncing waypoints... ${done}/${total}`;
    });

    // Pull routes from server that we don't have locally
    let routesPulled = 0;
    try {
      const resp = await fetch(`${serverUrl}/api/routes`);
      if (resp.ok) {
        const serverRoutes = await resp.json();
        const localRoutes = await getAllRoutes();
        const localRouteIds = new Set(localRoutes.map(r => r.id));
        for (const route of serverRoutes) {
          if (!localRouteIds.has(route.id)) {
            if (route.points) {
              route.points.forEach(pt => {
                if (pt.photos) {
                  pt.photos = pt.photos.map(p =>
                    p.startsWith('data:') || p.startsWith('http') ? p : `${serverUrl}/photos/${p}`
                  );
                }
              });
            }
            await saveRoute(route);
            routesPulled++;
          }
        }
      }
    } catch (e) {
      console.error('Route pull failed:', e.message);
    }

    statusToast.textContent = `Backup complete!\n${result.synced} wp pushed, ${routesSynced} routes pushed\n${result.pulled} wp pulled, ${routesPulled} routes pulled`;
    statusToast.style.background = 'rgba(27,94,32,0.95)';
    setTimeout(() => statusToast.remove(), 4000);
  } catch (e) {
    statusToast.textContent = `Backup failed: ${e.message}`;
    statusToast.style.background = 'rgba(183,28,28,0.95)';
    setTimeout(() => statusToast.remove(), 4000);
  }
};

// --- Printable Route Map ---
window.showPrintRouteDialog = async function() {
  closeMapMenu();
  const routes = await getAllRoutes();
  if (routes.length === 0) { alert('No routes to print. Create a route first.'); return; }

  const picker = document.createElement('div');
  picker.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9000;background:#1a1a1a;overflow-y:auto;padding:12px;padding-bottom:80px';
  let html = '<h2 style="text-align:center;font-size:18px;margin-bottom:12px">Select Route to Print</h2>';
  routes.forEach(r => {
    html += `<div style="padding:12px;background:#222;border-radius:8px;margin-bottom:8px;cursor:pointer" onclick="generatePrintMap(${r.id})">
      <div style="font-weight:bold;font-size:14px">${r.name}</div>
      <div style="font-size:12px;color:#888">${r.points ? r.points.length : 0} points | ${r.description || ''}</div>
    </div>`;
  });
  html += '<button class="btn btn-cancel" onclick="this.parentElement.remove()">Cancel</button>';
  picker.innerHTML = html;
  document.body.appendChild(picker);
};

window.generatePrintMap = async function(routeId) {
  // Remove picker
  document.querySelectorAll('[style*="z-index:9000"]').forEach(el => el.remove());

  const routes = await getAllRoutes();
  const route = routes.find(r => r.id === routeId);
  if (!route) return;

  const ACCESS_TYPES = {
    any: { label: 'Any Vehicle', icon: '\u{1F697}', color: '#4caf50' },
    utv: { label: 'UTV/ATV', icon: '\u{1F6FB}', color: '#ff9800' },
    foot: { label: 'Foot Only', icon: '\u{1F97E}', color: '#2196f3' },
    rope: { label: 'Rope/Climb', icon: '\u{1FA22}', color: '#f44336' },
    scramble: { label: 'Scramble', icon: '\u26F0\uFE0F', color: '#9c27b0' }
  };

  // Calculate route bounds and stats
  let totalDist = 0;
  let minElev = Infinity, maxElev = -Infinity;
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  const pts = route.points || [];

  pts.forEach((pt, i) => {
    if (pt.lat < minLat) minLat = pt.lat;
    if (pt.lat > maxLat) maxLat = pt.lat;
    if (pt.lon < minLon) minLon = pt.lon;
    if (pt.lon > maxLon) maxLon = pt.lon;
    if (i > 0) {
      totalDist += haversineDistance(pts[i-1].lat, pts[i-1].lon, pt.lat, pt.lon);
    }
  });

  const centerLat = ((minLat + maxLat) / 2).toFixed(6);
  const centerLon = ((minLon + maxLon) / 2).toFixed(6);

  // Generate static map image URL using ESRI
  const bbox = `${minLon - 0.005},${minLat - 0.003},${maxLon + 0.005},${maxLat + 0.003}`;
  const mapImgUrl = `https://services.arcgisonline.com/arcgis/rest/services/World_Topo_Map/MapServer/export?bbox=${bbox}&bboxSR=4326&imageSR=4326&size=900,600&format=png&transparent=false&f=image`;

  // Build point rows
  let tableRows = '';
  pts.forEach((pt, i) => {
    const access = ACCESS_TYPES[pt.accessType] || ACCESS_TYPES.any;
    let segDist = '--';
    if (i > 0) {
      const d = haversineDistance(pts[i-1].lat, pts[i-1].lon, pt.lat, pt.lon);
      segDist = formatPrintDist(d);
    }
    tableRows += `<tr>
      <td style="font-weight:bold;color:${access.color}">${i + 1}</td>
      <td><b>${pt.label || 'Point ' + (i+1)}</b></td>
      <td style="font-family:monospace;font-size:10px">${pt.lat.toFixed(6)}, ${pt.lon.toFixed(6)}</td>
      <td><span style="color:${access.color}">${access.icon} ${access.label}</span></td>
      <td>${segDist}</td>
      <td>
        ${pt.hazards ? `<div class="print-hazard">\u26A0\uFE0F ${pt.hazards}</div>` : ''}
        ${pt.landmarks ? `<div class="print-notes">\u{1F3D4}\uFE0F ${pt.landmarks}</div>` : ''}
        ${pt.notes ? `<div style="margin-top:2px">${pt.notes}</div>` : ''}
      </td>
    </tr>`;
  });

  // Build legend for used access types
  const usedAccess = new Set(pts.map(p => p.accessType || 'any'));
  let legendHtml = '';
  for (const [key, val] of Object.entries(ACCESS_TYPES)) {
    if (usedAccess.has(key)) {
      legendHtml += `<div class="print-legend-item"><span style="color:${val.color};font-size:16px">${val.icon}</span> ${val.label}</div>`;
    }
  }
  // Add pin categories if there are nearby waypoints
  const nearWps = mapWaypoints.filter(wp => {
    return wp.lat >= minLat - 0.01 && wp.lat <= maxLat + 0.01 && wp.lon >= minLon - 0.01 && wp.lon <= maxLon + 0.01;
  });
  if (nearWps.length > 0) {
    const usedCats = new Set(nearWps.map(w => w.category));
    for (const cat of usedCats) {
      const p = PIN_PRESETS[cat] || PIN_PRESETS.general;
      legendHtml += `<div class="print-legend-item"><span style="font-size:14px">${p.icon}</span> ${p.label}</div>`;
    }
  }

  const distMiles = (totalDist * 0.000621371).toFixed(2);

  const overlay = document.createElement('div');
  overlay.className = 'print-overlay';
  overlay.innerHTML = `
    <div class="print-no-print" style="text-align:center;margin-bottom:12px">
      <button onclick="window.print()" class="btn" style="display:inline-block;width:auto;padding:10px 30px;background:#1976d2">Print / Save PDF</button>
      <button onclick="this.closest('.print-overlay').remove()" class="btn" style="display:inline-block;width:auto;padding:10px 30px;background:#555;margin-left:8px">Close</button>
    </div>
    <div class="print-map-container">
      <div class="print-header">
        <h1>${route.name}</h1>
        ${route.description ? `<p>${route.description}</p>` : ''}
        <p>Generated ${new Date().toLocaleDateString()} | ${pts.length} waypoints | ${distMiles} miles total</p>
        <p style="font-family:monospace;font-size:11px">Center: ${centerLat}, ${centerLon}</p>
      </div>

      <img class="print-map-img" src="${mapImgUrl}" alt="Route Map" onerror="this.alt='Map image requires internet connection'">

      <div class="print-legend">
        <div class="print-legend-item"><b>Legend:</b></div>
        ${legendHtml}
      </div>

      <h3 style="margin:12px 0 6px;font-size:14px">Route Waypoints</h3>
      <table class="print-point-table">
        <thead><tr><th>#</th><th>Label</th><th>Coordinates</th><th>Access</th><th>Dist</th><th>Notes / Hazards</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>

      ${nearWps.length > 0 ? `
      <h3 style="margin:12px 0 6px;font-size:14px">Nearby Marked Locations (${nearWps.length})</h3>
      <table class="print-point-table">
        <thead><tr><th>Name</th><th>Type</th><th>Coordinates</th><th>Notes</th></tr></thead>
        <tbody>${nearWps.map(wp => {
          const p = PIN_PRESETS[wp.category] || PIN_PRESETS.general;
          return `<tr><td>${wp.name}</td><td>${p.icon} ${p.label}</td><td style="font-family:monospace;font-size:10px">${wp.lat.toFixed(6)}, ${wp.lon.toFixed(6)}</td><td>${wp.notes || ''}</td></tr>`;
        }).join('')}</tbody>
      </table>` : ''}

      <div class="print-footer">
        Field Mapper Route Report | Coordinates: WGS84 (DD) | Distances: Haversine
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
};

function formatPrintDist(meters) {
  const ft = meters * 3.28084;
  if (ft < 1000) return `${ft.toFixed(0)} ft`;
  return `${(meters * 0.000621371).toFixed(2)} mi`;
}

// --- Coordinate parser (same as laptop map.js) ---
function parseCoordinates(input) {
  const s = input.trim();
  if (!s) return null;

  const dd = s.match(/^([+-]?\d+\.?\d*)\s*([NSns])?\s*[,;\s]+\s*([+-]?\d+\.?\d*)\s*([EWew])?$/);
  if (dd) {
    let lat = parseFloat(dd[1]), lon = parseFloat(dd[3]);
    if (dd[2] && dd[2].toUpperCase() === 'S') lat = -Math.abs(lat);
    if (dd[4] && dd[4].toUpperCase() === 'W') lon = -Math.abs(lon);
    if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) return { lat, lon };
  }

  const dd2 = s.match(/^([NSns])\s*(\d+\.?\d*)\s*[,;\s]+\s*([EWew])\s*(\d+\.?\d*)$/);
  if (dd2) {
    let lat = parseFloat(dd2[2]), lon = parseFloat(dd2[4]);
    if (dd2[1].toUpperCase() === 'S') lat = -lat;
    if (dd2[3].toUpperCase() === 'W') lon = -lon;
    if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) return { lat, lon };
  }

  const dms = s.match(/(\d+)[°\s]+(\d+)['\s]+(\d+\.?\d*)["\s]*([NSns])[\s,]+(\d+)[°\s]+(\d+)['\s]+(\d+\.?\d*)["\s]*([EWew])/);
  if (dms) {
    let lat = parseInt(dms[1]) + parseInt(dms[2]) / 60 + parseFloat(dms[3]) / 3600;
    let lon = parseInt(dms[5]) + parseInt(dms[6]) / 60 + parseFloat(dms[7]) / 3600;
    if (dms[4].toUpperCase() === 'S') lat = -lat;
    if (dms[8].toUpperCase() === 'W') lon = -lon;
    if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) return { lat, lon };
  }

  const ddm = s.match(/(\d+)[°\s]+(\d+\.?\d*)['\s]*([NSns])[\s,]+(\d+)[°\s]+(\d+\.?\d*)['\s]*([EWew])/);
  if (ddm) {
    let lat = parseInt(ddm[1]) + parseFloat(ddm[2]) / 60;
    let lon = parseInt(ddm[4]) + parseFloat(ddm[5]) / 60;
    if (ddm[3].toUpperCase() === 'S') lat = -lat;
    if (ddm[6].toUpperCase() === 'W') lon = -lon;
    if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) return { lat, lon };
  }

  const utm = s.match(/^(\d{1,2})\s*([A-Za-z])\s+(\d+\.?\d*)\s+(\d+\.?\d*)$/);
  if (utm) {
    const zone = parseInt(utm[1]), letter = utm[2].toUpperCase();
    const easting = parseFloat(utm[3]), northing = parseFloat(utm[4]);
    if (zone >= 1 && zone <= 60 && easting > 100000 && easting < 900000) {
      const r = utmToLatLon(zone, letter, easting, northing);
      if (r && r.lat >= -90 && r.lat <= 90) return r;
    }
  }
  return null;
}

function utmToLatLon(zone, letter, easting, northing) {
  const isNorth = letter >= 'N';
  const a = 6378137, f = 1/298.257223563, e = Math.sqrt(2*f - f*f), e2 = e*e/(1-e*e), k0 = 0.9996;
  const x = easting - 500000, y = isNorth ? northing : northing - 10000000;
  const M = y / k0, mu = M / (a * (1 - e*e/4 - 3*e*e*e*e/64));
  const e1 = (1 - Math.sqrt(1-e*e)) / (1 + Math.sqrt(1-e*e));
  const phi1 = mu + (3*e1/2 - 27*e1**3/32)*Math.sin(2*mu) + (21*e1*e1/16 - 55*e1**4/32)*Math.sin(4*mu) + (151*e1**3/96)*Math.sin(6*mu);
  const N1 = a / Math.sqrt(1 - e*e*Math.sin(phi1)**2);
  const T1 = Math.tan(phi1)**2, C1 = e2 * Math.cos(phi1)**2;
  const R1 = a * (1-e*e) / (1-e*e*Math.sin(phi1)**2)**1.5;
  const D = x / (N1 * k0);
  const lat = phi1 - (N1*Math.tan(phi1)/R1)*(D*D/2 - (5+3*T1+10*C1-4*C1*C1-9*e2)*D**4/24 + (61+90*T1+298*C1+45*T1*T1-252*e2-3*C1*C1)*D**6/720);
  const lon0 = (zone-1)*6 - 180 + 3;
  const lon = lon0 + (D - (1+2*T1+C1)*D**3/6 + (5-2*C1+28*T1-3*C1*C1+8*e2+24*T1*T1)*D**5/120) / Math.cos(phi1);
  return { lat: lat*180/Math.PI, lon: lon*180/Math.PI };
}
