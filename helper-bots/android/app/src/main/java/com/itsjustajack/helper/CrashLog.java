package com.itsjustajack.helper;

import android.content.Context;

import java.io.File;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/** If Helper ever crashes, what went wrong is saved and shown the next time it opens. */
final class CrashLog {
    private CrashLog() {}

    static File file(Context c) {
        return new File(c.getFilesDir(), "last_crash.txt");
    }

    static void install(Context c) {
        Context app = c.getApplicationContext();
        Thread.UncaughtExceptionHandler before = Thread.getDefaultUncaughtExceptionHandler();
        if (before instanceof Saver) return;
        Thread.setDefaultUncaughtExceptionHandler(new Saver(app, before));
    }

    /** The saved report, or null. Reading it clears it. */
    static String take(Context c) {
        File f = file(c);
        if (!f.exists()) return null;
        try {
            return new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        } finally {
            f.delete();
        }
    }

    private static final class Saver implements Thread.UncaughtExceptionHandler {
        private final Context app;
        private final Thread.UncaughtExceptionHandler next;

        Saver(Context app, Thread.UncaughtExceptionHandler next) {
            this.app = app;
            this.next = next;
        }

        @Override
        public void uncaughtException(Thread t, Throwable e) {
            try {
                StringWriter sw = new StringWriter();
                e.printStackTrace(new PrintWriter(sw));
                String s = "Helper " + BuildInfo.version(app) + " on Android " + android.os.Build.VERSION.RELEASE
                        + " (" + android.os.Build.MODEL + ")\n" + sw;
                Files.write(file(app).toPath(), s.getBytes(StandardCharsets.UTF_8));
            } catch (Throwable ignored) {
                // nothing more to do
            }
            if (next != null) next.uncaughtException(t, e);
        }
    }
}
