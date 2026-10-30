package com.itsjustajack.scriptpocket;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.text.SimpleDateFormat;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Date;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/**
 * The object scripts reach as window.ScriptPocketBridge. Any web page can see it, so every
 * call must carry the secret token that only our injected runtime knows.
 */
public class Bridge {
    public static final String NAME = "ScriptPocketBridge";

    public interface Host {
        void openUrl(String url);
    }

    public static class MenuCommand {
        public final String scriptId, cmdId, name;
        MenuCommand(String s, String c, String n) { scriptId = s; cmdId = c; name = n; }
    }

    private static class Job {
        volatile String result;
        volatile Future<?> future;
        final long started = System.currentTimeMillis();
    }

    private static final ArrayDeque<String> LOG = new ArrayDeque<>();
    private static final int LOG_MAX = 300;

    public final String token = random(24);
    public final String key = random(10);

    private final Context ctx;
    private final Host host;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private final Map<String, Job> jobs = new ConcurrentHashMap<>();
    private final LinkedHashSet<String> ran = new LinkedHashSet<>();
    private final Map<String, MenuCommand> menu = new LinkedHashMap<>();
    private volatile String userAgent = "";
    private int seq;

    public Bridge(Context ctx, Host host) {
        this.ctx = ctx.getApplicationContext();
        this.host = host;
    }

    public void setUserAgent(String ua) { userAgent = ua == null ? "" : ua; }

    /** Called when the main page starts loading something new. */
    public synchronized void newPage() {
        ran.clear();
        menu.clear();
    }

    public synchronized List<String> ranScriptIds() { return new ArrayList<>(ran); }

    public synchronized List<MenuCommand> menuCommands() { return new ArrayList<>(menu.values()); }

    private boolean ok(String t) { return token.equals(t); }

    private String nameOf(String id) {
        ScriptStore.Entry e = ScriptStore.get(ctx).find(id);
        return e == null ? "?" : e.meta.name;
    }

    private SharedPreferences values(String id) { return ScriptStore.get(ctx).values(id); }

    // ---------- storage ----------

    @JavascriptInterface
    public String getValue(String t, String id, String k) {
        if (!ok(t)) return null;
        return values(id).getString(k, null);
    }

    @JavascriptInterface
    public void setValue(String t, String id, String k, String json) {
        if (!ok(t)) return;
        values(id).edit().putString(k, json).apply();
    }

    @JavascriptInterface
    public void deleteValue(String t, String id, String k) {
        if (!ok(t)) return;
        values(id).edit().remove(k).apply();
    }

    @JavascriptInterface
    public String listValues(String t, String id) {
        if (!ok(t)) return "[]";
        return new JSONArray(values(id).getAll().keySet()).toString();
    }

    // ---------- GM_xmlhttpRequest ----------

    @JavascriptInterface
    public String xhrStart(String t, String id, String detailsJson) {
        if (!ok(t)) return "";
        purgeOldJobs();
        final JSONObject d;
        try { d = new JSONObject(detailsJson); } catch (JSONException e) { return ""; }
        final String rid;
        synchronized (this) { rid = "r" + (++seq); }
        final Job job = new Job();
        jobs.put(rid, job);
        job.future = pool.submit(() -> job.result = doRequest(d).toString());
        return rid;
    }

    @JavascriptInterface
    public String xhrPoll(String t, String rid) {
        if (!ok(t)) return "";
        Job j = jobs.get(rid);
        if (j == null) return "{\"error\":\"request lost\"}";
        String r = j.result;
        if (r == null) return "";
        jobs.remove(rid);
        return r;
    }

    @JavascriptInterface
    public void xhrAbort(String t, String rid) {
        if (!ok(t)) return;
        Job j = jobs.remove(rid);
        if (j != null && j.future != null) j.future.cancel(true);
    }

    private void purgeOldJobs() {
        long cutoff = System.currentTimeMillis() - 10 * 60 * 1000;
        Iterator<Map.Entry<String, Job>> it = jobs.entrySet().iterator();
        while (it.hasNext()) if (it.next().getValue().started < cutoff) it.remove();
    }

