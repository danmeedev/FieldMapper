// Sync engine — phone-orchestrated BIDIRECTIONAL reconciliation with the laptop hub.
//
// On sync, the phone compares its records against the laptop's for each type
// (waypoints, routes, specimens, dig orders) and resolves every id by last-write-wins
// using `updatedAt`, with delete-tombstones so a delete on one side propagates instead
// of the record being re-created. Track sessions remain append-only (new-id merge).

// ---- Pure reconciliation planner (no I/O — unit-testable) ----
// Inputs: server live items[], server tombstones {id:deletedAt}, local live items[],
//         local tombstones {id:deletedAt}.
// Output: actions [{op, id, localItem?, serverItem?, deletedAt?}].
function planReconcile(serverItems, serverTombs, localItems, localTombs) {
  serverTombs = serverTombs || {};
  localTombs = localTombs || {};
  const sById = new Map((serverItems || []).map(i => [String(i.id), i]));
  const lById = new Map((localItems || []).map(i => [String(i.id), i]));
  const ids = new Set([
    ...sById.keys(), ...lById.keys(),
    ...Object.keys(serverTombs), ...Object.keys(localTombs)
  ]);
  const actions = [];
  ids.forEach(id => {
    const s = sById.get(id) || null;
    const l = lById.get(id) || null;
    const sDel = serverTombs[id] || 0;
    const lDel = localTombs[id] || 0;
    const sVer = s ? (s.updatedAt || 0) : 0;
    const lVer = l ? (l.updatedAt || 0) : 0;

    if (s && l) {
      // Both live -> newer wins. Equal -> already in sync.
      if (lVer > sVer) actions.push({ op: 'push-update', id, localItem: l });
      else if (sVer > lVer) actions.push({ op: 'pull-update', id, serverItem: s });
    } else if (s && !l) {
      // Server live; local absent or deleted.
      if (lDel && lDel > sVer) actions.push({ op: 'push-delete', id, deletedAt: lDel });
      else actions.push({ op: 'pull-create', id, serverItem: s }); // create or resurrect locally
    } else if (!s && l) {
      // Local live; server absent or deleted.
      if (sDel && sDel > lVer) actions.push({ op: 'pull-delete', id, localItem: l, deletedAt: sDel });
      else actions.push({ op: 'push-create', id, localItem: l }); // create or resurrect on server
    }
    // else: neither side live (both deleted / tombstone-only) -> nothing to transfer
  });
  return actions;
}

