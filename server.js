const express = require('express');
const http = require('http');
const https = require('https');
const { WebSocketServer } = require('ws');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();

const PORT = 3000;
const HTTPS_PORT = 3443;

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
  res.header('Access-Control-Allow-Headers', 'Content-Type');
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
  const msg = JSON.stringify({ type: 'waypoint', ...cleanWP });
  for (const client of mapClients) {
    if (client.readyState === 1) client.send(msg);
  }

  // Also append to a persistent waypoints file
  const wpFile = path.join(__dirname, 'data', 'waypoints.json');
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
    latestGPS = { ...data, type: 'gps', timestamp: Date.now() };
    const msg = JSON.stringify(latestGPS);
    for (const client of mapClients) {
      if (client.readyState === 1) client.send(msg);
    }
    res.json({ ok: true });
  } else {
    res.status(400).json({ error: 'lat and lon required' });
  }
});

// Health check / status
app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    gpsClients: gpsClients.size,
    mapClients: mapClients.size,
    latestGPS: latestGPS ? { lat: latestGPS.lat, lon: latestGPS.lon, timestamp: latestGPS.timestamp } : null,
    server: 'Field Mapper Laptop Server'
  });
});

// Get all saved waypoints
app.get('/api/waypoints', (req, res) => {
  const wpFile = path.join(__dirname, 'data', 'waypoints.json');
  if (fs.existsSync(wpFile)) {
    res.json(JSON.parse(fs.readFileSync(wpFile, 'utf8')));
  } else {
    res.json([]);
  }
});

// --- Sync from Chromebook ---
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
    const wpFile = path.join(__dirname, 'data', 'waypoints.json');
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

// --- Environmental metadata enrichment ---
// Fetches weather, elevation, sun, magnetic declination for a location
async function getLocationMetadata(lat, lon, timestamp) {
  const meta = {};
  const date = timestamp ? new Date(timestamp) : new Date();
  const dateStr = date.toISOString().split('T')[0];

  // Calculate date ranges for weather
  const weekAgo = new Date(date);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAhead = new Date(date);
  weekAhead.setDate(weekAhead.getDate() + 7);

  const promises = [];

  // 1. USGS Elevation (precise DEM elevation)
  promises.push(
    httpGet(`https://epqs.nationalmap.gov/v1/json?x=${lon}&y=${lat}&wkid=4326&units=Feet&includeDate=false`)
      .then(data => {
        try {
          const parsed = JSON.parse(data);
          meta.elevation_ft = parsed.value;
          meta.elevation_m = (parsed.value * 0.3048).toFixed(1);
          meta.elevation_source = 'USGS 3DEP';
        } catch (e) {}
      })
      .catch(() => {})
  );

  // 2. Weather: past week + forecast (Open-Meteo, free, no API key)
  const pastStart = weekAgo.toISOString().split('T')[0];
  const pastEnd = dateStr;
  promises.push(
    httpGet(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${pastStart}&end_date=${pastEnd}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max,weathercode&temperature_unit=fahrenheit&windspeed_unit=mph&precipitation_unit=inch&timezone=auto`)
      .then(data => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.daily) {
            meta.weather_past_week = {
              dates: parsed.daily.time,
              high_f: parsed.daily.temperature_2m_max,
              low_f: parsed.daily.temperature_2m_min,
              precip_in: parsed.daily.precipitation_sum,
              wind_max_mph: parsed.daily.windspeed_10m_max,
              weather_codes: parsed.daily.weathercode
            };
          }
        } catch (e) {}
      })
      .catch(() => {})
  );

  // 3. Weather forecast (next 7 days)
  const futureEnd = weekAhead.toISOString().split('T')[0];
  promises.push(
    httpGet(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,windspeed_10m_max,weathercode&temperature_unit=fahrenheit&windspeed_unit=mph&precipitation_unit=inch&timezone=auto`)
      .then(data => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.daily) {
            meta.weather_forecast = {
              dates: parsed.daily.time,
              high_f: parsed.daily.temperature_2m_max,
              low_f: parsed.daily.temperature_2m_min,
              precip_in: parsed.daily.precipitation_sum,
              precip_prob: parsed.daily.precipitation_probability_max,
              wind_max_mph: parsed.daily.windspeed_10m_max,
              weather_codes: parsed.daily.weathercode
            };
          }
          if (parsed.elevation) meta.openmeteo_elevation_m = parsed.elevation;
        } catch (e) {}
      })
      .catch(() => {})
  );

  // 4. Current conditions
  promises.push(
    httpGet(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weathercode,windspeed_10m,winddirection_10m,pressure_msl&temperature_unit=fahrenheit&windspeed_unit=mph&precipitation_unit=inch&timezone=auto`)
      .then(data => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.current) {
            meta.current_weather = {
              temp_f: parsed.current.temperature_2m,
              feels_like_f: parsed.current.apparent_temperature,
              humidity_pct: parsed.current.relative_humidity_2m,
              precipitation_in: parsed.current.precipitation,
              wind_mph: parsed.current.windspeed_10m,
              wind_dir_deg: parsed.current.winddirection_10m,
              pressure_hpa: parsed.current.pressure_msl,
              weather_code: parsed.current.weathercode
            };
          }
        } catch (e) {}
      })
      .catch(() => {})
  );

  // 5. NOAA Magnetic Declination
  const year = date.getFullYear() + (date.getMonth() / 12);
  promises.push(
    httpGet(`https://www.ngdc.noaa.gov/geomag-web/calculators/calculateDeclination?lat1=${lat}&lon1=${lon}&key=zNEw7&resultFormat=json&startYear=${year.toFixed(2)}`)
      .then(data => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.result && parsed.result[0]) {
            meta.magnetic_declination = {
              degrees: parsed.result[0].declination.toFixed(2),
              description: parsed.result[0].declination > 0 ? 'East' : 'West'
            };
          }
        } catch (e) {}
      })
      .catch(() => {})
  );

  // 6. Sun position (calculated, no API needed)
  const sunPos = calculateSunPosition(lat, lon, date);
  meta.sun = sunPos;

  // 7. Timezone info
  meta.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  meta.local_time = date.toLocaleString();

  await Promise.all(promises);
  return meta;
}

