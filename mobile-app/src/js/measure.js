// Measure Tool - draw lines, measure distances, areas on map

let measureMode = false;
let measurePoints = [];
let measureMarkers = [];
let measureLine = null;
let measureLabels = [];
let savedMeasurements = [];

function initMeasureTool(map) {
  const btn = document.getElementById('measure-btn');
  if (!btn) return;

  btn.addEventListener('click', () => {
    measureMode = !measureMode;
    btn.textContent = measureMode ? 'Done' : 'Measure';
    btn.style.background = measureMode ? '#f44336' : '';
    map.getContainer().style.cursor = measureMode ? 'crosshair' : '';

    if (!measureMode && measurePoints.length > 1) {
      // Show save prompt
      showMeasureSavePrompt(map);
    }
  });

  document.getElementById('measure-clear-btn')?.addEventListener('click', () => clearMeasure(map));
  document.getElementById('measure-undo-btn')?.addEventListener('click', () => undoMeasurePoint(map));

  map.on('click', (e) => {
    if (!measureMode) return;
    addMeasurePoint(e.latlng, map);
  });

  // Load saved measurements
  loadSavedMeasurements(map);
}

function addMeasurePoint(latlng, map) {
  measurePoints.push(latlng);

  // Add marker
  const marker = L.circleMarker(latlng, {
    radius: 5, color: '#ff0', fillColor: '#ff0', fillOpacity: 1, weight: 2
  }).addTo(map);
  measureMarkers.push(marker);

  // Update line
  if (measureLine) map.removeLayer(measureLine);
  measureLine = L.polyline(measurePoints, { color: '#ff0', weight: 3, dashArray: '8,4' }).addTo(map);

  // Add distance label
  if (measurePoints.length > 1) {
    const prev = measurePoints[measurePoints.length - 2];
    const curr = measurePoints[measurePoints.length - 1];
    const segDist = haversineDistance(prev.lat, prev.lng, curr.lat, curr.lng);
    const totalDist = getTotalMeasureDistance();

    const label = L.marker(curr, {
      icon: L.divIcon({
        className: 'measure-label',
        html: `<div>${formatDistance(segDist)}<br><b>${formatDistance(totalDist)}</b></div>`,
        iconSize: [80, 30],
        iconAnchor: [-5, 15]
      })
    }).addTo(map);
    measureLabels.push(label);
  }

  updateMeasureInfo();
}

function undoMeasurePoint(map) {
  if (measurePoints.length === 0) return;
  measurePoints.pop();

  const m = measureMarkers.pop();
  if (m) map.removeLayer(m);
  const l = measureLabels.pop();
  if (l) map.removeLayer(l);

  if (measureLine) map.removeLayer(measureLine);
  if (measurePoints.length > 1) {
    measureLine = L.polyline(measurePoints, { color: '#ff0', weight: 3, dashArray: '8,4' }).addTo(map);
  } else {
    measureLine = null;
  }
  updateMeasureInfo();
}

function clearMeasure(map) {
  measurePoints = [];
  measureMarkers.forEach(m => map.removeLayer(m));
  measureMarkers = [];
  measureLabels.forEach(l => map.removeLayer(l));
  measureLabels = [];
  if (measureLine) { map.removeLayer(measureLine); measureLine = null; }
  updateMeasureInfo();
}

function getTotalMeasureDistance() {
  let total = 0;
  for (let i = 1; i < measurePoints.length; i++) {
    total += haversineDistance(measurePoints[i-1].lat, measurePoints[i-1].lng, measurePoints[i].lat, measurePoints[i].lng);
  }
  return total;
}

function formatDistance(meters) {
  const ft = meters * 3.28084;
  if (ft < 1000) return `${ft.toFixed(0)} ft`;
  const miles = meters * 0.000621371;
  return `${miles.toFixed(2)} mi`;
}

function updateMeasureInfo() {
  const el = document.getElementById('measure-info');
  if (!el) return;

  if (measurePoints.length < 2) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'block';

  const total = getTotalMeasureDistance();
  let html = `<b>Distance:</b> ${formatDistance(total)}`;

  if (measurePoints.length > 1) {
    const b = bearingTo(measurePoints[0].lat, measurePoints[0].lng,
                        measurePoints[measurePoints.length-1].lat, measurePoints[measurePoints.length-1].lng);
    html += ` | <b>Bearing:</b> ${b.toFixed(0)}° ${headingToCardinal(b)}`;
  }

  html += ` | ${measurePoints.length} points`;
  el.innerHTML = html;
}

function showMeasureSavePrompt(map) {
  const name = prompt('Save measurement? Enter a name (or cancel):');
  if (!name) return;

  const m = {
    id: Date.now(),
    name,
    points: measurePoints.map(p => ({ lat: p.lat, lng: p.lng })),
    distance: getTotalMeasureDistance(),
    timestamp: new Date().toISOString()
  };
  saveMeasurement(m);
  savedMeasurements.push(m);
  clearMeasure(map);
  renderSavedMeasurement(m, map);
}

async function loadSavedMeasurements(map) {
  savedMeasurements = await getAllMeasurements();
  savedMeasurements.forEach(m => renderSavedMeasurement(m, map));
}

function renderSavedMeasurement(m, map) {
  const latlngs = m.points.map(p => [p.lat, p.lng]);
  L.polyline(latlngs, { color: '#00bcd4', weight: 2, opacity: 0.7 })
    .bindPopup(`<b>${m.name}</b><br>${formatDistance(m.distance)}`)
    .addTo(map);
}
