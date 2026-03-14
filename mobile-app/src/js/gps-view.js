// GPS View - mark locations, capture photos, sync to laptop
// Adapted from gps.html script block to use shared waypoint-store.js

let capturedPos = null;
let waypointCount = 0;
let sampleCount = 0;
let pendingPhotos = [];
let selectedCategory = 'general';
let wsConnected = false;
let ws = null;
let httpGpsInterval = null; // Fallback GPS push via HTTP

async function initGpsView() {
  // Load counts from settings
  waypointCount = (await getSetting('wp-count')) || 0;
  sampleCount = (await getSetting('sample-count')) || 0;
  refreshGpsList();

  // Show server URL status
  const serverUrl = await getSetting('laptopUrl');
  const urlDisplay = document.getElementById('gps-server-url-display');
  if (urlDisplay) {
    if (serverUrl) {
      urlDisplay.innerHTML = `Server: <b>${serverUrl}</b>`;
    } else {
      urlDisplay.textContent = 'No server URL set. Go to Map > Settings to configure.';
    }
  }

  // Try WebSocket to laptop for live GPS streaming
  connectWS();
}

// --- WebSocket to laptop (optional, for live GPS relay) ---
async function connectWS() {
  const serverUrl = await getSetting('laptopUrl');
  if (!serverUrl) return;

  // Close existing connection if any
  if (ws) {
    try { ws.close(); } catch (e) {}
    ws = null;
  }

  try {
    // Convert http(s) URL to ws(s) URL
    let wsUrl = serverUrl;
    if (wsUrl.startsWith('https://')) {
      wsUrl = 'wss://' + wsUrl.substring(8);
    } else if (wsUrl.startsWith('http://')) {
      wsUrl = 'ws://' + wsUrl.substring(7);
    } else {
      wsUrl = 'ws://' + wsUrl;
    }
    // Remove trailing slash
    wsUrl = wsUrl.replace(/\/+$/, '');

    console.log('Connecting WebSocket to:', wsUrl);
    ws = new WebSocket(`${wsUrl}?role=gps`);

    ws.onopen = () => {
      console.log('WebSocket connected to laptop');
      wsConnected = true;
      updateGpsStatus();
      // Send current position immediately if available
      if (currentPosition && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'gps', ...currentPosition }));
      }
    };

    ws.onclose = (e) => {
      console.log('WebSocket disconnected:', e.code, e.reason);
      wsConnected = false;
      ws = null;
      updateGpsStatus();
      // Fall back to HTTP GPS push
      startHttpGpsPush();
      // Try WS reconnect after delay
      setTimeout(connectWS, 15000);
    };

    ws.onerror = (e) => {
      console.error('WebSocket error:', e);
      wsConnected = false;
    };
  } catch (e) {
    console.error('WebSocket connect failed:', e);
    wsConnected = false;
    ws = null;
    // Fall back to HTTP GPS push
    startHttpGpsPush();
    setTimeout(connectWS, 15000);
  }
}

