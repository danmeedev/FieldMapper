// Navigation Mode - GPS guide with compass, bearing, distance to target
// Enhanced with route point details (notes, hazards, access, photos)

let navActive = false;
let navTarget = null; // { lat, lon, name }
let navRoute = null; // { points: [...], currentIndex: 0, name }
let navRouteData = null; // full route object with point details

function initNavigation() {
  document.getElementById('nav-close-btn')?.addEventListener('click', stopNavigation);
  document.getElementById('nav-next-btn')?.addEventListener('click', navNextPoint);
  document.getElementById('nav-prev-btn')?.addEventListener('click', navPrevPoint);
}

// Navigate to a specific waypoint
window.navigateTo = function(wpId) {
  getWaypoint(wpId).then(wp => {
    if (!wp) return;
    startNavigation({ lat: wp.lat, lon: wp.lon, name: wp.name });
  });
};

// Navigate to coordinates
window.navigateToCoords = function(lat, lon, name) {
  startNavigation({ lat, lon, name: name || `${lat.toFixed(4)}, ${lon.toFixed(4)}` });
};

// Navigate along a route (enhanced with point details)
window.navigateRoute = async function(routeId) {
  const routes = await getAllRoutes();
  const route = routes.find(r => r.id === routeId);
  if (!route || !route.points || route.points.length < 1) return;

  navRouteData = route;
  navRoute = {
    points: route.points,
    currentIndex: 0,
    name: route.name
  };

  const pt = route.points[0];
  startNavigation({
    lat: pt.lat,
    lon: pt.lon,
    name: `${route.name} (1/${route.points.length})`
  });
  updateNavPointInfo();
};

function startNavigation(target) {
  navTarget = target;
  navActive = true;

  const overlay = document.getElementById('nav-overlay');
  if (overlay) overlay.style.display = 'flex';
  document.getElementById('nav-target-name').textContent = target.name;

  // Show/hide route controls
  const routeControls = document.getElementById('nav-route-controls');
  if (routeControls) routeControls.style.display = navRoute ? 'flex' : 'none';

  updateNavDisplay();
}

function stopNavigation() {
  navActive = false;
  navTarget = null;
  navRoute = null;
  navRouteData = null;
  const overlay = document.getElementById('nav-overlay');
  if (overlay) overlay.style.display = 'none';
}

function navNextPoint() {
  if (!navRoute || navRoute.currentIndex >= navRoute.points.length - 1) return;
  navRoute.currentIndex++;
  const pt = navRoute.points[navRoute.currentIndex];
  navTarget = {
    lat: pt.lat, lon: pt.lon,
    name: `${navRoute.name} (${navRoute.currentIndex + 1}/${navRoute.points.length})`
  };
  document.getElementById('nav-target-name').textContent = navTarget.name;
  updateNavPointInfo();
}

function navPrevPoint() {
  if (!navRoute || navRoute.currentIndex <= 0) return;
  navRoute.currentIndex--;
  const pt = navRoute.points[navRoute.currentIndex];
  navTarget = {
    lat: pt.lat, lon: pt.lon,
    name: `${navRoute.name} (${navRoute.currentIndex + 1}/${navRoute.points.length})`
  };
  document.getElementById('nav-target-name').textContent = navTarget.name;
  updateNavPointInfo();
}

function updateNavPointInfo() {
  const infoEl = document.getElementById('nav-point-info');
  if (!infoEl || !navRoute) { if (infoEl) infoEl.innerHTML = ''; return; }

  const pt = navRoute.points[navRoute.currentIndex];
  if (!pt) return;

  const ACCESS_TYPES = {
    any: { label: 'Any Vehicle', icon: '\u{1F697}', color: '#4caf50' },
    utv: { label: 'UTV/ATV', icon: '\u{1F6FB}', color: '#ff9800' },
    foot: { label: 'Foot Only', icon: '\u{1F97E}', color: '#2196f3' },
    rope: { label: 'Rope/Climb', icon: '\u{1FA22}', color: '#f44336' },
    scramble: { label: 'Scramble', icon: '\u26F0\uFE0F', color: '#9c27b0' }
  };

  const access = ACCESS_TYPES[pt.accessType] || ACCESS_TYPES.any;
  let html = `<div class="nav-pt-label">${pt.label || `Point ${navRoute.currentIndex + 1}`}</div>`;
  html += `<div class="nav-pt-access" style="color:${access.color}">${access.icon} ${access.label}</div>`;

  if (pt.hazards) html += `<div class="nav-pt-hazard">\u26A0\uFE0F ${pt.hazards}</div>`;
  if (pt.landmarks) html += `<div class="nav-pt-landmark">\u{1F3D4}\uFE0F Look for: ${pt.landmarks}</div>`;
  if (pt.notes) html += `<div class="nav-pt-notes">${pt.notes}</div>`;

  if (pt.photos && pt.photos.length > 0) {
    html += `<div style="display:flex;gap:4px;margin-top:6px;overflow-x:auto">`;
    pt.photos.forEach(url => {
      html += `<img src="${url}" style="width:50px;height:50px;object-fit:cover;border-radius:4px;flex-shrink:0">`;
    });
    html += `</div>`;
  }

  // Prev/next button states
  const prevBtn = document.getElementById('nav-prev-btn');
  const nextBtn = document.getElementById('nav-next-btn');
  if (prevBtn) prevBtn.disabled = navRoute.currentIndex === 0;
  if (nextBtn) nextBtn.disabled = navRoute.currentIndex >= navRoute.points.length - 1;

  infoEl.innerHTML = html;
}

