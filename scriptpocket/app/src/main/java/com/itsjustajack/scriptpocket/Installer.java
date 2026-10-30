package com.itsjustajack.scriptpocket;

import android.content.Context;
import android.util.Base64;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.net.URL;

/** Saves a script after downloading its @require and @resource files. Blocking; run off the main thread. */
public class Installer {

    /**
     * @param targetId  the script being edited, or null for a new one
     * @param matchSame when true and targetId is null, a script with the same name and
     *                  namespace is updated instead of added twice
     */
    public static ScriptStore.Entry install(Context ctx, String code, String source,
                                            String targetId, boolean matchSame) throws IOException {
        UserScript meta = UserScript.parse(code);
        ScriptStore store = ScriptStore.get(ctx);
        String id = targetId;
        if (id == null && matchSame) {
            ScriptStore.Entry same = store.findSame(meta);
            if (same != null) id = same.id;
        }
        ScriptStore.Entry old = store.find(id);
        String base = source != null && !source.isEmpty() ? source : (old != null ? old.source : "");

        StringBuilder requires = new StringBuilder();
        for (String r : meta.requires) {
            String url = resolve(base, r);
            String text = Net.get(url).text();
            requires.append("/* @require ").append(url.replace("*/", "*\\/")).append(" */\n")
                    .append(text).append("\n;\n");
        }

        JSONObject resources = new JSONObject();
        for (java.util.Map.Entry<String, String> res : meta.resources.entrySet()) {
            String url = resolve(base, res.getValue());
            Net.Result r = Net.get(url);
            String mime = r.contentType.isEmpty() ? guessMime(url) : r.contentType.split(";")[0].trim();
            try {
                JSONObject o = new JSONObject();
                o.put("mime", mime);
                o.put("b64", Base64.encodeToString(r.body, Base64.NO_WRAP));
                resources.put(res.getKey(), o);
            } catch (JSONException e) {
                throw new IOException(e);
            }
        }
        return store.save(id, code, source, requires.toString(), resources);
    }

    static String resolve(String base, String url) throws IOException {
        if (url.startsWith("http://") || url.startsWith("https://")) return url;
        if (base == null || base.isEmpty()) throw new IOException("Can't download " + url + " (not a full link)");
        return new URL(new URL(base), url).toString();
    }

    private static String guessMime(String url) {
        String u = url.toLowerCase();
        if (u.endsWith(".css")) return "text/css";
        if (u.endsWith(".js")) return "application/javascript";
        if (u.endsWith(".json")) return "application/json";
        if (u.endsWith(".png")) return "image/png";
        if (u.endsWith(".jpg") || u.endsWith(".jpeg")) return "image/jpeg";
        if (u.endsWith(".gif")) return "image/gif";
        if (u.endsWith(".svg")) return "image/svg+xml";
        if (u.endsWith(".html") || u.endsWith(".htm")) return "text/html";
        return "text/plain";
    }
}
