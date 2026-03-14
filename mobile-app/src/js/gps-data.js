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
    points: tripPoints // no point cap — native tracking handles persistence
  });
}

// Track recording — uses native foreground service when available
async function toggleRecording() {
  if (recordingTrack) {
    // Stop recording
    if (window.NativeGps && NativeGps.isNative && NativeGps.isTracking) {
      // Stop native background tracking
      await NativeGps.stopTracking();
      console.log('[GpsData] Native tracking stopped');
    }
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
    const sessionName = `Track ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`;

    // Try to start native background tracking first
    if (window.NativeGps && NativeGps.isNative) {
      try {
        const result = await NativeGps.startTracking(sessionName, {
          intervalMs: 3000,
          minDistanceM: 5.0
        });
        console.log('[GpsData] Native tracking started, session:', result.sessionId);
      } catch (e) {
        console.warn('[GpsData] Native tracking failed, using web fallback:', e);
      }
    }

    // Still create a JS session for trip computer compatibility
    recordingSession = {
      id: Date.now(),
      name: sessionName,
      nativeSessionId: NativeGps ? NativeGps.currentSessionId : null,
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
    const nativeActive = window.NativeGps && NativeGps.isNative && NativeGps.isTracking;
    if (recordingTrack) {
      btn.textContent = nativeActive ? '⏹ Stop Recording (BG)' : '⏹ Stop Recording';
      btn.style.background = '#d32f2f';
    } else {
      btn.textContent = '⏺ Record Track';
      btn.style.background = '#1565c0';
    }
  }
  const indicator = document.getElementById('recording-indicator');
  if (indicator) indicator.style.display = recordingTrack ? 'block' : 'none';
}

// Receive stats from native tracking service (called via NativeGps listener)
window.onNativeTrackingStats = function(stats) {
  // Update native point count display if it exists
  const nativeStatsEl = document.getElementById('native-track-stats');
  if (nativeStatsEl && stats) {
    const distMi = (stats.distanceM / 1609.34).toFixed(2);
    const mins = Math.floor(stats.elapsedMs / 60000);
    const timeStr = mins < 60 ?
      `${mins}m` :
      `${Math.floor(mins/60)}h ${mins%60}m`;
    nativeStatsEl.textContent = `BG: ${stats.points} pts · ${distMi} mi · ${timeStr}`;
    nativeStatsEl.style.display = 'block';
  }
};

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
    if (avgSpdEl && tripStartTime && tripDistance > 0) {
      const elapsedHrs = (Date.now() - tripStartTime) / 3600000;
      if (elapsedHrs > 0) {
        const avgMph = (tripDistance / 1609.34) / elapsedHrs;
        avgSpdEl.textContent = `${avgMph.toFixed(1)} mph`;
      }
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

// --- GPX Import/Export ---

window.exportCurrentTrackGpx = function() {
  if (!window.GpxUtils) return;
  if (tripPoints.length < 2) {
    alert('No track data to export. Start a trip and record some points first.');
    return;
  }
  const name = `Track_${new Date().toISOString().slice(0,10)}`;
  const gpx = GpxUtils.exportTrackGpx(tripPoints, name);
  GpxUtils.downloadFile(gpx, `${name}.gpx`);
};

window.handleGpxImport = async function(input) {
  const file = input.files[0];
  if (!file) return;

  const statusEl = document.getElementById('gpx-import-status');
  statusEl.textContent = 'Reading file...';

  try {
    const text = await file.text();
    const data = GpxUtils.parseGpx(text);

    let imported = 0;

    // Import tracks as track sessions
    for (const track of data.tracks) {
      if (track.points.length > 0) {
        const session = {
          id: Date.now() + imported,
          name: track.name,
          startTime: track.points[0].t || Date.now(),
          endTime: track.points[track.points.length - 1].t || Date.now(),
          points: track.points,
          distance: GpxUtils.trackDistance(track.points)
        };
        await saveTrackSession(session);
        imported++;
      }
    }

    // Import waypoints
    for (const wp of data.waypoints) {
      const waypoint = {
        id: Date.now() + imported,
        lat: wp.lat,
        lon: wp.lon,
        name: wp.name || 'Imported',
        category: wp.category || 'general',
        notes: wp.notes || '',
        altitude: wp.altitude || null,
        timestamp: Date.now(),
        synced: false
      };
      await saveWaypoint(waypoint);
      imported++;
    }

    // Import routes
    for (const route of data.routes) {
      if (route.points.length > 0) {
        const routeObj = {
          id: Date.now() + imported,
          name: route.name,
          description: 'Imported from GPX',
          points: route.points.map((p, i) => ({
            lat: p.lat, lon: p.lon || p.lng,
            label: p.label || (i === 0 ? 'Start' : i === route.points.length - 1 ? 'End' : `Point ${i+1}`),
            notes: p.notes || '', accessType: 'any', hazards: '', landmarks: '', directions: '', photos: []
          }))
        };
        await saveRoute(routeObj);
        imported++;
      }
    }

    statusEl.textContent = `Imported: ${data.tracks.length} tracks, ${data.waypoints.length} waypoints, ${data.routes.length} routes`;
    statusEl.style.color = '#4caf50';
    input.value = ''; // Reset file input
  } catch (e) {
    statusEl.textContent = `Error: ${e.message}`;
    statusEl.style.color = '#f44336';
  }
};
