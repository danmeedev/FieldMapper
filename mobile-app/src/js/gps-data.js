// GPS Data View - altitude, speed, distance, compass, trip tracking

let tripActive = false;
let tripStartTime = null;
let tripDistance = 0; // meters
let tripMaxSpeed = 0;
let tripMaxAlt = -Infinity;
let tripMinAlt = Infinity;
let tripElevGain = 0;
let tripElevLoss = 0;
let tripPoints = [];
let lastTripPos = null;
let tripSpeedSamples = [];

// Recording
let recordingTrack = false;
let recordingSession = null;

function initGpsDataView() {
  // Load saved trip if any
  getSetting('trip-data').then(data => {
    if (data && data.active) {
      tripActive = true;
      tripStartTime = data.startTime;
      tripDistance = data.distance || 0;
      tripMaxSpeed = data.maxSpeed || 0;
      tripMaxAlt = data.maxAlt || -Infinity;
      tripMinAlt = data.minAlt || Infinity;
      tripElevGain = data.elevGain || 0;
      tripElevLoss = data.elevLoss || 0;
      tripPoints = data.points || [];
      updateTripButton();
    }
  });

  // Load recording state
  getSetting('recording-session').then(s => {
    if (s) {
      recordingTrack = true;
      recordingSession = s;
      updateRecordButton();
    }
  });

  document.getElementById('trip-start-btn').addEventListener('click', toggleTrip);
  document.getElementById('trip-reset-btn').addEventListener('click', resetTrip);
  document.getElementById('record-track-btn').addEventListener('click', toggleRecording);
}

function toggleTrip() {
  if (tripActive) {
    tripActive = false;
    saveSetting('trip-data', { active: false });
  } else {
    tripActive = true;
    tripStartTime = Date.now();
    tripDistance = 0;
    tripMaxSpeed = 0;
    tripMaxAlt = -Infinity;
    tripMinAlt = Infinity;
    tripElevGain = 0;
    tripElevLoss = 0;
    tripPoints = [];
    lastTripPos = null;
    tripSpeedSamples = [];
    saveTripData();
  }
  updateTripButton();
}

function resetTrip() {
  tripActive = false;
  tripDistance = 0;
  tripMaxSpeed = 0;
  tripStartTime = null;
  tripMaxAlt = -Infinity;
  tripMinAlt = Infinity;
  tripElevGain = 0;
  tripElevLoss = 0;
  tripPoints = [];
  lastTripPos = null;
  tripSpeedSamples = [];
  saveSetting('trip-data', { active: false });
  updateTripButton();
  updateGpsDataDisplay(null);
}

function updateTripButton() {
  const btn = document.getElementById('trip-start-btn');
  if (btn) {
    btn.textContent = tripActive ? 'Stop Trip' : 'Start Trip';
    btn.style.background = tripActive ? '#d32f2f' : '#4caf50';
  }
}

function saveTripData() {
  saveSetting('trip-data', {
    active: tripActive,
    startTime: tripStartTime,
    distance: tripDistance,
    maxSpeed: tripMaxSpeed,
    maxAlt: tripMaxAlt,
    minAlt: tripMinAlt,
    elevGain: tripElevGain,
    elevLoss: tripElevLoss,
    points: tripPoints.slice(-500) // keep last 500 points
  });
}

// Track recording
async function toggleRecording() {
  if (recordingTrack) {
    // Stop recording
    if (recordingSession) {
      recordingSession.endTime = Date.now();
      recordingSession.distance = tripDistance;
      await saveTrackSession(recordingSession);
    }
    recordingTrack = false;
    recordingSession = null;
    await saveSetting('recording-session', null);
  } else {
    // Start recording
    recordingSession = {
      id: Date.now(),
      name: `Track ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`,
      startTime: Date.now(),
      endTime: null,
      points: [],
      distance: 0
    };
    recordingTrack = true;
    await saveSetting('recording-session', recordingSession);
  }
  updateRecordButton();
}

function updateRecordButton() {
  const btn = document.getElementById('record-track-btn');
  if (btn) {
    btn.textContent = recordingTrack ? 'Stop Recording' : 'Record Track';
    btn.style.background = recordingTrack ? '#d32f2f' : '#1565c0';
  }
  const indicator = document.getElementById('recording-indicator');
  if (indicator) indicator.style.display = recordingTrack ? 'block' : 'none';
}