// Sun position calculator
function calculateSunPosition(lat, lon, date) {
  const dayOfYear = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 86400000);
  const hour = date.getHours() + date.getMinutes() / 60;

  // Solar declination
  const declination = 23.45 * Math.sin(2 * Math.PI * (284 + dayOfYear) / 365) * Math.PI / 180;
  const latRad = lat * Math.PI / 180;

  // Hour angle
  const solarNoon = 12 - lon / 15; // approximate
  const hourAngle = (hour - solarNoon) * 15 * Math.PI / 180;

  // Altitude
  const sinAlt = Math.sin(latRad) * Math.sin(declination) +
    Math.cos(latRad) * Math.cos(declination) * Math.cos(hourAngle);
  const altitude = Math.asin(sinAlt) * 180 / Math.PI;

  // Azimuth
  const cosAz = (Math.sin(declination) - Math.sin(latRad) * sinAlt) /
    (Math.cos(latRad) * Math.cos(Math.asin(sinAlt)));
  let azimuth = Math.acos(Math.max(-1, Math.min(1, cosAz))) * 180 / Math.PI;
  if (hourAngle > 0) azimuth = 360 - azimuth;

  // Day length
  const cosHA = -Math.tan(latRad) * Math.tan(declination);
  const dayLength = cosHA >= 1 ? 0 : cosHA <= -1 ? 24 : 2 * Math.acos(cosHA) * 12 / Math.PI;

  // Sunrise/sunset times (approximate)
  const sunrise = solarNoon - dayLength / 2;
  const sunset = solarNoon + dayLength / 2;

  return {
    altitude_deg: altitude.toFixed(1),
    azimuth_deg: azimuth.toFixed(1),
    day_length_hrs: dayLength.toFixed(1),
    sunrise_approx: `${Math.floor(sunrise)}:${String(Math.round((sunrise % 1) * 60)).padStart(2, '0')}`,
    sunset_approx: `${Math.floor(sunset)}:${String(Math.round((sunset % 1) * 60)).padStart(2, '0')}`
  };
}

