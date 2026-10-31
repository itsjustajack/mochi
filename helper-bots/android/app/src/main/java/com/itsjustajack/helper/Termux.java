package com.itsjustajack.helper;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;

/**
 * Asks Termux to start `helper serve` in the background.
 * Needs: Termux installed, `allow-external-apps = true` in ~/.termux/termux.properties,
 * and the "Run commands in Termux environment" permission granted to Helper.
 */
final class Termux {
    static final String PERMISSION = "com.termux.permission.RUN_COMMAND";
    static final String HELPER_BIN = "/data/data/com.termux/files/usr/bin/helper";

    private Termux() {}

    static boolean installed(Activity a) {
        try {
            a.getPackageManager().getPackageInfo("com.termux", 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    static boolean hasPermission(Activity a) {
        return a.checkSelfPermission(PERMISSION) == PackageManager.PERMISSION_GRANTED;
    }

    /** Returns null on success, or a plain-words reason it could not start. */
    static String startHelper(Activity a) {
        if (!installed(a)) return "Termux is not installed.";
        if (!hasPermission(a)) {
            a.requestPermissions(new String[]{PERMISSION}, 42);
            return "Allow Helper to run commands in Termux, then tap Start again.";
        }
        Intent i = new Intent("com.termux.RUN_COMMAND");
        i.setClassName("com.termux", "com.termux.app.RunCommandService");
        i.putExtra("com.termux.RUN_COMMAND_PATH", HELPER_BIN);
        i.putExtra("com.termux.RUN_COMMAND_ARGUMENTS", new String[]{"serve"});
        i.putExtra("com.termux.RUN_COMMAND_BACKGROUND", true);
        try {
            a.startService(i);
            return null;
        } catch (SecurityException e) {
            return "Termux refused. In Termux run:\n"
                    + "echo allow-external-apps=true >> ~/.termux/termux.properties";
        } catch (Exception e) {
            return "Could not start Termux: " + e.getMessage();
        }
    }
}
