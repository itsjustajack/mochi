package com.itsjustajack.helper;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/**
 * Where the screens get their answers. On its own the phone runs Helper itself (Local): no PC, no
 * Wi-Fi. When Jack links the PC (optional), the same screens talk to Helper on the PC instead, over
 * Stub Link (home Wi-Fi, or Tailscale when away), with this phone's own key from pairing. Every PC
 * screen route is reached as /v2/app/... Call from a background thread.
 */
final class Api {
    static final int DEFAULT_PORT = 8766;

    static final class HttpError extends IOException {
        final int code;
        HttpError(int code, String msg) { super(msg); this.code = code; }
    }

    private final String key;
    private final String host;
    private final int port;
    private final Local local;

    Api(String key, String host, int port) {
        this.key = key;
        this.host = host;
        this.port = port;
        this.local = null;
    }

    private Api(Local local) {
        this.key = null;
        this.host = null;
        this.port = 0;
        this.local = local;
    }

    /** Helper on the PC when this phone is linked, otherwise Helper on this phone. Never null. */
    static Api from(Context c) {
        Api pc = pc(c);
        return pc != null ? pc : new Api(new Local(c));
    }

    /** Null unless the phone is linked to the PC. */
    static Api pc(Context c) {
        String key = KeyBox.load(c);
        String host = KeyBox.prefs(c).getString("pc_host", null);
        if (key == null || host == null) return null;
        return new Api(key, host, KeyBox.prefs(c).getInt("pc_port", DEFAULT_PORT));
    }

    static boolean linked(Context c) {
        return pc(c) != null;
    }

    boolean isLocal() {
        return local != null;
    }

    /** Pair once with the code shown on the PC. Returns {device_id, key, notes_key}. */
    static JSONObject pair(String host, int port, String code, String name) throws IOException {
        try {
            return new Api(null, host, port).call("POST", "/v2/pair",
                    new JSONObject().put("code", code).put("name", name));
        } catch (JSONException e) {
            throw new IOException(e);
        }
    }

    /** A PC app route like "/v1/today" becomes "/v2/app/today". */
    private static String map(String path) {
        if (path.startsWith("/v1/")) return "/v2/app/" + path.substring(4);
        return path;
    }

    JSONObject get(String path) throws IOException {
        if (local != null) return local.get(path);
        return call("GET", map(path), null);
    }

    JSONObject post(String path, JSONObject body) throws IOException {
        if (local != null) return local.post(path, body);
        return call("POST", map(path), body == null ? new JSONObject() : body);
    }

    JSONObject health() throws IOException {
        return call("GET", "/v2/health", null);
    }

    /** An encrypted brain dump note (see Notes). */
    void sendNote(byte[] sealed) throws IOException {
        try {
            call("POST", "/v2/notes", new JSONObject().put("note",
                    android.util.Base64.encodeToString(sealed, android.util.Base64.NO_WRAP)));
        } catch (JSONException e) {
            throw new IOException(e);
        }
    }

    private JSONObject call(String method, String path, JSONObject body) throws IOException {
        if (local != null) throw new IOException("not linked to a PC");
        URL url = new URL("http", host, port, path);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        try {
            conn.setRequestMethod(method);
            conn.setConnectTimeout(3000);
            conn.setReadTimeout(10000);
            conn.setUseCaches(false);
            conn.setInstanceFollowRedirects(false);
            if (key != null) conn.setRequestProperty("Authorization", "Bearer " + key);
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
            } catch (JSONException e) {
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
            if (total > 4_000_000) throw new IOException("response too large");
            out.write(buf, 0, n);
        }
        return out.toString("UTF-8");
    }

    static String enc(String s) {
        try {
            return URLEncoder.encode(s, "UTF-8");
        } catch (java.io.UnsupportedEncodingException e) {
            return s;
        }
    }

    /** Pending OK cards, newest last. */
    JSONArray approvals() throws IOException {
        return get("/v1/approvals").optJSONArray("approvals");
    }

    JSONObject approval(String id) throws IOException {
        JSONArray list = approvals();
        for (int i = 0; list != null && i < list.length(); i++) {
            JSONObject a = list.optJSONObject(i);
            if (a != null && id.equals(a.optString("id"))) return a;
        }
        return null;
    }

    void decide(String id, String verdict) throws IOException {
        try {
            post("/v1/approvals/" + enc(id), new JSONObject().put("verdict", verdict));
        } catch (JSONException e) {
            throw new IOException(e);
        }
    }

    void stopAll() throws IOException {
        post("/v1/stop", null);
    }

    /**
     * One line in plain words. With details=false only the agent and the job are named, never
     * file names or email text, so nothing private shows on the lock screen.
     */
    static String describe(JSONObject a, boolean details) {
        StringBuilder sb = new StringBuilder();
        sb.append(a.optString("agent", "Helper")).append(" wants to: ")
          .append(a.optString("job", a.optString("tool", "do something").replace('_', ' ')));
        JSONObject args = details ? a.optJSONObject("args") : null;
        if (args != null) {
            JSONArray names = args.names();
            for (int i = 0; names != null && i < names.length(); i++) {
                String k = names.optString(i);
                String v = args.optString(k);
                if (v.length() > 300) v = v.substring(0, 300) + "…";
                sb.append("\n").append(k).append(": ").append(v);
            }
        }
        return sb.toString();
    }
}