// Weather code to description
function weatherCodeToText(code) {
  const codes = {
    0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
    45: 'Fog', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
    61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
    71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow', 77: 'Snow grains',
    80: 'Slight showers', 81: 'Moderate showers', 82: 'Violent showers',
    85: 'Slight snow showers', 86: 'Heavy snow showers',
    95: 'Thunderstorm', 96: 'Thunderstorm w/ hail', 99: 'Thunderstorm w/ heavy hail'
  };
  return codes[code] || `Code ${code}`;
}

// Endpoint to get metadata for a location (used by AI and displayed in UI)
app.get('/api/metadata', async (req, res) => {
  const { lat, lon, timestamp } = req.query;
  if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' });
  try {
    const meta = await getLocationMetadata(parseFloat(lat), parseFloat(lon), timestamp);
    res.json(meta);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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

// --- AI Analysis ---
// Load API key from config file
const configFile = path.join(__dirname, 'config.json');
function getConfig() {
  if (fs.existsSync(configFile)) {
    try { return JSON.parse(fs.readFileSync(configFile, 'utf8')); } catch (e) {}
  }
  return {};
}

app.post('/api/config', (req, res) => {
  const config = { ...getConfig(), ...req.body };
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  res.json({ ok: true });
});

app.get('/api/config', (req, res) => {
  const config = getConfig();
  // Mask API key for security
  if (config.anthropicApiKey) {
    config.anthropicApiKeySet = true;
    config.anthropicApiKey = '****' + config.anthropicApiKey.slice(-4);
  }
  res.json(config);
});

app.post('/api/ai/analyze', async (req, res) => {
  const config = getConfig();
  if (!config.anthropicApiKey) {
    return res.status(400).json({ error: 'API key not configured. Go to Settings to add your Anthropic API key.' });
  }

  const { waypointId, waypoints: allWaypoints } = req.body;
  const wpFile = path.join(__dirname, 'data', 'waypoints.json');
  let localWaypoints = allWaypoints;
  if (!localWaypoints && fs.existsSync(wpFile)) {
    localWaypoints = JSON.parse(fs.readFileSync(wpFile, 'utf8'));
  }

  if (!localWaypoints || localWaypoints.length === 0) {
    return res.status(400).json({ error: 'No waypoints to analyze.' });
  }

  const target = waypointId
    ? localWaypoints.find(w => w.id === waypointId)
    : null;

  // Fetch environmental metadata for the area
  const refPoint = target || localWaypoints[0];
  let metadata = {};
  try {
    metadata = await getLocationMetadata(refPoint.lat, refPoint.lon, refPoint.timestamp);
    console.log('  Fetched environmental metadata for AI context');
  } catch (e) {
    console.log('  Warning: Could not fetch metadata:', e.message);
  }

  // Build context about all waypoints in the area
  let waypointContext = localWaypoints.map(wp => {
    let desc = `${wp.name} (${wp.category}) at ${wp.lat.toFixed(6)}, ${wp.lon.toFixed(6)}`;
    if (wp.altitude) desc += `, GPS elev ${(wp.altitude * 3.28084).toFixed(0)} ft`;
    if (wp.accuracy) desc += `, GPS accuracy ${wp.accuracy.toFixed(0)}m`;
    desc += `, time: ${wp.timestamp}`;
    if (wp.notes) desc += `\n  Notes: ${wp.notes}`;
    if (wp.samples) {
      wp.samples.forEach(s => {
        desc += `\n  Sample ${s.id}: ${s.type}`;
        if (s.rockType) desc += `, rock: ${s.rockType}`;
        if (s.mineralization) desc += `, mineralization: ${s.mineralization}`;
        if (s.alteration) desc += `, alteration: ${s.alteration}`;
        if (s.description) desc += `, notes: ${s.description}`;
      });
    }
    if (wp.photos && wp.photos.length > 0) desc += `\n  [${wp.photos.length} photo(s) attached]`;
    return desc;
  }).join('\n\n');

  // Build photo content blocks for the target waypoint
  const contentBlocks = [];

  contentBlocks.push({
    type: 'text',
    text: buildPrompt(target, waypointContext, localWaypoints, metadata)
  });

  // Include photos if analyzing a specific waypoint
  if (target && target.photos && target.photos.length > 0) {
    for (const filename of target.photos) {
      const filePath = path.join(photosDir, filename);
      if (fs.existsSync(filePath)) {
        const imageData = fs.readFileSync(filePath).toString('base64');
        const ext = path.extname(filename).toLowerCase();
        const mediaType = ext === '.png' ? 'image/png' : 'image/jpeg';
        contentBlocks.push({
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: imageData }
        });
        contentBlocks.push({
          type: 'text',
          text: `[Photo: ${filename}]`
        });
      }
    }
  }

  try {
    const response = await callClaude(config.anthropicApiKey, contentBlocks);
    res.json({ analysis: response });
  } catch (e) {
    console.error('AI analysis failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

function buildPrompt(target, waypointContext, allWaypoints, metadata) {
  let centerLat = 0, centerLon = 0;
  if (allWaypoints.length > 0) {
    centerLat = allWaypoints.reduce((s, w) => s + w.lat, 0) / allWaypoints.length;
    centerLon = allWaypoints.reduce((s, w) => s + w.lon, 0) / allWaypoints.length;
  }

  let prompt = `You are a field geology and mining exploration assistant. The user is prospecting and collecting field observations. Analyze their data and provide useful geological insights. Use all available metadata to inform your analysis.

AREA: The prospecting area is centered around approximately ${centerLat.toFixed(4)}, ${centerLon.toFixed(4)}.
`;

  // Add environmental metadata
  if (metadata) {
    prompt += '\n--- ENVIRONMENTAL DATA ---\n';

    if (metadata.elevation_ft) {
      prompt += `DEM Elevation: ${metadata.elevation_ft} ft (${metadata.elevation_m} m) [${metadata.elevation_source}]\n`;
    }

    if (metadata.magnetic_declination) {
      prompt += `Magnetic Declination: ${metadata.magnetic_declination.degrees}° ${metadata.magnetic_declination.description} (important for compass/strike corrections)\n`;
    }

    if (metadata.sun) {
      prompt += `Sun: altitude ${metadata.sun.altitude_deg}°, azimuth ${metadata.sun.azimuth_deg}°, day length ${metadata.sun.day_length_hrs} hrs, sunrise ~${metadata.sun.sunrise_approx}, sunset ~${metadata.sun.sunset_approx}\n`;
    }

    if (metadata.current_weather) {
      const cw = metadata.current_weather;
      prompt += `Current Weather: ${cw.temp_f}°F (feels like ${cw.feels_like_f}°F), humidity ${cw.humidity_pct}%, wind ${cw.wind_mph} mph from ${cw.wind_dir_deg}°, pressure ${cw.pressure_hpa} hPa, ${weatherCodeToText(cw.weather_code)}\n`;
    }

    if (metadata.weather_past_week) {
      const pw = metadata.weather_past_week;
      prompt += '\nWeather Past 7 Days:\n';
      for (let i = 0; i < pw.dates.length; i++) {
        const precip = pw.precip_in[i] || 0;
        prompt += `  ${pw.dates[i]}: ${pw.high_f[i]}°F/${pw.low_f[i]}°F, precip ${precip.toFixed(2)}in, wind ${pw.wind_max_mph[i]} mph, ${weatherCodeToText(pw.weather_codes[i])}\n`;
      }
      const totalPrecip = pw.precip_in.reduce((s, v) => s + (v || 0), 0);
      prompt += `  Total precipitation past week: ${totalPrecip.toFixed(2)} inches\n`;
    }

    if (metadata.weather_forecast) {
      const wf = metadata.weather_forecast;
      prompt += '\nWeather Forecast (next 7 days):\n';
      for (let i = 0; i < Math.min(wf.dates.length, 7); i++) {
        const precip = wf.precip_in[i] || 0;
        prompt += `  ${wf.dates[i]}: ${wf.high_f[i]}°F/${wf.low_f[i]}°F, ${wf.precip_prob[i]}% chance precip (${precip.toFixed(2)}in), wind ${wf.wind_max_mph[i]} mph\n`;
      }
    }

    prompt += '--- END ENVIRONMENTAL DATA ---\n';
  }

  prompt += `\nALL FIELD OBSERVATIONS COLLECTED:\n${waypointContext}\n`;

  if (target) {
    prompt += `
FOCUS WAYPOINT: "${target.name}" at ${target.lat.toFixed(6)}, ${target.lon.toFixed(6)}
Collected: ${target.timestamp}
${target.altitude ? `GPS Elevation: ${(target.altitude * 3.28084).toFixed(0)} ft` : ''}
${target.accuracy ? `GPS Accuracy: ${target.accuracy.toFixed(0)} meters` : ''}
${target.notes ? `Notes: ${target.notes}` : ''}
${target.samples ? target.samples.map(s => `Sample ${s.id}: type=${s.type}, rock=${s.rockType || 'unknown'}, mineralization=${s.mineralization || 'none noted'}, alteration=${s.alteration || 'none noted'}`).join('\n') : ''}
${target.photos && target.photos.length > 0 ? `\nPhotos are attached. Analyze what you see in the images.` : ''}

Please provide:
1. **Photo Analysis** (if photos attached): Describe what you observe — rock type, texture, color, any visible mineralization, structures, weathering, or features of interest. Note lighting conditions based on sun position data.
2. **Geological Interpretation**: What does this tell us about the geology here? What formation or rock unit might this be? Consider the elevation and terrain context.
3. **Mineralization Assessment**: Any indicators of economic mineralization? What should the prospector look for nearby? How might recent weather (especially precipitation) affect surface expressions?
4. **Recommendations**: What should be sampled, tested, or investigated further at this location? Include compass correction note if strike/dip measurements are present (use magnetic declination data).
5. **Regional Context**: Based on the exact coordinates (${target.lat.toFixed(6)}, ${target.lon.toFixed(6)}), what is known about the geology, mining history, mining districts, known deposits, USGS surveys, geological maps, and mineral occurrence databases for this area? Be as specific as possible about formation names, district names, and historical mines.
6. **Weather Considerations**: Based on recent weather and forecast, any field safety concerns or effects on prospecting conditions? (e.g., flash flood risk in washes, fresh erosion exposing new material after rain, frozen ground, heat safety)
`;
  } else {
    prompt += `
Please provide a comprehensive analysis:
1. **Pattern Recognition**: Look across all observations. Are there geological patterns, trends in mineralization, structural alignments, or elevation-dependent changes connecting these points?
2. **Area Assessment**: Based on the coordinates and observations, what geological setting is this? What formations are likely present? What tectonic/structural context?
3. **Exploration Targets**: Which waypoints or areas look most promising and why? Where should the prospector focus next? Consider terrain, access, and elevation patterns.
4. **Regional Context**: Based on these exact coordinates, what is known about mining history, geology, mining districts, known deposits, USGS surveys, geological maps, and mineral occurrence databases for this area? Be as specific as possible.
5. **Weather Impact**: How have recent weather conditions (see data above) affected field conditions? After recent precipitation, what areas might show fresh exposures or concentrated placers?
6. **Recommendations**: What additional observations, samples, or tests would help evaluate this area's potential? Any compass declination corrections needed? Field safety notes based on weather forecast?
`;
  }

  return prompt;
}

function callClaude(apiKey, contentBlocks) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: contentBlocks
      }]
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 120000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(parsed.error.message));
          } else if (parsed.content && parsed.content[0]) {
            resolve(parsed.content[0].text);
          } else {
            reject(new Error('Unexpected API response'));
          }
        } catch (e) {
          reject(new Error('Failed to parse API response'));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('API request timed out')); });
    req.write(body);
    req.end();
  });
}

