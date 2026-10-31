package com.itsjustajack.helper;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.widget.RemoteViews;

import org.json.JSONObject;

/**
 * Home-screen widget: Helper's status and how many requests are waiting, with Open and Stop all.
 * It never shows file names, and it never approves anything: Open takes you to the full card.
 */
public class StatusWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager mgr, int[] ids) {
        final Context c = context.getApplicationContext();
        render(c, "Checking…", 0, true);
        final PendingResult done = goAsync();
        new Thread(() -> {
            refreshNow(c);
            done.finish();
        }).start();
    }

    static void refresh(Context c) {
        refreshNow(c);
    }

    private static void refreshNow(Context c) {
        Api api = Api.from(c);
        if (api == null) {
            render(c, "Open Helper to connect", 0, false);
            return;
        }
        try {
            JSONObject st = api.get("/v1/status");
            int count = st.optInt("pending", 0);
            render(c, statusLine(st, count), count, true);
        } catch (Exception e) {
            render(c, "Not running", 0, false);
        }
    }

    static String statusLine(JSONObject st, int pending) {
        if (st.optBoolean("stopped")) return "Stopped";
        if (pending == 1) return "1 request needs your OK";
        if (pending > 1) return pending + " requests need your OK";
        JSONObject model = st.optJSONObject("model");
        if (model != null && !model.optBoolean("ok")) return "Model not ready";
        return "Ready";
    }

    static void render(Context c, String status, int pending, boolean reachable) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(c);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(c, StatusWidget.class));
        if (ids == null || ids.length == 0) return;
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_status);
        v.setTextViewText(R.id.widget_status, status);
        v.setTextColor(R.id.widget_status, !reachable ? Ui.BAD : pending > 0 ? Ui.WARN : Ui.MUTED);
        v.setTextViewText(R.id.widget_review, pending > 0 ? "Review" : "Open");
        v.setOnClickPendingIntent(R.id.widget_root, WatchService.openApp(c, 11));
        v.setOnClickPendingIntent(R.id.widget_review, WatchService.openApp(c, 12));
        v.setOnClickPendingIntent(R.id.widget_stop, ActionReceiver.pending(c, ActionReceiver.STOP_ALL, null));
        mgr.updateAppWidget(ids, v);
    }
}
