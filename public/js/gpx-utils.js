// GPX Import/Export and Track Processing Utilities

const GpxUtils = {

  // --- Ramer-Douglas-Peucker line simplification ---
  // Much smarter than every-Nth-point: preserves shape-defining points
  // (sharp turns, switchbacks) while removing redundant straight-line points.

  /**
   * Simplify a track using Ramer-Douglas-Peucker algorithm.
   * @param {Array} points - Array of {lat, lon, ...} objects
   * @param {number} epsilon - Tolerance in meters (higher = more simplification)
   * @returns {Array} Simplified points (same objects, subset of input)
   */
  simplifyTrack(points, epsilon = 15) {
    if (points.length <= 2) return points.slice();

    // Find the point with the maximum distance from the line between first and last
    let maxDist = 0;
    let maxIdx = 0;

    const start = points[0];
    const end = points[points.length - 1];

    for (let i = 1; i < points.length - 1; i++) {
      const d = this._perpendicularDistance(points[i], start, end);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }

    // If max distance is greater than epsilon, recursively simplify
    if (maxDist > epsilon) {
      const left = this.simplifyTrack(points.slice(0, maxIdx + 1), epsilon);
      const right = this.simplifyTrack(points.slice(maxIdx), epsilon);
      // Concatenate, removing duplicate at join point
      return left.slice(0, -1).concat(right);
    } else {
      // All points between start and end are within tolerance
      return [start, end];
    }
  },

  /**
   * Perpendicular distance from a point to a line segment (in meters).
   */
  _perpendicularDistance(point, lineStart, lineEnd) {
    const lat = point.lat, lon = point.lon || point.lng;
    const lat1 = lineStart.lat, lon1 = lineStart.lon || lineStart.lng;
    const lat2 = lineEnd.lat, lon2 = lineEnd.lon || lineEnd.lng;

    // Convert to approximate meters using equirectangular projection
    const cosLat = Math.cos(lat * Math.PI / 180);
    const x = (lon - lon1) * cosLat;
    const y = lat - lat1;
    const x2 = (lon2 - lon1) * cosLat;
    const y2 = lat2 - lat1;

    const len2 = x2 * x2 + y2 * y2;
    if (len2 === 0) {
      // Line segment is a point
      return Math.sqrt(x * x + y * y) * 111319;
    }

    // Project point onto line
    let t = (x * x2 + y * y2) / len2;
    t = Math.max(0, Math.min(1, t));

    const projX = t * x2;
    const projY = t * y2;

    return Math.sqrt((x - projX) ** 2 + (y - projY) ** 2) * 111319;
  },

  // --- Decision point detection ---
  // Finds stops, sharp turns, and elevation changes automatically.

  /**
   * Detect interesting points along a track.
   * @param {Array} points - Array of {lat, lon, alt, speed, t, ...}
   * @param {object} opts - Detection thresholds
   * @returns {Array} Array of {index, type, point} objects
   */
  detectDecisionPoints(points, opts = {}) {
    const {
      stopDurationMs = 30000,    // 30s pause = a stop
      stopSpeedThreshold = 0.5,  // m/s — below this = stopped
      turnAngle = 60,            // degrees — sharp turn threshold
      elevChangeM = 30,          // elevation change to flag
      minSpacing = 5             // min points between detections
    } = opts;

    const decisions = [];
    let lastDetectionIdx = -minSpacing;

    for (let i = 1; i < points.length - 1; i++) {
      if (i - lastDetectionIdx < minSpacing) continue;

      const prev = points[i - 1];
      const curr = points[i];
      const next = points[i + 1];

      // Detect stops (long pause)
      if (curr.t && prev.t) {
        const dt = curr.t - prev.t;
        if (dt > stopDurationMs) {
          decisions.push({ index: i, type: 'stop', point: curr, duration: dt });
          lastDetectionIdx = i;
          continue;
        }
      }

      // Detect sharp turns
      if (i >= 2) {
        const bearing1 = this._bearing(prev.lat, prev.lon || prev.lng, curr.lat, curr.lon || curr.lng);
        const bearing2 = this._bearing(curr.lat, curr.lon || curr.lng, next.lat, next.lon || next.lng);
        let angle = Math.abs(bearing2 - bearing1);
        if (angle > 180) angle = 360 - angle;
        if (angle > turnAngle) {
          decisions.push({ index: i, type: 'turn', point: curr, angle });
          lastDetectionIdx = i;
          continue;
        }
      }

      // Detect significant elevation changes
      if (curr.alt && prev.alt) {
        const elevDiff = Math.abs(curr.alt - prev.alt);
        if (elevDiff > elevChangeM) {
          decisions.push({ index: i, type: 'elevation', point: curr, elevChange: curr.alt - prev.alt });
          lastDetectionIdx = i;
        }
      }
    }

    return decisions;
  },

  _bearing(lat1, lon1, lat2, lon2) {
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
    const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
              Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
    return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
  },

  // --- Track operations ---

  /**
   * Reverse a track (for return trip directions).
   */
  reverseTrack(points) {
    const reversed = points.slice().reverse();
    // Swap start/end labels
    reversed.forEach((p, i) => {
      if (p.label === 'Start') p.label = 'End';
      else if (p.label === 'End') p.label = 'Start';
    });
    return reversed;
  },

  /**
   * Trim a track between two indices.
   */
  trimTrack(points, startIdx, endIdx) {
    return points.slice(startIdx, endIdx + 1);
  },

  /**
   * Merge two tracks end-to-end.
   */
  mergeTracks(track1, track2) {
    return track1.concat(track2);
  },

  /**
   * Split a track at a given index into two tracks.
   */
  splitTrack(points, splitIdx) {
    return [
      points.slice(0, splitIdx + 1),
      points.slice(splitIdx)
    ];
  },

  /**
   * Calculate total distance of a track in meters.
   */
  trackDistance(points) {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      total += this._haversine(
        points[i-1].lat, points[i-1].lon || points[i-1].lng,
        points[i].lat, points[i].lon || points[i].lng
      );
    }
    return total;
  },

  _haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  },

  // --- GPX Export ---

  /**
   * Export points as a GPX track.
   * @param {Array} points - Array of {lat, lon/lng, alt, t/timestamp}
   * @param {string} name - Track name
   * @returns {string} GPX XML string
   */
  exportTrackGpx(points, name = 'Field Mapper Track') {
    let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Field Mapper"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <trk>
    <name>${this._escapeXml(name)}</name>
    <trkseg>\n`;

    points.forEach(p => {
      const lon = p.lon || p.lng;
      const alt = p.alt || p.altitude || 0;
      const time = p.t || p.timestamp;
      gpx += `      <trkpt lat="${p.lat}" lon="${lon}">\n`;
      if (alt) gpx += `        <ele>${alt.toFixed(1)}</ele>\n`;
      if (time) gpx += `        <time>${new Date(time).toISOString()}</time>\n`;
      gpx += `      </trkpt>\n`;
    });

    gpx += `    </trkseg>
  </trk>
</gpx>`;
    return gpx;
  },

  /**
   * Export route points as GPX route.
   * @param {Array} points - Array of {lat, lon, label, notes, ...}
   * @param {string} name - Route name
   * @returns {string} GPX XML string
   */
  exportRouteGpx(points, name = 'Field Mapper Route') {
    let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Field Mapper"
  xmlns="http://www.topografix.com/GPX/1/1">
  <rte>
    <name>${this._escapeXml(name)}</name>\n`;

    points.forEach(p => {
      const lon = p.lon || p.lng;
      gpx += `    <rtept lat="${p.lat}" lon="${lon}">\n`;
      if (p.label) gpx += `      <name>${this._escapeXml(p.label)}</name>\n`;
      if (p.alt) gpx += `      <ele>${p.alt.toFixed(1)}</ele>\n`;
      if (p.notes) gpx += `      <desc>${this._escapeXml(p.notes)}</desc>\n`;
      gpx += `    </rtept>\n`;
    });

    gpx += `  </rte>
</gpx>`;
    return gpx;
  },

  /**
   * Export waypoints as GPX waypoints.
   */
  exportWaypointsGpx(waypoints) {
    let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Field Mapper"
  xmlns="http://www.topografix.com/GPX/1/1">\n`;

    waypoints.forEach(wp => {
      gpx += `  <wpt lat="${wp.lat}" lon="${wp.lon || wp.lng}">\n`;
      if (wp.name) gpx += `    <name>${this._escapeXml(wp.name)}</name>\n`;
      if (wp.notes) gpx += `    <desc>${this._escapeXml(wp.notes)}</desc>\n`;
      if (wp.category) gpx += `    <type>${this._escapeXml(wp.category)}</type>\n`;
      gpx += `  </wpt>\n`;
    });

    gpx += `</gpx>`;
    return gpx;
  },

  // --- GPX Import ---

  /**
   * Parse a GPX file and return tracks, routes, and waypoints.
   * @param {string} gpxString - GPX XML content
   * @returns {object} { tracks: [...], routes: [...], waypoints: [...] }
   */
  parseGpx(gpxString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(gpxString, 'text/xml');

    const result = { tracks: [], routes: [], waypoints: [] };

    // Parse tracks
    doc.querySelectorAll('trk').forEach(trk => {
      const name = trk.querySelector('name')?.textContent || 'Imported Track';
      const points = [];
      trk.querySelectorAll('trkpt').forEach(pt => {
        const p = {
          lat: parseFloat(pt.getAttribute('lat')),
          lon: parseFloat(pt.getAttribute('lon'))
        };
        const ele = pt.querySelector('ele');
        if (ele) p.alt = parseFloat(ele.textContent);
        const time = pt.querySelector('time');
        if (time) p.t = new Date(time.textContent).getTime();
        points.push(p);
      });
      result.tracks.push({ name, points });
    });

    // Parse routes
    doc.querySelectorAll('rte').forEach(rte => {
      const name = rte.querySelector('name')?.textContent || 'Imported Route';
      const points = [];
      rte.querySelectorAll('rtept').forEach(pt => {
        const p = {
          lat: parseFloat(pt.getAttribute('lat')),
          lon: parseFloat(pt.getAttribute('lon')),
          label: pt.querySelector('name')?.textContent || '',
          notes: pt.querySelector('desc')?.textContent || ''
        };
        const ele = pt.querySelector('ele');
        if (ele) p.alt = parseFloat(ele.textContent);
        points.push(p);
      });
      result.routes.push({ name, points });
    });

    // Parse waypoints
    doc.querySelectorAll('gpx > wpt').forEach(pt => {
      const wp = {
        lat: parseFloat(pt.getAttribute('lat')),
        lon: parseFloat(pt.getAttribute('lon')),
        name: pt.querySelector('name')?.textContent || 'Imported Point',
        notes: pt.querySelector('desc')?.textContent || '',
        category: pt.querySelector('type')?.textContent || 'general'
      };
      const ele = pt.querySelector('ele');
      if (ele) wp.altitude = parseFloat(ele.textContent);
      result.waypoints.push(wp);
    });

    return result;
  },

  // --- Helpers ---

  _escapeXml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  },

  /**
   * Download a string as a file in the browser.
   */
  downloadFile(content, filename, mimeType = 'application/gpx+xml') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
};

window.GpxUtils = GpxUtils;
