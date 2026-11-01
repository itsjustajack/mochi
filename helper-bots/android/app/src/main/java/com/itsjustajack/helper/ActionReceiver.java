package com.itsjustajack.helper;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.widget.Toast;

/**
 * The "safe direction" actions: Deny one request, or Stop all tasks. They only ever reduce what
 * the bots do, so they need no unlock. Not exported, so only Helper's own notifications and widget
 * can send them.
 */
public class ActionReceiver extends BroadcastReceiver {
    static final String DENY = "com.itsjustajack.helper.DENY";
    static final String STOP_ALL = "com.itsjustajack.helper.STOP_ALL";

    static int notifId(String approvalId) {
        return 1000 + (approvalId.hashCode() & 0x7fffff);
    }

    static PendingIntent pending(Context c, String action, String id) {
        Intent i = new Intent(c, ActionReceiver.class).setAction(action);
        if (id != null) i.putExtra("id", id);
        int req = id == null ? action.hashCode() : (action + id).hashCode();
        return PendingIntent.getBroadcast(c, req, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        final Context c = context.getApplicationContext();
        final String action = intent.getAction();
        final String id = intent.getStringExtra("id");
        final PendingResult done = goAsync();
        new Thread(() -> {
            String msg;
            try {
                Api api = Api.from(c);
                if (api == null) {
                    msg = "Open Helper to connect first.";
                } else if (DENY.equals(action) && id != null) {
                    api.decide(id, "deny");
                    c.getSystemService(NotificationManager.class).cancel(notifId(id));
                    msg = "Denied.";
                } else if (STOP_ALL.equals(action)) {
                    api.stopAll();
                    msg = "Stopped all Helper tasks.";
                } else {
                    msg = null;
                }
            } catch (Exception e) {
                msg = "Helper isn't running.";
            }
            final String fm = msg;
            if (fm != null) {
                new android.os.Handler(android.os.Looper.getMainLooper()).post(() ->
                        Toast.makeText(c, fm, Toast.LENGTH_SHORT).show());
            }
            StatusWidget.refresh(c);
            done.finish();
        }).start();
    }
}
