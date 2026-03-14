// Chromebook Field Server — lightweight, battery-friendly
// Only serves the phone marking page and stores waypoints + photos
// No maps, no tiles, no WebSocket streaming, no heavy processing

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 3000;
const DATA_DIR = path.join(__dirname, 'field-data');
const PHOTOS_DIR = path.join(DATA_DIR, 'photos');

// Ensure directories exist
if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });

// Waypoints file
const WP_FILE = path.join(DATA_DIR, 'waypoints.json');
function loadWaypoints() {
  if (fs.existsSync(WP_FILE)) {
    try { return JSON.parse(fs.readFileSync(WP_FILE, 'utf8')); } catch (e) {}
  }
  return [];
}
function saveWaypoint(wp) {
  const all = loadWaypoints();
  all.push(wp);
  fs.writeFileSync(WP_FILE, JSON.stringify(all));
}

// Read the phone page once at startup
const gpsPage = fs.readFileSync(path.join(__dirname, 'public', 'gps.html'), 'utf8');

// Simple body parser for JSON
function parseBody(req, maxSize = 50 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxSize) { reject(new Error('Too large')); return; }
      body += chunk;
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  // Phone marking page
  if (req.method === 'GET' && (req.url === '/' || req.url === '/gps.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(gpsPage);
    return;
  }

  // Receive waypoint with photos from phone
  if (req.method === 'POST' && req.url === '/api/waypoint') {
    try {
      const wp = await parseBody(req);
      const savedPhotos = [];

      // Save base64 photos to disk
      if (wp.photoData && wp.photoData.length > 0) {
        wp.photoData.forEach((dataUrl, i) => {
          const matches = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
          if (matches) {
            const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
            const filename = `${wp.id}-${i}.${ext}`;
            fs.writeFileSync(path.join(PHOTOS_DIR, filename), Buffer.from(matches[2], 'base64'));
            savedPhotos.push(filename);
          }
        });
      }

      const cleanWP = { ...wp, photos: savedPhotos };
      delete cleanWP.photoData;
      saveWaypoint(cleanWP);

      console.log(`+ ${cleanWP.name} (${savedPhotos.length} photos)`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, photos: savedPhotos }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // --- Sync endpoints (laptop pulls from here) ---

  // Get all waypoints
  if (req.method === 'GET' && req.url === '/api/sync/waypoints') {
    const waypoints = loadWaypoints();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(waypoints));
    return;
  }

  // List all photos
  if (req.method === 'GET' && req.url === '/api/sync/photo-list') {
    try {
      const files = fs.readdirSync(PHOTOS_DIR);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(files));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('[]');
    }
    return;
  }

  // Download a specific photo
  if (req.method === 'GET' && req.url.startsWith('/api/sync/photo/')) {
    const filename = path.basename(req.url.split('/').pop());
    const filePath = path.join(PHOTOS_DIR, filename);
    if (fs.existsSync(filePath)) {
      const ext = path.extname(filename).toLowerCase();
      const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
      res.writeHead(200, { 'Content-Type': mime, 'Content-Length': fs.statSync(filePath).size });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
    return;
  }

  // Status endpoint (laptop can check if Chromebook is reachable)
  if (req.method === 'GET' && req.url === '/api/sync/status') {
    const waypoints = loadWaypoints();
    let photoCount = 0;
    try { photoCount = fs.readdirSync(PHOTOS_DIR).length; } catch (e) {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      device: 'chromebook',
      waypoints: waypoints.length,
      photos: photoCount,
      uptime: process.uptime()
    }));
    return;
  }

  // 404 everything else
  res.writeHead(404);
  res.end('Not found');
});

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('');
  console.log('=== Field Mapper (Chromebook) ===');
  console.log('');
  console.log(`Phone: http://${ip}:${PORT}`);
  console.log('');
  console.log('Lightweight mode — collecting waypoints & photos only.');
  console.log('Sync to laptop when back at camp.');
  console.log('');
});
