package com.itsjustajack.scriptpocket;

import android.app.Activity;
import android.app.AlertDialog;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.View;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** The dialogs for installing, importing and updating scripts, shared by every screen. */
public class InstallUi {
    private static final ExecutorService WORK = Executors.newSingleThreadExecutor();
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    public interface Task<T> { T run() throws Exception; }
    public interface Done<T> { void done(T result); }

    /** Runs work in the background behind a "please wait" dialog, then reports back on screen. */
    public static <T> void background(Activity a, String waitText, Task<T> task, Done<T> done) {
        AlertDialog wait = new AlertDialog.Builder(a).setMessage(waitText).setCancelable(false).show();
        WORK.execute(() -> {
            T result = null;
            Exception error = null;
            try { result = task.run(); } catch (Exception e) { error = e; }
            final T r = result;
            final Exception err = error;
            MAIN.post(() -> {
                if (a.isFinishing() || a.isDestroyed()) return;
                wait.dismiss();
                if (err != null) {
                    String msg = err.getMessage() == null ? err.toString() : err.getMessage();
                    new AlertDialog.Builder(a).setTitle("That didn't work")
                            .setMessage(msg).setPositiveButton("OK", null).show();
                } else if (done != null) {
                    done.done(r);
                }
            });
        });
    }

    public static boolean looksLikeUserScriptUrl(String url) {
        if (url == null) return false;
        String path = Uri.parse(url).getPath();
        return path != null && path.toLowerCase().endsWith(".user.js");
    }

