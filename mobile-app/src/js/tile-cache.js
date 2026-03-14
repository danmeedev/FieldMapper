// Tile Cache - IndexedDB-backed tile storage with direct fetching from tile servers
// Replaces the Express server tile proxy for the mobile app

const TILE_DB_NAME = 'fieldmapper-tiles';
const TILE_DB_VERSION = 1;
const TILE_STORE = 'tiles';

// Same tile sources as server.js
const TILE_SOURCES = {
  topo: {
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',
    type: 'image/png', maxZoom: 16
  },
  satellite: {
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
    type: 'image/jpeg', maxZoom: 16
  },
  'satellite-hd': {
    url: 'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    type: 'image/jpeg', maxZoom: 20
  },
  'imagery-topo': {
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}',
    type: 'image/jpeg', maxZoom: 16
  },
  blm: {
    url: 'https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_Cached_without_PriUnk/MapServer/tile/{z}/{y}/{x}',
    type: 'image/jpeg', maxZoom: 15
  },
  'esri-topo': {
    url: 'https://services.arcgisonline.com/arcgis/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    type: 'image/jpeg', maxZoom: 19
  },
  'esri-street': {
    url: 'https://services.arcgisonline.com/arcgis/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    type: 'image/jpeg', maxZoom: 19
  },
  natgeo: {
    url: 'https://services.arcgisonline.com/arcgis/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}',
    type: 'image/jpeg', maxZoom: 16
  },
  relief: {
    url: 'https://services.arcgisonline.com/arcgis/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}',
    type: 'image/jpeg', maxZoom: 13
  },
  terrain: {
    url: 'https://services.arcgisonline.com/arcgis/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}',
    type: 'image/jpeg', maxZoom: 13
  },
  streets: {
    url: 'https://services.arcgisonline.com/arcgis/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
    type: 'image/png', maxZoom: 18
  },
  labels: {
    url: 'https://services.arcgisonline.com/arcgis/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    type: 'image/png', maxZoom: 18
  },
  hydro: {
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSHydroCached/MapServer/tile/{z}/{y}/{x}',
    type: 'image/png', maxZoom: 16
  },
  trails: {
    url: 'https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png',
    type: 'image/png', maxZoom: 18
  },
  'land-ownership': {
    url: 'https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_Cached_with_PriUnk/MapServer/tile/{z}/{y}/{x}',
    type: 'image/png', maxZoom: 15
  }
};

let tileDB = null;
const objectURLs = new Map(); // Track URLs to revoke

function openTileDB() {
  return new Promise((resolve, reject) => {
    if (tileDB) { resolve(tileDB); return; }
    const req = indexedDB.open(TILE_DB_NAME, TILE_DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(TILE_STORE)) {
        db.createObjectStore(TILE_STORE);
      }
    };
    req.onsuccess = (e) => { tileDB = e.target.result; resolve(tileDB); };
    req.onerror = (e) => reject(e.target.error);
  });
}

