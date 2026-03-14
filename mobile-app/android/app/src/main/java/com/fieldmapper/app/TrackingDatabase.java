package com.fieldmapper.app;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * SQLite database for GPS track points recorded by the foreground service.
 * This persists data independently of the WebView/IndexedDB so points
 * survive app backgrounding, WebView destruction, and process death.
 */
public class TrackingDatabase extends SQLiteOpenHelper {
    private static final String TAG = "TrackingDatabase";
    private static final String DB_NAME = "fieldmapper_tracking.db";
    private static final int DB_VERSION = 1;

    private static final String TABLE_POINTS = "track_points";
    private static final String COL_ID = "id";
    private static final String COL_SESSION_ID = "session_id";
    private static final String COL_LAT = "latitude";
    private static final String COL_LNG = "longitude";
    private static final String COL_ALT = "altitude";
    private static final String COL_ACCURACY = "accuracy";
    private static final String COL_SPEED = "speed";
    private static final String COL_BEARING = "bearing";
    private static final String COL_TIMESTAMP = "timestamp";
    private static final String COL_SYNCED = "synced";

    private static final String TABLE_SESSIONS = "track_sessions";
    private static final String COL_SESSION_START = "start_time";
    private static final String COL_SESSION_END = "end_time";
    private static final String COL_SESSION_NAME = "name";
    private static final String COL_SESSION_ACTIVE = "active";

    private static TrackingDatabase instance;

    public static synchronized TrackingDatabase getInstance(Context context) {
        if (instance == null) {
            instance = new TrackingDatabase(context.getApplicationContext());
        }
        return instance;
    }

    private TrackingDatabase(Context context) {
        super(context, DB_NAME, null, DB_VERSION);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE " + TABLE_SESSIONS + " (" +
                COL_ID + " INTEGER PRIMARY KEY AUTOINCREMENT, " +
                COL_SESSION_NAME + " TEXT, " +
                COL_SESSION_START + " INTEGER NOT NULL, " +
                COL_SESSION_END + " INTEGER DEFAULT 0, " +
                COL_SESSION_ACTIVE + " INTEGER DEFAULT 1" +
                ")");

        db.execSQL("CREATE TABLE " + TABLE_POINTS + " (" +
                COL_ID + " INTEGER PRIMARY KEY AUTOINCREMENT, " +
                COL_SESSION_ID + " INTEGER NOT NULL, " +
                COL_LAT + " REAL NOT NULL, " +
                COL_LNG + " REAL NOT NULL, " +
                COL_ALT + " REAL DEFAULT 0, " +
                COL_ACCURACY + " REAL DEFAULT 0, " +
                COL_SPEED + " REAL DEFAULT 0, " +
                COL_BEARING + " REAL DEFAULT 0, " +
                COL_TIMESTAMP + " INTEGER NOT NULL, " +
                COL_SYNCED + " INTEGER DEFAULT 0, " +
                "FOREIGN KEY(" + COL_SESSION_ID + ") REFERENCES " + TABLE_SESSIONS + "(" + COL_ID + ")" +
                ")");

        db.execSQL("CREATE INDEX idx_points_session ON " + TABLE_POINTS + "(" + COL_SESSION_ID + ")");
        db.execSQL("CREATE INDEX idx_points_timestamp ON " + TABLE_POINTS + "(" + COL_TIMESTAMP + ")");
        db.execSQL("CREATE INDEX idx_points_synced ON " + TABLE_POINTS + "(" + COL_SYNCED + ")");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        // Future migrations go here
    }

    // --- Session management ---

    public long startSession(String name) {
        SQLiteDatabase db = getWritableDatabase();
        ContentValues cv = new ContentValues();
        cv.put(COL_SESSION_NAME, name != null ? name : "Track " + System.currentTimeMillis());
        cv.put(COL_SESSION_START, System.currentTimeMillis());
        cv.put(COL_SESSION_ACTIVE, 1);
        return db.insert(TABLE_SESSIONS, null, cv);
    }

    public void endSession(long sessionId) {
        SQLiteDatabase db = getWritableDatabase();
        ContentValues cv = new ContentValues();
        cv.put(COL_SESSION_END, System.currentTimeMillis());
        cv.put(COL_SESSION_ACTIVE, 0);
        db.update(TABLE_SESSIONS, cv, COL_ID + "=?", new String[]{String.valueOf(sessionId)});
    }

