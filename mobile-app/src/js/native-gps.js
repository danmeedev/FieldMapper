// Native GPS Tracking Bridge
// Connects the Capacitor GpsTracking plugin (Android foreground service)
// to the existing app GPS pipeline. Falls back to navigator.geolocation
// when running in a browser (not Capacitor).

const NativeGps = window.NativeGps = {
  isNative: false,
  isTracking: false,
  currentSessionId: null,
  plugin: null,
  _listeners: [],

  async init() {
    // Check if we're running inside Capacitor with the native plugin
    if (window.Capacitor && window.Capacitor.isPluginAvailable('GpsTracking')) {
      try {
        const { GpsTracking } = window.Capacitor.Plugins;
        this.plugin = GpsTracking;
        this.isNative = true;
        console.log('[NativeGps] Native plugin available');

        // Check if a tracking session is already running (service survived app restart)
        const status = await this.plugin.isTracking();
        if (status.tracking) {
          this.isTracking = true;
          this.currentSessionId = status.sessionId;
          console.log('[NativeGps] Resuming active session:', status.sessionId,
            'points:', status.points, 'distance:', status.distanceM);
        }

        // Listen for real-time location updates from the native service
        this.plugin.addListener('locationUpdate', (data) => {
          const pos = {
            lat: data.lat,
            lon: data.lng,
            accuracy: data.accuracy,
            altitude: data.alt,
            speed: data.speed,
            heading: data.bearing,
            timestamp: data.timestamp
          };
          // Dispatch to all registered listeners
          this._listeners.forEach(fn => {
            try { fn(pos); } catch(e) { console.error('[NativeGps] listener error:', e); }
          });
        });

        this.plugin.addListener('trackingStats', (data) => {
          if (typeof window.onNativeTrackingStats === 'function') {
            window.onNativeTrackingStats(data);
          }
        });

        return true;
      } catch (e) {
        console.warn('[NativeGps] Plugin init failed, using web GPS:', e);
        this.isNative = false;
        return false;
      }
    } else {
      console.log('[NativeGps] Not in Capacitor, using web GPS');
      return false;
    }
  },

  /**
   * Register a callback for GPS position updates.
   * Works for both native and web GPS.
   */
  onLocationUpdate(fn) {
    this._listeners.push(fn);
  },

  /**
   * Start background-persistent GPS tracking via native foreground service.
   * @param {string} name - Session name
   * @param {object} opts - { intervalMs, minDistanceM }
   * @returns {object} { sessionId, tracking }
   */
  async startTracking(name, opts = {}) {
    if (!this.isNative) {
      console.warn('[NativeGps] startTracking called but native not available');
      return { tracking: false, sessionId: null };
    }

    const result = await this.plugin.startTracking({
      name: name || `Track ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`,
      intervalMs: opts.intervalMs || 3000,
      minDistanceM: opts.minDistanceM || 5.0
    });

    this.isTracking = result.tracking;
    this.currentSessionId = result.sessionId;
    console.log('[NativeGps] Started tracking, session:', result.sessionId);
    return result;
  },

  /**
   * Stop background GPS tracking.
   */
  async stopTracking() {
    if (!this.isNative) return { tracking: false };

    const result = await this.plugin.stopTracking();
    this.isTracking = false;
    this.currentSessionId = null;
    console.log('[NativeGps] Stopped tracking');
    return result;
  },

  /**
   * Check if tracking is currently active.
   */
  async checkTracking() {
    if (!this.isNative) return { tracking: false, sessionId: null };
    const status = await this.plugin.isTracking();
    this.isTracking = status.tracking;
    this.currentSessionId = status.sessionId;
    return status;
  },

  /**
   * Get current tracking stats.
   */
  async getStats() {
    if (!this.isNative) return { points: 0, distanceM: 0, elapsedMs: 0 };
    return await this.plugin.getTrackingStats();
  },

  /**
   * Get all track sessions from native SQLite.
   */
  async getSessions() {
    if (!this.isNative) return [];
    const result = await this.plugin.getSessions();
    return JSON.parse(result.sessions || '[]');
  },

  /**
   * Get all points for a specific session.
   */
  async getSessionPoints(sessionId) {
    if (!this.isNative) return [];
    const result = await this.plugin.getSessionPoints({ sessionId });
    return JSON.parse(result.points || '[]');
  },

  /**
   * Delete a track session and all its points.
   */
  async deleteSession(sessionId) {
    if (!this.isNative) return;
    return await this.plugin.deleteSession({ sessionId });
  },

  /**
   * Get unsynced points (for pushing to laptop server).
   */
  async getUnsyncedPoints(limit = 500) {
    if (!this.isNative) return [];
    const result = await this.plugin.getUnsyncedPoints({ limit });
    return JSON.parse(result.points || '[]');
  },

  /**
   * Mark points as synced after successful push to laptop.
   */
  async markPointsSynced(ids) {
    if (!this.isNative) return;
    return await this.plugin.markPointsSynced({ ids: ids.join(',') });
  }
};

// Export for use by other modules
window.NativeGps = NativeGps;
