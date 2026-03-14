/**
 * Lightweight Leaflet Marker Clustering
 * Grid-based clustering for offline use. No external dependencies beyond Leaflet.
 *
 * Usage:
 *   const cluster = new MarkerClusterGroup({ gridSize: 60 });
 *   cluster.addTo(map);
 *   cluster.addMarker(leafletMarker);   // add one
 *   cluster.addMarkers([m1, m2, ...]);  // add many
 *   cluster.removeMarker(leafletMarker);
 *   cluster.clearMarkers();
 */
(function (global) {
  'use strict';

  function MarkerClusterGroup(options) {
    options = options || {};
    this._gridSize = options.gridSize || 60;          // px radius for grouping
    this._maxClusterZoom = options.maxClusterZoom || 18; // above this, always show individual
    this._spiderfyOnClick = options.spiderfyOnClick !== false;
    this._map = null;
    this._markers = [];       // all source markers (Leaflet L.Marker instances)
    this._clusters = [];      // currently rendered cluster icons on map
    this._soloOnMap = [];     // individual markers currently shown on map
    this._dirty = false;
    this._updateTimer = null;
  }

  // ---- public API ----

  MarkerClusterGroup.prototype.addTo = function (map) {
    this._map = map;
    map.on('zoomend moveend', this._scheduleUpdate, this);
    this._refresh();
    return this;
  };

  MarkerClusterGroup.prototype.removeFrom = function (map) {
    map.off('zoomend moveend', this._scheduleUpdate, this);
    this._clearRendered();
    this._map = null;
  };

  MarkerClusterGroup.prototype.addMarker = function (marker) {
    this._markers.push(marker);
    this._scheduleUpdate();
  };

  MarkerClusterGroup.prototype.addMarkers = function (arr) {
    for (var i = 0; i < arr.length; i++) this._markers.push(arr[i]);
    this._scheduleUpdate();
  };

  MarkerClusterGroup.prototype.removeMarker = function (marker) {
    var idx = this._markers.indexOf(marker);
    if (idx !== -1) {
      this._markers.splice(idx, 1);
      this._scheduleUpdate();
    }
  };

  MarkerClusterGroup.prototype.clearMarkers = function () {
    this._markers = [];
    this._clearRendered();
  };

  MarkerClusterGroup.prototype.getMarkers = function () {
    return this._markers.slice();
  };

  // ---- internal ----

  MarkerClusterGroup.prototype._scheduleUpdate = function () {
    if (this._updateTimer) return;
    var self = this;
    this._updateTimer = setTimeout(function () {
      self._updateTimer = null;
      self._refresh();
    }, 80);
  };

  MarkerClusterGroup.prototype._clearRendered = function () {
    var map = this._map;
    if (!map) return;
    var i;
    for (i = 0; i < this._clusters.length; i++) map.removeLayer(this._clusters[i]);
    for (i = 0; i < this._soloOnMap.length; i++) map.removeLayer(this._soloOnMap[i]);
    this._clusters = [];
    this._soloOnMap = [];
  };

  MarkerClusterGroup.prototype._refresh = function () {
    var map = this._map;
    if (!map) return;

    this._clearRendered();

    var zoom = map.getZoom();
    var markers = this._markers;

    // Above max cluster zoom: show everything individually
    if (zoom > this._maxClusterZoom) {
      for (var i = 0; i < markers.length; i++) {
        markers[i].addTo(map);
        this._soloOnMap.push(markers[i]);
      }
      return;
    }

    // Grid-based clustering
    var grid = {};
    var gridSize = this._gridSize;
    var bounds = map.getBounds();

    for (var m = 0; m < markers.length; m++) {
      var mk = markers[m];
      var latlng = mk.getLatLng();

      // Skip markers outside current view (with buffer)
      // We still cluster them so counts are correct for visible clusters,
      // but for performance skip far-away ones
      var pt = map.latLngToContainerPoint(latlng);
      var gx = Math.floor(pt.x / gridSize);
      var gy = Math.floor(pt.y / gridSize);
      var key = gx + ':' + gy;

      if (!grid[key]) {
        grid[key] = { markers: [], sumLat: 0, sumLon: 0 };
      }
      grid[key].markers.push(mk);
      grid[key].sumLat += latlng.lat;
      grid[key].sumLon += latlng.lng;
    }

    var self = this;
    var keys = Object.keys(grid);
    for (var k = 0; k < keys.length; k++) {
      var cell = grid[keys[k]];
      var count = cell.markers.length;

      if (count === 1) {
        // Solo marker - add directly
        cell.markers[0].addTo(map);
        this._soloOnMap.push(cell.markers[0]);
      } else {
        // Cluster - create cluster icon at centroid
        var cLat = cell.sumLat / count;
        var cLng = cell.sumLon / count;

        var sizeClass = count < 10 ? 'marker-cluster-small'
                      : count < 50 ? 'marker-cluster-medium'
                      : 'marker-cluster-large';

        var clusterIcon = L.divIcon({
          className: 'marker-cluster ' + sizeClass,
          html: '<div><span>' + count + '</span></div>',
          iconSize: L.point(40, 40),
          iconAnchor: L.point(20, 20)
        });

        var clusterMarker = L.marker([cLat, cLng], {
          icon: clusterIcon,
          interactive: true,
          zIndexOffset: 500
        });

        // Store child markers for spiderfy/zoom on click
        clusterMarker._childMarkers = cell.markers;

        clusterMarker.on('click', function (e) {
          self._onClusterClick(e.target);
        });

        clusterMarker.addTo(map);
        this._clusters.push(clusterMarker);
      }
    }
  };

  MarkerClusterGroup.prototype._onClusterClick = function (clusterMarker) {
    var map = this._map;
    if (!map) return;

    var children = clusterMarker._childMarkers;
    if (!children || children.length === 0) return;

    // Calculate bounds of child markers and zoom to fit
    var latlngs = [];
    for (var i = 0; i < children.length; i++) {
      latlngs.push(children[i].getLatLng());
    }
    var bounds = L.latLngBounds(latlngs);

    // If already at max zoom, spiderfy instead
    if (map.getZoom() >= map.getMaxZoom() || map.getZoom() >= this._maxClusterZoom) {
      this._spiderfy(clusterMarker);
    } else {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: this._maxClusterZoom + 1 });
    }
  };

  MarkerClusterGroup.prototype._spiderfy = function (clusterMarker) {
    var map = this._map;
    if (!map) return;

    var children = clusterMarker._childMarkers;
    if (!children || children.length === 0) return;

    var center = clusterMarker.getLatLng();
    var count = children.length;

    // Remove cluster, add individual markers in a circle pattern
    map.removeLayer(clusterMarker);
    var idx = this._clusters.indexOf(clusterMarker);
    if (idx !== -1) this._clusters.splice(idx, 1);

    var angleStep = (2 * Math.PI) / count;
    var radius = 35 + count * 3; // px
    var centerPt = map.latLngToContainerPoint(center);

    for (var i = 0; i < count; i++) {
      var angle = angleStep * i - Math.PI / 2;
      var x = centerPt.x + radius * Math.cos(angle);
      var y = centerPt.y + radius * Math.sin(angle);
      var pos = map.containerPointToLatLng(L.point(x, y));

      // Move child marker to spiderfied position
      var child = children[i];
      child._origLatLng = child.getLatLng();
      child.setLatLng(pos);
      child.addTo(map);
      this._soloOnMap.push(child);

      // Draw leg line
      var leg = L.polyline([center, pos], {
        color: '#999',
        weight: 1.5,
        opacity: 0.6,
        className: 'marker-cluster-spider-leg'
      }).addTo(map);
      this._clusters.push(leg); // track for cleanup
    }

    // Clicking map un-spiderfies (restores original positions on next refresh)
    var self = this;
    var unspiderfy = function () {
      // Restore original positions
      for (var j = 0; j < children.length; j++) {
        if (children[j]._origLatLng) {
          children[j].setLatLng(children[j]._origLatLng);
          delete children[j]._origLatLng;
        }
      }
      map.off('click', unspiderfy);
      self._scheduleUpdate();
    };

    setTimeout(function () {
      map.on('click', unspiderfy);
    }, 100);
  };

  global.MarkerClusterGroup = MarkerClusterGroup;
})(window);