// --- Tile sources (for fetching from internet) ---
const TILE_SOURCES = {
  // Base layers
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
  // Overlays (transparent)
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

// Track active fetches to avoid duplicate downloads of the same tile
const activeFetches = new Map();

// Concurrency limiter: max 4 simultaneous outbound tile fetches
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

  // If already fetching this tile, return the existing promise
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
            // Save to disk for permanent cache
            const dir = path.dirname(tilePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFile(tilePath, data, () => {}); // async write, don't block
            currentFetches--;
            runNext();
            resolve(data);
          });
        } else {
          currentFetches--;
          runNext();
          resolve(null); // tile doesn't exist at source
        }
      });

      req.on('error', () => { currentFetches--; runNext(); resolve(null); });
      req.on('timeout', () => { req.destroy(); currentFetches--; runNext(); resolve(null); });
    }

    // Queue or run immediately based on concurrency limit
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

// Serve tiles: cache-first, then fetch from internet and save permanently
app.get('/tiles/:layer/:z/:x/:y.png', async (req, res) => {
  const { layer, z, x, y } = req.params;
  const tilePath = path.join(__dirname, 'tiles', layer, z, x, `${y}.png`);

  // Serve from cache
  if (fs.existsSync(tilePath)) {
    res.setHeader('Content-Type', 'image/png');
    res.sendFile(tilePath);
    return;
  }

  // Try to fetch from internet
  const source = TILE_SOURCES[layer];
  if (source) {
    const data = await fetchAndCacheTile(source, z, x, y, tilePath);
    if (data) {
      res.setHeader('Content-Type', source.contentType);
      res.send(data);
      return;
    }
  }

  // No cache, no internet — return empty tile
  res.setHeader('Content-Type', 'image/png');
  res.send(emptyPng);
});

