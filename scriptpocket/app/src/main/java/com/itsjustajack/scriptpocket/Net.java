package com.itsjustajack.scriptpocket;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Small blocking HTTP helper. Call it off the main thread. */
public class Net {
    public static final int MAX_BODY = 20 * 1024 * 1024;

    public static class Result {
        public int status;
        public String statusText = "";
        public String headers = "";
        public String finalUrl = "";
        public String contentType = "";
        public byte[] body = new byte[0];
        public Map<String, List<String>> headerMap;

        public String text() {
            return new String(body, charsetOf(contentType));
        }
    }

    public static Result request(String method, String url, Map<String, String> headers,
                                 byte[] body, int timeoutMs) throws IOException {
        URL u = new URL(url);
        String proto = u.getProtocol().toLowerCase(Locale.ROOT);
        if (!proto.equals("http") && !proto.equals("https")) throw new IOException("Only http and https links work");
        HttpURLConnection c = (HttpURLConnection) u.openConnection();
        try {
            c.setInstanceFollowRedirects(true);
            int t = timeoutMs > 0 ? timeoutMs : 30000;
            c.setConnectTimeout(t);
            c.setReadTimeout(t);
            setMethod(c, method);
            if (headers != null) {
                for (Map.Entry<String, String> h : headers.entrySet()) c.setRequestProperty(h.getKey(), h.getValue());
            }
            if (body != null && !method.equals("GET") && !method.equals("HEAD")) {
                c.setDoOutput(true);
                c.setFixedLengthStreamingMode(body.length);
                try (OutputStream os = c.getOutputStream()) { os.write(body); }
            }
            Result r = new Result();
            r.status = c.getResponseCode();
            r.statusText = c.getResponseMessage() == null ? "" : c.getResponseMessage();
            r.finalUrl = c.getURL().toString();
            r.contentType = c.getContentType() == null ? "" : c.getContentType();
            r.headerMap = c.getHeaderFields();
            StringBuilder hb = new StringBuilder();
            for (Map.Entry<String, List<String>> e : r.headerMap.entrySet()) {
                if (e.getKey() == null) continue;
                for (String v : e.getValue()) hb.append(e.getKey().toLowerCase(Locale.ROOT)).append(": ").append(v).append("\r\n");
            }
            r.headers = hb.toString();
            InputStream in = r.status >= 400 ? c.getErrorStream() : c.getInputStream();
            if (in != null) {
                try { r.body = readAll(in); } finally { in.close(); }
            }
            return r;
        } finally {
            c.disconnect();
        }
    }

    /** HttpURLConnection refuses PATCH; set the field directly for that case. */
    private static void setMethod(HttpURLConnection c, String method) throws IOException {
        try {
            c.setRequestMethod(method);
        } catch (java.net.ProtocolException e) {
            try {
                java.lang.reflect.Field f = HttpURLConnection.class.getDeclaredField("method");
                f.setAccessible(true);
                f.set(c, method);
            } catch (ReflectiveOperationException re) {
                throw e;
            }
        }
    }

    /** Downloads a script, library or resource. Fails on HTTP errors. */
    public static Result get(String url) throws IOException {
        Result r = request("GET", url, null, null, 30000);
        if (r.status < 200 || r.status >= 300) throw new IOException("HTTP " + r.status + " for " + url);
        return r;
    }

    public static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n, total = 0;
        while ((n = in.read(buf)) > 0) {
            total += n;
            if (total > MAX_BODY) throw new IOException("Response is too big");
            out.write(buf, 0, n);
        }
        return out.toByteArray();
    }

    public static Charset charsetOf(String contentType) {
        if (contentType != null) {
            for (String part : contentType.split(";")) {
                part = part.trim();
                if (part.toLowerCase(Locale.ROOT).startsWith("charset=")) {
                    try { return Charset.forName(part.substring(8).replace("\"", "").trim()); }
                    catch (Exception ignored) { break; }
                }
            }
        }
        return StandardCharsets.UTF_8;
    }
}