    private JSONObject doRequest(JSONObject d) {
        JSONObject out = new JSONObject();
        String url = d.optString("url");
        try {
            Map<String, String> headers = new LinkedHashMap<>();
            JSONObject h = d.optJSONObject("headers");
            boolean hasUa = false, hasCookie = false;
            if (h != null) {
                Iterator<String> keys = h.keys();
                while (keys.hasNext()) {
                    String k = keys.next();
                    headers.put(k, h.optString(k));
                    if (k.equalsIgnoreCase("user-agent")) hasUa = true;
                    if (k.equalsIgnoreCase("cookie")) hasCookie = true;
                }
            }
            if (!hasUa && !userAgent.isEmpty()) headers.put("User-Agent", userAgent);
            boolean anonymous = d.optBoolean("anonymous");
            if (!anonymous && !hasCookie) {
                String c = CookieManager.getInstance().getCookie(url);
                if (c != null && !c.isEmpty()) headers.put("Cookie", c);
            }
            String user = d.isNull("user") ? null : d.optString("user");
            if (user != null && !user.isEmpty()) {
                String pass = d.isNull("password") ? "" : d.optString("password");
                headers.put("Authorization", "Basic " + Base64.encodeToString(
                        (user + ":" + pass).getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP));
            }
            byte[] body = d.isNull("data") ? null : d.optString("data").getBytes(StandardCharsets.UTF_8);
            Net.Result r = Net.request(d.optString("method", "GET"), url, headers, body, d.optInt("timeout"));

            if (!anonymous && r.headerMap != null) {
                for (Map.Entry<String, List<String>> e : r.headerMap.entrySet()) {
                    if (e.getKey() != null && e.getKey().equalsIgnoreCase("set-cookie")) {
                        for (String c : e.getValue()) CookieManager.getInstance().setCookie(r.finalUrl, c);
                    }
                }
            }
            out.put("status", r.status);
            out.put("statusText", r.statusText);
            out.put("headers", r.headers);
            out.put("finalUrl", r.finalUrl);
            out.put("contentType", r.contentType);
            if (d.optBoolean("binary")) {
                out.put("base64", Base64.encodeToString(r.body, Base64.NO_WRAP));
            } else {
                String mime = d.isNull("overrideMimeType") ? r.contentType : d.optString("overrideMimeType");
                out.put("text", new String(r.body, Net.charsetOf(mime)));
            }
        } catch (SocketTimeoutException e) {
            put(out, "timeout", true);
        } catch (Exception e) {
            put(out, "error", e.getMessage() == null ? e.toString() : e.getMessage());
        }
        return out;
    }

    private static void put(JSONObject o, String k, Object v) {
        try { o.put(k, v); } catch (JSONException ignored) { }
    }

    // ---------- everything else ----------

    @JavascriptInterface
    public void log(String t, String id, String level, String msg) {
        if (!ok(t)) return;
        addLog(nameOf(id), level, msg);
    }

    @JavascriptInterface
    public synchronized void ran(String t, String id, String url) {
        if (!ok(t)) return;
        ran.add(id);
    }

    @JavascriptInterface
    public synchronized void registerMenu(String t, String id, String cmd, String name) {
        if (!ok(t)) return;
        menu.put(id + "/" + cmd, new MenuCommand(id, cmd, name));
    }

    @JavascriptInterface
    public synchronized void unregisterMenu(String t, String id, String cmd) {
        if (!ok(t)) return;
        menu.remove(id + "/" + cmd);
    }

    @JavascriptInterface
    public void notify(String t, String id, String text) {
        if (!ok(t)) return;
        main.post(() -> Toast.makeText(ctx, text, Toast.LENGTH_LONG).show());
    }

    @JavascriptInterface
    public void setClipboard(String t, String id, String text) {
        if (!ok(t)) return;
        main.post(() -> {
            ClipboardManager cm = (ClipboardManager) ctx.getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("ScriptPocket", text));
        });
    }

    @JavascriptInterface
    public void openInTab(String t, String id, String url) {
        if (!ok(t)) return;
        main.post(() -> host.openUrl(url));
    }

    /** Builds the call that runs a menu command inside the page. */
    public String menuCallJs(MenuCommand c) {
        return "(function(){var f=window[" + JSONObject.quote("__spm_" + key + "_" + c.scriptId)
                + "];if(f)f(" + JSONObject.quote(c.cmdId) + ");})();";
    }

    // ---------- log ----------

    public static void addLog(String who, String level, String msg) {
        String time = new SimpleDateFormat("HH:mm:ss", Locale.US).format(new Date());
        synchronized (LOG) {
            LOG.addLast(time + "  " + who + "  [" + level + "]  " + msg);
            while (LOG.size() > LOG_MAX) LOG.removeFirst();
        }
    }

    public static String logText() {
        synchronized (LOG) {
            if (LOG.isEmpty()) return "Nothing logged yet.\n\nErrors from your scripts and anything they print with GM_log show up here.";
            StringBuilder b = new StringBuilder();
            Iterator<String> it = LOG.descendingIterator();
            while (it.hasNext()) b.append(it.next()).append("\n\n");
            return b.toString();
        }
    }

    public static void clearLog() {
        synchronized (LOG) { LOG.clear(); }
    }

    private static String random(int len) {
        SecureRandom r = new SecureRandom();
        String chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < len; i++) b.append(chars.charAt(r.nextInt(chars.length())));
        return b.toString();
    }
}
