const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const readline = require('readline');

// Tile sources
const SOURCES = {
  topo: {
    name: 'USGS Topo',
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',
    ext: 'png',
    maxZoom: 16
  },
  satellite: {
    name: 'USGS Satellite Imagery',
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
    ext: 'jpg',
    maxZoom: 16
  },
  blm: {
    name: 'BLM Surface Management',
    url: 'https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_Cached_without_PriUnk/MapServer/tile/{z}/{y}/{x}',
    ext: 'jpg',
    maxZoom: 15
  }
};

// Convert lat/lon to tile coordinates
function latLonToTile(lat, lon, zoom) {
  const n = Math.pow(2, zoom);
  const x = Math.floor((lon + 180) / 360 * n);
  const latRad = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  return { x, y };
}

// Count total tiles for a bounding box and zoom range
function countTiles(minLat, minLon, maxLat, maxLon, minZoom, maxZoom) {
  let total = 0;
  for (let z = minZoom; z <= maxZoom; z++) {
    const topLeft = latLonToTile(maxLat, minLon, z);
    const bottomRight = latLonToTile(minLat, maxLon, z);
    const width = bottomRight.x - topLeft.x + 1;
    const height = bottomRight.y - topLeft.y + 1;
    total += width * height;
  }
  return total;
}

// Download a single tile with retries
function downloadTile(url, destPath, retries = 3) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Skip if already downloaded
    if (fs.existsSync(destPath)) {
      resolve('cached');
      return;
    }

    const client = url.startsWith('https') ? https : http;
    const request = client.get(url, {
      headers: {
        'User-Agent': 'FieldMapper/1.0 (offline mining map tool)',
        'Accept': 'image/*'
      },
      timeout: 15000
    }, (res) => {
      if (res.statusCode === 200) {
        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve('downloaded');
        });
        file.on('error', (err) => {
          fs.unlinkSync(destPath);
          reject(err);
        });
      } else if (res.statusCode === 404) {
        resolve('not-found');
      } else if (retries > 0) {
        setTimeout(() => {
          downloadTile(url, destPath, retries - 1).then(resolve).catch(reject);
        }, 1000);
      } else {
        resolve('failed');
      }
    });

    request.on('error', (err) => {
      if (retries > 0) {
        setTimeout(() => {
          downloadTile(url, destPath, retries - 1).then(resolve).catch(reject);
        }, 1000);
      } else {
        resolve('failed');
      }
    });

    request.on('timeout', () => {
      request.destroy();
      if (retries > 0) {
        setTimeout(() => {
          downloadTile(url, destPath, retries - 1).then(resolve).catch(reject);
        }, 1000);
      } else {
        resolve('timeout');
      }
    });
  });
}

// Download tiles for a layer within a bounding box
async function downloadLayer(layerKey, minLat, minLon, maxLat, maxLon, minZoom, maxZoom, concurrency = 6) {
  const source = SOURCES[layerKey];
  if (!source) {
    console.log(`Unknown layer: ${layerKey}`);
    return;
  }

  const effectiveMaxZoom = Math.min(maxZoom, source.maxZoom);
  const totalTiles = countTiles(minLat, minLon, maxLat, maxLon, minZoom, effectiveMaxZoom);

  console.log(`\nDownloading ${source.name}: ~${totalTiles} tiles (zoom ${minZoom}-${effectiveMaxZoom})`);

  let downloaded = 0;
  let cached = 0;
  let failed = 0;
  let notFound = 0;
  let queue = [];

  for (let z = minZoom; z <= effectiveMaxZoom; z++) {
    const topLeft = latLonToTile(maxLat, minLon, z);
    const bottomRight = latLonToTile(minLat, maxLon, z);

    for (let x = topLeft.x; x <= bottomRight.x; x++) {
      for (let y = topLeft.y; y <= bottomRight.y; y++) {
        const url = source.url
          .replace('{z}', z)
          .replace('{x}', x)
          .replace('{y}', y);
        const destPath = path.join(__dirname, 'tiles', layerKey, String(z), String(x), `${y}.${source.ext}`);
        queue.push({ url, destPath });
      }
    }
  }

  // Process in batches
  for (let i = 0; i < queue.length; i += concurrency) {
    const batch = queue.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(({ url, destPath }) => downloadTile(url, destPath))
    );

    for (const result of results) {
      if (result === 'downloaded') downloaded++;
      else if (result === 'cached') cached++;
      else if (result === 'not-found') notFound++;
      else failed++;
    }

    const progress = Math.min(i + concurrency, queue.length);
    const pct = ((progress / queue.length) * 100).toFixed(1);
    process.stdout.write(`\r  Progress: ${progress}/${queue.length} (${pct}%) | New: ${downloaded} | Cached: ${cached} | Missing: ${notFound} | Failed: ${failed}`);
  }

  console.log(`\n  Done: ${downloaded} downloaded, ${cached} cached, ${notFound} not available, ${failed} failed`);
}

