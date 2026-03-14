const path = require('path');
const fs = require('fs');

module.exports = function setupTrackRoutes(app, dataDir) {
  const tracksFile = path.join(dataDir, 'tracks.json');

  function loadTracks() {
    if (fs.existsSync(tracksFile)) {
      try { return JSON.parse(fs.readFileSync(tracksFile, 'utf8')); }
      catch (e) { return []; }
    }
    return [];
  }

  function saveTracks(tracks) {
    const dir = path.dirname(tracksFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tracksFile, JSON.stringify(tracks, null, 2));
  }

  app.post('/api/track-session', (req, res) => {
    const session = req.body;
    if (!session || !session.id) {
      return res.status(400).json({ error: 'Missing session id' });
    }

    // Normalize points: accept both lon/lng and t/timestamp
    if (session.points && Array.isArray(session.points)) {
      session.points = session.points.map(pt => ({
        lat: pt.lat,
        lng: pt.lng !== undefined ? pt.lng : pt.lon,
        alt: pt.alt,
        speed: pt.speed,
        timestamp: pt.timestamp !== undefined ? pt.timestamp : pt.t
      }));
    }

    const tracks = loadTracks();

    // Skip if ID already exists
    if (tracks.some(t => String(t.id) === String(session.id))) {
      return res.json({ success: true, id: session.id, note: 'already exists' });
    }

    tracks.push({
      id: session.id,
      name: session.name,
      startTime: session.startTime,
      endTime: session.endTime,
      points: session.points || [],
      distance: session.distance,
      savedAt: new Date().toISOString()
    });

    saveTracks(tracks);
    console.log(`Track session saved: ${session.name || session.id} (${(session.points || []).length} points)`);
    res.json({ success: true, id: session.id });
  });

  app.get('/api/track-sessions', (req, res) => {
    res.json(loadTracks());
  });
};
