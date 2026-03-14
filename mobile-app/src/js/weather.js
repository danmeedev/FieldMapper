// Weather View - NWS API forecast, alerts, conditions

let weatherCache = null;
let weatherAlerts = [];

async function initWeatherView() {
  // Load cached weather
  weatherCache = await getSetting('weather-cache');
  if (weatherCache) renderWeather(weatherCache);

  document.getElementById('weather-refresh-btn').addEventListener('click', fetchWeather);

  // Auto-fetch if we have GPS
  if (currentPosition) fetchWeather();
}

async function fetchWeather() {
  if (!currentPosition) {
    document.getElementById('weather-status').textContent = 'Waiting for GPS fix...';
    return;
  }

  const statusEl = document.getElementById('weather-status');
  statusEl.textContent = 'Fetching weather...';
  statusEl.style.color = '#ffc107';

  const { lat, lon } = currentPosition;

  try {
    // Step 1: Get forecast URLs from NWS points endpoint
    const pointResp = await fetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, {
      headers: { 'User-Agent': 'FieldMapper/1.0 (field-mapping-app)', 'Accept': 'application/geo+json' }
    });

    if (!pointResp.ok) throw new Error(`NWS API error: ${pointResp.status}`);
    const pointData = await pointResp.json();
    const props = pointData.properties;

    // Step 2: Fetch forecast and hourly in parallel
    const [forecastResp, hourlyResp, alertResp] = await Promise.all([
      fetch(props.forecast, { headers: { 'User-Agent': 'FieldMapper/1.0', 'Accept': 'application/geo+json' } }),
      fetch(props.forecastHourly, { headers: { 'User-Agent': 'FieldMapper/1.0', 'Accept': 'application/geo+json' } }),
      fetch(`https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`, {
        headers: { 'User-Agent': 'FieldMapper/1.0', 'Accept': 'application/geo+json' }
      }).catch(() => null)
    ]);

    const forecast = forecastResp.ok ? await forecastResp.json() : null;
    const hourly = hourlyResp.ok ? await hourlyResp.json() : null;
    const alerts = alertResp && alertResp.ok ? await alertResp.json() : null;

    weatherCache = {
      fetchTime: Date.now(),
      lat, lon,
      location: `${props.relativeLocation?.properties?.city || ''}, ${props.relativeLocation?.properties?.state || ''}`,
      elevation: props.elevation?.value ? (props.elevation.value * 3.28084).toFixed(0) : null,
      forecast: forecast?.properties?.periods || [],
      hourly: hourly?.properties?.periods?.slice(0, 24) || [],
      alerts: alerts?.features?.map(f => ({
        event: f.properties.event,
        headline: f.properties.headline,
        severity: f.properties.severity,
        description: f.properties.description
      })) || []
    };

    await saveSetting('weather-cache', weatherCache);
    await saveSetting('last-weather', { data: weatherCache, timestamp: Date.now(), lat, lon });
    renderWeather(weatherCache);
    hideWeatherOfflineBanner();
    statusEl.textContent = `Updated ${new Date().toLocaleTimeString()}`;
    statusEl.style.color = '#4caf50';
  } catch (e) {
    statusEl.textContent = `Error: ${e.message}`;
    statusEl.style.color = '#f44336';
    // Load cached weather from last-weather and display with offline banner
    const cached = await getSetting('last-weather');
    if (cached && cached.data) {
      weatherCache = cached.data;
      renderWeather(weatherCache);
      showWeatherOfflineBanner(cached.timestamp);
    } else if (weatherCache) {
      renderWeather(weatherCache);
      showWeatherOfflineBanner(weatherCache.fetchTime);
    }
  }
}