async function fetchSyncSnapshot(url, kind) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Sync read failed (${r.status}): ${kind}`);
  const value = await r.json();
  if (kind === 'tombstones') {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.values(value).some(group => !group || typeof group !== 'object' || Array.isArray(group) ||
          Object.values(group).some(t => !Number.isFinite(t) || t <= 0))) {
      throw new Error('Invalid sync tombstone snapshot');
    }
  } else if (!Array.isArray(value) || value.some(item => !item || item.id == null)) {
    throw new Error(`Invalid sync list: ${kind}`);
  }
  return value;
}

// Run the reconciliation for one record type using its descriptor.
async function reconcileType(serverUrl, allTombs, desc, stats) {
  const serverItems = await fetchSyncSnapshot(`${serverUrl}${desc.listPath}`, desc.type);
  const serverTombs = (allTombs && allTombs[desc.type]) || {};
  const localItems = await desc.getLocal();
  const localTombs = (await getLocalTombstones())[desc.type] || {};

  const actions = planReconcile(serverItems, serverTombs, localItems, localTombs);

  for (const a of actions) {
    try {
      if (a.op === 'push-create' || a.op === 'push-update') {
        const ok = await desc.push(a.localItem, serverUrl);
        if (ok) {
          // push() stamps a.localItem.updatedAt if it was missing; persist that exact
          // value locally so the local store and server agree (no spurious re-pull).
          await desc.markSynced(a.localItem.id, a.localItem.updatedAt);
          if (a.op === 'push-create') stats.pushedCreated++; else stats.pushedUpdated++;
        } else { stats.errors++; }
      } else if (a.op === 'pull-create' || a.op === 'pull-update') {
        await desc.saveLocal(a.serverItem, serverUrl);
        await clearLocalTombstone(desc.type, a.serverItem.id);
        if (a.op === 'pull-create') stats.pulledCreated++; else stats.pulledUpdated++;
      } else if (a.op === 'push-delete') {
        const ok = await desc.remoteDelete(a.id, a.deletedAt, serverUrl);
        if (ok) { stats.pushedDeleted++; await clearLocalTombstone(desc.type, a.id); }
        else stats.errors++;
      } else if (a.op === 'pull-delete') {
        await desc.deleteLocal(a.localItem.id, a.deletedAt);
        stats.pulledDeleted++;
      }
    } catch (e) {
      stats.errors++;
      console.error(`[sync ${desc.type}] ${a.op} ${a.id} failed:`, e.message);
    }
  }

  // Bound local-tombstone growth: once the server holds the authoritative tombstone,
  // the local copy is redundant (server-tombstone + locally-absent already no-ops).
  const freshLocalTombs = (await getLocalTombstones())[desc.type] || {};
  for (const tid of Object.keys(freshLocalTombs)) {
    if (serverTombs[tid] != null) await clearLocalTombstone(desc.type, tid);
  }
}

function mapPhotoFilenamesToUrls(arr, serverUrl) {
  return (arr || []).map(p =>
    (p && (p.startsWith('data:') || p.startsWith('http'))) ? p : `${serverUrl}/photos/${p}`);
}

// ---- Per-type descriptors ----
const SYNC_DESCRIPTORS = [
  {
    type: 'waypoints',
    listPath: '/api/waypoints',
    getLocal: () => getAllWaypoints(),
    markSynced: (id, updatedAt) => markSynced(id, updatedAt),
    push: async (wp, serverUrl) => {
      wp.updatedAt = wp.updatedAt || Date.now(); // persisted via markSynced after push
      const photos = await getPhotos(wp.id);
      const payload = { ...wp, photoData: photos.map(p => p.dataUrl) };
      const r = await fetch(`${serverUrl}/api/waypoint`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      return r.ok;
    },
    saveLocal: async (wp, serverUrl) => {
      const files = Array.isArray(wp.photos) ? wp.photos.slice() : [];
      const staged = [];
      for (const fn of files) {
        if (typeof fn !== 'string') throw new Error('Invalid waypoint photo reference');
        if (fn.startsWith('data:image/')) { staged.push(fn); continue; }
        const url = fn.startsWith('http') ? fn : `${serverUrl}/photos/${fn}`;
        const pr = await fetch(url);
        if (!pr.ok) throw new Error(`Waypoint photo download failed (${pr.status})`);
        const blob = await pr.blob();
        if (!blob.size || !blob.type.startsWith('image/')) throw new Error('Invalid waypoint image response');
        staged.push(await new Promise((resolve, reject) => {
          const rd = new FileReader(); rd.onerror = () => reject(new Error('Photo read failed'));
          rd.onloadend = () => resolve(rd.result); rd.readAsDataURL(blob);
        }));
      }
      // Commit record + complete photo set in one transaction; any failure preserves the old set.
      await replaceSyncedWaypointPhotos({ ...wp, photoCount: staged.length }, staged);
    },
    remoteDelete: async (id, deletedAt, serverUrl) => {
      const r = await fetch(`${serverUrl}/api/waypoint/${encodeURIComponent(id)}?deletedAt=${deletedAt || Date.now()}`, { method: 'DELETE' });
      return r.ok;
    },
    deleteLocal: async (id, deletedAt) => { await deleteWaypoint(id, { deletedAt }); }
  },
  {
    type: 'routes',
    listPath: '/api/routes',
    getLocal: () => getAllRoutes(),
    markSynced: (id, updatedAt) => markRouteSynced(id, updatedAt),
    push: async (route, serverUrl) => {
      route.updatedAt = route.updatedAt || Date.now();
      const payload = JSON.parse(JSON.stringify(route));
      if (payload.points) {
        for (const pt of payload.points) {
          if (pt.photos && pt.photos.length) {
            const resolved = [];
            for (const ref of pt.photos) { const u = await resolveRoutePhoto(ref); if (u) resolved.push(u); }
            pt.photos = resolved;
          }
        }
      }
      const r = await fetch(`${serverUrl}/api/route`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      return r.ok;
    },
    saveLocal: async (route, serverUrl) => {
      if (route.points) route.points.forEach(pt => { if (pt.photos) pt.photos = mapPhotoFilenamesToUrls(pt.photos, serverUrl); });
      await saveRoute(route, { fromSync: true });
    },
    remoteDelete: async (id, deletedAt, serverUrl) => {
      const r = await fetch(`${serverUrl}/api/route/${encodeURIComponent(id)}?deletedAt=${deletedAt || Date.now()}`, { method: 'DELETE' });
      return r.ok;
    },
    deleteLocal: async (id, deletedAt) => { await deleteRoute(id, { deletedAt }); }
  },
  {
    type: 'specimens',
    listPath: '/api/specimens',
    getLocal: () => getAllSpecimens(),
    markSynced: (id, updatedAt) => markSpecimenSynced(id, updatedAt),
    push: async (sp, serverUrl) => {
      sp.updatedAt = sp.updatedAt || Date.now();
      const payload = JSON.parse(JSON.stringify(sp));
      if (payload.photos && payload.photos.length) {
        const resolved = [];
        for (const ref of payload.photos) { const u = await resolveRoutePhoto(ref); if (u) resolved.push(u); }
        payload.photos = resolved;
      }
      if (payload.uv && payload.uv.photoRef) payload.uv.photoRef = await resolveRoutePhoto(payload.uv.photoRef);
      const r = await fetch(`${serverUrl}/api/specimen`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      return r.ok;
    },
    saveLocal: async (sp, serverUrl) => {
      if (sp.photos) sp.photos = mapPhotoFilenamesToUrls(sp.photos, serverUrl);
      if (sp.uv && sp.uv.photoRef && !(sp.uv.photoRef.startsWith('data:') || sp.uv.photoRef.startsWith('http'))) {
        sp.uv.photoRef = `${serverUrl}/photos/${sp.uv.photoRef}`;
      }
      await saveSpecimen(sp, { fromSync: true });
    },
    remoteDelete: async (id, deletedAt, serverUrl) => {
      const r = await fetch(`${serverUrl}/api/specimen/${encodeURIComponent(id)}?deletedAt=${deletedAt || Date.now()}`, { method: 'DELETE' });
      return r.ok;
    },
    deleteLocal: async (id, deletedAt) => { await deleteSpecimen(id, { deletedAt }); }
  },
  {
    type: 'digOrders',
    listPath: '/api/digorders',
    getLocal: () => getAllDigOrders(),
    markSynced: (id, updatedAt) => markDigOrderSynced(id, updatedAt),
    push: async (order, serverUrl) => {
      order.updatedAt = order.updatedAt || Date.now();
      const payload = JSON.parse(JSON.stringify(order));
      if (payload.photos && payload.photos.length) {
        const resolved = [];
        for (const ref of payload.photos) { const u = await resolveRoutePhoto(ref); if (u) resolved.push(u); }
        payload.photos = resolved;
      }
      const r = await fetch(`${serverUrl}/api/digorder`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      return r.ok;
    },
    saveLocal: async (order, serverUrl) => {
      if (order.photos) order.photos = mapPhotoFilenamesToUrls(order.photos, serverUrl);
      await saveDigOrder(order, { fromSync: true });
    },
    remoteDelete: async (id, deletedAt, serverUrl) => {
      const r = await fetch(`${serverUrl}/api/digorder/${encodeURIComponent(id)}?deletedAt=${deletedAt || Date.now()}`, { method: 'DELETE' });
      return r.ok;
    },
    deleteLocal: async (id, deletedAt) => { await deleteDigOrder(id, { deletedAt }); }
  },
  {
    type: 'orders',
    listPath: '/api/orders',
    getLocal: () => getAllOrders(),
    markSynced: (id, updatedAt) => markOrderSynced(id, updatedAt),
    push: async (order, serverUrl) => {
      order.updatedAt = order.updatedAt || Date.now();
      const r = await fetch(`${serverUrl}/api/order`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(order)
      });
      return r.ok;
    },
    saveLocal: async (order, serverUrl) => { await saveOrder(order, { fromSync: true }); },
    remoteDelete: async (id, deletedAt, serverUrl) => {
      const r = await fetch(`${serverUrl}/api/order/${encodeURIComponent(id)}?deletedAt=${deletedAt || Date.now()}`, { method: 'DELETE' });
      return r.ok;
    },
    deleteLocal: async (id, deletedAt) => { await deleteOrder(id, { deletedAt }); }
  }
];

async function syncToLaptop(onProgress) {
  const serverUrl = await getSetting('laptopUrl');
  if (!serverUrl) throw new Error('No laptop server URL configured. Go to Map > Settings to enter your laptop URL.');

  const connected = await checkLaptopConnection();
  if (!connected) throw new Error('Cannot reach laptop server. Check URL and make sure you are on the same WiFi network.');

  const stats = {
    pushedCreated: 0, pushedUpdated: 0, pushedDeleted: 0,
    pulledCreated: 0, pulledUpdated: 0, pulledDeleted: 0,
    errors: 0, tracksPushed: 0, tracksPulled: 0
  };

  // One snapshot of the laptop's delete-tombstones for the whole pass.
  const allTombs = await fetchSyncSnapshot(`${serverUrl}/api/tombstones`, 'tombstones');

  const totalSteps = SYNC_DESCRIPTORS.length + 1; // +1 for track sessions
  let step = 0;
  for (const desc of SYNC_DESCRIPTORS) {
    try { await reconcileType(serverUrl, allTombs, desc, stats); }
    catch (e) { stats.errors++; console.error(`[sync ${desc.type}] snapshot failed:`, e.message); }
    step++;
    if (onProgress) onProgress(step, totalSteps);
  }

  // --- Track sessions: append-only, never edited/deleted (new-id merge both ways) ---
  try {
    const localSessions = await getAllTrackSessions();
    for (const session of localSessions) {
      try {
        const resp = await fetch(`${serverUrl}/api/track-session`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(session)
        });
        if (resp.ok) stats.tracksPushed++;
      } catch (e) { console.error(`Track session push error:`, e.message); }
    }
    if (typeof NativeGps !== 'undefined' && NativeGps.isNative) {
      const nativeSessions = await NativeGps.getSessions();
      for (const session of nativeSessions) {
        try {
          const points = await NativeGps.getSessionPoints(session.id);
          const resp = await fetch(`${serverUrl}/api/track-session`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...session, points })
          });
          if (resp.ok) stats.tracksPushed++;
        } catch (e) { console.error(`Native track push error:`, e.message); }
      }
    }
  } catch (e) { console.error('Track session push failed:', e.message); }

  try {
    const resp = await fetch(`${serverUrl}/api/track-sessions`);
    if (resp.ok) {
      const serverSessions = await resp.json();
      const localSessions = await getAllTrackSessions();
      const localIds = new Set(localSessions.map(s => s.id));
      for (const session of serverSessions) {
        if (!localIds.has(session.id)) { await saveTrackSession(session); stats.tracksPulled++; }
      }
    }
  } catch (e) { console.error('Track session pull failed:', e.message); }

  step++;
  if (onProgress) onProgress(totalSteps, totalSteps);

  // Return detailed stats plus a few legacy aliases the UI may read.
  return {
    ...stats,
    synced: stats.pushedCreated + stats.pushedUpdated,
    pulled: stats.pulledCreated + stats.pulledUpdated,
    total: stats.pushedCreated + stats.pushedUpdated + stats.pushedDeleted
  };
}

async function checkLaptopConnection() {
  const serverUrl = await getSetting('laptopUrl');
  if (!serverUrl) return false;

  try {
    // Use the trivial /api/status health endpoint — NOT /api/cache-stats, which can be
    // slow on a large tile cache and would make this reachability check time out.
    const resp = await fetch(`${serverUrl}/api/status`, {
      signal: AbortSignal.timeout(5000)
    });
    return resp.ok;
  } catch (e) {
    return false;
  }
}

// Pull waypoints from laptop (standalone helper; not used by the main sync path)
async function pullFromLaptop() {
  const serverUrl = await getSetting('laptopUrl');
  if (!serverUrl) throw new Error('No laptop server URL configured');

  const resp = await fetch(`${serverUrl}/api/waypoints`);
  if (!resp.ok) throw new Error('Failed to fetch waypoints from laptop');

  const serverWps = await resp.json();
  const localWps = await getAllWaypoints();
  const localById = new Map(localWps.map(w => [w.id, w]));

  let imported = 0;
  for (const wp of serverWps) {
    const localWp = localById.get(wp.id);
    if (!localWp || (wp.updatedAt && (!localWp.updatedAt || wp.updatedAt > localWp.updatedAt))) {
      await saveWaypoint(wp, { fromSync: true });
      imported++;
    }
  }
  return { imported };
}

// AI Analysis via laptop server (with offline cache)
async function runAIAnalysis(waypointId, forceRefresh) {
  await AiSettings.requireReady();
  // Check cache first (unless forcing a refresh)
  if (!forceRefresh && waypointId) {
    var cached = await getAIResult(waypointId);
    if (cached) {
      var online = navigator.onLine !== false;
      var serverUrl = await getSetting('laptopUrl');
      if (!online || !serverUrl) {
        return { analysis: cached.analysis, fromCache: true, cachedAt: cached.cachedAt };
      }
      try {
        await fetch(serverUrl + '/api/status', { signal: AbortSignal.timeout(3000) });
      } catch (e) {
        return { analysis: cached.analysis, fromCache: true, cachedAt: cached.cachedAt };
      }
    }
  }

  var serverUrl2 = await getSetting('laptopUrl');
  if (!serverUrl2) {
    if (waypointId) {
      var fallback = await getAIResult(waypointId);
      if (fallback) {
        return { analysis: fallback.analysis, fromCache: true, cachedAt: fallback.cachedAt };
      }
    }
    throw new Error('Connect to laptop for AI analysis');
  }

  var resp = await fetch(serverUrl2 + '/api/ai/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ waypointId })
  });

  var result = await resp.json();
  if (!resp.ok) { await AiSettings.refresh(); throw new Error(result.error || "AI request failed"); }

  if (result.analysis && waypointId) {
    try { await saveAIResult(waypointId, result); }
    catch (e) { console.error('Failed to cache AI result:', e.message); }
  }

  result.fromCache = false;
  return result;
}

// Exported for unit testing in Node (no-op in the browser).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { planReconcile };
}
