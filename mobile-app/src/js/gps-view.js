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
let wsReconnectDelay = 1000; // Exponential backoff (Phase 5A)

async function initGpsView() {
  // Load counts from settings
  waypointCount = (await getSetting('wp-count')) || 0;
  sampleCount = (await getSetting('sample-count')) || 0;
  refreshGpsList();
  updateLastSyncDisplay();

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
      wsReconnectDelay = 1000; // Reset on successful connection (Phase 5A)
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
      // Exponential backoff reconnect (Phase 5A)
      console.log(`WebSocket reconnecting in ${wsReconnectDelay / 1000}s`);
      setTimeout(connectWS, wsReconnectDelay);
      wsReconnectDelay = Math.min(wsReconnectDelay * 2, 60000);
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
    setTimeout(connectWS, wsReconnectDelay);
    wsReconnectDelay = Math.min(wsReconnectDelay * 2, 60000);
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

  // Store form state for undo
  const undoData = {
    wpId: wpId,
    title: title,
    notes: notes,
    category: selectedCategory,
    photoCount: pendingPhotos.length
  };

  closeMarkForm();
  refreshGpsList();

  // Show undo toast
  const toast = document.getElementById('saving-toast');
  toast.innerHTML = `Saved: ${title} <button id="undo-save-btn" style="margin-left:10px;padding:2px 10px;background:#fff;color:#333;border:none;border-radius:4px;font-weight:bold;cursor:pointer">Undo</button>`;
  toast.style.display = 'block';

  const undoTimeout = setTimeout(() => {
    toast.style.display = 'none';
    toast.innerHTML = 'Saved!';
  }, 5000);

  document.getElementById('undo-save-btn').addEventListener('click', async () => {
    clearTimeout(undoTimeout);
    toast.style.display = 'none';
    toast.innerHTML = 'Saved!';

    // Delete the just-saved waypoint and its photos
    await deleteWaypoint(undoData.wpId);
    for (let i = 0; i < undoData.photoCount; i++) {
      try { await deletePhoto(`${undoData.wpId}-${i}`); } catch (e) {}
    }

    waypointCount--;
    await saveSetting('wp-count', waypointCount);
    if (undoData.category === 'sample') {
      sampleCount--;
      await saveSetting('sample-count', sampleCount);
    }

    refreshGpsList();

    // Restore the mark form with previous values
    if (currentPosition) {
      capturedPos = { ...currentPosition };
      const posText = `${capturedPos.lat.toFixed(6)}, ${capturedPos.lon.toFixed(6)}` +
        (capturedPos.altitude ? ` | ${(capturedPos.altitude * 3.28084).toFixed(0)} ft` : '') +
        (capturedPos.accuracy ? ` | Acc: ${(capturedPos.accuracy * 3.28084).toFixed(0)} ft` : '');
      document.getElementById('captured-pos').textContent = posText;
    }
    document.getElementById('wp-title').value = undoData.title;
    document.getElementById('wp-notes').value = undoData.notes;
    pendingPhotos = [];
    renderPhotoStrip();
    document.getElementById('mark-overlay').classList.add('active');

    if (typeof loadMapWaypoints === 'function') {
      try { loadMapWaypoints(); } catch (e) {}
    }
  });
};

