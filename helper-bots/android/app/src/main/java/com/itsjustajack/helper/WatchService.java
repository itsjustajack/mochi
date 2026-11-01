package com.itsjustajack.helper;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.IBinder;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Set;

/**
 * Watches helperd on 127.0.0.1 for actions that need Jack's OK and turns them into notifications.
 * Notifications name the agent and action only (no file names) and offer Deny; approving always
 * opens the app, which asks for a fingerprint or PIN first. Also keeps the home-screen widget fresh.
 */
public class WatchService extends Service {
    private static final int ONGOING_ID = 1;
    private volatile boolean running;
    private Thread worker;
    private final Set<String> shown = new HashSet<>();

    static boolean wanted(Context c) {
        return KeyBox.prefs(c).getBoolean("watch", true);
    }

    static void startIfWanted(Context c) {
        if (!wanted(c) || KeyBox.load(c) == null) return;
        try {
            c.startForegroundService(new Intent(c, WatchService.class));
        } catch (Exception ignored) {
            // Android refuses to start it from the background; the app starts it next time it opens.
        }
    }

    static void stop(Context c) {
        c.stopService(new Intent(c, WatchService.class));
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Ui.channels(this);
        Notification n = new Notification.Builder(this, Ui.CH_WATCH)
                .setSmallIcon(R.drawable.ic_face)
                .setContentTitle("Helper is watching for approvals")
                .setContentIntent(openApp(this, 0))
                .setOngoing(true)
                .build();
        startForeground(ONGOING_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        if (!running) {
            running = true;
            worker = new Thread(this::loop, "helper-watch");
            worker.start();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        if (worker != null) worker.interrupt();
        super.onDestroy();
    }

    private void loop() {
        while (running) {
            long sleep = 15000;
            Api api = Api.from(this);
            if (api == null) {
                stopSelf();
                return;
            }
            try {
                JSONObject st = api.get("/v1/status");
                JSONArray pending = api.approvals();
                int count = pending == null ? 0 : pending.length();
                sync(pending);
                StatusWidget.render(this, StatusWidget.statusLine(st, count), count, true);
                sleep = count > 0 ? 4000 : 8000;
            } catch (Api.HttpError e) {
                StatusWidget.render(this, e.code == 401 ? "Key doesn't match. Open Helper." : "Helper error", 0, false);
            } catch (Exception e) {
                StatusWidget.render(this, "Not running", 0, false);
                clearAll();
            }
            try {
                Thread.sleep(sleep);
            } catch (InterruptedException e) {
                return;
            }
        }
    }

    private void sync(JSONArray pending) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        Set<String> now = new HashSet<>();
        for (int i = 0; pending != null && i < pending.length(); i++) {
            JSONObject a = pending.optJSONObject(i);
            if (a == null) continue;
            String id = a.optString("id");
            now.add(id);
            if (shown.contains(id)) continue;
            String line = Api.describe(a, false);
            Notification pub = new Notification.Builder(this, Ui.CH_APPROVALS)
                    .setSmallIcon(R.drawable.ic_face)
                    .setContentTitle("Helper needs your OK")
                    .build();
            Notification n = new Notification.Builder(this, Ui.CH_APPROVALS)
                    .setSmallIcon(R.drawable.ic_face)
                    .setColor(Ui.WARN)
                    .setContentTitle("Needs your OK")
                    .setContentText(line + (a.optBoolean("tainted") ? " (read web content)" : ""))
                    .setCategory(Notification.CATEGORY_REMINDER)
                    .setVisibility(Notification.VISIBILITY_PRIVATE)
                    .setPublicVersion(pub)
                    .setContentIntent(openApp(this, id.hashCode()))
                    .setAutoCancel(true)
                    .addAction(new Notification.Action.Builder(null, "Deny",
                            ActionReceiver.pending(this, ActionReceiver.DENY, id)).build())
                    .addAction(new Notification.Action.Builder(null, "Review",
                            openApp(this, id.hashCode() + 1)).build())
                    .build();
            nm.notify(ActionReceiver.notifId(id), n);
            shown.add(id);
        }
        for (String id : new HashSet<>(shown)) {
            if (!now.contains(id)) {
                nm.cancel(ActionReceiver.notifId(id));
                shown.remove(id);
            }
        }
    }

    private void clearAll() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        for (String id : shown) nm.cancel(ActionReceiver.notifId(id));
        shown.clear();
    }

    static PendingIntent openApp(Context c, int req) {
        Intent i = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c, req, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
}
