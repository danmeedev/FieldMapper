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
const setupCatalogRoutes = require('./server/routes-catalog');
const { loadTombstones } = require('./server/tombstones');

const app = express();
const dataDir = process.env.FIELDMAPPER_DATA_DIR ? path.resolve(process.env.FIELDMAPPER_DATA_DIR) : path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const PORT = parseInt(process.env.FIELDMAPPER_PORT, 10) || 3000;
const HTTPS_PORT = parseInt(process.env.FIELDMAPPER_HTTPS_PORT, 10) || 3443;

// --- Self-signed HTTPS cert (required for phone GPS access) ---
const certDir = path.join(__dirname, 'certs');
const keyPath = path.join(certDir, 'key.pem');
const certPath = path.join(certDir, 'cert.pem');

function generateCert() {
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) return true;
  if (!fs.existsSync(certDir)) fs.mkdirSync(certDir, { recursive: true });

  console.log('Generating self-signed HTTPS certificate for phone GPS access...');
  try {
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" ` +
      `-days 365 -nodes -subj "/CN=fieldmapper"`,
      { stdio: 'pipe' }
    );
    console.log('Certificate generated.');
    return true;
  } catch (e) {
    console.warn('HTTPS is unavailable; laptop and native Android access remain available over HTTP.');
    return false;
  }
}

// The native APK uses GPS on-device and local HTTP for syncing. HTTPS is optional
// for the older phone-browser GPS page and never a portable-package prerequisite.
const httpsEnabled = process.env.FIELDMAPPER_HTTPS !== '0' && generateCert();
const httpServer = http.createServer(app);
const httpsServer = httpsEnabled ? https.createServer({
  key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath)
}, app) : null;
const wssHTTP = new WebSocketServer({ server: httpServer });
const wssHTTPS = httpsServer ? new WebSocketServer({ server: httpsServer }) : null;

// Parse JSON bodies (for waypoint data)
app.use(express.json({ limit: '50mb' }));

// CORS - allow mobile app to sync from any origin
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Review diagnostics avoid request bodies, query strings, and credentials.
if (process.env.FIELDMAPPER_REVIEW_LOGS === '1') {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      if (req.path.startsWith('/api/') || res.statusCode >= 400)
        console.log(`[request] ${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
    });
    next();
  });
}

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Serve uploaded photos
const photosDir = path.join(dataDir, 'photos');
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

// Client diagnostics are opt-in for the local review session.
if (process.env.FIELDMAPPER_REVIEW_LOGS === '1') {
  app.post('/api/client-log', (req, res) => {
    const level = ['error', 'warn', 'info'].includes(req.body?.level) ? req.body.level : 'info';
    const source = req.body?.source === 'mobile' ? 'mobile' : 'desktop';
    const message = String(req.body?.message || '').replace(/sk-ant-[a-zA-Z0-9_-]+/g, '[redacted]').replace(/[\r\n]/g, ' ').slice(0, 2000);
    console.log(`[client:${source}:${level}] ${message}`);
    res.json({ ok: true });
  });
}

// --- Shared state for WebSocket clients ---
let latestGPS = null;
const mapClients = new Set();
const gpsClients = new Set();

const configFile = process.env.FIELDMAPPER_CONFIG_FILE || path.join(__dirname, 'config.json');
const tilesDir = process.env.FIELDMAPPER_TILES_DIR || path.join(__dirname, 'tiles');

// --- Register route modules ---
setupWaypointRoutes(app, dataDir, {
  photosDir,
  getMapClients: () => mapClients,
  getLatestGPS: () => latestGPS,
  setLatestGPS: (gps) => { latestGPS = gps; }
});

const { loadRoutes } = setupRouteRoutes(app, dataDir, { photosDir });

const { loadSpecimens, loadDigOrders, loadOrders } = setupCatalogRoutes(app, dataDir, { photosDir });

setupTrackRoutes(app, dataDir);

setupAIRoutes(app, dataDir, configFile, { photosDir });

require('./server/routes-sharing')(app, dataDir);

setupTileProxy(app, tilesDir);

// --- Delete tombstones (for bidirectional sync reconciliation) ---
app.get('/api/tombstones', (req, res) => {
  res.json(loadTombstones(dataDir));
});

// --- Health check / status ---
app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    reviewLogs: process.env.FIELDMAPPER_REVIEW_LOGS === '1',
    connectionUrls: getConnectionUrls(),
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
  const specimens = loadSpecimens();
  const digOrders = loadDigOrders();
  const orders = loadOrders();

  res.json({
    exportDate: new Date().toISOString(),
    waypoints,
    routes,
    specimens,
    digOrders,
    orders,
    waypointCount: waypoints.length,
    routeCount: routes.length,
    specimenCount: specimens.length,
    digOrderCount: digOrders.length,
    orderCount: orders.length
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
if (wssHTTPS) wssHTTPS.on('connection', handleWSConnection);

// Show every active LAN candidate rather than silently choosing a VPN/virtual adapter.
function getConnectionUrls() {
  const urls = [];
  for (const [name, interfaces] of Object.entries(os.networkInterfaces())) {
    for (const iface of interfaces || []) {
      if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254.')) {
        urls.push({ interface: name, url: `http://${iface.address}:${PORT}` });
      }
    }
  }
  return urls;
}
httpServer.on('error', e => { console.error(`HTTP startup failed: ${e.message}`); process.exit(1); });
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log('\n=== Field Mapper ===');
  console.log(`PC browser: http://localhost:${PORT}`);
  console.log('Android app > Map > Settings > Laptop Server URL:');
  for (const entry of getConnectionUrls()) console.log(`  ${entry.interface}: ${entry.url}`);
  console.log('Keep this window open. Press Ctrl+C to stop.\n');
});
if (httpsServer) {
  httpsServer.on('error', e => console.warn(`Optional HTTPS unavailable: ${e.message}`));
  httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`Optional phone-browser GPS uses HTTPS port ${HTTPS_PORT} with a local self-signed certificate.`);
  });
}
