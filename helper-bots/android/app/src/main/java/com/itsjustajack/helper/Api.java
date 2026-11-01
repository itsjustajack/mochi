package com.itsjustajack.helper;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Tiny client for helperd on 127.0.0.1. Call from a background thread only. */
final class Api {
    static final String HOST = "127.0.0.1";
    static final int DEFAULT_PORT = 8765;

    static final class HttpError extends IOException {
        final int code;
        HttpError(int code, String msg) { super(msg); this.code = code; }
    }

    private final String key;
    private final int port;

    Api(String key, int port) {
        this.key = key;
        this.port = port;
    }

    /** Null if no key has been set up yet. */
    static Api from(Context c) {
        String key = KeyBox.load(c);
        if (key == null) return null;
        return new Api(key, port(c));
    }

    static int port(Context c) {
        return KeyBox.prefs(c).getInt("port", DEFAULT_PORT);
    }

    static String baseUrl(Context c) {
        return "http://" + HOST + ":" + port(c) + "/";
    }

    JSONObject get(String path) throws IOException {
        return call("GET", path, null);
    }

    JSONObject post(String path, JSONObject body) throws IOException {
        return call("POST", path, body == null ? new JSONObject() : body);
    }

    private JSONObject call(String method, String path, JSONObject body) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL("http://" + HOST + ":" + port + path).openConnection();
        try {
            conn.setRequestMethod(method);
            conn.setConnectTimeout(2500);
            conn.setReadTimeout(8000);
            conn.setUseCaches(false);
            conn.setInstanceFollowRedirects(false);
            conn.setRequestProperty("Authorization", "Bearer " + key);
            conn.setRequestProperty("Accept", "application/json");
            if (body != null) {
                byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(bytes);
                }
            }
            int code = conn.getResponseCode();
            InputStream in = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            String text = in == null ? "" : readAll(in);
            JSONObject json;
            try {
                json = text.isEmpty() ? new JSONObject() : new JSONObject(text);
            } catch (Exception e) {
                json = new JSONObject();
            }
            if (code >= 400) throw new HttpError(code, json.optString("error", "HTTP " + code));
            return json;
        } finally {
            conn.disconnect();
        }
    }

    private static String readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        int total = 0;
        while ((n = in.read(buf)) > 0) {
            total += n;
            if (total > 2_000_000) throw new IOException("response too large");
            out.write(buf, 0, n);
        }
        return out.toString("UTF-8");
    }

    /** Pending approvals, newest last. */
    JSONArray approvals() throws IOException {
        return get("/v1/approvals").optJSONArray("approvals");
    }

    /** Finds one pending approval by id, or null. */
    JSONObject approval(String id) throws IOException {
        JSONArray list = approvals();
        if (list == null) return null;
        for (int i = 0; i < list.length(); i++) {
            JSONObject a = list.optJSONObject(i);
            if (a != null && id.equals(a.optString("id"))) return a;
        }
        return null;
    }

    void decide(String id, String verdict) throws IOException {
        try {
            post("/v1/approvals/" + java.net.URLEncoder.encode(id, "UTF-8"),
                    new JSONObject().put("verdict", verdict));
        } catch (org.json.JSONException e) {
            throw new IOException(e);
        }
    }

    void stopAll() throws IOException {
        post("/v1/stop", null);
    }

    /**
     * One line in plain words. With details=false only the agent and the action are named, never
     * file names, so nothing private shows on the home screen or lock screen.
     */
    static String describe(JSONObject a, boolean details) {
        StringBuilder sb = new StringBuilder();
        sb.append(a.optString("agent", "Helper")).append(" wants to ")
          .append(a.optString("tool", "do something").replace('_', ' '));
        JSONObject args = details ? a.optJSONObject("args") : null;
        if (args != null) {
            JSONArray names = args.names();
            for (int i = 0; names != null && i < names.length(); i++) {
                String k = names.optString(i);
                String v = args.optString(k);
                sb.append("\n").append(k).append(": ").append(v);
            }
        }
        return sb.toString();
    }
}