    public long getActiveSessionId() {
        SQLiteDatabase db = getReadableDatabase();
        Cursor c = db.query(TABLE_SESSIONS, new String[]{COL_ID},
                COL_SESSION_ACTIVE + "=1", null, null, null,
                COL_SESSION_START + " DESC", "1");
        long id = -1;
        if (c.moveToFirst()) {
            id = c.getLong(0);
        }
        c.close();
        return id;
    }

    // --- Point recording ---

    public void insertPoint(long sessionId, double lat, double lng, double alt,
                            float accuracy, float speed, float bearing, long timestamp) {
        SQLiteDatabase db = getWritableDatabase();
        ContentValues cv = new ContentValues();
        cv.put(COL_SESSION_ID, sessionId);
        cv.put(COL_LAT, lat);
        cv.put(COL_LNG, lng);
        cv.put(COL_ALT, alt);
        cv.put(COL_ACCURACY, accuracy);
        cv.put(COL_SPEED, speed);
        cv.put(COL_BEARING, bearing);
        cv.put(COL_TIMESTAMP, timestamp);
        cv.put(COL_SYNCED, 0);
        db.insert(TABLE_POINTS, null, cv);
    }

    // --- Data retrieval for JS bridge ---

    /**
     * Get all points for a session as a JSON array.
     */
    public JSONArray getSessionPoints(long sessionId) {
        SQLiteDatabase db = getReadableDatabase();
        Cursor c = db.query(TABLE_POINTS, null,
                COL_SESSION_ID + "=?", new String[]{String.valueOf(sessionId)},
                null, null, COL_TIMESTAMP + " ASC");

        JSONArray arr = new JSONArray();
        while (c.moveToNext()) {
            try {
                JSONObject pt = new JSONObject();
                pt.put("id", c.getLong(c.getColumnIndexOrThrow(COL_ID)));
                pt.put("lat", c.getDouble(c.getColumnIndexOrThrow(COL_LAT)));
                pt.put("lng", c.getDouble(c.getColumnIndexOrThrow(COL_LNG)));
                pt.put("alt", c.getDouble(c.getColumnIndexOrThrow(COL_ALT)));
                pt.put("accuracy", c.getFloat(c.getColumnIndexOrThrow(COL_ACCURACY)));
                pt.put("speed", c.getFloat(c.getColumnIndexOrThrow(COL_SPEED)));
                pt.put("bearing", c.getFloat(c.getColumnIndexOrThrow(COL_BEARING)));
                pt.put("timestamp", c.getLong(c.getColumnIndexOrThrow(COL_TIMESTAMP)));
                arr.put(pt);
            } catch (Exception e) {
                Log.e(TAG, "Error reading point", e);
            }
        }
        c.close();
        return arr;
    }

    /**
     * Get all sessions as a JSON array.
     */
    public JSONArray getAllSessions() {
        SQLiteDatabase db = getReadableDatabase();
        Cursor c = db.query(TABLE_SESSIONS, null, null, null, null, null,
                COL_SESSION_START + " DESC");

        JSONArray arr = new JSONArray();
        while (c.moveToNext()) {
            try {
                JSONObject s = new JSONObject();
                s.put("id", c.getLong(c.getColumnIndexOrThrow(COL_ID)));
                s.put("name", c.getString(c.getColumnIndexOrThrow(COL_SESSION_NAME)));
                s.put("startTime", c.getLong(c.getColumnIndexOrThrow(COL_SESSION_START)));
                s.put("endTime", c.getLong(c.getColumnIndexOrThrow(COL_SESSION_END)));
                s.put("active", c.getInt(c.getColumnIndexOrThrow(COL_SESSION_ACTIVE)) == 1);

                // Get point count
                Cursor pc = db.rawQuery("SELECT COUNT(*) FROM " + TABLE_POINTS +
                        " WHERE " + COL_SESSION_ID + "=?",
                        new String[]{String.valueOf(s.getLong("id"))});
                if (pc.moveToFirst()) {
                    s.put("pointCount", pc.getInt(0));
                }
                pc.close();

                arr.put(s);
            } catch (Exception e) {
                Log.e(TAG, "Error reading session", e);
            }
        }
        c.close();
        return arr;
    }

