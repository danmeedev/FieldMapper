package com.fieldmapper.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.location.Location;
import android.os.Binder;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

/**
 * Android foreground service for continuous GPS tracking.
 * Runs independently of the WebView — survives app backgrounding,
 * screen off, and even WebView process death.
 *
 * Data is stored in SQLite via TrackingDatabase so it persists
 * across any lifecycle event.
 */
public class GpsTrackingService extends Service {
    private static final String TAG = "GpsTrackingService";
    private static final String CHANNEL_ID = "fieldmapper_tracking";
    private static final int NOTIFICATION_ID = 1001;

    public static final String ACTION_START = "com.fieldmapper.app.START_TRACKING";
    public static final String ACTION_STOP = "com.fieldmapper.app.STOP_TRACKING";
    public static final String EXTRA_SESSION_NAME = "session_name";
    public static final String EXTRA_INTERVAL_MS = "interval_ms";
    public static final String EXTRA_MIN_DISTANCE_M = "min_distance_m";

    private FusedLocationProviderClient fusedClient;
    private LocationCallback locationCallback;
    private TrackingDatabase db;
    private PowerManager.WakeLock wakeLock;

    private long currentSessionId = -1;
    private Location lastRecordedLocation;
    private long pointCount = 0;
    private double totalDistanceM = 0;
    private long startTimeMs = 0;

    // Configurable parameters (set via intent extras)
    private long intervalMs = 3000;       // GPS update interval
    private float minDistanceM = 5.0f;    // Minimum distance between recorded points
    private float maxAccuracyM = 50.0f;   // Discard points worse than this accuracy

    // Listener for real-time updates to the WebView
    private GpsUpdateListener updateListener;

    public interface GpsUpdateListener {
        void onLocationUpdate(Location location);
        void onTrackingStats(long points, double distanceM, long elapsedMs);
    }

    public class LocalBinder extends Binder {
        public GpsTrackingService getService() {
            return GpsTrackingService.this;
        }
    }

    private final IBinder binder = new LocalBinder();

    @Override
    public void onCreate() {
        super.onCreate();
        db = TrackingDatabase.getInstance(this);
        fusedClient = LocationServices.getFusedLocationProviderClient(this);
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            // Service restarted after being killed — try to resume
            long activeSession = db.getActiveSessionId();
            if (activeSession > 0) {
                currentSessionId = activeSession;
                startLocationUpdates();
                startForeground(NOTIFICATION_ID, buildNotification("Tracking resumed..."));
                Log.i(TAG, "Service restarted, resuming session " + currentSessionId);
            } else {
                stopSelf();
            }
            return START_STICKY;
        }

        String action = intent.getAction();

        if (ACTION_STOP.equals(action)) {
            stopTracking();
            return START_NOT_STICKY;
        }

        // ACTION_START or default
        if (currentSessionId > 0) {
            Log.w(TAG, "Already tracking session " + currentSessionId);
            return START_STICKY;
        }

        // Read configuration from intent
        intervalMs = intent.getLongExtra(EXTRA_INTERVAL_MS, 3000);
        minDistanceM = intent.getFloatExtra(EXTRA_MIN_DISTANCE_M, 5.0f);
        String sessionName = intent.getStringExtra(EXTRA_SESSION_NAME);

        // Start new session
        currentSessionId = db.startSession(sessionName);
        pointCount = 0;
        totalDistanceM = 0;
        startTimeMs = System.currentTimeMillis();
        lastRecordedLocation = null;

        Log.i(TAG, "Starting tracking session " + currentSessionId +
                " (interval=" + intervalMs + "ms, minDist=" + minDistanceM + "m)");

