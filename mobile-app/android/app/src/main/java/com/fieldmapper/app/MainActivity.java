package com.fieldmapper.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register the native GPS tracking plugin before super.onCreate
        registerPlugin(GpsTrackingPlugin.class);
        registerPlugin(SharingFilesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
