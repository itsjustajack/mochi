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

/** Shared colours, notification channels and small view helpers, matching the Windows app. */
final class Ui {
    static final int BG = 0xFF17212B, PANEL = 0xFF182533, PANEL2 = 0xFF1F2F3F, LINE = 0xFF24364A;
    static final int TEXT = 0xFFF5F5F5, MUTED = 0xFF7F91A4, ACCENT = 0xFF5288C1, RAIL = 0xFF0E1621;
    static final int OK = 0xFF5FB878, WARN = 0xFFE0B05F, BAD = 0xFFE06C6C;

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
        b.setTextColor(primary ? 0xFFFFFFFF : TEXT);
        b.setBackground(round(c, primary ? ACCENT : Color.TRANSPARENT, 999, primary ? 0 : LINE));
        b.setMinHeight(dp(c, 48));
        b.setGravity(Gravity.CENTER);
        b.setStateListAnimator(null);
        int p = dp(c, 18);
        b.setPadding(p, 0, p, 0);
        return b;
    }

    /** A small flat button in a given colour. */
    static Button chip(Context c, String s, int fill, boolean on) {
        Button b = new Button(c);
        b.setText(s);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        b.setTextColor(on ? 0xFFFFFFFF : MUTED);
        b.setBackground(round(c, on ? fill : LINE, 8, 0));
        b.setMinHeight(dp(c, 36));
        b.setMinimumHeight(dp(c, 36));
        b.setMinWidth(0);
        b.setMinimumWidth(0);
        b.setStateListAnimator(null);
        int p = dp(c, 10);
        b.setPadding(p, 0, p, 0);
        return b;
    }
}