        // Acquire partial wake lock to keep CPU running
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "fieldmapper:gps_tracking");
        wakeLock.acquire();

        startForeground(NOTIFICATION_ID, buildNotification("Starting GPS tracking..."));
        startLocationUpdates();

        return START_STICKY;
    }

    private void startLocationUpdates() {
        LocationRequest request = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, intervalMs)
                .setMinUpdateIntervalMillis(intervalMs / 2)
                .setMaxUpdateDelayMillis(intervalMs * 3)
                .build();

        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult result) {
                Location location = result.getLastLocation();
                if (location == null) return;
                processLocation(location);
            }
        };

        try {
            fusedClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper());
        } catch (SecurityException e) {
            Log.e(TAG, "Location permission not granted", e);
            stopTracking();
        }
    }

    private void processLocation(Location location) {
        // Filter by accuracy
        if (location.getAccuracy() > maxAccuracyM) {
            return;
        }

        // Filter by minimum distance
        if (lastRecordedLocation != null) {
            float dist = location.distanceTo(lastRecordedLocation);
            if (dist < minDistanceM) {
                // Still notify listener for live display even if not recording
                if (updateListener != null) {
                    updateListener.onLocationUpdate(location);
                }
                return;
            }
            totalDistanceM += dist;
        }

        // Record to SQLite
        db.insertPoint(currentSessionId,
                location.getLatitude(),
                location.getLongitude(),
                location.hasAltitude() ? location.getAltitude() : 0,
                location.getAccuracy(),
                location.hasSpeed() ? location.getSpeed() : 0,
                location.hasBearing() ? location.getBearing() : 0,
                location.getTime());

        lastRecordedLocation = location;
        pointCount++;

        // Update notification every 10 points
        if (pointCount % 10 == 0) {
            updateNotification();
        }

        // Notify listener (for WebView updates)
        if (updateListener != null) {
            updateListener.onLocationUpdate(location);
            updateListener.onTrackingStats(pointCount, totalDistanceM,
                    System.currentTimeMillis() - startTimeMs);
        }
    }

    private void stopTracking() {
        Log.i(TAG, "Stopping tracking session " + currentSessionId +
                " (" + pointCount + " points, " + String.format("%.0f", totalDistanceM) + "m)");

        if (locationCallback != null) {
            fusedClient.removeLocationUpdates(locationCallback);
            locationCallback = null;
        }

        if (currentSessionId > 0) {
            db.endSession(currentSessionId);
            currentSessionId = -1;
        }

        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
            wakeLock = null;
        }

        stopForeground(true);
        stopSelf();
    }

    // --- Notification ---

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "GPS Tracking",
                    NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Shows while Field Mapper is recording your track");
            channel.setShowBadge(false);
            NotificationManager nm = getSystemService(NotificationManager.class);
            nm.createNotificationChannel(channel);
        }
    }

    private Notification buildNotification(String text) {
        Intent openApp = new Intent(this, MainActivity.class);
        openApp.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingOpen = PendingIntent.getActivity(this, 0, openApp,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent stopIntent = new Intent(this, GpsTrackingService.class);
        stopIntent.setAction(ACTION_STOP);
        PendingIntent pendingStop = PendingIntent.getService(this, 1, stopIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Field Mapper - Tracking")
                .setContentText(text)
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setContentIntent(pendingOpen)
                .addAction(android.R.drawable.ic_media_pause, "Stop", pendingStop)
                .setOngoing(true)
                .setSilent(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
    }

    private void updateNotification() {
        String distStr;
        if (totalDistanceM > 1609) {
            distStr = String.format("%.1f mi", totalDistanceM / 1609.34);
        } else {
            distStr = String.format("%.0f m", totalDistanceM);
        }

        long elapsed = System.currentTimeMillis() - startTimeMs;
        long mins = elapsed / 60000;
        String timeStr = mins < 60 ?
                mins + " min" :
                String.format("%dh %dm", mins / 60, mins % 60);

        String text = pointCount + " pts · " + distStr + " · " + timeStr;

        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.notify(NOTIFICATION_ID, buildNotification(text));
    }

    // --- Public API for binding ---

    public void setUpdateListener(GpsUpdateListener listener) {
        this.updateListener = listener;
    }

    public boolean isTracking() {
        return currentSessionId > 0;
    }

    public long getCurrentSessionId() {
        return currentSessionId;
    }

    public long getPointCount() {
        return pointCount;
    }

    public double getTotalDistanceM() {
        return totalDistanceM;
    }

    public long getElapsedMs() {
        return startTimeMs > 0 ? System.currentTimeMillis() - startTimeMs : 0;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (locationCallback != null) {
            fusedClient.removeLocationUpdates(locationCallback);
        }
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
    }
}