    public static void askForUrl(Activity a, Runnable onInstalled) {
        EditText input = new EditText(a);
        input.setHint("https://example.com/my-script.user.js");
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        new AlertDialog.Builder(a)
                .setTitle("Install from a link")
                .setView(padded(a, input))
                .setPositiveButton("Next", (d, w) -> {
                    String url = input.getText().toString().trim();
                    if (!url.isEmpty()) installFromUrl(a, url, onInstalled);
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    public static void installFromUrl(Activity a, String url, Runnable onInstalled) {
        background(a, "Downloading script…", () -> Net.get(url).text(),
                code -> confirm(a, code, url, onInstalled));
    }

    public static void installFromUri(Activity a, Uri uri, Runnable onInstalled) {
        background(a, "Reading file…", () -> readUri(a, uri), code -> confirm(a, code, "", onInstalled));
    }

    public static String readUri(Activity a, Uri uri) throws IOException {
        try (InputStream in = a.getContentResolver().openInputStream(uri)) {
            if (in == null) throw new IOException("Could not open that file");
            return new String(Net.readAll(in), StandardCharsets.UTF_8);
        }
    }

    /** Shows what a script is and where it runs, and installs it if the user agrees. */
    public static void confirm(Activity a, String code, String source, Runnable onInstalled) {
        UserScript s = UserScript.parse(code);
        if (!s.hasHeader) {
            new AlertDialog.Builder(a).setTitle("Not a userscript")
                    .setMessage("This file has no ==UserScript== header, so there's nothing to install.")
                    .setPositiveButton("OK", null).show();
            return;
        }
        ScriptStore.Entry existing = ScriptStore.get(a).findSame(s);
        StringBuilder msg = new StringBuilder();
        if (!s.version.isEmpty()) msg.append("Version ").append(s.version).append("\n");
        if (!s.author.isEmpty()) msg.append("By ").append(s.author).append("\n");
        if (!s.description.isEmpty()) msg.append("\n").append(s.description).append("\n");
        msg.append("\nRuns on: ").append(s.runsOn()).append("\n");
        if (!s.requires.isEmpty()) msg.append("Downloads ").append(s.requires.size()).append(" extra librar")
                .append(s.requires.size() == 1 ? "y" : "ies").append("\n");
        if (existing != null) {
            int cmp = UserScript.compareVersions(s.version, existing.meta.version);
            msg.append("\nYou already have version ").append(existing.meta.version.isEmpty() ? "?" : existing.meta.version)
                    .append(cmp > 0 ? ". This updates it." : cmp == 0 ? ". This reinstalls it." : ". This is an older version.");
        }
        msg.append("\n\nOnly install scripts you trust: a script can read and change the pages it runs on.");

        new AlertDialog.Builder(a)
                .setTitle((existing != null ? "Update " : "Install ") + s.name + "?")
                .setMessage(msg.toString())
                .setPositiveButton(existing != null ? "Update" : "Install", (d, w) ->
                        background(a, "Installing…", () -> Installer.install(a, code, source, null, true), e -> {
                            Toast.makeText(a, "Installed " + e.meta.name, Toast.LENGTH_SHORT).show();
                            if (onInstalled != null) onInstalled.run();
                        }))
                .setNeutralButton("View code", (d, w) -> showCode(a, code, source, onInstalled))
                .setNegativeButton("Cancel", null)
                .show();
    }

    private static void showCode(Activity a, String code, String source, Runnable onInstalled) {
        TextView tv = new TextView(a);
        tv.setText(code);
        tv.setTypeface(android.graphics.Typeface.MONOSPACE);
        tv.setTextSize(12);
        tv.setTextIsSelectable(true);
        int p = dp(a, 16);
        tv.setPadding(p, p, p, p);
        ScrollView sv = new ScrollView(a);
        sv.addView(tv);
        new AlertDialog.Builder(a).setView(sv)
                .setPositiveButton("Back", (d, w) -> confirm(a, code, source, onInstalled))
                .setNegativeButton("Cancel", null).show();
    }

    /** Checks each script's update link and installs any newer version. */
    public static void checkUpdates(Activity a, List<ScriptStore.Entry> scripts, Runnable onDone) {
        background(a, "Checking for updates…", () -> {
            List<String> updated = new ArrayList<>();
            List<String> failed = new ArrayList<>();
            int checked = 0;
            for (ScriptStore.Entry e : scripts) {
                String check = firstNonEmpty(e.meta.updateURL, e.meta.downloadURL, e.source);
                if (check.isEmpty() || !check.startsWith("http")) continue;
                checked++;
                try {
                    String remote = Net.get(check).text();
                    UserScript rm = UserScript.parse(remote);
                    if (UserScript.compareVersions(rm.version, e.meta.version) <= 0) continue;
                    if (!rm.metaStr.isEmpty() && remote.trim().length() <= rm.metaStr.length() + 2) {
                        // That was only the .meta.js header; fetch the full script.
                        String full = firstNonEmpty(rm.downloadURL, e.meta.downloadURL,
                                check.endsWith(".meta.js") ? check.replace(".meta.js", ".user.js") : "", e.source);
                        remote = Net.get(full).text();
                    }
                    Installer.install(a, remote, e.source, e.id, false);
                    updated.add(e.meta.name);
                } catch (Exception ex) {
                    failed.add(e.meta.name);
                    Bridge.addLog(e.meta.name, "error", "Update check failed: " + ex.getMessage());
                }
            }
            StringBuilder b = new StringBuilder();
            if (checked == 0) b.append("None of these scripts has an update link.");
            else if (updated.isEmpty()) b.append("Everything is up to date.");
            else b.append("Updated: ").append(String.join(", ", updated));
            if (!failed.isEmpty()) b.append("\n\nCouldn't check: ").append(String.join(", ", failed));
            return b.toString();
        }, msg -> {
            new AlertDialog.Builder(a).setTitle("Updates").setMessage(msg).setPositiveButton("OK", null).show();
            if (onDone != null) onDone.run();
        });
    }

    private static String firstNonEmpty(String... values) {
        for (String v : values) if (v != null && !v.isEmpty()) return v;
        return "";
    }

    public static View padded(Activity a, View v) {
        FrameLayout f = new FrameLayout(a);
        int p = dp(a, 20);
        f.setPadding(p, dp(a, 8), p, 0);
        f.addView(v);
        return f;
    }

    public static int dp(Activity a, int v) {
        return Math.round(v * a.getResources().getDisplayMetrics().density);
    }
}