function renderWeather(data) {
  const container = document.getElementById('weather-content');
  if (!container) return;

  let html = '';

  // Location
  html += `<div class="wx-location">${data.location || 'Unknown Location'}</div>`;
  if (data.elevation) html += `<div class="wx-sublabel">Elevation: ${data.elevation} ft</div>`;

  // Alerts
  if (data.alerts && data.alerts.length > 0) {
    html += `<div class="wx-alerts">`;
    data.alerts.forEach(a => {
      const color = a.severity === 'Extreme' ? '#d32f2f' : a.severity === 'Severe' ? '#f44336' : '#ff9800';
      html += `<div class="wx-alert" style="border-left:4px solid ${color}">
        <b>${a.event}</b><br>
        <span style="font-size:12px">${a.headline || ''}</span>
      </div>`;
    });
    html += `</div>`;
  }

  // Current/next period
  if (data.forecast.length > 0) {
    const now = data.forecast[0];
    html += `<div class="wx-current">
      <div class="wx-temp">${now.temperature}°${now.temperatureUnit}</div>
      <div class="wx-desc">${now.shortForecast}</div>
      <div class="wx-wind">Wind: ${now.windSpeed} ${now.windDirection}</div>
      <div class="wx-sublabel">${now.name}</div>
    </div>`;
  }

  // Hourly (next 12 hours)
  if (data.hourly.length > 0) {
    html += `<div class="wx-section"><h4>Next 12 Hours</h4><div class="wx-hourly-scroll">`;
    data.hourly.slice(0, 12).forEach(h => {
      const time = new Date(h.startTime);
      const hr = time.getHours();
      const ampm = hr >= 12 ? 'PM' : 'AM';
      const hr12 = hr % 12 || 12;
      html += `<div class="wx-hour">
        <div class="wx-hour-time">${hr12}${ampm}</div>
        <div class="wx-hour-temp">${h.temperature}°</div>
        <div class="wx-hour-wind">${h.windSpeed}</div>
        <div class="wx-hour-desc">${h.shortForecast}</div>
      </div>`;
    });
    html += `</div></div>`;
  }

  // 7-day forecast
  if (data.forecast.length > 1) {
    html += `<div class="wx-section"><h4>Extended Forecast</h4>`;
    data.forecast.forEach(p => {
      html += `<div class="wx-day">
        <div class="wx-day-name">${p.name}</div>
        <div class="wx-day-temp">${p.temperature}°${p.temperatureUnit}</div>
        <div class="wx-day-detail">
          <div>${p.shortForecast}</div>
          <div class="wx-sublabel">Wind: ${p.windSpeed} ${p.windDirection}</div>
        </div>
      </div>`;
    });
    html += `</div>`;
  }

  // Staleness indicator
  if (data.fetchTime) {
    const age = Math.round((Date.now() - data.fetchTime) / 60000);
    html += `<div class="wx-sublabel" style="text-align:center;margin-top:10px">Last updated ${age < 1 ? 'just now' : age + ' min ago'}</div>`;
  }

  container.innerHTML = html;
}

function showWeatherOfflineBanner(timestamp) {
  let banner = document.getElementById('weather-offline-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'weather-offline-banner';
    banner.style.cssText = 'background:#e65100;color:#fff;text-align:center;padding:6px 10px;font-size:13px;border-radius:6px;margin:6px 0';
    const content = document.getElementById('weather-content');
    if (content) content.parentNode.insertBefore(banner, content);
  }
  const age = Date.now() - timestamp;
  const mins = Math.floor(age / 60000);
  const hours = Math.floor(mins / 60);
  let agoText;
  if (mins < 1) agoText = 'just now';
  else if (mins < 60) agoText = `${mins} min ago`;
  else if (hours < 24) agoText = `${hours} hr${hours > 1 ? 's' : ''} ago`;
  else agoText = `${Math.floor(hours / 24)} day${Math.floor(hours / 24) > 1 ? 's' : ''} ago`;
  banner.textContent = `Offline - Last updated: ${agoText}`;
  banner.style.display = 'block';
}

function hideWeatherOfflineBanner() {
  const banner = document.getElementById('weather-offline-banner');
  if (banner) banner.style.display = 'none';
}
