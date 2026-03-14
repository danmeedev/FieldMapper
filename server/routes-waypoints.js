const path = require('path');
const fs = require('fs');

module.exports = function setupWaypointRoutes(app, dataDir, { photosDir, getMapClients, getLatestGPS, setLatestGPS }) {
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

    // Relay to map viewers via WebSocket
    const mapClients = getMapClients();
    const msg = JSON.stringify({ type: 'waypoint', ...cleanWP });
    for (const client of mapClients) {
      if (client.readyState === 1) client.send(msg);
    }

    // Also append to a persistent waypoints file
    const wpFile = path.join(dataDir, 'waypoints.json');
    let allWaypoints = [];
    if (fs.existsSync(wpFile)) {
      try { allWaypoints = JSON.parse(fs.readFileSync(wpFile, 'utf8')); } catch (e) {}
    }
    allWaypoints.push(cleanWP);
    fs.writeFileSync(wpFile, JSON.stringify(allWaypoints, null, 2));

    console.log(`Waypoint saved: ${cleanWP.name} (${savedPhotos.length} photos)`);
    res.json({ ok: true, photos: savedPhotos });
  });

  // GPS push via HTTP (fallback when WebSocket doesn't work)
  app.post('/api/gps', (req, res) => {
    const data = req.body;
    if (data && data.lat && data.lon) {
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