// Download BLM mining claims as GeoJSON for a bounding box
async function downloadBLMMiningClaims(minLat, minLon, maxLat, maxLon) {
  console.log('\nDownloading BLM Mining Claims (GeoJSON)...');

  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const destPath = path.join(dataDir, 'mining-claims.geojson');

  // BLM Mining Claims feature service - query by bounding box
  const bbox = `${minLon},${minLat},${maxLon},${maxLat}`;
  const params = new URLSearchParams({
    where: '1=1',
    geometry: bbox,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    f: 'geojson',
    resultRecordCount: '10000'
  });

  const url = `https://gis.blm.gov/arcgis/rest/services/mining/BLM_Natl_Mining_Claims_Active/MapServer/1/query?${params}`;

  return new Promise((resolve) => {
    https.get(url, {
      headers: { 'User-Agent': 'FieldMapper/1.0' },
      timeout: 30000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const geojson = JSON.parse(data);
          fs.writeFileSync(destPath, JSON.stringify(geojson, null, 2));
          const count = geojson.features ? geojson.features.length : 0;
          console.log(`  Saved ${count} mining claims to data/mining-claims.geojson`);
        } catch (e) {
          console.log(`  Warning: Could not parse mining claims response: ${e.message}`);
          console.log('  You may need to download this data manually from BLM GeoCommunicator.');
        }
        resolve();
      });
    }).on('error', (e) => {
      console.log(`  Warning: Could not download mining claims: ${e.message}`);
      resolve();
    });
  });
}

// Download PLSS (Public Land Survey System) grid as GeoJSON
async function downloadPLSS(minLat, minLon, maxLat, maxLon) {
  console.log('\nDownloading PLSS Township/Range grid (GeoJSON)...');

  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const destPath = path.join(dataDir, 'plss-sections.geojson');

  const bbox = `${minLon},${minLat},${maxLon},${maxLat}`;
  const params = new URLSearchParams({
    where: '1=1',
    geometry: bbox,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'FRSTDIVID,FRSTDIVNO,FRSTDIVTYP,TWNSHPNO,TWNSHPDIR,RANGENO,RANGEDIR,PLSSID',
    f: 'geojson',
    resultRecordCount: '5000'
  });

  const url = `https://gis.blm.gov/arcgis/rest/services/Cadastral/BLM_Natl_PLSS_CadNSDI/MapServer/2/query?${params}`;

  return new Promise((resolve) => {
    https.get(url, {
      headers: { 'User-Agent': 'FieldMapper/1.0' },
      timeout: 30000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const geojson = JSON.parse(data);
          fs.writeFileSync(destPath, JSON.stringify(geojson, null, 2));
          const count = geojson.features ? geojson.features.length : 0;
          console.log(`  Saved ${count} PLSS sections to data/plss-sections.geojson`);
        } catch (e) {
          console.log(`  Warning: Could not parse PLSS response: ${e.message}`);
        }
        resolve();
      });
    }).on('error', (e) => {
      console.log(`  Warning: Could not download PLSS data: ${e.message}`);
      resolve();
    });
  });
}

// Interactive CLI
async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise(resolve => rl.question(q, resolve));

  console.log('');
  console.log('=== Field Mapper - Tile Downloader ===');
  console.log('');
  console.log('This downloads map tiles for offline use while you have internet.');
  console.log('You need to specify the area you want to cover.');
  console.log('');
  console.log('Tip: Use Google Maps to find coordinates of your mining area.');
  console.log('     Right-click on the map and the lat/lon will be shown.');
  console.log('');

  // Get bounding box
  const centerLat = parseFloat(await ask('Center latitude (e.g. 39.5): '));
  const centerLon = parseFloat(await ask('Center longitude (e.g. -118.5): '));
  const radiusMiles = parseFloat(await ask('Radius in miles to cover (e.g. 10): '));

  // Convert miles to degrees (approximate)
  const latDeg = radiusMiles / 69;
  const lonDeg = radiusMiles / (69 * Math.cos(centerLat * Math.PI / 180));

  const minLat = centerLat - latDeg;
  const maxLat = centerLat + latDeg;
  const minLon = centerLon - lonDeg;
  const maxLon = centerLon + lonDeg;

  console.log(`\nBounding box: ${minLat.toFixed(4)}, ${minLon.toFixed(4)} to ${maxLat.toFixed(4)}, ${maxLon.toFixed(4)}`);

  const minZoom = parseInt(await ask('\nMin zoom level (default 8): ') || '8');
  const maxZoom = parseInt(await ask('Max zoom level (default 15, higher = more detail + more data): ') || '15');

  // Show estimates
  console.log('\nLayers to download:');
  const layers = ['topo', 'satellite', 'blm'];
  let totalAll = 0;
  for (const layer of layers) {
    const effectiveMax = Math.min(maxZoom, SOURCES[layer].maxZoom);
    const count = countTiles(minLat, minLon, maxLat, maxLon, minZoom, effectiveMax);
    totalAll += count;
    console.log(`  ${SOURCES[layer].name}: ~${count} tiles (zoom ${minZoom}-${effectiveMax})`);
  }
  const estSizeMB = (totalAll * 25 / 1024).toFixed(0); // ~25KB avg per tile
  console.log(`\nTotal: ~${totalAll} tiles (~${estSizeMB} MB estimated)`);
  console.log('Plus: BLM Mining Claims + PLSS sections (GeoJSON)');

  const confirm = await ask('\nProceed? (y/n): ');
  if (confirm.toLowerCase() !== 'y') {
    console.log('Cancelled.');
    rl.close();
    return;
  }

  // Download all layers
  for (const layer of layers) {
    const effectiveMax = Math.min(maxZoom, SOURCES[layer].maxZoom);
    await downloadLayer(layer, minLat, minLon, maxLat, maxLon, minZoom, effectiveMax);
  }

  // Download vector overlays
  await downloadBLMMiningClaims(minLat, minLon, maxLat, maxLon);
  await downloadPLSS(minLat, minLon, maxLat, maxLon);

  console.log('\n=== Download complete! ===');
  console.log('You can now run "npm start" and use the app offline.');
  console.log('');
  rl.close();
}

main().catch(console.error);
