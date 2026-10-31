package com.itsjustajack.helper;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;

/** First run and connection settings: paste helperd's key, test it, choose approval alerts. */
public class SetupActivity extends Activity {
    private EditText keyField;
    private TextView result;
    private final Handler main = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Ui.BG);
        scroll.setFitsSystemWindows(true);
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int p = Ui.dp(this, 24);
        box.setPadding(p, Ui.dp(this, 40), p, p);
        scroll.addView(box);
        setContentView(scroll);

        box.addView(Ui.text(this, "Connect to Helper", 24, Ui.TEXT, true));
        TextView intro = Ui.text(this,
                "Helper's engine runs in Termux on this phone. This app only shows it and asks for "
                        + "your fingerprint or PIN before anything is approved.", 15, Ui.MUTED, false);
        intro.setPadding(0, Ui.dp(this, 8), 0, Ui.dp(this, 20));
        box.addView(intro);

        box.addView(step("1. In Termux, set Helper up once:"));
        box.addView(Ui.mono(this, "helper init"));
        box.addView(step("2. Copy its key to the clipboard:"));
        box.addView(Ui.mono(this, "termux-clipboard-set < ~/.helper/secret/token"));
        box.addView(step("3. Paste it here:"));

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        keyField = new EditText(this);
        keyField.setHint("Key");
        keyField.setHintTextColor(Ui.MUTED);
        keyField.setTextColor(Ui.TEXT);
        keyField.setSingleLine(true);
        keyField.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        keyField.setImportantForAutofill(android.view.View.IMPORTANT_FOR_AUTOFILL_NO);
        keyField.setBackground(Ui.round(this, Ui.PANEL, 999, Ui.LINE));
        int fp = Ui.dp(this, 16);
        keyField.setPadding(fp, Ui.dp(this, 12), fp, Ui.dp(this, 12));
        row.addView(keyField, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        Button paste = Ui.button(this, "Paste", false);
        paste.setOnClickListener(v -> paste());
        LinearLayout.LayoutParams plp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        plp.leftMargin = Ui.dp(this, 8);
        row.addView(paste, plp);
        box.addView(row);

        String saved = KeyBox.load(this);
        TextView current = Ui.text(this, saved == null ? "No key saved yet." : "Saved key ends in " + KeyBox.hint(saved),
                13, Ui.MUTED, false);
        current.setPadding(0, Ui.dp(this, 8), 0, 0);
        box.addView(current);

        Switch alerts = new Switch(this);
        alerts.setText("Notify me when an agent needs my OK");
        alerts.setTextColor(Ui.TEXT);
        alerts.setTextSize(15);
        alerts.setChecked(WatchService.wanted(this));
        alerts.setPadding(0, Ui.dp(this, 20), 0, Ui.dp(this, 8));
        alerts.setOnCheckedChangeListener((b, on) -> {
            KeyBox.prefs(this).edit().putBoolean("watch", on).apply();
            if (on) WatchService.startIfWanted(this);
            else WatchService.stop(this);
        });
        box.addView(alerts);

        Button save = Ui.button(this, "Save and connect", true);
        save.setOnClickListener(v -> save());
        LinearLayout.LayoutParams slp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        slp.topMargin = Ui.dp(this, 16);
        box.addView(save, slp);

        result = Ui.text(this, "", 14, Ui.MUTED, false);
        result.setPadding(0, Ui.dp(this, 12), 0, 0);
        box.addView(result);

        if (saved != null) {
            Button forget = Ui.button(this, "Forget the saved key", false);
            forget.setTextColor(Ui.BAD);
            forget.setOnClickListener(v -> {
                KeyBox.clear(this);
                WatchService.stop(this);
                current.setText("No key saved yet.");
                result.setText("Key removed from this phone.");
            });
            LinearLayout.LayoutParams flp = new LinearLayout.LayoutParams(slp);
            flp.topMargin = Ui.dp(this, 24);
            box.addView(forget, flp);
        }

        TextView sig = Ui.text(this, "Helper " + versionName() + " · signed build. Its signing fingerprint is printed in each GitHub build log.",
                12, Ui.MUTED, false);
        sig.setPadding(0, Ui.dp(this, 28), 0, 0);
        box.addView(sig);
    }

    @Override
    public void onBackPressed() {
        if (KeyBox.load(this) == null) finishAffinity(); // nothing to show without a key
        else super.onBackPressed();
    }

    private TextView step(String s) {
        TextView t = Ui.text(this, s, 15, Ui.TEXT, false);
        t.setPadding(0, Ui.dp(this, 14), 0, Ui.dp(this, 6));
        return t;
    }

    private String versionName() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "";
        }
    }

    private void paste() {
        ClipboardManager cm = getSystemService(ClipboardManager.class);
        if (cm == null || !cm.hasPrimaryClip()) return;
        ClipData clip = cm.getPrimaryClip();
        if (clip != null && clip.getItemCount() > 0) {
            CharSequence t = clip.getItemAt(0).coerceToText(this);
            if (t != null) keyField.setText(t.toString().trim());
        }
    }

    private void save() {
        String key = keyField.getText().toString().trim();
        if (!key.matches("[A-Za-z0-9_\\-]{20,100}")) {
            result.setTextColor(Ui.BAD);
            result.setText("That doesn't look like a Helper key.");
            return;
        }
        result.setTextColor(Ui.MUTED);
        result.setText("Checking…");
        new Thread(() -> {
            String msg;
            boolean ok = false;
            try {
                new Api(key, Api.port(this)).get("/v1/status");
                KeyBox.save(this, key);
                ok = true;
                msg = "Connected.";
            } catch (Api.HttpError e) {
                msg = e.code == 401 ? "helperd is running but that key is wrong." : "helperd said: " + e.getMessage();
            } catch (java.io.IOException e) {
                try {
                    KeyBox.save(this, key);
                    msg = "Key saved. Helper isn't running yet; you can start it from the next screen.";
                    ok = true;
                } catch (Exception e2) {
                    msg = "Could not save the key: " + e2.getMessage();
                }
            } catch (Exception e) {
                msg = "Could not save the key: " + e.getMessage();
            }
            final String fm = msg;
            final boolean fok = ok;
            main.post(() -> {
                result.setTextColor(fok ? Ui.OK : Ui.BAD);
                result.setText(fm);
                if (fok) {
                    keyField.setText("");
                    WatchService.startIfWanted(this);
                    main.postDelayed(this::finish, 700);
                }
            });
        }).start();
    }
}
