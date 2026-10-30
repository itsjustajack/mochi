package com.itsjustajack.scriptpocket;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Saves scripts as files inside the app:
 *   scripts/index.json            list of ids, on/off state and where each came from
 *   scripts/(id)/script.user.js   the script itself
 *   scripts/(id)/requires.js      its @require libraries, joined
 *   scripts/(id)/resources.json   its @resource files as base64
 * GM_setValue data lives in SharedPreferences named "values_(id)".
 */
public class ScriptStore {
    public static class Entry {
        public String id;
        public boolean enabled = true;
        public String source = "";
        public long installed;
        public long updated;
        public String code = "";
        public UserScript meta;
    }

    private static ScriptStore instance;
    private static volatile int changeCount;

    private final Context ctx;
    private final File root;
    private final List<Entry> entries = new ArrayList<>();

    public static synchronized ScriptStore get(Context c) {
        if (instance == null) instance = new ScriptStore(c.getApplicationContext());
        return instance;
    }

    /** Goes up every time a script is added, changed, removed or switched. */
    public static int changeCount() { return changeCount; }

    private ScriptStore(Context c) {
        ctx = c;
        root = new File(c.getFilesDir(), "scripts");
        //noinspection ResultOfMethodCallIgnored
        root.mkdirs();
        load();
    }

    private void load() {
        entries.clear();
        File idx = new File(root, "index.json");
        if (!idx.exists()) return;
        try {
            JSONArray arr = new JSONArray(readText(idx));
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                Entry e = new Entry();
                e.id = o.getString("id");
                e.enabled = o.optBoolean("enabled", true);
                e.source = o.optString("source", "");
                e.installed = o.optLong("installed");
                e.updated = o.optLong("updated");
                File f = new File(new File(root, e.id), "script.user.js");
                if (!f.exists()) continue;
                e.code = readText(f);
                e.meta = UserScript.parse(e.code);
                entries.add(e);
            }
        } catch (IOException | JSONException ex) {
            Bridge.addLog("App", "error", "Could not read the script list: " + ex);
        }
    }

    private void saveIndex() {
        JSONArray arr = new JSONArray();
        try {
            for (Entry e : entries) {
                JSONObject o = new JSONObject();
                o.put("id", e.id);
                o.put("enabled", e.enabled);
                o.put("source", e.source);
                o.put("installed", e.installed);
                o.put("updated", e.updated);
                arr.put(o);
            }
            writeText(new File(root, "index.json"), arr.toString(1));
        } catch (IOException | JSONException ex) {
            Bridge.addLog("App", "error", "Could not save the script list: " + ex);
        }
        changeCount++;
    }

    public synchronized List<Entry> list() { return new ArrayList<>(entries); }

    public synchronized Entry find(String id) {
        if (id == null) return null;
        for (Entry e : entries) if (e.id.equals(id)) return e;
        return null;
    }

    /** Finds an installed script with the same @name and @namespace, so installing it again updates it. */
    public synchronized Entry findSame(UserScript s) {
        for (Entry e : entries) {
            if (e.meta.name.equals(s.name) && e.meta.namespace.equals(s.namespace)) return e;
        }
        return null;
    }

    /** Writes a script and its downloaded extras. Pass id = null to add a new one. */
    public synchronized Entry save(String id, String code, String source, String requires,
                                   JSONObject resources) throws IOException {
        Entry e = find(id);
        long now = System.currentTimeMillis();
        if (e == null) {
            e = new Entry();
            e.id = id != null ? id : UUID.randomUUID().toString().replace("-", "").substring(0, 12);
            e.installed = now;
            entries.add(e);
        }
        File dir = new File(root, e.id);
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        writeText(new File(dir, "script.user.js"), code);
        writeText(new File(dir, "requires.js"), requires == null ? "" : requires);
        writeText(new File(dir, "resources.json"), resources == null ? "{}" : resources.toString());
        e.code = code;
        e.meta = UserScript.parse(code);
        if (source != null && !source.isEmpty()) e.source = source;
        e.updated = now;
        saveIndex();
        return e;
    }

    public synchronized void setEnabled(String id, boolean on) {
        Entry e = find(id);
        if (e == null || e.enabled == on) return;
        e.enabled = on;
        saveIndex();
    }

    public synchronized void delete(String id) {
        Entry e = find(id);
        if (e == null) return;
        entries.remove(e);
        File dir = new File(root, id);
        File[] files = dir.listFiles();
        if (files != null) for (File f : files) //noinspection ResultOfMethodCallIgnored
            f.delete();
        //noinspection ResultOfMethodCallIgnored
        dir.delete();
        values(id).edit().clear().apply();
        saveIndex();
    }

    public String requires(String id) {
        try { return readText(new File(new File(root, id), "requires.js")); }
        catch (IOException ex) { return ""; }
    }

    public JSONObject resources(String id) {
        try { return new JSONObject(readText(new File(new File(root, id), "resources.json"))); }
        catch (IOException | JSONException ex) { return new JSONObject(); }
    }

    public SharedPreferences values(String id) {
        return ctx.getSharedPreferences("values_" + id, Context.MODE_PRIVATE);
    }

    public JSONObject valuesAsJson(String id) {
        JSONObject o = new JSONObject();
        for (Map.Entry<String, ?> v : values(id).getAll().entrySet()) {
            try { o.put(v.getKey(), String.valueOf(v.getValue())); } catch (JSONException ignored) { }
        }
        return o;
    }

    public static SharedPreferences settings(Context c) {
        return c.getSharedPreferences("settings", Context.MODE_PRIVATE);
    }

    public static boolean scriptsOn(Context c) { return settings(c).getBoolean("scripts_on", true); }

    public static void setScriptsOn(Context c, boolean on) {
        settings(c).edit().putBoolean("scripts_on", on).apply();
        changeCount++;
    }

    static String readText(File f) throws IOException {
        try (FileInputStream in = new FileInputStream(f)) {
            return new String(Net.readAll(in), StandardCharsets.UTF_8);
        }
    }

    static void writeText(File f, String s) throws IOException {
        File tmp = new File(f.getPath() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(s.getBytes(StandardCharsets.UTF_8));
        }
        if (!tmp.renameTo(f)) throw new IOException("Could not save " + f.getName());
    }
}
