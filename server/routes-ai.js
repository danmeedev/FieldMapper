const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

// --- Helper: HTTP GET ---
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
async function getLocationMetadata(lat, lon, timestamp) {
  const meta = {};
  const date = timestamp ? new Date(timestamp) : new Date();
  const dateStr = date.toISOString().split('T')[0];

  const weekAgo = new Date(date);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAhead = new Date(date);
  weekAhead.setDate(weekAhead.getDate() + 7);

  const promises = [];

  // 1. USGS Elevation
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

  // 2. Weather: past week
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

  // 3. Weather forecast
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

  // 6. Sun position
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

  const declination = 23.45 * Math.sin(2 * Math.PI * (284 + dayOfYear) / 365) * Math.PI / 180;
  const latRad = lat * Math.PI / 180;

  const solarNoon = 12 - lon / 15;
  const hourAngle = (hour - solarNoon) * 15 * Math.PI / 180;

  const sinAlt = Math.sin(latRad) * Math.sin(declination) +
    Math.cos(latRad) * Math.cos(declination) * Math.cos(hourAngle);
  const altitude = Math.asin(sinAlt) * 180 / Math.PI;

  const cosAz = (Math.sin(declination) - Math.sin(latRad) * sinAlt) /
    (Math.cos(latRad) * Math.cos(Math.asin(sinAlt)));
  let azimuth = Math.acos(Math.max(-1, Math.min(1, cosAz))) * 180 / Math.PI;
  if (hourAngle > 0) azimuth = 360 - azimuth;

  const cosHA = -Math.tan(latRad) * Math.tan(declination);
  const dayLength = cosHA >= 1 ? 0 : cosHA <= -1 ? 24 : 2 * Math.acos(cosHA) * 12 / Math.PI;

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

function buildPrompt(target, waypointContext, allWaypoints, metadata) {
  let centerLat = 0, centerLon = 0;
  if (allWaypoints.length > 0) {
    centerLat = allWaypoints.reduce((s, w) => s + w.lat, 0) / allWaypoints.length;
    centerLon = allWaypoints.reduce((s, w) => s + w.lon, 0) / allWaypoints.length;
  }

  let prompt = `You are a field geology and mining exploration assistant. The user is prospecting and collecting field observations. Analyze their data and provide useful geological insights. Use all available metadata to inform your analysis.

AREA: The prospecting area is centered around approximately ${centerLat.toFixed(4)}, ${centerLon.toFixed(4)}.
`;

  if (metadata) {
    prompt += '\n--- ENVIRONMENTAL DATA ---\n';

    if (metadata.elevation_ft) {
      prompt += `DEM Elevation: ${metadata.elevation_ft} ft (${metadata.elevation_m} m) [${metadata.elevation_source}]\n`;
    }

    if (metadata.magnetic_declination) {
      prompt += `Magnetic Declination: ${metadata.magnetic_declination.degrees}\u00b0 ${metadata.magnetic_declination.description} (important for compass/strike corrections)\n`;
    }

    if (metadata.sun) {
      prompt += `Sun: altitude ${metadata.sun.altitude_deg}\u00b0, azimuth ${metadata.sun.azimuth_deg}\u00b0, day length ${metadata.sun.day_length_hrs} hrs, sunrise ~${metadata.sun.sunrise_approx}, sunset ~${metadata.sun.sunset_approx}\n`;
    }

    if (metadata.current_weather) {
      const cw = metadata.current_weather;
      prompt += `Current Weather: ${cw.temp_f}\u00b0F (feels like ${cw.feels_like_f}\u00b0F), humidity ${cw.humidity_pct}%, wind ${cw.wind_mph} mph from ${cw.wind_dir_deg}\u00b0, pressure ${cw.pressure_hpa} hPa, ${weatherCodeToText(cw.weather_code)}\n`;
    }

    if (metadata.weather_past_week) {
      const pw = metadata.weather_past_week;
      prompt += '\nWeather Past 7 Days:\n';
      for (let i = 0; i < pw.dates.length; i++) {
        const precip = pw.precip_in[i] || 0;
        prompt += `  ${pw.dates[i]}: ${pw.high_f[i]}\u00b0F/${pw.low_f[i]}\u00b0F, precip ${precip.toFixed(2)}in, wind ${pw.wind_max_mph[i]} mph, ${weatherCodeToText(pw.weather_codes[i])}\n`;
      }
      const totalPrecip = pw.precip_in.reduce((s, v) => s + (v || 0), 0);
      prompt += `  Total precipitation past week: ${totalPrecip.toFixed(2)} inches\n`;
    }

    if (metadata.weather_forecast) {
      const wf = metadata.weather_forecast;
      prompt += '\nWeather Forecast (next 7 days):\n';
      for (let i = 0; i < Math.min(wf.dates.length, 7); i++) {
        const precip = wf.precip_in[i] || 0;
        prompt += `  ${wf.dates[i]}: ${wf.high_f[i]}\u00b0F/${wf.low_f[i]}\u00b0F, ${wf.precip_prob[i]}% chance precip (${precip.toFixed(2)}in), wind ${wf.wind_max_mph[i]} mph\n`;
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

module.exports = function setupAIRoutes(app, dataDir, configFile, { photosDir }) {
  function getConfig() {
    let config = {};
    if (fs.existsSync(configFile)) {
      try { config = JSON.parse(fs.readFileSync(configFile, 'utf8')); } catch (e) {}
    }
    if (process.env.ANTHROPIC_API_KEY) {
      config.anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    }
    return config;
  }

  app.post('/api/config', (req, res) => {
    const config = { ...getConfig(), ...req.body };
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
    res.json({ ok: true });
  });

  app.get('/api/config', (req, res) => {
    const config = getConfig();
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
    const wpFile = path.join(dataDir, 'waypoints.json');
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

    const refPoint = target || localWaypoints[0];
    let metadata = {};
    try {
      metadata = await getLocationMetadata(refPoint.lat, refPoint.lon, refPoint.timestamp);
      console.log('  Fetched environmental metadata for AI context');
    } catch (e) {
      console.log('  Warning: Could not fetch metadata:', e.message);
    }

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

    const contentBlocks = [];

    contentBlocks.push({
      type: 'text',
      text: buildPrompt(target, waypointContext, localWaypoints, metadata)
    });

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

  // Metadata endpoint (used by AI and displayed in UI)
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
};
