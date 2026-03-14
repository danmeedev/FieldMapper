const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');

// --- Tile sources ---
const TILE_SOURCES = {
  topo: {
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',
    contentType: 'image/png',
    ext: 'png'
  },
  satellite: {
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
    contentType: 'image/jpeg',
    ext: 'jpg'
  },
  'satellite-hd': {
    url: 'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    contentType: 'image/jpeg',
    ext: 'jpg'
  },
  'imagery-topo': {
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}',
    contentType: 'image/jpeg',
    ext: 'jpg'
  },
  blm: {
    url: 'https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_Cached_without_PriUnk/MapServer/tile/{z}/{y}/{x}',
    contentType: 'image/jpeg',
    ext: 'jpg'
  },
  'esri-topo': {
    url: 'https://services.arcgisonline.com/arcgis/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    contentType: 'image/jpeg',
    ext: 'jpg'
  },
  'esri-street': {
    url: 'https://services.arcgisonline.com/arcgis/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    contentType: 'image/jpeg',
    ext: 'jpg'
  },
  natgeo: {
    url: 'https://services.arcgisonline.com/arcgis/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}',
    contentType: 'image/jpeg',
    ext: 'jpg'
  },
  relief: {
    url: 'https://services.arcgisonline.com/arcgis/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}',
    contentType: 'image/jpeg',
    ext: 'jpg'
  },
  terrain: {
    url: 'https://services.arcgisonline.com/arcgis/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}',
    contentType: 'image/jpeg',
    ext: 'jpg'
  },
  streets: {
    url: 'https://services.arcgisonline.com/arcgis/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
    contentType: 'image/png',
    ext: 'png'
  },
  labels: {
    url: 'https://services.arcgisonline.com/arcgis/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    contentType: 'image/png',
    ext: 'png'
  },
  hydro: {
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSHydroCached/MapServer/tile/{z}/{y}/{x}',
    contentType: 'image/png',
    ext: 'png'
  }
};

const emptyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAB' +
  'Nl7BcQAAAABJRU5ErkJggg==', 'base64'
);

// Track active fetches to avoid duplicate downloads
const activeFetches = new Map();

// Concurrency limiter
const MAX_CONCURRENT_FETCHES = 4;
let currentFetches = 0;
const fetchQueue = [];

function runNext() {
  while (fetchQueue.length > 0 && currentFetches < MAX_CONCURRENT_FETCHES) {
    const next = fetchQueue.shift();
    currentFetches++;
    next();
  }
}