    /**
     * Get unsynced points (for pushing to laptop).
     */
    public JSONArray getUnsyncedPoints(int limit) {
        SQLiteDatabase db = getReadableDatabase();
        Cursor c = db.query(TABLE_POINTS, null,
                COL_SYNCED + "=0", null, null, null,
                COL_TIMESTAMP + " ASC",
                String.valueOf(limit));

        JSONArray arr = new JSONArray();
        while (c.moveToNext()) {
            try {
                JSONObject pt = new JSONObject();
                pt.put("id", c.getLong(c.getColumnIndexOrThrow(COL_ID)));
                pt.put("sessionId", c.getLong(c.getColumnIndexOrThrow(COL_SESSION_ID)));
                pt.put("lat", c.getDouble(c.getColumnIndexOrThrow(COL_LAT)));
                pt.put("lng", c.getDouble(c.getColumnIndexOrThrow(COL_LNG)));
                pt.put("alt", c.getDouble(c.getColumnIndexOrThrow(COL_ALT)));
                pt.put("accuracy", c.getFloat(c.getColumnIndexOrThrow(COL_ACCURACY)));
                pt.put("speed", c.getFloat(c.getColumnIndexOrThrow(COL_SPEED)));
                pt.put("bearing", c.getFloat(c.getColumnIndexOrThrow(COL_BEARING)));
                pt.put("timestamp", c.getLong(c.getColumnIndexOrThrow(COL_TIMESTAMP)));
                arr.put(pt);
            } catch (Exception e) {
                Log.e(TAG, "Error reading unsynced point", e);
            }
        }
        c.close();
        return arr;
    }

    /**
     * Mark points as synced by their IDs.
     */
    public void markPointsSynced(long[] ids) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            ContentValues cv = new ContentValues();
            cv.put(COL_SYNCED, 1);
            for (long id : ids) {
                db.update(TABLE_POINTS, cv, COL_ID + "=?", new String[]{String.valueOf(id)});
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    /**
     * Get the latest point for a session (used to resume distance calculation).
     */
    public JSONObject getLastPoint(long sessionId) {
        SQLiteDatabase db = getReadableDatabase();
        Cursor c = db.query(TABLE_POINTS, null,
                COL_SESSION_ID + "=?", new String[]{String.valueOf(sessionId)},
                null, null, COL_TIMESTAMP + " DESC", "1");

        JSONObject pt = null;
        if (c.moveToFirst()) {
            try {
                pt = new JSONObject();
                pt.put("lat", c.getDouble(c.getColumnIndexOrThrow(COL_LAT)));
                pt.put("lng", c.getDouble(c.getColumnIndexOrThrow(COL_LNG)));
                pt.put("alt", c.getDouble(c.getColumnIndexOrThrow(COL_ALT)));
                pt.put("accuracy", c.getFloat(c.getColumnIndexOrThrow(COL_ACCURACY)));
                pt.put("speed", c.getFloat(c.getColumnIndexOrThrow(COL_SPEED)));
                pt.put("timestamp", c.getLong(c.getColumnIndexOrThrow(COL_TIMESTAMP)));
            } catch (Exception e) {
                Log.e(TAG, "Error reading last point", e);
            }
        }
        c.close();
        return pt;
    }

    /**
     * Delete a session and all its points.
     */
    public void deleteSession(long sessionId) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            db.delete(TABLE_POINTS, COL_SESSION_ID + "=?", new String[]{String.valueOf(sessionId)});
            db.delete(TABLE_SESSIONS, COL_ID + "=?", new String[]{String.valueOf(sessionId)});
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    /**
     * Get total point count across all sessions (for stats).
     */
    public int getTotalPointCount() {
        SQLiteDatabase db = getReadableDatabase();
        Cursor c = db.rawQuery("SELECT COUNT(*) FROM " + TABLE_POINTS, null);
        int count = 0;
        if (c.moveToFirst()) {
            count = c.getInt(0);
        }
        c.close();
        return count;
    }
}
