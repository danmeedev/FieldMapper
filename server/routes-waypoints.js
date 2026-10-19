const path = require('path');
const fs = require('fs');
const { addTombstone, clearTombstone } = require('./tombstones');

module.exports = function setupWaypointRoutes(app, dataDir, { photosDir, getMapClients, getLatestGPS, setLatestGPS }) {
  const wpFilePath = path.join(dataDir, 'waypoints.json');
  function loadWaypoints() {
    if (fs.existsSync(wpFilePath)) {
      try { return JSON.parse(fs.readFileSync(wpFilePath, 'utf8')); } catch (e) {}
    }
    return [];
  }
  function saveWaypoints(arr) {
    const dir = path.dirname(wpFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(wpFilePath, JSON.stringify(arr, null, 2));
  }
  // Upload waypoint with photos (from phone)
  app.post('/api/waypoint', (req, res) => {
    const wp = req.body;
    const savedPhotos = [];

    // Save base64 photos to disk
    if (wp.photoData && wp.photoData.length > 0) {
      wp.photoData.forEach((dataUrl, i) => {
        const matches = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
        if (matches) {
          const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
          const filename = `${wp.id}-${i}.${ext}`;
          const filePath = path.join(photosDir, filename);
          fs.writeFileSync(filePath, Buffer.from(matches[2], 'base64'));
          savedPhotos.push(filename);
          console.log(`  Photo saved: ${filename}`);
        }
      });
    }

    // Build clean waypoint (without base64 data)
    const cleanWP = { ...wp, photos: savedPhotos };
    delete cleanWP.photoData;

    // Preserve already-saved photo filenames if this is an update that didn't
    // re-send photo data (e.g. a metadata-only edit pushed without photoData).
    if (!Array.isArray(wp.photoData) && savedPhotos.length === 0 && Array.isArray(wp.photos) && wp.photos.length) {
      cleanWP.photos = wp.photos.map(p => String(p).split('/').pop().split('?')[0]);
    }

    // Relay to map viewers via WebSocket
    const mapClients = getMapClients();
    const msg = JSON.stringify({ type: 'waypoint', ...cleanWP });
    for (const client of mapClients) {
      if (client.readyState === 1) client.send(msg);
    }

    // UPSERT by id (not append) so re-syncing the same waypoint never duplicates it.
    const allWaypoints = loadWaypoints();
    const idx = allWaypoints.findIndex(w => String(w.id) === String(cleanWP.id));
    if (idx >= 0) allWaypoints[idx] = cleanWP; else allWaypoints.push(cleanWP);
    saveWaypoints(allWaypoints);
    clearTombstone(dataDir, 'waypoints', cleanWP.id); // re-created/updated -> resurrect

    console.log(`Waypoint saved: ${cleanWP.name} (${savedPhotos.length} photos)`);
    res.json({ ok: true, photos: cleanWP.photos });
  });

  // Delete a waypoint (records a tombstone so the delete propagates on sync)
  app.delete('/api/waypoint/:id', (req, res) => {
    const id = req.params.id;
    let all = loadWaypoints();
    all = all.filter(w => String(w.id) !== String(id));
    saveWaypoints(all);
    addTombstone(dataDir, 'waypoints', id, req.query.deletedAt ? Number(req.query.deletedAt) : undefined);
    res.json({ ok: true });
  });

  // GPS push via HTTP (fallback when WebSocket doesn't work)
  app.post('/api/gps', (req, res) => {
    const data = req.body;
    if (data && Number.isFinite(data.lat) && Number.isFinite(data.lon) &&
        Math.abs(data.lat) <= 90 && Math.abs(data.lon) <= 180) {
      setLatestGPS({ ...data, type: 'gps', timestamp: Date.now() });
      const msg = JSON.stringify(getLatestGPS());
      const mapClients = getMapClients();
      for (const client of mapClients) {
        if (client.readyState === 1) client.send(msg);
      }
      res.json({ ok: true });
    } else {
      res.status(400).json({ error: 'lat and lon required' });
    }
  });

  // Get all saved waypoints
  app.get('/api/waypoints', (req, res) => {
    const wpFile = path.join(dataDir, 'waypoints.json');
    if (fs.existsSync(wpFile)) {
      res.json(JSON.parse(fs.readFileSync(wpFile, 'utf8')));
    } else {
      res.json([]);
    }
  });
};
