const express = require('express');
const http = require('http');
const https = require('https');
const { WebSocketServer } = require('ws');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// --- Module imports ---
const setupWaypointRoutes = require('./server/routes-waypoints');
const setupRouteRoutes = require('./server/routes-routes');
const setupTrackRoutes = require('./server/routes-tracks');
const setupAIRoutes = require('./server/routes-ai');
const setupTileProxy = require('./server/tile-proxy');

const app = express();

const PORT = parseInt(process.env.FIELDMAPPER_PORT, 10) || 3000;
const HTTPS_PORT = parseInt(process.env.FIELDMAPPER_HTTPS_PORT, 10) || 3443;

// --- Self-signed HTTPS cert (required for phone GPS access) ---
const certDir = path.join(__dirname, 'certs');
const keyPath = path.join(certDir, 'key.pem');
const certPath = path.join(certDir, 'cert.pem');

function generateCert() {
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) return;
  if (!fs.existsSync(certDir)) fs.mkdirSync(certDir, { recursive: true });

  console.log('Generating self-signed HTTPS certificate for phone GPS access...');
  try {
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" ` +
      `-days 365 -nodes -subj "/CN=fieldmapper"`,
      { stdio: 'pipe' }
    );
    console.log('Certificate generated.');
  } catch (e) {
    console.error('Could not generate certificate. openssl may not be installed.');
    console.error('Install it: https://slproweb.com/products/Win32OpenSSL.html');
    console.error('Or run: winget install ShiningLight.OpenSSL');
    process.exit(1);
  }
}

generateCert();

const sslOptions = {
  key: fs.readFileSync(keyPath),
  cert: fs.readFileSync(certPath)
};

const httpServer = http.createServer(app);
const httpsServer = https.createServer(sslOptions, app);

// WebSocket on both HTTP and HTTPS
const wssHTTP = new WebSocketServer({ server: httpServer });
const wssHTTPS = new WebSocketServer({ server: httpsServer });

// Parse JSON bodies (for waypoint data)
app.use(express.json({ limit: '50mb' }));

// CORS - allow mobile app to sync from any origin
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Serve uploaded photos
const photosDir = path.join(__dirname, 'data', 'photos');
if (!fs.existsSync(photosDir)) fs.mkdirSync(photosDir, { recursive: true });
app.use('/photos', express.static(photosDir));