// HTTP GPS push fallback - sends GPS position via HTTP POST every 2 seconds
function startHttpGpsPush() {
  if (httpGpsInterval) return; // Already running

  httpGpsInterval = setInterval(async () => {
    // Stop HTTP push if WebSocket reconnected
    if (wsConnected) {
      clearInterval(httpGpsInterval);
      httpGpsInterval = null;
      return;
    }

    if (!currentPosition) return;

    const serverUrl = await getSetting('laptopUrl');
    if (!serverUrl) return;

    try {
      const resp = await fetch(`${serverUrl}/api/gps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentPosition),
        signal: AbortSignal.timeout(2000)
      });
      if (resp.ok) {
        // Update status to show we're streaming via HTTP
        const el = document.getElementById('gps-status-bar');
        if (el && gpsActive) {
          el.textContent = 'GPS Active - Streaming to Laptop (HTTP)';
          el.className = 'status-bar ok';
        }
      }
    } catch (e) {
      // Silently fail - we'll retry next interval
    }
  }, 2000);
}

function stopHttpGpsPush() {
  if (httpGpsInterval) {
    clearInterval(httpGpsInterval);
    httpGpsInterval = null;
  }
}

function updateGpsStatus() {
  const el = document.getElementById('gps-status-bar');
  if (!el) return;
  if (!gpsActive) {
    el.textContent = 'Waiting for GPS...';
    el.className = 'status-bar warn';
  } else if (wsConnected) {
    el.textContent = 'GPS Active - Connected to Laptop';
    el.className = 'status-bar ok';
  } else {
    el.textContent = 'GPS Active - Standalone';
    el.className = 'status-bar warn';
  }
}

// Called by app.js when GPS position updates
function onGpsUpdate_gpsView(pos) {
  const coordsEl = document.getElementById('gps-coords-text');
  const detailEl = document.getElementById('gps-detail-text');
  if (!coordsEl) return;

  coordsEl.textContent = `${pos.lat.toFixed(6)}, ${pos.lon.toFixed(6)}`;

  let detail = '';
  if (pos.altitude) detail += `Elev: ${(pos.altitude * 3.28084).toFixed(0)} ft | `;
  if (pos.accuracy) detail += `Acc: ${(pos.accuracy * 3.28084).toFixed(0)} ft`;
  if (pos.speed && pos.speed > 0) detail += ` | ${(pos.speed * 2.237).toFixed(1)} mph`;
  detailEl.textContent = detail;

  updateGpsStatus();

  // Stream to laptop if connected
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'gps', ...pos }));
  }
}

function onGpsError_gpsView(err) {
  const el = document.getElementById('gps-status-bar');
  if (el) {
    el.textContent = `GPS Error: ${err.message}`;
    el.className = 'status-bar error';
  }
}

// --- Category selection ---
window.selectCat = function(el) {
  document.querySelectorAll('#mark-overlay .cat-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  selectedCategory = el.dataset.cat;
  const sf = document.getElementById('sample-fields');
  if (sf) sf.style.display = selectedCategory === 'sample' ? 'block' : 'none';
};

// --- Mark form ---
window.openMarkForm = function() {
  if (!currentPosition) { alert('Waiting for GPS fix...'); return; }

  capturedPos = { ...currentPosition };
  waypointCount++;

  const posText = `${capturedPos.lat.toFixed(6)}, ${capturedPos.lon.toFixed(6)}` +
    (capturedPos.altitude ? ` | ${(capturedPos.altitude * 3.28084).toFixed(0)} ft` : '') +
    (capturedPos.accuracy ? ` | Acc: ${(capturedPos.accuracy * 3.28084).toFixed(0)} ft` : '');

  document.getElementById('captured-pos').textContent = posText;
  document.getElementById('wp-title').value = `WP-${waypointCount}`;
  document.getElementById('wp-notes').value = '';
  pendingPhotos = [];
  renderPhotoStrip();

  if (selectedCategory === 'sample') {
    sampleCount++;
    document.getElementById('sample-id').value = `S-${String(sampleCount).padStart(3, '0')}`;
  }

  document.getElementById('mark-overlay').classList.add('active');
  setTimeout(() => document.getElementById('wp-title').focus(), 100);
};

window.closeMarkForm = function() {
  document.getElementById('mark-overlay').classList.remove('active');
  pendingPhotos = [];
};

// --- Photos ---
window.takePhoto = function() {
  document.getElementById('photo-input').click();
};

document.addEventListener('DOMContentLoaded', () => {
  const photoInput = document.getElementById('photo-input');
  if (photoInput) {
    photoInput.addEventListener('change', (e) => {
      for (const file of e.target.files) processPhoto(file);
      e.target.value = '';
    });
  }
});

function processPhoto(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
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
      pendingPhotos.push(canvas.toDataURL('image/jpeg', 0.8));
      renderPhotoStrip();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function renderPhotoStrip() {
  const strip = document.getElementById('photo-strip');
  if (!strip) return;
  strip.innerHTML = '';
  pendingPhotos.forEach((dataUrl, i) => {
    strip.innerHTML += `<div class="photo-preview"><img src="${dataUrl}"><button onclick="removePhoto(${i})" style="position:absolute;top:0;right:0;background:red;color:#fff;border:none;border-radius:50%;width:20px;height:20px;font-size:12px;cursor:pointer">X</button></div>`;
  });
}

window.removePhoto = function(i) {
  pendingPhotos.splice(i, 1);
  renderPhotoStrip();
};

// --- Save waypoint ---
window.saveGpsWaypoint = async function() {
  if (!capturedPos) return;

  const title = document.getElementById('wp-title').value.trim() || `WP-${waypointCount}`;
  const notes = document.getElementById('wp-notes').value.trim();
  const wpId = Date.now();

  const wp = {
    id: wpId,
    lat: capturedPos.lat,
    lon: capturedPos.lon,
    altitude: capturedPos.altitude,
    accuracy: capturedPos.accuracy,
    speed: capturedPos.speed,
    heading: capturedPos.heading,
    name: title,
    category: selectedCategory,
    notes: notes,
    timestamp: new Date().toISOString(),
    photoCount: pendingPhotos.length,
    synced: false,
    device: {
      userAgent: navigator.userAgent,
      platform: navigator.platform
    }
  };

  if (selectedCategory === 'sample') {
    wp.samples = [{
      id: document.getElementById('sample-id').value,
      type: document.getElementById('sample-type').value,
      rockType: document.getElementById('rock-type').value,
      mineralization: document.getElementById('mineralization').value,
      alteration: document.getElementById('alteration').value,
      description: notes
    }];
  }

  // Save photos to IndexedDB
  for (let i = 0; i < pendingPhotos.length; i++) {
    await savePhoto(wpId, i, pendingPhotos[i]);
  }

  // Save waypoint
  await saveWaypoint(wp);
  await saveSetting('wp-count', waypointCount);
  if (selectedCategory === 'sample') await saveSetting('sample-count', sampleCount);

  if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

  const toast = document.getElementById('saving-toast');
  toast.textContent = `Saved: ${title}`;
  toast.style.display = 'block';
  setTimeout(() => toast.style.display = 'none', 1500);

  closeMarkForm();
  refreshGpsList();
};

// --- List ---
async function refreshGpsList() {
  const list = document.getElementById('gps-recent-list');
  if (!list) return;

  const allWps = await getAllWaypoints();
  document.getElementById('gps-total-count').textContent = allWps.length;

  const unsynced = allWps.filter(w => !w.synced).length;
  document.getElementById('gps-unsynced-count').textContent =
    unsynced === 0 ? 'All synced' : `${unsynced} unsynced`;

  list.innerHTML = '';
  const recent = allWps.slice(-30).reverse();
  recent.forEach(wp => {
    const preset = PIN_PRESETS[wp.category] || PIN_PRESETS.general;
    const syncBadge = wp.synced
      ? '<span class="recent-badge synced">synced</span>'
      : '<span class="recent-badge">not synced</span>';
    const photoInfo = wp.photoCount > 0 ? ` | ${wp.photoCount} photo${wp.photoCount > 1 ? 's' : ''}` : '';

    const div = document.createElement('div');
    div.className = 'recent-item';
    div.style.cursor = 'pointer';
    div.innerHTML = `
      <div class="recent-dot" style="background:${preset.color}">${preset.icon}</div>
      <div class="recent-info">
        <div class="recent-name">${wp.name} ${syncBadge}</div>
        <div class="recent-detail">${wp.lat.toFixed(6)}, ${wp.lon.toFixed(6)} | ${new Date(wp.timestamp).toLocaleTimeString()}${photoInfo}</div>
        ${wp.notes ? `<div class="recent-detail">${wp.notes.substring(0, 100)}${wp.notes.length > 100 ? '...' : ''}</div>` : ''}
      </div>
    `;
    div.addEventListener('click', () => showWaypointDetail(wp.id));
    list.appendChild(div);
  });
}

// --- Sync ---
window.doSync = async function() {
  const btn = document.getElementById('gps-sync-btn');
  const statusEl = document.getElementById('gps-sync-status');
  const barEl = document.getElementById('gps-sync-bar');
  const progressEl = document.getElementById('gps-sync-progress');

  btn.disabled = true;
  btn.textContent = 'Syncing...';
  progressEl.style.display = 'block';

  try {
    const result = await syncToLaptop((done, total, synced, errors) => {
      const pct = (done / total * 100).toFixed(0);
      barEl.style.width = pct + '%';
      statusEl.textContent = `Syncing: ${done}/${total}...`;
    });

    let msg = '';
    if (result.synced > 0) msg += `Pushed ${result.synced} wp. `;
    if (result.pulled > 0) msg += `Pulled ${result.pulled} wp. `;
    if (result.routesPushed > 0) msg += `${result.routesPushed} routes pushed. `;
    if (result.routesPulled > 0) msg += `${result.routesPulled} routes pulled. `;
    if (result.tracksPushed > 0) msg += `${result.tracksPushed} tracks pushed. `;
    if (result.tracksPulled > 0) msg += `${result.tracksPulled} tracks pulled. `;
    if (result.errors > 0) msg += `${result.errors} failed. `;
    if (!msg) msg = 'Everything up to date!';
    statusEl.textContent = msg.trim();
    statusEl.style.color = result.errors > 0 ? '#f44336' : '#4caf50';

    // Reconnect WebSocket after sync
    connectWS();
  } catch (e) {
    statusEl.textContent = e.message;
    statusEl.style.color = '#f44336';
  }

  btn.disabled = false;
  btn.textContent = 'Sync to Laptop';
  refreshGpsList();

  // Update server URL display
  const serverUrl = await getSetting('laptopUrl');
  const urlDisplay = document.getElementById('gps-server-url-display');
  if (urlDisplay && serverUrl) {
    urlDisplay.innerHTML = `Server: <b>${serverUrl}</b>`;
  }
};

// --- Waypoint detail view (from GPS list) ---
async function showWaypointDetail(id) {
  const wp = await getWaypoint(id);
  if (!wp) return;

  const photos = await getPhotos(wp.id);
  const preset = PIN_PRESETS[wp.category] || PIN_PRESETS.general;

  let photoHtml = '';
  if (photos.length > 0) {
    photoHtml = `<div style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0">`;
    photos.forEach((p, i) => {
      photoHtml += `<img src="${p.dataUrl}" onclick="showFullPhoto('${wp.id}', ${i})" style="width:90px;height:90px;object-fit:cover;border-radius:6px;border:1px solid #444;cursor:pointer">`;
    });
    photoHtml += `</div>`;
  }

  let sampleHtml = '';
  if (wp.samples && wp.samples.length > 0) {
    const s = wp.samples[0];
    sampleHtml = `<div style="margin:8px 0;padding:8px;background:#2a2a2a;border-radius:6px;font-size:13px">
      <b>Sample ${s.id}</b> (${s.type})
      ${s.rockType ? `<br>Rock: ${s.rockType}` : ''}
      ${s.mineralization ? `<br>Mineralization: ${s.mineralization}` : ''}
      ${s.alteration ? `<br>Alteration: ${s.alteration}` : ''}
    </div>`;
  }

  const overlay = document.createElement('div');
  overlay.id = 'wp-detail-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:6000;background:#1a1a1a;overflow-y:auto;padding:12px;padding-bottom:80px';
  overlay.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <h2 style="font-size:18px">${wp.name}</h2>
      <button onclick="document.getElementById('wp-detail-overlay').remove()" style="background:#555;color:#fff;border:none;border-radius:6px;padding:8px 14px;font-size:14px">Back</button>
    </div>
    <div style="font-size:14px;color:#1976d2;margin-bottom:6px">${preset.icon} ${preset.label}</div>
    <div style="font-family:monospace;font-size:14px;margin-bottom:6px">${wp.lat.toFixed(6)}, ${wp.lon.toFixed(6)}</div>
    ${wp.altitude ? `<div style="font-size:13px;color:#aaa">Elev: ${(wp.altitude * 3.28084).toFixed(0)} ft${wp.accuracy ? ` | Acc: ${(wp.accuracy * 3.28084).toFixed(0)} ft` : ''}</div>` : ''}
    <div style="font-size:12px;color:#888;margin:4px 0">${new Date(wp.timestamp).toLocaleString()}</div>
    <div style="font-size:12px;margin:4px 0">${wp.synced ? '<span style="color:#4caf50">Synced</span>' : '<span style="color:#e65100">Not synced</span>'}</div>
    ${wp.notes ? `<div style="margin:10px 0;font-size:14px;line-height:1.5;padding:8px;background:#222;border-radius:6px">${wp.notes}</div>` : ''}
    ${sampleHtml}
    <h3 style="font-size:15px;margin:10px 0 6px">Photos (${photos.length})</h3>
    ${photoHtml}
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn btn-photo" onclick="showEditWaypoint(${wp.id}); document.getElementById('wp-detail-overlay').remove();" style="flex:1">Edit</button>
      <button class="btn" style="flex:1;background:#7b1fa2" onclick="showAddPhotosQuick(${wp.id})">Add Photos</button>
    </div>
    <div style="margin-top:12px">
      <button class="btn" style="width:100%;background:#d32f2f" onclick="deleteWaypointFromGps(${wp.id})">Delete Waypoint</button>
    </div>
  `;
  document.body.appendChild(overlay);
}

// Quick add photos without full edit form
window.showAddPhotosQuick = function(id) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.capture = 'environment';
  input.multiple = true;
  input.style.display = 'none';
  document.body.appendChild(input);

  input.addEventListener('change', async (e) => {
    const wp = await getWaypoint(id);
    if (!wp) return;
    const existingPhotos = await getPhotos(id);
    let nextIndex = existingPhotos.length;

    for (const file of e.target.files) {
      const dataUrl = await resizePhoto(file);
      await savePhoto(id, nextIndex++, dataUrl);
    }

    wp.photoCount = nextIndex;
    wp.synced = false;
    await saveWaypoint(wp);

    input.remove();

    // Refresh detail view if open
    const detailOverlay = document.getElementById('wp-detail-overlay');
    if (detailOverlay) {
      detailOverlay.remove();
      showWaypointDetail(id);
    }
    refreshGpsList();
  });

  input.click();
};

function resizePhoto(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
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
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// --- Delete waypoint from GPS view ---
window.deleteWaypointFromGps = async function(id) {
  if (!confirm('Delete this waypoint and all its photos?')) return;
  await deleteWaypoint(id);
  const detailOverlay = document.getElementById('wp-detail-overlay');
  if (detailOverlay) detailOverlay.remove();
  refreshGpsList();
  // Also refresh map pins if map view is loaded
  if (typeof loadMapWaypoints === 'function') {
    try { loadMapWaypoints(); } catch (e) {}
  }
};

// --- Export ---
window.exportAllDataMobile = async function() {
  const allWps = await getAllWaypoints();
  const data = { waypoints: allWps, exportDate: new Date().toISOString(), device: 'mobile-app' };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `field-data-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
};
