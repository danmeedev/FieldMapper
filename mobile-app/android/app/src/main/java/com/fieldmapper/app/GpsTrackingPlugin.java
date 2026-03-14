package com.fieldmapper.app;

import android.Manifest;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.location.Location;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;

/**
 * Capacitor plugin that bridges the native GpsTrackingService
 * to JavaScript. Provides methods to start/stop tracking,
 * query sessions and points, and receive real-time location updates.
 */
@CapacitorPlugin(
    name = "GpsTracking",
    permissions = {
        @Permission(
            alias = "location",
            strings = {
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            }
        ),
        @Permission(
            alias = "background_location",
            strings = {
                Manifest.permission.ACCESS_BACKGROUND_LOCATION
            }
        )
    }
)
public class GpsTrackingPlugin extends Plugin {
    private static final String TAG = "GpsTrackingPlugin";

    private GpsTrackingService trackingService;
    private boolean serviceBound = false;
    private TrackingDatabase db;

    // Pending call waiting for service bind
    private PluginCall pendingStartCall;

    private final ServiceConnection serviceConnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder binder) {
            GpsTrackingService.LocalBinder localBinder = (GpsTrackingService.LocalBinder) binder;
            trackingService = localBinder.getService();
            serviceBound = true;

            // Set up real-time updates to JS
            trackingService.setUpdateListener(new GpsTrackingService.GpsUpdateListener() {
                @Override
                public void onLocationUpdate(Location location) {
                    JSObject data = new JSObject();
                    data.put("lat", location.getLatitude());
                    data.put("lng", location.getLongitude());
                    data.put("alt", location.hasAltitude() ? location.getAltitude() : 0);
                    data.put("accuracy", location.getAccuracy());
                    data.put("speed", location.hasSpeed() ? location.getSpeed() : 0);
                    data.put("bearing", location.hasBearing() ? location.getBearing() : 0);
                    data.put("timestamp", location.getTime());
                    notifyListeners("locationUpdate", data);
                }

                @Override
                public void onTrackingStats(long points, double distanceM, long elapsedMs) {
                    JSObject data = new JSObject();
                    data.put("points", points);
                    data.put("distanceM", distanceM);
                    data.put("elapsedMs", elapsedMs);
                    notifyListeners("trackingStats", data);
                }
            });

            // If we had a pending start call, resolve it now
            if (pendingStartCall != null) {
                PluginCall call = pendingStartCall;
                pendingStartCall = null;
                resolveStartCall(call);
            }

            Log.i(TAG, "Service bound");
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            trackingService = null;
            serviceBound = false;
            Log.w(TAG, "Service disconnected");
        }
    };

    @Override
    public void load() {
        db = TrackingDatabase.getInstance(getContext());

        // Bind to service if it's already running (e.g., after app restart)
        if (GpsTrackingService.class.getName() != null) {
            Intent bindIntent = new Intent(getContext(), GpsTrackingService.class);
            try {
                getContext().bindService(bindIntent, serviceConnection, 0);
            } catch (Exception e) {
                // Service not running yet, that's fine
            }
        }
    }

    @PluginMethod()
    public void startTracking(PluginCall call) {
        // Check location permission first
        if (!hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)) {
            pendingStartCall = call;
            requestAllPermissions(call, "locationPermissionCallback");
            return;
        }

        // Check background location for Android 10+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
                !hasPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION)) {
            pendingStartCall = call;
            requestPermissionForAlias("background_location", call, "backgroundLocationCallback");
            return;
        }

        doStartTracking(call);
    }

    @PermissionCallback
    private void locationPermissionCallback(PluginCall call) {
        if (hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)) {
            // Now request background location if needed
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
                    !hasPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION)) {
                requestPermissionForAlias("background_location", call, "backgroundLocationCallback");
                return;
            }
            doStartTracking(call);
        } else {
            call.reject("Location permission is required for GPS tracking");
        }
    }

    @PermissionCallback
    private void backgroundLocationCallback(PluginCall call) {
        // Start tracking even if background permission was denied —
        // it'll work in foreground at minimum
        doStartTracking(call);
    }

    private void doStartTracking(PluginCall call) {
        String sessionName = call.getString("name", null);
        long intervalMs = call.getInt("intervalMs", 3000);
        float minDistanceM = call.getFloat("minDistanceM", 5.0f);

        Intent intent = new Intent(getContext(), GpsTrackingService.class);
        intent.setAction(GpsTrackingService.ACTION_START);
        intent.putExtra(GpsTrackingService.EXTRA_SESSION_NAME, sessionName);
        intent.putExtra(GpsTrackingService.EXTRA_INTERVAL_MS, intervalMs);
        intent.putExtra(GpsTrackingService.EXTRA_MIN_DISTANCE_M, minDistanceM);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }

        // Bind so we get real-time updates
        if (!serviceBound) {
            pendingStartCall = call;
            getContext().bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE);
        } else {
            resolveStartCall(call);
        }
    }

    private void resolveStartCall(PluginCall call) {
        JSObject result = new JSObject();
        if (trackingService != null) {
            result.put("sessionId", trackingService.getCurrentSessionId());
            result.put("tracking", true);
        } else {
            result.put("sessionId", db.getActiveSessionId());
            result.put("tracking", true);
        }
        call.resolve(result);
    }

    @PluginMethod()
    public void stopTracking(PluginCall call) {
        Intent intent = new Intent(getContext(), GpsTrackingService.class);
        intent.setAction(GpsTrackingService.ACTION_STOP);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }

        if (serviceBound) {
            try {
                getContext().unbindService(serviceConnection);
            } catch (Exception e) {
                // Already unbound
            }
            serviceBound = false;
            trackingService = null;
        }

        JSObject result = new JSObject();
        result.put("tracking", false);
        call.resolve(result);
    }

    @PluginMethod()
    public void isTracking(PluginCall call) {
        JSObject result = new JSObject();
        boolean tracking = false;
        long sessionId = -1;

        if (serviceBound && trackingService != null) {
            tracking = trackingService.isTracking();
            sessionId = trackingService.getCurrentSessionId();
        } else {
            sessionId = db.getActiveSessionId();
            tracking = sessionId > 0;
        }

        result.put("tracking", tracking);
        result.put("sessionId", sessionId);

        if (tracking && serviceBound && trackingService != null) {
            result.put("points", trackingService.getPointCount());
            result.put("distanceM", trackingService.getTotalDistanceM());
            result.put("elapsedMs", trackingService.getElapsedMs());
        }

        call.resolve(result);
    }

    @PluginMethod()
    public void getTrackingStats(PluginCall call) {
        JSObject result = new JSObject();
        if (serviceBound && trackingService != null) {
            result.put("points", trackingService.getPointCount());
            result.put("distanceM", trackingService.getTotalDistanceM());
            result.put("elapsedMs", trackingService.getElapsedMs());
            result.put("sessionId", trackingService.getCurrentSessionId());
        } else {
            result.put("points", 0);
            result.put("distanceM", 0);
            result.put("elapsedMs", 0);
            result.put("sessionId", -1);
        }
        call.resolve(result);
    }

    @PluginMethod()
    public void getSessions(PluginCall call) {
        try {
            JSONArray sessions = db.getAllSessions();
            JSObject result = new JSObject();
            result.put("sessions", sessions.toString());
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Failed to get sessions", e);
        }
    }

    @PluginMethod()
    public void getSessionPoints(PluginCall call) {
        long sessionId = call.getInt("sessionId", -1);
        if (sessionId < 0) {
            call.reject("sessionId is required");
            return;
        }
        try {
            JSONArray points = db.getSessionPoints(sessionId);
            JSObject result = new JSObject();
            result.put("points", points.toString());
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Failed to get session points", e);
        }
    }

    @PluginMethod()
    public void deleteSession(PluginCall call) {
        long sessionId = call.getInt("sessionId", -1);
        if (sessionId < 0) {
            call.reject("sessionId is required");
            return;
        }
        db.deleteSession(sessionId);
        JSObject result = new JSObject();
        result.put("deleted", true);
        call.resolve(result);
    }

    @PluginMethod()
    public void getUnsyncedPoints(PluginCall call) {
        int limit = call.getInt("limit", 500);
        try {
            JSONArray points = db.getUnsyncedPoints(limit);
            JSObject result = new JSObject();
            result.put("points", points.toString());
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Failed to get unsynced points", e);
        }
    }

    @PluginMethod()
    public void markPointsSynced(PluginCall call) {
        String idsStr = call.getString("ids", "");
        if (idsStr.isEmpty()) {
            call.reject("ids is required");
            return;
        }
        try {
            String[] parts = idsStr.split(",");
            long[] ids = new long[parts.length];
            for (int i = 0; i < parts.length; i++) {
                ids[i] = Long.parseLong(parts[i].trim());
            }
            db.markPointsSynced(ids);
            JSObject result = new JSObject();
            result.put("synced", ids.length);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Failed to mark points synced", e);
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (serviceBound) {
            try {
                getContext().unbindService(serviceConnection);
            } catch (Exception e) {
                // Already unbound
            }
        }
        super.handleOnDestroy();
    }
}