// Called by app.js on GPS update
function onGpsUpdate_gpsData(pos) {
  updateGpsDataDisplay(pos);

  if (tripActive && pos) {
    if (lastTripPos) {
      const d = haversineDistance(lastTripPos.lat, lastTripPos.lon, pos.lat, pos.lon);
      if (d > 2) { // ignore jitter < 2m
        tripDistance += d;
        tripPoints.push({ lat: pos.lat, lon: pos.lon, alt: pos.altitude, t: Date.now() });

        // Elevation tracking
        if (pos.altitude && lastTripPos.altitude) {
          const dElev = pos.altitude - lastTripPos.altitude;
          if (dElev > 0.5) tripElevGain += dElev;
          else if (dElev < -0.5) tripElevLoss += Math.abs(dElev);
        }
      }
    }
    lastTripPos = { ...pos };

    if (pos.speed && pos.speed > tripMaxSpeed) tripMaxSpeed = pos.speed;
    if (pos.altitude) {
      if (pos.altitude > tripMaxAlt) tripMaxAlt = pos.altitude;
      if (pos.altitude < tripMinAlt) tripMinAlt = pos.altitude;
    }

    // Speed samples for average
    if (pos.speed != null) {
      tripSpeedSamples.push(pos.speed);
      if (tripSpeedSamples.length > 100) tripSpeedSamples.shift();
    }

    // Save periodically
    if (tripPoints.length % 10 === 0) saveTripData();
  }

  // Record track
  if (recordingTrack && pos && recordingSession) {
    recordingSession.points.push({
      lat: pos.lat, lon: pos.lon, alt: pos.altitude,
      speed: pos.speed, t: Date.now()
    });
    // Save every 20 points
    if (recordingSession.points.length % 20 === 0) {
      saveSetting('recording-session', recordingSession);
    }
  }
}

function updateGpsDataDisplay(pos) {
  // Current speed
  const speedEl = document.getElementById('data-speed');
  if (speedEl) {
    const mph = pos && pos.speed ? (pos.speed * 2.237).toFixed(1) : '0.0';
    speedEl.textContent = mph;
  }

  // Heading
  const headingEl = document.getElementById('data-heading');
  const compassEl = document.getElementById('compass-arrow');
  if (pos && pos.heading != null && pos.heading >= 0) {
    if (headingEl) headingEl.textContent = `${pos.heading.toFixed(0)}°  ${headingToCardinal(pos.heading)}`;
    if (compassEl) compassEl.style.transform = `rotate(${pos.heading}deg)`;
  }

  // Altitude
  const altEl = document.getElementById('data-altitude');
  if (altEl) {
    altEl.textContent = pos && pos.altitude ? `${(pos.altitude * 3.28084).toFixed(0)} ft` : '--';
  }

  // Accuracy
  const accEl = document.getElementById('data-accuracy');
  if (accEl) {
    accEl.textContent = pos && pos.accuracy ? `${(pos.accuracy * 3.28084).toFixed(0)} ft` : '--';
  }

  // Coordinates
  const coordEl = document.getElementById('data-coords');
  if (coordEl && pos) {
    coordEl.textContent = `${pos.lat.toFixed(6)}, ${pos.lon.toFixed(6)}`;
  }

  // Trip data
  if (tripActive) {
    const distEl = document.getElementById('data-trip-distance');
    if (distEl) {
      const miles = tripDistance * 0.000621371;
      distEl.textContent = miles < 0.1 ? `${(tripDistance * 3.28084).toFixed(0)} ft` : `${miles.toFixed(2)} mi`;
    }

    const timeEl = document.getElementById('data-trip-time');
    if (timeEl && tripStartTime) {
      const elapsed = Date.now() - tripStartTime;
      const hrs = Math.floor(elapsed / 3600000);
      const mins = Math.floor((elapsed % 3600000) / 60000);
      const secs = Math.floor((elapsed % 60000) / 1000);
      timeEl.textContent = hrs > 0 ? `${hrs}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}` : `${mins}:${String(secs).padStart(2,'0')}`;
    }

    const maxSpdEl = document.getElementById('data-max-speed');
    if (maxSpdEl) maxSpdEl.textContent = `${(tripMaxSpeed * 2.237).toFixed(1)} mph`;

    const avgSpdEl = document.getElementById('data-avg-speed');
    if (avgSpdEl && tripSpeedSamples.length > 0) {
      const avg = tripSpeedSamples.reduce((a,b) => a+b, 0) / tripSpeedSamples.length;
      avgSpdEl.textContent = `${(avg * 2.237).toFixed(1)} mph`;
    }

    const elevGainEl = document.getElementById('data-elev-gain');
    if (elevGainEl) elevGainEl.textContent = `+${(tripElevGain * 3.28084).toFixed(0)} ft`;

    const elevLossEl = document.getElementById('data-elev-loss');
    if (elevLossEl) elevLossEl.textContent = `-${(tripElevLoss * 3.28084).toFixed(0)} ft`;

    const maxAltEl = document.getElementById('data-max-alt');
    if (maxAltEl) maxAltEl.textContent = tripMaxAlt > -Infinity ? `${(tripMaxAlt * 3.28084).toFixed(0)} ft` : '--';

    const minAltEl = document.getElementById('data-min-alt');
    if (minAltEl) minAltEl.textContent = tripMinAlt < Infinity ? `${(tripMinAlt * 3.28084).toFixed(0)} ft` : '--';
  }
}

function headingToCardinal(deg) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

// Haversine distance in meters
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Bearing from point 1 to point 2
function bearingTo(lat1, lon1, lat2, lon2) {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1*Math.PI/180) * Math.sin(lat2*Math.PI/180) -
            Math.sin(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}