// Optional Bearer token auth on /api/* routes
if (process.env.FIELDMAPPER_AUTH_TOKEN) {
  const authToken = process.env.FIELDMAPPER_AUTH_TOKEN;
  app.use('/api', (req, res, next) => {
    const header = req.headers.authorization;
    if (!header || header !== `Bearer ${authToken}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  });
  console.log('Auth token enabled for /api/* routes.');
}

// --- Shared state for WebSocket clients ---
let latestGPS = null;
const mapClients = new Set();
const gpsClients = new Set();

const dataDir = path.join(__dirname, 'data');
const configFile = path.join(__dirname, 'config.json');
const tilesDir = path.join(__dirname, 'tiles');

// --- Register route modules ---
setupWaypointRoutes(app, dataDir, {
  photosDir,
  getMapClients: () => mapClients,
  getLatestGPS: () => latestGPS,
  setLatestGPS: (gps) => { latestGPS = gps; }
});

const { loadRoutes } = setupRouteRoutes(app, dataDir, { photosDir });

setupTrackRoutes(app, dataDir);

setupAIRoutes(app, dataDir, configFile, { photosDir });

setupTileProxy(app, tilesDir);

// --- Health check / status ---
app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    gpsClients: gpsClients.size,
    mapClients: mapClients.size,
    latestGPS: latestGPS ? { lat: latestGPS.lat, lon: latestGPS.lon, timestamp: latestGPS.timestamp } : null,
    server: 'Field Mapper Laptop Server'
  });
});

// --- Sync from Chromebook ---
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { timeout: 10000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpGet(res.headers.location).then(resolve).catch(reject);
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(dest);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = fs.createWriteStream(dest);
    http.get(url, { timeout: 15000 }, (res) => {
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (e) => {
      fs.unlink(dest, () => {});
      reject(e);
    });
  });
}

app.post('/api/sync', async (req, res) => {
  const { chromebookIP } = req.body;
  if (!chromebookIP) return res.status(400).json({ error: 'chromebookIP required' });

  const baseUrl = `http://${chromebookIP}:3000`;
  console.log(`\nSyncing from Chromebook at ${baseUrl}...`);

  try {
    // 1. Check status
    const status = await httpGet(`${baseUrl}/api/sync/status`);
    const statusData = JSON.parse(status);
    console.log(`  Chromebook has ${statusData.waypoints} waypoints, ${statusData.photos} photos`);

    // 2. Pull waypoints
    const wpData = await httpGet(`${baseUrl}/api/sync/waypoints`);
    const remoteWaypoints = JSON.parse(wpData);

    // Merge with existing
    const wpFile = path.join(dataDir, 'waypoints.json');
    let localWaypoints = [];
    if (fs.existsSync(wpFile)) {
      try { localWaypoints = JSON.parse(fs.readFileSync(wpFile, 'utf8')); } catch (e) {}
    }

    const existingIds = new Set(localWaypoints.map(w => w.id));
    let newCount = 0;
    for (const wp of remoteWaypoints) {
      if (!existingIds.has(wp.id)) {
        localWaypoints.push(wp);
        newCount++;
      }
    }
    fs.writeFileSync(wpFile, JSON.stringify(localWaypoints, null, 2));
    console.log(`  Merged ${newCount} new waypoints`);

    // 3. Pull photos
    const photoListData = await httpGet(`${baseUrl}/api/sync/photo-list`);
    const remotePhotos = JSON.parse(photoListData);
    let photosDownloaded = 0;

    for (const filename of remotePhotos) {
      const localPath = path.join(photosDir, filename);
      if (!fs.existsSync(localPath)) {
        try {
          await downloadFile(`${baseUrl}/api/sync/photo/${filename}`, localPath);
          photosDownloaded++;
          process.stdout.write(`\r  Photos: ${photosDownloaded}/${remotePhotos.length}`);
        } catch (e) {
          console.log(`  Warning: failed to download ${filename}`);
        }
      }
    }
    if (photosDownloaded > 0) console.log('');
    console.log(`  Downloaded ${photosDownloaded} new photos`);

    // Notify map viewers to reload
    const msg = JSON.stringify({ type: 'sync-complete', newWaypoints: newCount, newPhotos: photosDownloaded });
    for (const client of mapClients) {
      if (client.readyState === 1) client.send(msg);
    }

    res.json({ ok: true, newWaypoints: newCount, newPhotos: photosDownloaded, totalWaypoints: localWaypoints.length });
  } catch (e) {
    console.error('  Sync failed:', e.message);
    res.status(500).json({ error: `Sync failed: ${e.message}` });
  }
});

// --- Backup ---
app.get('/api/backup', (req, res) => {
  const wpFile = path.join(dataDir, 'waypoints.json');
  const waypoints = fs.existsSync(wpFile) ? JSON.parse(fs.readFileSync(wpFile, 'utf8')) : [];
  const routes = loadRoutes();

  res.json({
    exportDate: new Date().toISOString(),
    waypoints,
    routes,
    waypointCount: waypoints.length,
    routeCount: routes.length
  });
});

// Serve GeoJSON overlay data
app.get('/data/:file', (req, res) => {
  const filePath = path.join(dataDir, req.params.file);
  if (fs.existsSync(filePath)) {
    res.json(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// --- WebSocket: relay GPS from phone to map viewers ---
function handleWSConnection(ws, req) {
  let role = 'map';
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    role = url.searchParams.get('role') || 'map';
  } catch (e) {
    if (req.url && req.url.includes('role=gps')) role = 'gps';
  }

  if (role === 'gps') {
    gpsClients.add(ws);
    console.log(`Phone GPS connected (total GPS clients: ${gpsClients.size})`);

    ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        latestGPS = { ...parsed, timestamp: Date.now() };
        const msg = JSON.stringify(latestGPS);
        for (const client of mapClients) {
          if (client.readyState === 1) client.send(msg);
        }
      } catch (e) {
        console.error('Bad GPS data:', e.message);
      }
    });

    ws.on('close', () => {
      gpsClients.delete(ws);
      console.log(`Phone GPS disconnected (remaining: ${gpsClients.size})`);
    });

    ws.on('error', (e) => {
      console.error('GPS WebSocket error:', e.message);
    });
  } else {
    mapClients.add(ws);
    console.log(`Map viewer connected (total viewers: ${mapClients.size})`);
    if (latestGPS) ws.send(JSON.stringify(latestGPS));

    ws.on('close', () => {
      mapClients.delete(ws);
      console.log(`Map viewer disconnected (remaining: ${mapClients.size})`);
    });
  }
}

wssHTTP.on('connection', handleWSConnection);
wssHTTPS.on('connection', handleWSConnection);

// Get local IP for phone connection
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

httpServer.listen(PORT, '0.0.0.0', () => {
  httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    const ip = getLocalIP();
    console.log('');
    console.log('=== Field Mapper ===');
    console.log('');
    console.log(`Map viewer (laptop):  http://localhost:${PORT}`);
    console.log('');
    console.log(`Phone (use HTTPS for GPS):`);
    console.log(`  https://${ip}:${HTTPS_PORT}/gps.html`);
    console.log('');
    console.log('Your phone will show a security warning for the self-signed cert.');
    console.log('Tap "Advanced" then "Proceed" — this is safe, it\'s your own server.');
    console.log('');
    console.log('Load the page ONCE while connected to cache it for offline use.');
    console.log('');
  });
});
