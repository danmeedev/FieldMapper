package com.fieldmapper.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/** Android system pickers/sharesheet only; no network permission use or private database export. */
@CapacitorPlugin(name = "SharingFiles")
public class SharingFilesPlugin extends Plugin {
    private static final int MAX_BYTES = 32 * 1024 * 1024;
    private byte[] content(PluginCall call) throws Exception {
        String text = call.getString("content");
        if (text == null || text.length() > MAX_BYTES) throw new Exception("Sharing file exceeds 32 MiB or is missing.");
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_BYTES) throw new Exception("Sharing file exceeds 32 MiB.");
        return bytes;
    }
    private String filename(PluginCall call) {
        String name = call.getString("filename", "FieldMapper.fieldmapper.json");
        name = name.replaceAll("[^A-Za-z0-9._-]", "_");
        if (name.length() > 150) name = "FieldMapper.fieldmapper.json";
        return name.endsWith(".json") ? name : name + ".json";
    }
    @PluginMethod public void saveFile(PluginCall call) {
        try {
            content(call);
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("application/json");
            intent.putExtra(Intent.EXTRA_TITLE, filename(call));
            startActivityForResult(call, intent, "saved");
        } catch (Exception e) { call.reject(e.getMessage()); }
    }
    @ActivityCallback private void saved(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) { call.resolve(new JSObject().put("cancelled", true)); return; }
        Uri uri = result.getData().getData();
        new Thread(() -> {
            try {
                try (OutputStream out = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                    if (out == null) throw new Exception("Cannot write the selected file.");
                    out.write(content(call));
                }
                call.resolve(new JSObject().put("cancelled", false));
            } catch (Exception e) { call.reject(e.getMessage()); }
        }, "fieldmapper-save").start();
    }
    @PluginMethod public void pickFile(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        startActivityForResult(call, intent, "picked");
    }
    @ActivityCallback private void picked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) { call.resolve(new JSObject().put("cancelled", true)); return; }
        Uri uri = result.getData().getData();
        new Thread(() -> {
            try (InputStream input = getContext().getContentResolver().openInputStream(uri); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                if (input == null) throw new Exception("Cannot read the selected file.");
                byte[] buffer = new byte[16384]; int count;
                while ((count = input.read(buffer)) != -1) { if (out.size() + count > MAX_BYTES) throw new Exception("Sharing file exceeds 32 MiB."); out.write(buffer, 0, count); }
                call.resolve(new JSObject().put("content", new String(out.toByteArray(), StandardCharsets.UTF_8)).put("cancelled", false));
            } catch (Exception e) { call.reject(e.getMessage()); }
        }, "fieldmapper-open").start();
    }
    @PluginMethod public void shareFile(PluginCall call) {
        new Thread(() -> {
            try {
                File directory = new File(getContext().getCacheDir(), "sharing");
                if (!directory.isDirectory() && !directory.mkdirs()) throw new Exception("Cannot prepare sharing file.");
                File[] oldFiles = directory.listFiles();
                if (oldFiles != null) for (File old : oldFiles) {
                    if (old.isFile() && old.getCanonicalFile().getParentFile().equals(directory.getCanonicalFile()) && old.getName().endsWith(".json") && old.lastModified() < System.currentTimeMillis() - 7L * 86400000L) old.delete();
                }
                File file = new File(directory, UUID.randomUUID() + "-" + filename(call));
                try (FileOutputStream out = new FileOutputStream(file)) { out.write(content(call)); }
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
                Intent intent = new Intent(Intent.ACTION_SEND);
                intent.setType("application/json"); intent.putExtra(Intent.EXTRA_STREAM, uri);
                intent.setClipData(ClipData.newRawUri("Field Mapper data", uri));
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                getActivity().runOnUiThread(() -> {
                    try { startActivityForResult(call, Intent.createChooser(intent, "Share Field Mapper data"), "shared"); }
                    catch (Exception e) { call.reject(e.getMessage()); }
                });
            } catch (Exception e) { call.reject(e.getMessage()); }
        }, "fieldmapper-share").start();
    }
    @ActivityCallback private void shared(PluginCall call, ActivityResult result) {
        if (call != null) call.resolve(new JSObject().put("cancelled", false));
    }
}