app.get('/tiles/:layer/:z/:x/:y.jpg', async (req, res) => {
  const { layer, z, x, y } = req.params;
  const tilePath = path.join(__dirname, 'tiles', layer, z, x, `${y}.jpg`);

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

// Contour overlay: dynamic export from USGS (not a tile cache)
// Converts tile coords to bbox and fetches from ArcGIS export endpoint
app.get('/tiles/contours/:z/:x/:y.png', async (req, res) => {
  const { z, x, y } = req.params;
  const tilePath = path.join(__dirname, 'tiles', 'contours', z, x, `${y}.png`);

  if (fs.existsSync(tilePath)) {
    res.setHeader('Content-Type', 'image/png');
    res.sendFile(tilePath);
    return;
  }

  // Convert tile coords to Web Mercator bbox
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

// Pre-fetch surrounding tiles in background when viewing an area
app.post('/api/prefetch', (req, res) => {
  const { layer, z, x, y, radius } = req.body;
  const source = TILE_SOURCES[layer];
  if (!source) return res.json({ queued: 0 });

  const r = radius || 3; // tiles in each direction
  let queued = 0;

  for (let dz = 0; dz <= 1; dz++) { // current zoom + one level deeper
    const tz = parseInt(z) + dz;
    const scale = Math.pow(2, dz); // at deeper zoom, tile coords double
    const cx = parseInt(x) * scale;
    const cy = parseInt(y) * scale;
    const tr = r * scale;

    for (let dx = -tr; dx <= tr; dx++) {
      for (let dy = -tr; dy <= tr; dy++) {
        const tx = cx + dx;
        const ty = cy + dy;
        if (tx < 0 || ty < 0) continue;

        const ext = source.ext;
        const tilePath = path.join(__dirname, 'tiles', layer, String(tz), String(tx), `${ty}.${ext}`);

        if (!fs.existsSync(tilePath)) {
          // Fetch in background, don't await
          fetchAndCacheTile(source, tz, tx, ty, tilePath);
          queued++;
        }
      }
    }
  }

  res.json({ queued });
});

// Cache stats
app.get('/api/cache-stats', (req, res) => {
  const stats = {};
  const tilesDir = path.join(__dirname, 'tiles');

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

// --- Route backup/sync ---
const routesFile = path.join(__dirname, 'data', 'routes.json');
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

app.get('/api/backup', (req, res) => {
  const wpFile = path.join(__dirname, 'data', 'waypoints.json');
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
  const filePath = path.join(__dirname, 'data', req.params.file);
  if (fs.existsSync(filePath)) {
    res.json(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// WebSocket: relay GPS from phone to map viewers
let latestGPS = null;
const mapClients = new Set();
const gpsClients = new Set();

function handleWSConnection(ws, req) {
  let role = 'map';
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    role = url.searchParams.get('role') || 'map';
  } catch (e) {
    // If URL parsing fails, check raw url string
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
