const path = require('path');
const fs = require('fs');

module.exports = function setupRouteRoutes(app, dataDir, { photosDir }) {
  const routesFile = path.join(dataDir, 'routes.json');

  function loadRoutes() {
    if (fs.existsSync(routesFile)) {
      try { return JSON.parse(fs.readFileSync(routesFile, 'utf8')); } catch(e) {}
    }
    return [];
  }

  function saveRoutes(routes) {
    const dir = path.dirname(routesFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(routesFile, JSON.stringify(routes, null, 2));
  }

  app.post('/api/route', (req, res) => {
    const route = req.body;
    if (!route || !route.id) return res.status(400).json({ error: 'Invalid route' });

    // Extract photos from points, save to disk
    if (route.points) {
      route.points.forEach((pt, pi) => {
        if (pt.photos && pt.photos.length > 0) {
          const savedPhotos = [];
          pt.photos.forEach((dataUrl, i) => {
            if (typeof dataUrl === 'string' && dataUrl.startsWith('data:')) {
              const matches = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
              if (matches) {
                const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
                const filename = `route-${route.id}-pt${pi}-${i}.${ext}`;
                const filePath = path.join(photosDir, filename);
                fs.writeFileSync(filePath, Buffer.from(matches[2], 'base64'));
                savedPhotos.push(filename);
              }
            } else {
              savedPhotos.push(dataUrl); // already a filename
            }
          });
          pt.photos = savedPhotos;
        }
      });
    }

    const routes = loadRoutes();
    const idx = routes.findIndex(r => r.id === route.id);
    if (idx >= 0) routes[idx] = route;
    else routes.push(route);
    saveRoutes(routes);
    console.log(`Route saved: ${route.name} (${route.points ? route.points.length : 0} points)`);
    res.json({ ok: true });
  });

  app.get('/api/routes', (req, res) => {
    res.json(loadRoutes());
  });

  app.delete('/api/route/:id', (req, res) => {
    const id = req.params.id;
    let routes = loadRoutes();
    routes = routes.filter(r => String(r.id) !== String(id));
    saveRoutes(routes);
    res.json({ ok: true });
  });

  app.get('/api/export/route/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const routes = loadRoutes();
    const route = routes.find(r => r.id === id);
    if (!route) return res.status(404).json({ error: 'Route not found' });

    // Include photo data URLs for export
    if (route.points) {
      route.points.forEach(pt => {
        if (pt.photos) {
          pt.photoFiles = pt.photos;
          pt.photoUrls = pt.photos.map(f => `/photos/${f}`);
        }
      });
    }
    res.json(route);
  });

  // Expose loadRoutes for use by other parts (e.g., backup endpoint)
  return { loadRoutes };
};
