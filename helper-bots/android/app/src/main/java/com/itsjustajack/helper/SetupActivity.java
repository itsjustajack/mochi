package com.itsjustajack.helper;

import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONObject;

/**
 * Link this phone to Helper on the PC, once. On the PC: Settings > Phone link > Link a new phone.
 * Type the PC's Wi-Fi address and the code it shows. The phone gets its own key (kept encrypted
 * with the Android Keystore) and the notes key. Nothing else to install: no Termux.
 */
public class SetupActivity extends Activity {
    private final Handler main = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Ui.BG);
        scroll.setFitsSystemWindows(true);
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int p = Ui.dp(this, 22);
        box.setPadding(p, p, p, p);
        scroll.addView(box);
        setContentView(scroll);

        box.addView(Ui.text(this, "Link to your PC (optional)", 24, Ui.TEXT, true));
        TextView intro = Ui.text(this, "Helper works on this phone by itself. Linking lets the phone use the "
                + "PC's agents, email and bigger AI instead. Put Tailscale on both, then on the PC open Helper, "
                + "Settings › Phone link: type the PC's Tailscale address (starts 100.), turn it on, press "
                + "\"Link a new phone\" and type the address and code here. Press Back to skip.", 15, Ui.MUTED, false);
        intro.setPadding(0, Ui.dp(this, 8), 0, Ui.dp(this, 16));
        box.addView(intro);

        EditText host = field("PC's address, e.g. 100.101.102.103", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        host.setText(KeyBox.prefs(this).getString("pc_host", ""));
        EditText code = field("Pairing code", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS);
        EditText name = field("Name for this phone", InputType.TYPE_CLASS_TEXT);
        name.setText(Build.MODEL);
        box.addView(host);
        box.addView(code);
        box.addView(name);

        TextView status = Ui.text(this, "", 14, Ui.MUTED, false);
        status.setPadding(0, Ui.dp(this, 10), 0, Ui.dp(this, 10));
        Button go = Ui.button(this, "Link", true);
        box.addView(go);
        box.addView(status);

        go.setOnClickListener(v -> {
            String h = host.getText().toString().trim();
            String c = code.getText().toString().trim();
            String n = name.getText().toString().trim();
            if (!h.matches("[0-9A-Za-z.\\-]{3,64}") || c.length() < 4) {
                status.setTextColor(Ui.BAD);
                status.setText("Type the PC's address and the code it shows.");
                return;
            }
            go.setEnabled(false);
            status.setTextColor(Ui.MUTED);
            status.setText("Linking…");
            new Thread(() -> {
                String msg;
                boolean ok = false;
                try {
                    JSONObject res = Api.pair(h, Api.DEFAULT_PORT, c, n.isEmpty() ? "Phone" : n);
                    KeyBox.save(this, res.getString("key"));
                    if (res.has("notes_key")) KeyBox.saveNotesKey(this, res.getString("notes_key"));
                    KeyBox.prefs(this).edit().putString("pc_host", h).putInt("pc_port", Api.DEFAULT_PORT).apply();
                    msg = "Linked. Your key is saved on this phone only.";
                    ok = true;
                } catch (Api.HttpError e) {
                    msg = e.getMessage();
                } catch (Exception e) {
                    msg = "Couldn't reach the PC at " + h + ". Is Helper open there, with Phone link on?";
                }
                final String fm = msg;
                final boolean fok = ok;
                main.post(() -> {
                    status.setTextColor(fok ? Ui.OK : Ui.BAD);
                    status.setText(fm);
                    go.setEnabled(true);
                    if (fok) main.postDelayed(this::finish, 700);
                });
            }).start();
        });

        TextView note = Ui.text(this, "Note: on home Wi-Fi the link isn't encrypted yet (that's coming). "
                + "Your brain dump notes are always encrypted before they leave the phone.", 13, Ui.MUTED, false);
        note.setPadding(0, Ui.dp(this, 20), 0, 0);
        box.addView(note);
    }

    private EditText field(String hint, int type) {
        EditText e = new EditText(this);
        e.setHint(hint);
        e.setHintTextColor(Ui.MUTED);
        e.setTextColor(Ui.TEXT);
        e.setInputType(type);
        e.setSingleLine(true);
        e.setBackground(Ui.round(this, Ui.PANEL2, 10, 0));
        int p = Ui.dp(this, 12);
        e.setPadding(p, p, p, p);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.bottomMargin = Ui.dp(this, 10);
        e.setLayoutParams(lp);
        return e;
    }

}
