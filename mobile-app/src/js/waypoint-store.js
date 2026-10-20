// Unified waypoint + photo storage using IndexedDB
const WP_DB_NAME = 'fieldmapper-data';
const WP_DB_VERSION = 7;

let wpDB = null;

function openWpDB() {
  return new Promise((resolve, reject) => {
    if (wpDB) { resolve(wpDB); return; }
    const req = indexedDB.open(WP_DB_NAME, WP_DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      // Sharing metadata is additive; field records and the established storage origin stay in place.
      if (!db.objectStoreNames.contains('sharing')) db.createObjectStore('sharing', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('waypoints')) {
        const store = db.createObjectStore('waypoints', { keyPath: 'id' });
        store.createIndex('synced', 'synced', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
      if (!db.objectStoreNames.contains('photos')) {
        db.createObjectStore('photos', { keyPath: 'id' });
      }
      const photos = e.target.transaction.objectStore('photos');
      if (!photos.indexNames.contains('waypointId')) photos.createIndex('waypointId', 'waypointId', { unique: false });
      if (!db.objectStoreNames.contains('track')) {
        db.createObjectStore('track', { autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings');
      }
      if (!db.objectStoreNames.contains('routes')) {
        db.createObjectStore('routes', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('measurements')) {
        db.createObjectStore('measurements', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('trackSessions')) {
        db.createObjectStore('trackSessions', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('ai-cache')) {
        db.createObjectStore('ai-cache');
      }
      // v5: rock-business catalog (specimens taken home) + dig orders.
      // Additive only — existing stores above are never touched.
      if (!db.objectStoreNames.contains('specimens')) {
        const sp = db.createObjectStore('specimens', { keyPath: 'id' });
        sp.createIndex('synced', 'synced', { unique: false });
        sp.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('digOrders')) {
        const dg = db.createObjectStore('digOrders', { keyPath: 'id' });
        dg.createIndex('synced', 'synced', { unique: false });
        dg.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      // v6: sales orders (customer + payment + line items). Additive only.
      if (!db.objectStoreNames.contains('orders')) {
        const or = db.createObjectStore('orders', { keyPath: 'id' });
        or.createIndex('synced', 'synced', { unique: false });
        or.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };
    req.onsuccess = (e) => { wpDB = e.target.result; resolve(wpDB); };
    req.onerror = (e) => reject(e.target.error);
  });
}

// --- Waypoints ---
// Save convention used across all synced record types:
//   local write (default)  -> synced=false, updatedAt bumped to now (so the edit propagates)
//   opts.fromSync === true -> synced=true, incoming updatedAt preserved (it's the server's)
async function saveWaypoint(wp, opts) {
  await openWpDB();
  const fromSync = opts && opts.fromSync;
  // fromSync preserves the server's updatedAt exactly (do NOT mint a fresh one, or a
  // legacy record lacking updatedAt would look "newer" than the server and bounce back).
  if (fromSync) { wp.synced = true; }
  else { wp.synced = false; wp.updatedAt = Date.now(); }
  return new Promise((resolve, reject) => {
    const tx = wpDB.transaction('waypoints', 'readwrite');
    tx.objectStore('waypoints').put(wp);
    tx.oncomplete = () => resolve(wp);
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllWaypoints() {
  await openWpDB();
  return new Promise((resolve) => {
    const tx = wpDB.transaction('waypoints', 'readonly');
    const req = tx.objectStore('waypoints').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

async function getWaypoint(id) {
  await openWpDB();
  return new Promise((resolve) => {
    const tx = wpDB.transaction('waypoints', 'readonly');
    const req = tx.objectStore('waypoints').get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

async function deleteWaypoint(id, opts) {
  await openWpDB();
  // Delete waypoint
  await new Promise((resolve) => {
    const tx = wpDB.transaction('waypoints', 'readwrite');
    tx.objectStore('waypoints').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  // Delete associated photos
  const photos = await getPhotos(id);
  if (photos.length > 0) {
    const tx = wpDB.transaction('photos', 'readwrite');
    photos.forEach(p => tx.objectStore('photos').delete(p.id));
  }
  // Record a tombstone so the delete propagates on the next sync.
  await setLocalTombstone('waypoints', id, (opts && opts.deletedAt) || Date.now());
}

async function getUnsyncedWaypoints() {
  await openWpDB();
  return new Promise((resolve) => {
    const tx = wpDB.transaction('waypoints', 'readonly');
    const req = tx.objectStore('waypoints').getAll();
    req.onsuccess = () => resolve((req.result || []).filter(wp => !wp.synced));
    req.onerror = () => resolve([]);
  });
}

async function markSynced(id, updatedAt) {
  await openWpDB();
  const wp = await getWaypoint(id);
  if (wp) {
    wp.synced = true; // raw put — preserve updatedAt (now matches the server)
    if (updatedAt != null) wp.updatedAt = updatedAt; // persist the value we pushed
    await new Promise((resolve, reject) => {
      const tx = wpDB.transaction('waypoints', 'readwrite');
      tx.objectStore('waypoints').put(wp);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

// --- Photos ---
async function savePhoto(waypointId, index, dataUrl) {
  await openWpDB();
  const id = `${waypointId}-${index}`;
  return new Promise((resolve) => {
    const tx = wpDB.transaction('photos', 'readwrite');
    tx.objectStore('photos').put({ id, waypointId, index, dataUrl });
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

async function getPhotos(waypointId) {
  await openWpDB();
  return new Promise((resolve) => {
    const tx = wpDB.transaction('photos', 'readonly');
    const req = tx.objectStore('photos').getAll();
    req.onsuccess = () => {
      const all = req.result || [];
      resolve(all.filter(p => p.waypointId === waypointId));
    };
    req.onerror = () => resolve([]);
  });
}

async function deletePhoto(photoId) {
  await openWpDB();
  return new Promise((resolve) => {
    const tx = wpDB.transaction('photos', 'readwrite');
    tx.objectStore('photos').delete(photoId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

// --- Route Photos ---
// Store route point photos in IndexedDB, keyed by a unique ID.
// The route point's photos array stores only these IDs (strings like "rp_<routeId>_<ptIdx>_<ts>").
async function saveRoutePhoto(photoId, dataUrl) {
  await openWpDB();
  return new Promise((resolve, reject) => {
    const tx = wpDB.transaction('photos', 'readwrite');
    tx.objectStore('photos').put({ id: photoId, waypointId: '__route__', dataUrl });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getRoutePhoto(photoId) {
  await openWpDB();
  return new Promise((resolve) => {
    const tx = wpDB.transaction('photos', 'readonly');
    const req = tx.objectStore('photos').get(photoId);
    req.onsuccess = () => resolve(req.result ? req.result.dataUrl : null);
    req.onerror = () => resolve(null);
  });
}

async function deleteRoutePhoto(photoId) {
  await openWpDB();
  return new Promise((resolve) => {
    const tx = wpDB.transaction('photos', 'readwrite');
    tx.objectStore('photos').delete(photoId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

/**
 * Check if a photo reference is a direct data URL or http URL (legacy/backward compat)
 * vs an IndexedDB reference ID.
 */
function isInlinePhotoUrl(ref) {
  return typeof ref === 'string' && (ref.startsWith('data:') || ref.startsWith('http'));
}

/**
 * Resolve a photo reference to a displayable URL.
 * If it's already a data URL or http URL, return it as-is.
 * Otherwise fetch from IndexedDB.
 */
async function resolveRoutePhoto(ref) {
  if (isInlinePhotoUrl(ref)) return ref;
  const dataUrl = await getRoutePhoto(ref);
  return dataUrl || '';
}

// --- Track ---
async function saveTrackPoint(point) {
  await openWpDB();
  return new Promise((resolve) => {
    const tx = wpDB.transaction('track', 'readwrite');
    tx.objectStore('track').add(point);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

async function getTrack() {
  await openWpDB();
  return new Promise((resolve) => {
    const tx = wpDB.transaction('track', 'readonly');
    const req = tx.objectStore('track').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

async function clearTrack() {
  await openWpDB();
  return new Promise((resolve) => {
    const tx = wpDB.transaction('track', 'readwrite');
    tx.objectStore('track').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

// --- Settings ---
async function saveSetting(key, value) {
  await openWpDB();
  return new Promise((resolve) => {
    const tx = wpDB.transaction('settings', 'readwrite');
    tx.objectStore('settings').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

async function getSetting(key) {
  await openWpDB();
  return new Promise((resolve) => {
    const tx = wpDB.transaction('settings', 'readonly');
    const req = tx.objectStore('settings').get(key);
    req.onsuccess = () => resolve(req.result !== undefined ? req.result : null);
    req.onerror = () => resolve(null);
  });
}

// --- Routes ---
async function saveRoute(route, opts) {
  await openWpDB();
  const fromSync = opts && opts.fromSync;
  if (fromSync) { route.synced = true; }
  else { route.synced = false; route.updatedAt = Date.now(); }
  return new Promise((resolve, reject) => {
    const tx = wpDB.transaction('routes', 'readwrite');
    tx.objectStore('routes').put(route);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function markRouteSynced(id, updatedAt) {
  await openWpDB();
  const r = await getRoute(id);
  if (r) {
    r.synced = true;
    if (updatedAt != null) r.updatedAt = updatedAt;
    await new Promise((resolve, reject) => {
      const tx = wpDB.transaction('routes', 'readwrite');
      tx.objectStore('routes').put(r);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
async function getAllRoutes() {
  await openWpDB();
  return new Promise((resolve) => {
    const tx = wpDB.transaction('routes', 'readonly');
    const req = tx.objectStore('routes').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}
async function getRoute(id) {
  await openWpDB();
  return new Promise((resolve) => {
    const tx = wpDB.transaction('routes', 'readonly');
    const req = tx.objectStore('routes').get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}
async function deleteRoute(id, opts) {
  await openWpDB();
  // Clean up photos from all route points (Phase 3C)
  const route = await getRoute(id);
  if (route && route.points) {
    for (const pt of route.points) {
      if (pt.photos && pt.photos.length > 0) {
        for (const ref of pt.photos) {
          if (!isInlinePhotoUrl(ref)) {
            try { await deleteRoutePhoto(ref); } catch (e) {}
          }
        }
      }
    }
  }
  await new Promise((resolve) => {
    const tx = wpDB.transaction('routes', 'readwrite');
    tx.objectStore('routes').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  await setLocalTombstone('routes', id, (opts && opts.deletedAt) || Date.now());
}

// --- Measurements ---
async function saveMeasurement(m) {
  await openWpDB();
  return new Promise((resolve) => {
    const tx = wpDB.transaction('measurements', 'readwrite');
    tx.objectStore('measurements').put(m);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}
async function getAllMeasurements() {
  await openWpDB();
  return new Promise((resolve) => {
    const tx = wpDB.transaction('measurements', 'readonly');
    const req = tx.objectStore('measurements').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}
async function deleteMeasurement(id) {
  await openWpDB();
  return new Promise((resolve) => {
    const tx = wpDB.transaction('measurements', 'readwrite');
    tx.objectStore('measurements').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

// --- Track Sessions ---
async function saveTrackSession(session) {
  await openWpDB();
  return new Promise((resolve, reject) => {
    const tx = wpDB.transaction('trackSessions', 'readwrite');
    tx.objectStore('trackSessions').put(session);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function getAllTrackSessions() {
  await openWpDB();
  return new Promise((resolve) => {
    const tx = wpDB.transaction('trackSessions', 'readonly');
    const req = tx.objectStore('trackSessions').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}
async function deleteTrackSession(id) {
  await openWpDB();
  return new Promise((resolve) => {
    const tx = wpDB.transaction('trackSessions', 'readwrite');
    tx.objectStore('trackSessions').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

// --- AI Analysis Cache ---
async function saveAIResult(waypointId, result) {
  await openWpDB();
  var key = String(waypointId);
  var entry = {
    analysis: result.analysis,
    cachedAt: Date.now()
  };
  return new Promise(function(resolve) {
    var tx = wpDB.transaction('ai-cache', 'readwrite');
    tx.objectStore('ai-cache').put(entry, key);
    tx.oncomplete = function() { resolve(); };
    tx.onerror = function() { resolve(); };
  });
}

// Invalidate cached AI analysis (Phase 5E — called when waypoint is edited or photos added)
async function invalidateAICache(waypointId) {
  await openWpDB();
  var key = String(waypointId);
  return new Promise(function(resolve) {
    var tx = wpDB.transaction('ai-cache', 'readwrite');
    tx.objectStore('ai-cache').delete(key);
    tx.oncomplete = function() { resolve(); };
    tx.onerror = function() { resolve(); };
  });
}

async function getAIResult(waypointId) {
  await openWpDB();
  var key = String(waypointId);
  return new Promise(function(resolve) {
    var tx = wpDB.transaction('ai-cache', 'readonly');
    var req = tx.objectStore('ai-cache').get(key);
    req.onsuccess = function() { resolve(req.result || null); };
    req.onerror = function() { resolve(null); };
  });
}

// =====================================================================
// CATALOG: specimens (rocks taken home for the business) + dig orders
// Mirrors the route storage pattern. Photos reuse the shared `photos`
// store via the route-photo helpers (resolveRoutePhoto/deleteRoutePhoto),
// with a distinct `sp_`/`do_` ref prefix so they never collide with
// waypoint (`<id>-<i>`) or route (`rp_`) photo keys.
// =====================================================================

// --- Specimens ---
async function saveSpecimen(sp, opts) {
  await openWpDB();
  const fromSync = opts && opts.fromSync;
  if (!sp.createdAt) sp.createdAt = Date.now();
  if (fromSync) { sp.synced = true; }
  else { sp.synced = false; sp.updatedAt = Date.now(); }
  return new Promise((resolve, reject) => {
    const tx = wpDB.transaction('specimens', 'readwrite');
    tx.objectStore('specimens').put(sp);
    tx.oncomplete = () => resolve(sp);
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllSpecimens() {
  await openWpDB();
  return new Promise((resolve) => {
    const tx = wpDB.transaction('specimens', 'readonly');
    const req = tx.objectStore('specimens').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

async function getSpecimen(id) {
  await openWpDB();
  return new Promise((resolve) => {
    const tx = wpDB.transaction('specimens', 'readonly');
    const req = tx.objectStore('specimens').get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

async function deleteSpecimen(id, opts) {
  await openWpDB();
  // Clean up associated photos (gallery refs + UV photo ref)
  const sp = await getSpecimen(id);
  if (sp) {
    const refs = (sp.photos || []).slice();
    if (sp.uv && sp.uv.photoRef) refs.push(sp.uv.photoRef);
    for (const ref of refs) {
      if (!isInlinePhotoUrl(ref)) {
        try { await deleteRoutePhoto(ref); } catch (e) {}
      }
    }
  }
  await new Promise((resolve) => {
    const tx = wpDB.transaction('specimens', 'readwrite');
    tx.objectStore('specimens').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  await setLocalTombstone('specimens', id, (opts && opts.deletedAt) || Date.now());
}

async function getUnsyncedSpecimens() {
  const all = await getAllSpecimens();
  return all.filter(s => !s.synced);
}

async function markSpecimenSynced(id, updatedAt) {
  const sp = await getSpecimen(id);
  if (sp) {
    sp.synced = true;
    if (updatedAt != null) sp.updatedAt = updatedAt;
    await new Promise((resolve, reject) => {
      const tx = wpDB.transaction('specimens', 'readwrite');
      tx.objectStore('specimens').put(sp);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

// Auto-generate the next field label/SKU for a site code: SITECODE-YY-NNN.
// Scans the live store (offline-safe, conflict-aware) for the current max.
async function nextSpecimenLabel(siteCode) {
  const yy = String(new Date().getFullYear()).slice(-2);
  const all = await getAllSpecimens();
  const re = new RegExp('^' + siteCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-' + yy + '-(\\d+)$');
  let max = 0;
  for (const s of all) {
    const m = (s.label || '').match(re);
    if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; }
  }
  return `${siteCode}-${yy}-${String(max + 1).padStart(3, '0')}`;
}

// True if a SKU/label is already used by a DIFFERENT specimen (for the dup badge).
async function isDuplicateLabel(label, exceptId) {
  if (!label) return false;
  const all = await getAllSpecimens();
  return all.some(s => s.label === label && s.id !== exceptId);
}

// --- Specimen / dig-order photos (shared `photos` store, tagged __catalog__) ---
async function saveCatalogPhoto(photoId, dataUrl) {
  await openWpDB();
  return new Promise((resolve, reject) => {
    const tx = wpDB.transaction('photos', 'readwrite');
    tx.objectStore('photos').put({ id: photoId, waypointId: '__catalog__', dataUrl });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- Dig Orders ---
async function saveDigOrder(order, opts) {
  await openWpDB();
  const fromSync = opts && opts.fromSync;
  if (!order.createdAt) order.createdAt = Date.now();
  if (fromSync) { order.synced = true; }
  else { order.synced = false; order.updatedAt = Date.now(); }
  return new Promise((resolve, reject) => {
    const tx = wpDB.transaction('digOrders', 'readwrite');
    tx.objectStore('digOrders').put(order);
    tx.oncomplete = () => resolve(order);
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllDigOrders() {
  await openWpDB();
  return new Promise((resolve) => {
    const tx = wpDB.transaction('digOrders', 'readonly');
    const req = tx.objectStore('digOrders').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

async function getDigOrder(id) {
  await openWpDB();
  return new Promise((resolve) => {
    const tx = wpDB.transaction('digOrders', 'readonly');
    const req = tx.objectStore('digOrders').get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

async function deleteDigOrder(id, opts) {
  await openWpDB();
  const order = await getDigOrder(id);
  if (order && order.photos) {
    for (const ref of order.photos) {
      if (!isInlinePhotoUrl(ref)) {
        try { await deleteRoutePhoto(ref); } catch (e) {}
      }
    }
  }
  await new Promise((resolve) => {
    const tx = wpDB.transaction('digOrders', 'readwrite');
    tx.objectStore('digOrders').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  await setLocalTombstone('digOrders', id, (opts && opts.deletedAt) || Date.now());
}

async function getUnsyncedDigOrders() {
  const all = await getAllDigOrders();
  return all.filter(o => !o.synced);
}

async function markDigOrderSynced(id, updatedAt) {
  const order = await getDigOrder(id);
  if (order) {
    order.synced = true;
    if (updatedAt != null) order.updatedAt = updatedAt;
    await new Promise((resolve, reject) => {
      const tx = wpDB.transaction('digOrders', 'readwrite');
      tx.objectStore('digOrders').put(order);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

// --- Sales Orders (customer + payment + line items) ---
async function saveOrder(order, opts) {
  await openWpDB();
  const fromSync = opts && opts.fromSync;
  if (!order.createdAt) order.createdAt = Date.now();
  if (fromSync) { order.synced = true; }
  else { order.synced = false; order.updatedAt = Date.now(); }
  return new Promise((resolve, reject) => {
    const tx = wpDB.transaction('orders', 'readwrite');
    tx.objectStore('orders').put(order);
    tx.oncomplete = () => resolve(order);
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllOrders() {
  await openWpDB();
  return new Promise((resolve) => {
    const tx = wpDB.transaction('orders', 'readonly');
    const req = tx.objectStore('orders').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

async function getOrder(id) {
  await openWpDB();
  return new Promise((resolve) => {
    const tx = wpDB.transaction('orders', 'readonly');
    const req = tx.objectStore('orders').get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

async function deleteOrder(id, opts) {
  await openWpDB();
  await new Promise((resolve) => {
    const tx = wpDB.transaction('orders', 'readwrite');
    tx.objectStore('orders').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  await setLocalTombstone('orders', id, (opts && opts.deletedAt) || Date.now());
}

async function getUnsyncedOrders() {
  const all = await getAllOrders();
  return all.filter(o => !o.synced);
}

async function markOrderSynced(id, updatedAt) {
  const order = await getOrder(id);
  if (order) {
    order.synced = true;
    if (updatedAt != null) order.updatedAt = updatedAt;
    await new Promise((resolve, reject) => {
      const tx = wpDB.transaction('orders', 'readwrite');
      tx.objectStore('orders').put(order);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

// Auto-generate the next order number: ORD-YY-NNN (live scan, offline-safe).
async function nextOrderNumber() {
  const yy = String(new Date().getFullYear()).slice(-2);
  const all = await getAllOrders();
  const re = new RegExp('^ORD-' + yy + '-(\\d+)$');
  let max = 0;
  for (const o of all) {
    const m = (o.orderNumber || '').match(re);
    if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; }
  }
  return `ORD-${yy}-${String(max + 1).padStart(3, '0')}`;
}

// --- Local delete tombstones (for bidirectional sync) ---
// Stored in the settings store under 'sync-tombstones':
//   { waypoints: {id: deletedAt}, routes: {...}, specimens: {...}, digOrders: {...} }
async function getLocalTombstones() {
  return (await getSetting('sync-tombstones')) || {};
}
async function setLocalTombstone(type, id, deletedAt) {
  const t = await getLocalTombstones();
  if (!t[type]) t[type] = {};
  t[type][String(id)] = deletedAt || Date.now();
  await saveSetting('sync-tombstones', t);
}
async function clearLocalTombstone(type, id) {
  const t = await getLocalTombstones();
  if (t[type] && t[type][String(id)] != null) {
    delete t[type][String(id)];
    await saveSetting('sync-tombstones', t);
  }
}

// Atomic replacement after every remote photo has downloaded successfully.
async function replaceSyncedWaypointPhotos(wp, images) {
  await openWpDB();
  return new Promise((resolve, reject) => {
    const tx = wpDB.transaction(['waypoints', 'photos'], 'readwrite');
    const photos = tx.objectStore('photos');
    const cursor = photos.openCursor();
    cursor.onsuccess = () => {
      const entry = cursor.result;
      if (entry) {
        if (entry.value.waypointId === wp.id) entry.delete();
        entry.continue();
      } else {
        images.forEach((dataUrl, index) => photos.put({ id: `${wp.id}-${index}`, waypointId: wp.id, index, dataUrl }));
        tx.objectStore('waypoints').put({ ...wp, synced: true });
      }
    };
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('Photo replacement aborted'));
  });
}
