package com.itsjustajack.scriptpocket;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/** Turns each enabled script into a self-contained piece of JavaScript built from assets/runtime.js. */
public class Injector {
    private static String template;

    public static List<String> buildAll(Context ctx, String token, String key) {
        List<String> out = new ArrayList<>();
        if (!ScriptStore.scriptsOn(ctx)) return out;
        ScriptStore store = ScriptStore.get(ctx);
        String tpl = template(ctx);
        for (ScriptStore.Entry e : store.list()) {
            if (!e.enabled) continue;
            try {
                JSONObject meta = metaJson(e.id, e.meta, store.resources(e.id), BuildConfig.VERSION_NAME);
                out.add(build(tpl, meta.toString(), store.requires(e.id) + "\n" + e.code, token, key));
            } catch (JSONException ex) {
                Bridge.addLog(e.meta.name, "error", "Could not prepare script: " + ex);
            }
        }
        return out;
    }

    public static JSONObject metaJson(String id, UserScript s, JSONObject resources, String appVersion) throws JSONException {
        JSONObject m = new JSONObject();
        m.put("id", id);
        m.put("name", s.name);
        m.put("namespace", s.namespace);
        m.put("version", s.version);
        m.put("description", s.description);
        m.put("author", s.author);
        m.put("runAt", s.runAt);
        m.put("noframes", s.noframes);
        m.put("matches", new JSONArray(s.matches));
        m.put("includes", new JSONArray(s.includes));
        m.put("excludes", new JSONArray(s.excludes));
        m.put("excludeMatches", new JSONArray(s.excludeMatches));
        m.put("grants", new JSONArray(s.grants));
        m.put("resources", resources == null ? new JSONObject() : resources);
        m.put("metaStr", s.metaStr);
        m.put("appVersion", appVersion);
        return m;
    }

    /** Fills the markers in runtime.js. The code goes in last so text inside it is never treated as a marker. */
    public static String build(String tpl, String metaJson, String code, String token, String key) {
        // JSON is valid JavaScript except for these two characters in older engines.
        String safeMeta = metaJson.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029");
        String head = tpl.replace("/*%%META%%*/null", safeMeta)
                .replace("/*%%TOKEN%%*/", token)
                .replace("/*%%KEY%%*/", key);
        int at = head.indexOf("/*%%CODE%%*/");
        // A trailing line comment in the script must not swallow the closing brace.
        return head.substring(0, at) + code + "\n" + head.substring(at + "/*%%CODE%%*/".length());
    }

    private static synchronized String template(Context ctx) {
        if (template == null) {
            try (InputStream in = ctx.getAssets().open("runtime.js")) {
                template = new String(Net.readAll(in), StandardCharsets.UTF_8);
            } catch (IOException e) {
                throw new IllegalStateException("runtime.js is missing from the app", e);
            }
        }
        return template;
    }
}
