package com.itsjustajack.helper;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;

/** Opens a sign-in page (Google, Trello) in the phone's browser. Called from helper.mobile. */
public final class Links {
    private static Context app;

    private Links() {}

    static void init(Context c) {
        app = c.getApplicationContext();
    }

    public static void open(String url) {
        if (app == null || url == null || !url.startsWith("https://")) return;
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        app.startActivity(i);
    }
}