function fetchAndCacheTile(source, z, x, y, tilePath) {
  const cacheKey = `${source.url}-${z}-${x}-${y}`;

  if (activeFetches.has(cacheKey)) {
    return activeFetches.get(cacheKey);
  }

  const promise = new Promise((resolve) => {
    function doFetch() {
      const tileUrl = source.url
        .replace('{z}', z)
        .replace('{x}', x)
        .replace('{y}', y);

      const client = tileUrl.startsWith('https') ? https : http;

      const req = client.get(tileUrl, {
        headers: { 'User-Agent': 'FieldMapper/1.0' },
        timeout: 10000
      }, (res) => {
        if (res.statusCode === 200) {
          const chunks = [];
          res.on('data', chunk => chunks.push(chunk));
          res.on('end', () => {
            const data = Buffer.concat(chunks);
            const dir = path.dirname(tilePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFile(tilePath, data, () => {});
            currentFetches--;
            runNext();
            resolve(data);
          });
        } else {
          currentFetches--;
          runNext();
          resolve(null);
        }
      });

      req.on('error', () => { currentFetches--; runNext(); resolve(null); });
      req.on('timeout', () => { req.destroy(); currentFetches--; runNext(); resolve(null); });
    }

    if (currentFetches < MAX_CONCURRENT_FETCHES) {
      currentFetches++;
      doFetch();
    } else {
      fetchQueue.push(doFetch);
    }
  }).finally(() => {
    activeFetches.delete(cacheKey);
  });

  activeFetches.set(cacheKey, promise);
  return promise;
}

module.exports = function setupTileProxy(app, tilesDir) {
  // Serve tiles: cache-first, then fetch from internet
  app.get('/tiles/:layer/:z/:x/:y.png', async (req, res) => {
    const { layer, z, x, y } = req.params;
    const tilePath = path.join(tilesDir, layer, z, x, `${y}.png`);

    if (fs.existsSync(tilePath)) {
      res.setHeader('Content-Type', 'image/png');
      res.sendFile(tilePath);
      return;
    }

    const source = TILE_SOURCES[layer];
    if (source) {
      const data = await fetchAndCacheTile(source, z, x, y, tilePath);
      if (data) {
        res.setHeader('Content-Type', source.contentType);
        res.send(data);
        return;
      }
    }

    res.setHeader('Content-Type', 'image/png');
    res.send(emptyPng);
  });

  app.get('/tiles/:layer/:z/:x/:y.jpg', async (req, res) => {
    const { layer, z, x, y } = req.params;
    const tilePath = path.join(tilesDir, layer, z, x, `${y}.jpg`);

    if (fs.existsSync(tilePath)) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.sendFile(tilePath);
      return;
    }

    const source = TILE_SOURCES[layer];
    if (source) {
      const data = await fetchAndCacheTile(source, z, x, y, tilePath);
      if (data) {
        res.setHeader('Content-Type', source.contentType);
        res.send(data);
        return;
      }
    }

    res.setHeader('Content-Type', 'image/png');
    res.send(emptyPng);
  });

  // Contour overlay
  app.get('/tiles/contours/:z/:x/:y.png', async (req, res) => {
    const { z, x, y } = req.params;
    const tilePath = path.join(tilesDir, 'contours', z, x, `${y}.png`);

    if (fs.existsSync(tilePath)) {
      res.setHeader('Content-Type', 'image/png');
      res.sendFile(tilePath);
      return;
    }

    const n = Math.pow(2, parseInt(z));
    const tileSize = 20037508.342789244 * 2 / n;
    const xMin = -20037508.342789244 + parseInt(x) * tileSize;
    const xMax = xMin + tileSize;
    const yMax = 20037508.342789244 - parseInt(y) * tileSize;
    const yMin = yMax - tileSize;

    const exportUrl = `https://carto.nationalmap.gov/arcgis/rest/services/contours/MapServer/export?` +
      `bbox=${xMin},${yMin},${xMax},${yMax}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image`;

    const cacheKey = `contours-${z}-${x}-${y}`;
    if (activeFetches.has(cacheKey)) {
      const data = await activeFetches.get(cacheKey);
      if (data) { res.setHeader('Content-Type', 'image/png'); res.send(data); }
      else { res.setHeader('Content-Type', 'image/png'); res.send(emptyPng); }
      return;
    }

    const promise = new Promise((resolve) => {
      function doFetch() {
        https.get(exportUrl, { headers: { 'User-Agent': 'FieldMapper/1.0' }, timeout: 15000 }, (resp) => {
          if (resp.statusCode === 200) {
            const chunks = [];
            resp.on('data', chunk => chunks.push(chunk));
            resp.on('end', () => {
              const data = Buffer.concat(chunks);
              const dir = path.dirname(tilePath);
              if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
              fs.writeFile(tilePath, data, () => {});
              currentFetches--;
              runNext();
              resolve(data);
            });
          } else { currentFetches--; runNext(); resolve(null); }
        }).on('error', () => { currentFetches--; runNext(); resolve(null); })
          .on('timeout', function() { this.destroy(); currentFetches--; runNext(); resolve(null); });
      }
      if (currentFetches < MAX_CONCURRENT_FETCHES) { currentFetches++; doFetch(); }
      else { fetchQueue.push(doFetch); }
    }).finally(() => { activeFetches.delete(cacheKey); });

    activeFetches.set(cacheKey, promise);
    const data = await promise;
    if (data) { res.setHeader('Content-Type', 'image/png'); res.send(data); }
    else { res.setHeader('Content-Type', 'image/png'); res.send(emptyPng); }
  });

  // Cache stats
  app.get('/api/cache-stats', (req, res) => {
    const stats = {};

    for (const layer of Object.keys(TILE_SOURCES)) {
      const layerDir = path.join(tilesDir, layer);
      let count = 0;
      let size = 0;

      if (fs.existsSync(layerDir)) {
        function countDir(dir) {
          try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
              if (entry.isDirectory()) {
                countDir(path.join(dir, entry.name));
              } else {
                count++;
                try { size += fs.statSync(path.join(dir, entry.name)).size; } catch (e) {}
              }
            }
          } catch (e) {}
        }
        countDir(layerDir);
      }

      stats[layer] = { tiles: count, sizeMB: (size / 1024 / 1024).toFixed(1) };
    }

    res.json(stats);
  });

  // Pre-fetch surrounding tiles
  app.post('/api/prefetch', (req, res) => {
    const { layer, z, x, y, radius } = req.body;
    const source = TILE_SOURCES[layer];
    if (!source) return res.json({ queued: 0 });

    const r = radius || 3;
    let queued = 0;

    for (let dz = 0; dz <= 1; dz++) {
      const tz = parseInt(z) + dz;
      const scale = Math.pow(2, dz);
      const cx = parseInt(x) * scale;
      const cy = parseInt(y) * scale;
      const tr = r * scale;

      for (let dx = -tr; dx <= tr; dx++) {
        for (let dy = -tr; dy <= tr; dy++) {
          const tx = cx + dx;
          const ty = cy + dy;
          if (tx < 0 || ty < 0) continue;

          const ext = source.ext;
          const tilePath = path.join(tilesDir, layer, String(tz), String(tx), `${ty}.${ext}`);

          if (!fs.existsSync(tilePath)) {
            fetchAndCacheTile(source, tz, tx, ty, tilePath);
            queued++;
          }
        }
      }
    }

    res.json({ queued });
  });
};