function getTileFromCache(key) {
  return new Promise((resolve) => {
    const tx = tileDB.transaction(TILE_STORE, 'readonly');
    const req = tx.objectStore(TILE_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

function putTileInCache(key, blob) {
  return new Promise((resolve) => {
    const tx = tileDB.transaction(TILE_STORE, 'readwrite');
    tx.objectStore(TILE_STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

// Concurrency limiter for tile fetches
const MAX_CONCURRENT = 6;
let activeFetches = 0;
const fetchQueue = [];

function throttledFetch(url) {
  return new Promise((resolve, reject) => {
    function doFetch() {
      activeFetches++;
      fetch(url)
        .then(r => { activeFetches--; runQueue(); resolve(r); })
        .catch(e => { activeFetches--; runQueue(); reject(e); });
    }
    if (activeFetches < MAX_CONCURRENT) doFetch();
    else fetchQueue.push(doFetch);
  });
}

function runQueue() {
  while (fetchQueue.length > 0 && activeFetches < MAX_CONCURRENT) {
    fetchQueue.shift()();
  }
}

// Custom Leaflet TileLayer that caches in IndexedDB
L.TileLayer.Cached = L.TileLayer.extend({
  _sourceId: null,

  initialize: function(sourceId, options) {
    this._sourceId = sourceId;
    const source = TILE_SOURCES[sourceId];
    // Use a dummy URL template - we override tile loading
    L.TileLayer.prototype.initialize.call(this, '', {
      maxZoom: source ? source.maxZoom : 18,
      maxNativeZoom: source ? source.maxZoom : 18,
      ...options
    });
  },

  createTile: function(coords, done) {
    const tile = document.createElement('img');
    tile.alt = '';
    tile.setAttribute('role', 'presentation');

    const source = TILE_SOURCES[this._sourceId];
    if (!source) { done(new Error('Unknown source'), tile); return tile; }

    const key = `${this._sourceId}/${coords.z}/${coords.x}/${coords.y}`;

    openTileDB().then(async () => {
      // Check cache first
      const cached = await getTileFromCache(key);
      if (cached) {
        const url = URL.createObjectURL(cached);
        tile.onload = () => { URL.revokeObjectURL(url); done(null, tile); };
        tile.onerror = () => { URL.revokeObjectURL(url); done(new Error('Load error'), tile); };
        tile.src = url;
        return;
      }

      // Fetch from server
      const tileUrl = source.url
        .replace('{z}', coords.z)
        .replace('{x}', coords.x)
        .replace('{y}', coords.y);

      try {
        const resp = await throttledFetch(tileUrl);
        if (resp.ok) {
          const blob = await resp.blob();
          // Cache it
          putTileInCache(key, blob);
          const url = URL.createObjectURL(blob);
          tile.onload = () => { URL.revokeObjectURL(url); done(null, tile); };
          tile.onerror = () => { URL.revokeObjectURL(url); done(new Error('Load error'), tile); };
          tile.src = url;
        } else {
          done(new Error('Tile not found'), tile);
        }
      } catch (e) {
        done(e, tile);
      }
    }).catch(() => done(new Error('DB error'), tile));

    return tile;
  }
});

// Contour tiles (dynamic export, not standard tile URL)
L.TileLayer.Contours = L.TileLayer.extend({
  createTile: function(coords, done) {
    const tile = document.createElement('img');
    tile.alt = '';
    const key = `contours/${coords.z}/${coords.x}/${coords.y}`;

    // Convert tile coords to Web Mercator bbox
    const n = Math.pow(2, coords.z);
    const tileSize = 20037508.342789244 * 2 / n;
    const xMin = -20037508.342789244 + coords.x * tileSize;
    const xMax = xMin + tileSize;
    const yMax = 20037508.342789244 - coords.y * tileSize;
    const yMin = yMax - tileSize;

    const exportUrl = `https://carto.nationalmap.gov/arcgis/rest/services/contours/MapServer/export?` +
      `bbox=${xMin},${yMin},${xMax},${yMax}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image`;

    openTileDB().then(async () => {
      const cached = await getTileFromCache(key);
      if (cached) {
        const url = URL.createObjectURL(cached);
        tile.onload = () => { URL.revokeObjectURL(url); done(null, tile); };
        tile.onerror = () => { URL.revokeObjectURL(url); done(new Error('Load error'), tile); };
        tile.src = url;
        return;
      }

      try {
        const resp = await throttledFetch(exportUrl);
        if (resp.ok) {
          const blob = await resp.blob();
          putTileInCache(key, blob);
          const url = URL.createObjectURL(blob);
          tile.onload = () => { URL.revokeObjectURL(url); done(null, tile); };
          tile.onerror = () => { URL.revokeObjectURL(url); done(new Error('Load error'), tile); };
          tile.src = url;
        } else { done(null, tile); }
      } catch (e) { done(null, tile); }
    }).catch(() => done(null, tile));

    return tile;
  }
});

// NOAA Weather Radar (live, not cached - uses ArcGIS export like contours)
L.TileLayer.NOAARadar = L.TileLayer.extend({
  createTile: function(coords, done) {
    const tile = document.createElement('img');
    tile.alt = '';

    const n = Math.pow(2, coords.z);
    const tileSize = 20037508.342789244 * 2 / n;
    const xMin = -20037508.342789244 + coords.x * tileSize;
    const xMax = xMin + tileSize;
    const yMax = 20037508.342789244 - coords.y * tileSize;
    const yMin = yMax - tileSize;

    const exportUrl = `https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity/MapServer/export?` +
      `bbox=${xMin},${yMin},${xMax},${yMax}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image`;

    // Don't cache radar - always fetch live
    throttledFetch(exportUrl)
      .then(resp => {
        if (resp.ok) return resp.blob();
        throw new Error('No radar');
      })
      .then(blob => {
        const url = URL.createObjectURL(blob);
        tile.onload = () => { URL.revokeObjectURL(url); done(null, tile); };
        tile.onerror = () => { URL.revokeObjectURL(url); done(null, tile); };
        tile.src = url;
      })
      .catch(() => done(null, tile));

    return tile;
  }
});

// NOAA Wind overlay (NDFD WMS)
function createWindLayer(options) {
  return L.tileLayer.wms('https://digital.weather.gov/wms', {
    layers: 'ndfd.conus.windspd',
    format: 'image/png',
    transparent: true,
    opacity: 0.5,
    ...options
  });
}

function createRadarLayer(options) {
  return new L.TileLayer.NOAARadar('', { maxZoom: 18, opacity: 0.6, ...options });
}

// Factory functions
function createCachedTileLayer(sourceId, options) {
  return new L.TileLayer.Cached(sourceId, options);
}

function createContourLayer(options) {
  return new L.TileLayer.Contours('', { maxZoom: 16, opacity: 0.7, ...options });
}

// Download tiles for an area (for offline use)
async function downloadArea(sourceId, bounds, minZoom, maxZoom, onProgress) {
  await openTileDB();
  const source = TILE_SOURCES[sourceId];
  if (!source) return;

  const effectiveMax = Math.min(maxZoom, source.maxZoom);
  const tiles = [];

  for (let z = minZoom; z <= effectiveMax; z++) {
    const n = Math.pow(2, z);
    const xMin = Math.floor((bounds.getWest() + 180) / 360 * n);
    const xMax = Math.floor((bounds.getEast() + 180) / 360 * n);
    const latRadN = bounds.getNorth() * Math.PI / 180;
    const latRadS = bounds.getSouth() * Math.PI / 180;
    const yMin = Math.floor((1 - Math.log(Math.tan(latRadN) + 1 / Math.cos(latRadN)) / Math.PI) / 2 * n);
    const yMax = Math.floor((1 - Math.log(Math.tan(latRadS) + 1 / Math.cos(latRadS)) / Math.PI) / 2 * n);

    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        tiles.push({ z, x, y });
      }
    }
  }

  let done = 0;
  for (const t of tiles) {
    const key = `${sourceId}/${t.z}/${t.x}/${t.y}`;
    const cached = await getTileFromCache(key);
    if (!cached) {
      const tileUrl = source.url.replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y);
      try {
        const resp = await throttledFetch(tileUrl);
        if (resp.ok) {
          const blob = await resp.blob();
          await putTileInCache(key, blob);
        }
      } catch (e) { /* skip failed tiles */ }
    }
    done++;
    if (onProgress) onProgress(done, tiles.length);
  }
}

// Cache stats
async function getCacheStats() {
  await openTileDB();
  return new Promise((resolve) => {
    const tx = tileDB.transaction(TILE_STORE, 'readonly');
    const store = tx.objectStore(TILE_STORE);
    const req = store.count();
    req.onsuccess = () => resolve({ totalTiles: req.result });
    req.onerror = () => resolve({ totalTiles: 0 });
  });
}
