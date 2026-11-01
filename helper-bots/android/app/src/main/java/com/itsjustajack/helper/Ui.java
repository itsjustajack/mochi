package com.itsjustajack.helper;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.util.TypedValue;
import android.view.Gravity;
import android.widget.Button;
import android.widget.TextView;

/** Shared colours, notification channels and small view helpers, matching the web app. */
final class Ui {
    static final int BG = 0xFF101412, PANEL = 0xFF171C19, PANEL2 = 0xFF1E2420, LINE = 0xFF262D29;
    static final int TEXT = 0xFFE8EFE9, MUTED = 0xFF93A197, ACCENT = 0xFF7CC4A4;
    static final int OK = 0xFF4CC38A, WARN = 0xFFE5B450, BAD = 0xFFEF6B73;

    static final String CH_APPROVALS = "approvals";
    static final String CH_WATCH = "watch";

    private Ui() {}

    static void channels(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        NotificationChannel a = new NotificationChannel(CH_APPROVALS, "Needs your OK", NotificationManager.IMPORTANCE_HIGH);
        a.setDescription("When an agent wants to change or delete something");
        a.setLockscreenVisibility(android.app.Notification.VISIBILITY_PRIVATE);
        nm.createNotificationChannel(a);
        NotificationChannel w = new NotificationChannel(CH_WATCH, "Helper connection", NotificationManager.IMPORTANCE_MIN);
        w.setDescription("Shown while Helper watches for approvals");
        w.setShowBadge(false);
        nm.createNotificationChannel(w);
    }

    static int dp(Context c, float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, c.getResources().getDisplayMetrics()));
    }

    static GradientDrawable round(Context c, int fill, float radiusDp, int stroke) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(fill);
        d.setCornerRadius(dp(c, radiusDp));
        if (stroke != 0) d.setStroke(dp(c, 1), stroke);
        return d;
    }

    static TextView text(Context c, String s, float sp, int color, boolean bold) {
        TextView t = new TextView(c);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        t.setLineSpacing(0, 1.2f);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    static TextView mono(Context c, String s) {
        TextView t = text(c, s, 13, TEXT, false);
        t.setTypeface(Typeface.MONOSPACE);
        t.setTextIsSelectable(true);
        t.setBackground(round(c, BG, 12, 0));
        int p = dp(c, 12);
        t.setPadding(p, p, p, p);
        return t;
    }

    static Button button(Context c, String s, boolean primary) {
        Button b = new Button(c);
        b.setText(s);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        b.setTextColor(primary ? BG : TEXT);
        b.setBackground(round(c, primary ? ACCENT : Color.TRANSPARENT, 999, primary ? 0 : LINE));
        b.setMinHeight(dp(c, 48));
        b.setGravity(Gravity.CENTER);
        b.setStateListAnimator(null);
        int p = dp(c, 18);
        b.setPadding(p, 0, p, 0);
        return b;
    }
}