// --- Search/filter ---
window.filterGpsList = function() {
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
  let recent = allWps.slice(-30).reverse();

  // Apply search filter
  const searchInput = document.getElementById('gps-search-input');
  if (searchInput && searchInput.value.trim()) {
    const q = searchInput.value.trim().toLowerCase();
    recent = allWps.filter(wp => {
      const name = (wp.name || '').toLowerCase();
      const category = (wp.category || '').toLowerCase();
      const notes = (wp.notes || '').toLowerCase();
      return name.includes(q) || category.includes(q) || notes.includes(q);
    }).reverse();
  }

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
    const sent = result.pushedCreated + result.pushedUpdated;
    const recv = result.pulledCreated + result.pulledUpdated;
    const delsApplied = result.pushedDeleted + result.pulledDeleted;
    if (sent > 0) msg += `Sent ${sent} (${result.pushedCreated} new, ${result.pushedUpdated} updated). `;
    if (recv > 0) msg += `Received ${recv} (${result.pulledCreated} new, ${result.pulledUpdated} updated). `;
    if (delsApplied > 0) msg += `${delsApplied} deletion${delsApplied > 1 ? 's' : ''} synced. `;
    if (result.tracksPushed > 0) msg += `${result.tracksPushed} tracks sent. `;
    if (result.tracksPulled > 0) msg += `${result.tracksPulled} tracks received. `;
    if (result.errors > 0) msg += `${result.errors} failed. `;
    if (!msg) msg = 'Everything up to date!';
    statusEl.textContent = msg.trim();
    statusEl.style.color = result.errors > 0 ? '#f44336' : '#4caf50';

    // Save last sync timestamp
    await saveSetting('last-sync-time', Date.now());
    updateLastSyncDisplay();

    // Reconnect WebSocket after sync
    connectWS();
  } catch (e) {
    statusEl.textContent = e.message;
    statusEl.style.color = '#f44336';
  }

  btn.disabled = false;
  btn.textContent = 'Sync to Laptop';
  refreshGpsList();
  if (typeof catalogInitialized !== 'undefined' && catalogInitialized && typeof refreshCatalog === 'function') {
    try { refreshCatalog(); } catch (e) {}
  }

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
    <div data-ai-tool style="margin-top:14px">
      <button id="ai-analyze-btn" class="btn" style="width:100%;background:#1565c0" onclick="triggerAIAnalysis(${wp.id}, false)">AI Analysis</button>
      <div id="ai-result-container" style="display:none;margin-top:10px">
        <div id="ai-result-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span style="font-size:14px;font-weight:bold">AI Analysis <span id="ai-cached-badge" style="display:none;font-size:11px;color:#ffa726;font-weight:normal;margin-left:6px">(cached)</span></span>
          <button id="ai-refresh-btn" style="display:none;background:#1565c0;color:#fff;border:none;border-radius:4px;padding:4px 10px;font-size:12px;cursor:pointer" onclick="triggerAIAnalysis(${wp.id}, true)">Refresh</button>
        </div>
        <div id="ai-cached-time" style="display:none;font-size:11px;color:#888;margin-bottom:6px"></div>
        <div id="ai-result-text" style="font-size:13px;line-height:1.6;padding:10px;background:#222;border-radius:6px;white-space:pre-wrap"></div>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn btn-photo" onclick="showEditWaypoint(${wp.id}); document.getElementById('wp-detail-overlay').remove();" style="flex:1">Edit</button>
      <button class="btn" style="flex:1;background:#7b1fa2" onclick="showAddPhotosQuick(${wp.id})">Add Photos</button>
    </div>
    <div style="margin-top:12px">
      <button class="btn" style="width:100%;background:#d32f2f" onclick="deleteWaypointFromGps(${wp.id})">Delete Waypoint</button>
    </div>
  `;
  document.body.appendChild(overlay);

  // Confirm laptop readiness before revealing cached AI content.
  AiSettings.refresh();
  getAIResult(wp.id).then(function(cached) {
    if (cached && cached.analysis) {
      var container = document.getElementById('ai-result-container');
      var resultText = document.getElementById('ai-result-text');
      var cachedBadge = document.getElementById('ai-cached-badge');
      var refreshBtn = document.getElementById('ai-refresh-btn');
      var cachedTimeEl = document.getElementById('ai-cached-time');
      if (container && resultText) {
        container.style.display = 'block';
        resultText.textContent = cached.analysis;
        cachedBadge.style.display = 'inline';
        refreshBtn.style.display = 'inline-block';
        if (cached.cachedAt) {
          cachedTimeEl.style.display = 'block';
          cachedTimeEl.textContent = 'Cached: ' + new Date(cached.cachedAt).toLocaleString();
        }
      }
    }
  }).catch(function() {});
}

// --- AI Analysis trigger ---
window.triggerAIAnalysis = async function(waypointId, forceRefresh) {
  try { await AiSettings.requireReady(); } catch (e) { await AiSettings.open(); return; }
  var btn = document.getElementById('ai-analyze-btn');
  var container = document.getElementById('ai-result-container');
  var resultText = document.getElementById('ai-result-text');
  var cachedBadge = document.getElementById('ai-cached-badge');
  var refreshBtn = document.getElementById('ai-refresh-btn');
  var cachedTime = document.getElementById('ai-cached-time');

  if (!btn || !container) return;

  btn.disabled = true;
  btn.textContent = forceRefresh ? 'Refreshing...' : 'Analyzing...';
  container.style.display = 'block';
  resultText.textContent = 'Running AI analysis...';
  cachedBadge.style.display = 'none';
  refreshBtn.style.display = 'none';
  cachedTime.style.display = 'none';

  try {
    var result = await runAIAnalysis(waypointId, forceRefresh);
    if (result.error) {
      resultText.textContent = 'Error: ' + result.error;
    } else {
      resultText.textContent = result.analysis || 'No analysis returned.';

      if (result.fromCache) {
        cachedBadge.style.display = 'inline';
        refreshBtn.style.display = 'inline-block';
        if (result.cachedAt) {
          cachedTime.style.display = 'block';
          cachedTime.textContent = 'Cached: ' + new Date(result.cachedAt).toLocaleString();
        }
      } else {
        cachedBadge.style.display = 'none';
        refreshBtn.style.display = 'inline-block';
        cachedTime.style.display = 'none';
      }
    }
  } catch (e) {
    resultText.textContent = 'Error: ' + e.message;
  }

  btn.disabled = false;
  btn.textContent = 'AI Analysis';
};

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
    // Invalidate AI cache when photos added (Phase 5E)
    if (typeof invalidateAICache === 'function') invalidateAICache(id);

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

// --- Last sync display ---
async function updateLastSyncDisplay() {
  const el = document.getElementById('gps-last-sync');
  if (!el) return;
  const ts = await getSetting('last-sync-time');
  if (!ts) {
    el.textContent = 'Never synced';
    return;
  }
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) el.textContent = 'Last sync: just now';
  else if (mins < 60) el.textContent = `Last sync: ${mins} minute${mins > 1 ? 's' : ''} ago`;
  else {
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) el.textContent = `Last sync: ${hrs} hour${hrs > 1 ? 's' : ''} ago`;
    else el.textContent = `Last sync: ${Math.floor(hrs / 24)} day${Math.floor(hrs / 24) > 1 ? 's' : ''} ago`;
  }
}