function onGpsUpdate_navigation(pos) {
  if (!navActive || !navTarget || !pos) return;

  const dist = haversineDistance(pos.lat, pos.lon, navTarget.lat, navTarget.lon);
  const brng = bearingTo(pos.lat, pos.lon, navTarget.lat, navTarget.lon);

  // Update display
  document.getElementById('nav-distance').textContent = formatNavDistance(dist);
  document.getElementById('nav-bearing').textContent = `${brng.toFixed(0)}\u00B0 ${headingToCardinal(brng)}`;

  // Compass arrow - rotate relative to heading
  const arrowEl = document.getElementById('nav-compass-arrow');
  if (arrowEl) {
    const heading = pos.heading || 0;
    const relative = brng - heading;
    arrowEl.style.transform = `rotate(${relative}deg)`;
  }

  // ETA based on current speed
  const etaEl = document.getElementById('nav-eta');
  if (etaEl) {
    if (pos.speed && pos.speed > 0.5) {
      const secs = dist / pos.speed;
      if (secs < 60) etaEl.textContent = `${secs.toFixed(0)}s`;
      else if (secs < 3600) etaEl.textContent = `${(secs/60).toFixed(0)} min`;
      else etaEl.textContent = `${(secs/3600).toFixed(1)} hrs`;
    } else {
      etaEl.textContent = '--';
    }
  }

  // Off-route warning (Phase 5D)
  if (navRoute && navRoute.points) {
    const offDist = getDistanceToRoute(pos.lat, pos.lon, navRoute.points);
    const offRouteEl = document.getElementById('nav-off-route-warning');
    if (offRouteEl) {
      if (offDist > 50) {
        offRouteEl.textContent = `Off route: ${Math.round(offDist)}m away`;
        offRouteEl.style.display = 'block';
      } else {
        offRouteEl.style.display = 'none';
      }
    }
  }

  // Arrival detection (within 15m)
  if (dist < 15) {
    if (navRoute && navRoute.currentIndex < navRoute.points.length - 1) {
      navRoute.currentIndex++;
      const next = navRoute.points[navRoute.currentIndex];
      navTarget = {
        lat: next.lat, lon: next.lon,
        name: `${navRoute.name} (${navRoute.currentIndex + 1}/${navRoute.points.length})`
      };
      document.getElementById('nav-target-name').textContent = navTarget.name;
      updateNavPointInfo();
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    } else {
      document.getElementById('nav-distance').textContent = 'ARRIVED';
      if (navigator.vibrate) navigator.vibrate([300, 100, 300, 100, 300]);
    }
  }
}

function updateNavDisplay() {
  if (!navTarget || !currentPosition) return;
  onGpsUpdate_navigation(currentPosition);
}

function formatNavDistance(meters) {
  const ft = meters * 3.28084;
  if (ft < 1000) return `${ft.toFixed(0)} ft`;
  const miles = meters * 0.000621371;
  return `${miles.toFixed(2)} mi`;
}

// --- Off-route detection (Phase 5D) ---
function distanceToSegment(lat, lon, lat1, lon1, lat2, lon2) {
  const dx = lon2 - lon1, dy = lat2 - lat1;
  if (dx === 0 && dy === 0) return haversineDistance(lat, lon, lat1, lon1);
  let t = ((lat - lat1) * dy + (lon - lon1) * dx) / (dy * dy + dx * dx);
  t = Math.max(0, Math.min(1, t));
  const projLat = lat1 + t * dy;
  const projLon = lon1 + t * dx;
  return haversineDistance(lat, lon, projLat, projLon);
}

function getDistanceToRoute(lat, lon, points) {
  if (!points || points.length === 0) return Infinity;
  if (points.length === 1) return haversineDistance(lat, lon, points[0].lat, points[0].lon);
  let minDist = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const d = distanceToSegment(lat, lon,
      points[i].lat, points[i].lon,
      points[i + 1].lat, points[i + 1].lon);
    if (d < minDist) minDist = d;
  }
  return minDist;
}
