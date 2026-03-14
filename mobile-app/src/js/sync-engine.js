// Sync engine - push waypoints + photos to laptop server, pull from laptop
// Bidirectional sync with the same POST /api/waypoint endpoint

async function syncToLaptop(onProgress) {
  const serverUrl = await getSetting('laptopUrl');
  if (!serverUrl) throw new Error('No laptop server URL configured. Go to Map > Settings to enter your laptop URL.');

  // Test connection first
  const connected = await checkLaptopConnection();
  if (!connected) throw new Error('Cannot reach laptop server. Check URL and make sure you are on the same WiFi network.');

  let pushed = 0;
  let pulled = 0;
  let errors = 0;
  const failedIds = [];

  // --- RETRY QUEUE: Attempt previously failed pushes first ---
  const retryQueue = (await getSetting('sync-retry-queue')) || [];
  for (const retryId of retryQueue) {
    try {
      const wp = await getWaypoint(retryId);
      if (!wp) continue;
      const photos = await getPhotos(wp.id);
      const photoDataUrls = photos.map(p => p.dataUrl);

      const payload = {
        ...wp,
        updatedAt: wp.updatedAt || Date.now(),
        photoData: photoDataUrls
      };

      const resp = await fetch(`${serverUrl}/api/waypoint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (resp.ok) {
        await markSynced(wp.id);
        pushed++;
      } else {
        failedIds.push(wp.id);
        errors++;
      }
    } catch (e) {
      console.error(`Retry push error for ${retryId}:`, e.message);
      failedIds.push(retryId);
      errors++;
    }
  }

  // --- PUSH: Send unsynced waypoints to laptop ---
  const unsynced = await getUnsyncedWaypoints();
  const totalWork = unsynced.length + 1; // +1 for pull phase

  for (const wp of unsynced) {
    try {
      const photos = await getPhotos(wp.id);
      const photoDataUrls = photos.map(p => p.dataUrl);

      const payload = {
        ...wp,
        updatedAt: wp.updatedAt || Date.now(),
        photoData: photoDataUrls
      };

      const resp = await fetch(`${serverUrl}/api/waypoint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (resp.ok) {
        await markSynced(wp.id);
        pushed++;
      } else {
        console.error(`Sync push failed for ${wp.name}: ${resp.status}`);
        failedIds.push(wp.id);
        errors++;
      }
    } catch (e) {
      console.error(`Sync push error for ${wp.name}:`, e.message);
      failedIds.push(wp.id);
      errors++;
    }

    if (onProgress) onProgress(pushed + errors, totalWork, pushed, errors);
  }

  // Save any failed IDs to retry queue for next sync
  await saveSetting('sync-retry-queue', failedIds);

  // --- PULL: Get waypoints from laptop, with conflict resolution ---
  try {
    const resp = await fetch(`${serverUrl}/api/waypoints`);
    if (resp.ok) {
      const serverWps = await resp.json();
      const localWps = await getAllWaypoints();
      const localById = new Map(localWps.map(w => [w.id, w]));

      for (const wp of serverWps) {
        const localWp = localById.get(wp.id);
        if (!localWp) {
          // New waypoint - save it
          wp.synced = true;
          await saveWaypoint(wp);
          pulled++;
        } else if (wp.updatedAt && (!localWp.updatedAt || wp.updatedAt > localWp.updatedAt)) {
          // Server version is newer - update local copy
          wp.synced = true;
          await saveWaypoint(wp);
          pulled++;
        }

        // Pull photos for this waypoint
        if (wp.photoFiles && wp.photoFiles.length > 0) {
          for (let i = 0; i < wp.photoFiles.length; i++) {
            const filename = wp.photoFiles[i];
            try {
              const photoResp = await fetch(`${serverUrl}/photos/${filename}`);
              if (photoResp.ok) {
                const blob = await photoResp.blob();
                const reader = new FileReader();
                const dataUrl = await new Promise((resolve) => {
                  reader.onloadend = () => resolve(reader.result);
                  reader.readAsDataURL(blob);
                });
                await savePhoto(wp.id, i, dataUrl);
              }
            } catch (photoErr) {
              console.error(`Failed to pull photo ${filename}:`, photoErr.message);
            }
          }
        }
      }
    }
  } catch (e) {
    console.error('Pull from laptop failed:', e.message);
  }

  // --- PUSH ROUTES: Send local routes to laptop ---
  let routesPushed = 0;
  try {
    const localRoutes = await getAllRoutes();
    for (const route of localRoutes) {
      try {
        const resp = await fetch(`${serverUrl}/api/route`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(route)
        });
        if (resp.ok) routesPushed++;
      } catch (e) {
        console.error(`Route push error for ${route.name}:`, e.message);
      }
    }
  } catch (e) {
    console.error('Route push failed:', e.message);
  }

  // --- PULL ROUTES: Get routes from laptop that we don't have ---
  let routesPulled = 0;
  try {
    const resp = await fetch(`${serverUrl}/api/routes`);
    if (resp.ok) {
      const serverRoutes = await resp.json();
      const localRoutes = await getAllRoutes();
      const localRouteIds = new Set(localRoutes.map(r => r.id));

      for (const route of serverRoutes) {
        if (!localRouteIds.has(route.id)) {
          // Convert server photo filenames to URLs for offline use
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

  // --- PUSH TRACK SESSIONS: Send local track sessions to laptop ---
  let tracksPushed = 0;
  try {
    // Push IndexedDB track sessions
    const localSessions = await getAllTrackSessions();
    for (const session of localSessions) {
      try {
        const resp = await fetch(`${serverUrl}/api/track-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(session)
        });
        if (resp.ok) tracksPushed++;
      } catch (e) {
        console.error(`Track session push error for ${session.name || session.id}:`, e.message);
      }
    }

    // Push native GPS track sessions (from background tracking)
    if (typeof NativeGps !== 'undefined' && NativeGps.isNative) {
      const nativeSessions = await NativeGps.getSessions();
      for (const session of nativeSessions) {
        try {
          const points = await NativeGps.getSessionPoints(session.id);
          const payload = { ...session, points };
          const resp = await fetch(`${serverUrl}/api/track-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if (resp.ok) tracksPushed++;
        } catch (e) {
          console.error(`Native track push error for ${session.id}:`, e.message);
        }
      }
    }
  } catch (e) {
    console.error('Track session push failed:', e.message);
  }

  // --- PULL TRACK SESSIONS: Get track sessions from laptop ---
  let tracksPulled = 0;
  try {
    const resp = await fetch(`${serverUrl}/api/track-sessions`);
    if (resp.ok) {
      const serverSessions = await resp.json();
      const localSessions = await getAllTrackSessions();
      const localSessionIds = new Set(localSessions.map(s => s.id));

      for (const session of serverSessions) {
        if (!localSessionIds.has(session.id)) {
          await saveTrackSession(session);
          tracksPulled++;
        }
      }
    }
  } catch (e) {
    console.error('Track session pull failed:', e.message);
  }

  if (onProgress) onProgress(totalWork, totalWork, pushed, errors);

  return { synced: pushed, pulled, errors, total: unsynced.length, routesPushed, routesPulled, tracksPushed, tracksPulled };
}

async function checkLaptopConnection() {
  const serverUrl = await getSetting('laptopUrl');
  if (!serverUrl) return false;

  try {
    const resp = await fetch(`${serverUrl}/api/cache-stats`, {
      signal: AbortSignal.timeout(5000)
    });
    return resp.ok;
  } catch (e) {
    return false;
  }
}

// Pull waypoints from laptop (standalone)
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
    if (!localWp) {
      wp.synced = true;
      await saveWaypoint(wp);
      imported++;
    } else if (wp.updatedAt && (!localWp.updatedAt || wp.updatedAt > localWp.updatedAt)) {
      wp.synced = true;
      await saveWaypoint(wp);
      imported++;
    }

    // Pull photos for this waypoint
    if (wp.photoFiles && wp.photoFiles.length > 0) {
      for (let i = 0; i < wp.photoFiles.length; i++) {
        const filename = wp.photoFiles[i];
        try {
          const photoResp = await fetch(`${serverUrl}/photos/${filename}`);
          if (photoResp.ok) {
            const blob = await photoResp.blob();
            const reader = new FileReader();
            const dataUrl = await new Promise((resolve) => {
              reader.onloadend = () => resolve(reader.result);
              reader.readAsDataURL(blob);
            });
            await savePhoto(wp.id, i, dataUrl);
          }
        } catch (photoErr) {
          console.error(`Failed to pull photo ${filename}:`, photoErr.message);
        }
      }
    }
  }

  return { imported };
}

// AI Analysis via laptop server (with offline cache)
async function runAIAnalysis(waypointId, forceRefresh) {
  // Check cache first (unless forcing a refresh)
  if (!forceRefresh && waypointId) {
    var cached = await getAIResult(waypointId);
    if (cached) {
      // If we're offline, return the cached result
      var online = navigator.onLine !== false;
      var serverUrl = await getSetting('laptopUrl');
      if (!online || !serverUrl) {
        return { analysis: cached.analysis, fromCache: true, cachedAt: cached.cachedAt };
      }
      // If online, still check server reachability before deciding
      try {
        await fetch(serverUrl + '/api/cache-stats', { signal: AbortSignal.timeout(3000) });
      } catch (e) {
        // Server unreachable — return cached result
        return { analysis: cached.analysis, fromCache: true, cachedAt: cached.cachedAt };
      }
    }
  }

  var serverUrl2 = await getSetting('laptopUrl');
  if (!serverUrl2) {
    // No server URL — try cache as last resort
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

  // Cache the successful result
  if (result.analysis && waypointId) {
    try {
      await saveAIResult(waypointId, result);
    } catch (e) {
      console.error('Failed to cache AI result:', e.message);
    }
  }

  result.fromCache = false;
  return result;
}
