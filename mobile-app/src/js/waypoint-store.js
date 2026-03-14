// Unified waypoint + photo storage using IndexedDB
const WP_DB_NAME = 'fieldmapper-data';
const WP_DB_VERSION = 4;

let wpDB = null;

function openWpDB() {
  return new Promise((resolve, reject) => {
    if (wpDB) { resolve(wpDB); return; }
    const req = indexedDB.open(WP_DB_NAME, WP_DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('waypoints')) {
        const store = db.createObjectStore('waypoints', { keyPath: 'id' });
        store.createIndex('synced', 'synced', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
      if (!db.objectStoreNames.contains('photos')) {
        db.createObjectStore('photos', { keyPath: 'id' });
      }
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
    };
    req.onsuccess = (e) => { wpDB = e.target.result; resolve(wpDB); };
    req.onerror = (e) => reject(e.target.error);
  });
}

// --- Waypoints ---
async function saveWaypoint(wp) {
  await openWpDB();
  wp.synced = wp.synced || false;
  if (!wp.updatedAt) wp.updatedAt = Date.now();
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

async function deleteWaypoint(id) {
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

async function markSynced(id) {
  const wp = await getWaypoint(id);
  if (wp) {
    wp.synced = true;
    await saveWaypoint(wp);
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
  return new Promise((resolve) => {
    const tx = wpDB.transaction('photos', 'readwrite');
    tx.objectStore('photos').put({ id: photoId, waypointId: '__route__', dataUrl });
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
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
async function saveRoute(route) {
  await openWpDB();
  return new Promise((resolve) => {
    const tx = wpDB.transaction('routes', 'readwrite');
    tx.objectStore('routes').put(route);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
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
async function deleteRoute(id) {
  await openWpDB();
  return new Promise((resolve) => {
    const tx = wpDB.transaction('routes', 'readwrite');
    tx.objectStore('routes').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
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
  return new Promise((resolve) => {
    const tx = wpDB.transaction('trackSessions', 'readwrite');
    tx.objectStore('trackSessions').put(session);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
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
