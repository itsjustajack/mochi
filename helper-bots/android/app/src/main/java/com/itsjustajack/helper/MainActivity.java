package com.itsjustajack.helper;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.OutputStream;
import java.nio.file.Files;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Helper on the phone: real screens, no web page. It works on its own (Local): no PC, no Wi-Fi.
 * Linking the PC is optional; then the same screens use Helper on the PC over Stub Link.
 *
 * Tabs: Chat (Pip, OK cards), Today (Needs you, Just one thing, Too much, reminders),
 * Note (brain dump, tick the real tasks), Records (your private records) and Settings (Do / Ask me /
 * Never rows, presets, Calm mode, link to PC). Stop all is on every screen. Approve and Always ask
 * for a fingerprint or PIN first, and Settings opens with one.
 */
public class MainActivity extends Activity {
    private static final int REQ_SAVE_DRIVE = 41;
    private static final String[] CHOICES = {"never", "ask", "do"};
    private static final String[] CHOICE_WORDS = {"Never", "Ask me", "Do"};
    private static final int[] CHOICE_COLORS = {Ui.BAD, Ui.WARN, Ui.OK};

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private FrameLayout content;
    private TextView title, okPill, stopBtn, dot;
    private String tab = "chat";
    private String agent = null;
    private JSONArray agents = new JSONArray();
    private String settingsAgent = null;
    private boolean settingsUnlocked = false;
    private String pendingShare;
    private String lastSig = "";
    private File driveFile;
    private final Runnable poll = new Runnable() {
        @Override
        public void run() {
            refresh(false);
            main.postDelayed(this, 3000);
        }
    };

    // ------------------------------------------------------------------ lifecycle

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Ui.channels(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Ui.BG);
        root.setFitsSystemWindows(true);
        root.addView(topBar());
        content = new FrameLayout(this);
        root.addView(content, new LinearLayout.LayoutParams(-1, 0, 1));
        root.addView(bottomBar());
        setContentView(root);
        takeShare(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (takeShare(intent)) show("chat");
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 7);
        }
        WatchService.startIfWanted(this);
        loadAgents();
        if (Api.linked(this)) io.execute(() -> Notes.sendQueued(this));
        main.removeCallbacks(poll);
        main.post(poll);
    }

    @Override
    protected void onPause() {
        main.removeCallbacks(poll);
        settingsUnlocked = false;
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        io.shutdownNow();
        super.onDestroy();
    }

    private boolean takeShare(Intent i) {
        if (i != null && Intent.ACTION_SEND.equals(i.getAction())) {
            CharSequence t = i.getCharSequenceExtra(Intent.EXTRA_TEXT);
            if (t != null && t.length() > 0) {
                String s = t.toString();
                pendingShare = s.length() > 4000 ? s.substring(0, 4000) : s;
                return true;
            }
        }
        return false;
    }

    // ------------------------------------------------------------------ frame

    private View topBar() {
        LinearLayout bar = row();
        bar.setBackgroundColor(Ui.PANEL);
        int p = Ui.dp(this, 10);
        bar.setPadding(Ui.dp(this, 16), p, p, p);
        title = Ui.text(this, "Helper", 18, Ui.TEXT, true);
        bar.addView(title);
        dot = Ui.text(this, "  ●", 14, Ui.MUTED, false);
        bar.addView(dot, new LinearLayout.LayoutParams(0, -2, 1));
        okPill = Ui.chip(this, "OK: 0", Ui.WARN, false);
        okPill.setOnClickListener(v -> show("today"));
        bar.addView(okPill);
        stopBtn = Ui.chip(this, "Stop all", Ui.BAD, true);
        stopBtn.setOnClickListener(v -> stopOrStart());
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-2, -2);
        lp.leftMargin = Ui.dp(this, 8);
        bar.addView(stopBtn, lp);
        return bar;
    }

    private View bottomBar() {
        LinearLayout bar = row();
        bar.setBackgroundColor(Ui.RAIL);
        String[][] tabs = {{"chat", "Chat"}, {"today", "Today"}, {"note", "Note"}, {"records", "Records"}, {"settings", "Settings"}};
        for (String[] t : tabs) {
            TextView b = Ui.text(this, t[1], 14, Ui.MUTED, true);
            b.setGravity(Gravity.CENTER);
            b.setPadding(0, Ui.dp(this, 14), 0, Ui.dp(this, 14));
            b.setTag(t[0]);
            b.setOnClickListener(v -> show((String) v.getTag()));
            bar.addView(b, new LinearLayout.LayoutParams(0, -2, 1));
        }
        return bar;
    }

    private LinearLayout row() {
        LinearLayout r = new LinearLayout(this);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setGravity(Gravity.CENTER_VERTICAL);
        return r;
    }

    private LinearLayout column(ScrollView[] holder) {
        ScrollView sv = new ScrollView(this);
        sv.setFillViewport(true);
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        int p = Ui.dp(this, 12);
        col.setPadding(p, p, p, p);
        sv.addView(col);
        content.removeAllViews();
        content.addView(sv);
        if (holder != null) holder[0] = sv;
        return col;
    }

    private TextView card(LinearLayout parent, String text, boolean bold) {
        TextView t = Ui.text(this, text, bold ? 15 : 14, bold ? Ui.TEXT : Ui.MUTED, bold);
        parent.addView(t);
        return t;
    }

    private LinearLayout box(LinearLayout parent, int stroke) {
        LinearLayout b = new LinearLayout(this);
        b.setOrientation(LinearLayout.VERTICAL);
        b.setBackground(Ui.round(this, Ui.PANEL2, 12, stroke));
        int p = Ui.dp(this, 12);
        b.setPadding(p, p, p, p);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.bottomMargin = Ui.dp(this, 8);
        parent.addView(b, lp);
        return b;
    }

    private Button add(LinearLayout parent, Button b) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-2, -2);
        lp.rightMargin = Ui.dp(this, 6);
        lp.topMargin = Ui.dp(this, 6);
        parent.addView(b, lp);
        return b;
    }

    private void toast(String s) {
        main.post(() -> Toast.makeText(this, s, Toast.LENGTH_SHORT).show());
    }

    /** Runs a call on the PC in the background, then `done` on the main thread with the answer. */
    private interface Call { JSONObject run(Api api) throws Exception; }
    private interface Done { void with(JSONObject res); }

    private void bg(Call call, Done done) {
        Api api = Api.from(this);
        io.execute(() -> {
            try {
                JSONObject res = call.run(api);
                main.post(() -> { if (done != null) done.with(res); });
            } catch (Api.HttpError e) {
                toast(e.code == 401 ? "This phone isn't linked any more. Link it again." : e.getMessage());
            } catch (Exception e) {
                if (api.isLocal()) {
                    toast("Something went wrong: " + e.getMessage());
                } else {
                    toast("Can't reach the PC right now.");
                    main.post(() -> dot.setTextColor(Ui.BAD));
                }
            }
        });
    }

    private void show(String t) {
        if ("settings".equals(t) && !settingsUnlocked) {
            unlock("Open Settings", "Settings change what your agents may do", () -> {
                settingsUnlocked = true;
                show("settings");
            });
            return;
        }
        tab = t;
        lastSig = "";
        refresh(true);
    }

    private void refresh(boolean force) {
        bg(api -> api.get("/v1/status"), st -> {
            int pend = st.optInt("pending", 0);
            okPill.setText("OK: " + pend);
            okPill.setBackground(Ui.round(this, pend > 0 ? Ui.WARN : Ui.LINE, 8, 0));
            okPill.setTextColor(pend > 0 ? 0xFFFFFFFF : Ui.MUTED);
            JSONObject model = st.optJSONObject("model");
            dot.setTextColor(model != null && model.optBoolean("ok") ? Ui.OK : Ui.WARN);
            boolean stopped = st.optBoolean("stopped");
            stopBtn.setText(stopped ? "Start again" : "Stop all");
            stopBtn.setBackground(Ui.round(this, stopped ? Ui.OK : Ui.BAD, 8, 0));
        });
        switch (tab) {
            case "chat": drawChat(force); break;
            case "today": if (force) drawToday(); break;
            case "note": if (force) drawNote(); break;
            case "records": if (force) drawRecords(); break;
            case "settings": if (force) drawSettings(); break;
            default: break;
        }
    }

    private void stopOrStart() {
        bg(api -> api.get("/v1/status"), st -> {
            boolean stopped = st.optBoolean("stopped");
            bg(api -> api.post(stopped ? "/v1/start" : "/v1/stop", null),
                    r -> { toast(stopped ? "Helper can take jobs again." : "Stopped everything."); refresh(true); });
        });
    }

    // ------------------------------------------------------------------ fingerprint / PIN

    private void unlock(String what, String why, Runnable ok) {
        int auth = BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.DEVICE_CREDENTIAL;
        BiometricManager bm = getSystemService(BiometricManager.class);
        if (bm == null || bm.canAuthenticate(auth) != BiometricManager.BIOMETRIC_SUCCESS) {
            Toast.makeText(this, "Set a screen lock (PIN or fingerprint) first.", Toast.LENGTH_LONG).show();
            return;
        }
        BiometricPrompt prompt = new BiometricPrompt.Builder(this)
                .setTitle(what)
                .setDescription(why.length() > 900 ? why.substring(0, 900) + "…" : why)
                .setAllowedAuthenticators(auth)
                .setConfirmationRequired(true)
                .build();
        prompt.authenticate(new CancellationSignal(), getMainExecutor(), new BiometricPrompt.AuthenticationCallback() {
            @Override
            public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                ok.run();
            }
        });
    }

    // ------------------------------------------------------------------ Chat

    private void loadAgents() {
        bg(api -> api.get("/v1/agents"), res -> {
            agents = res.optJSONArray("agents");
            if (agents == null) agents = new JSONArray();
            if (agent == null) agent = res.optString("default", agents.length() > 0 ? agents.optJSONObject(0).optString("key") : null);
            if (pendingShare != null) tab = "chat";
            lastSig = "";
            refresh(true);
        });
    }

    private String agentName(String key) {
        for (int i = 0; i < agents.length(); i++) {
            JSONObject a = agents.optJSONObject(i);
            if (a != null && a.optString("key").equals(key)) return a.optString("name", key);
        }
        return key == null ? "Helper" : key;
    }

    private void drawChat(boolean force) {
        bg(api -> api.get("/v1/tasks"), res -> {
            JSONArray all = res.optJSONArray("tasks");
            JSONArray mine = new JSONArray();
            StringBuilder sig = new StringBuilder(agent == null ? "" : agent);
            for (int i = 0; all != null && i < all.length(); i++) {
                JSONObject t = all.optJSONObject(i);
                if (t != null && t.optString("agent").equals(agent)) {
                    mine.put(t);
                    sig.append(t.optString("id")).append(t.optString("status")).append(t.optJSONArray("events").length());
                }
            }
            if (!force && sig.toString().equals(lastSig)) return;
            lastSig = sig.toString();
            renderChat(mine);
        });
    }

    private void renderChat(JSONArray tasks) {
        title.setText(agentName(agent));
        content.removeAllViews();
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        content.addView(page);

        HorizontalScrollView hs = new HorizontalScrollView(this);
        LinearLayout chips = row();
        chips.setPadding(Ui.dp(this, 8), Ui.dp(this, 6), Ui.dp(this, 8), Ui.dp(this, 6));
        hs.addView(chips);
        for (int i = 0; i < agents.length(); i++) {
            JSONObject a = agents.optJSONObject(i);
            String key = a.optString("key");
            int color = parseColor(a.optString("color"), Ui.ACCENT);
            Button b = Ui.chip(this, a.optString("name"), color, key.equals(agent));
            b.setOnClickListener(v -> { agent = key; lastSig = ""; drawChat(true); });
            add(chips, b);
        }
        page.addView(hs);

        ScrollView sv = new ScrollView(this);
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        int p = Ui.dp(this, 12);
        col.setPadding(p, 0, p, p);
        sv.addView(col);
        page.addView(sv, new LinearLayout.LayoutParams(-1, 0, 1));
        if (tasks.length() == 0) {
            card(col, "Ask " + agentName(agent) + " something. \"from now on…\" changes what it may do on its own.", false);
        }
        for (int i = 0; i < tasks.length(); i++) {
            JSONArray evs = tasks.optJSONObject(i).optJSONArray("events");
            for (int j = 0; evs != null && j < evs.length(); j++) renderEvent(col, tasks.optJSONObject(i), evs.optJSONObject(j));
        }
        sv.post(() -> sv.fullScroll(View.FOCUS_DOWN));

        LinearLayout input = row();
        input.setBackgroundColor(Ui.PANEL);
        input.setPadding(p, Ui.dp(this, 8), p, Ui.dp(this, 8));
        EditText box = new EditText(this);
        box.setHint("Message " + agentName(agent));
        box.setHintTextColor(Ui.MUTED);
        box.setTextColor(Ui.TEXT);
        box.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        box.setMaxLines(5);
        box.setBackground(Ui.round(this, Ui.PANEL2, 18, 0));
        box.setPadding(p, Ui.dp(this, 8), p, Ui.dp(this, 8));
        if (pendingShare != null) {
            box.setText(pendingShare);  // shared text is never sent by itself
            pendingShare = null;
        }
        input.addView(box, new LinearLayout.LayoutParams(0, -2, 1));
        Button send = Ui.chip(this, "Send", Ui.ACCENT, true);
        send.setOnClickListener(v -> {
            String goal = box.getText().toString().trim();
            if (goal.isEmpty()) return;
            box.setText("");
            bg(api -> api.post("/v1/tasks", new JSONObject().put("goal", goal).put("agent", agent)), r -> {
                String a = r.optString("agent", agent);
                if (!a.equals(agent)) agent = a;
                lastSig = "";
                drawChat(true);
            });
        });
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-2, -2);
        lp.leftMargin = Ui.dp(this, 8);
        input.addView(send, lp);
        page.addView(input);
    }

    private void bubble(LinearLayout col, String text, boolean mine, boolean small) {
        TextView t = Ui.text(this, text, small ? 13 : 15, small ? Ui.MUTED : Ui.TEXT, false);
        if (!small) {
            t.setBackground(Ui.round(this, mine ? Ui.ACCENT : Ui.PANEL2, 14, 0));
            int p = Ui.dp(this, 10);
            t.setPadding(p, Ui.dp(this, 7), p, Ui.dp(this, 7));
        }
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-2, -2);
        lp.gravity = mine ? Gravity.END : Gravity.START;
        lp.topMargin = Ui.dp(this, 6);
        if (!small) {
            if (mine) lp.leftMargin = Ui.dp(this, 48);
            else lp.rightMargin = Ui.dp(this, 48);
        }
        col.addView(t, lp);
    }

    private void renderEvent(LinearLayout col, JSONObject task, JSONObject ev) {
        if (ev == null) return;
        switch (ev.optString("kind")) {
            case "user": bubble(col, ev.optString("text"), true, false); break;
            case "step": bubble(col, "→ " + ev.optString("tool"), false, true); break;
            case "result": bubble(col, (ev.optBoolean("ok") ? "✓ " : "✗ ") + cut(ev.optString("text"), 200), false, true); break;
            case "denied": bubble(col, "Not done: " + ev.optString("reason"), false, true); break;
            case "system": bubble(col, ev.optString("text"), false, true); break;
            case "checklist":
                bubble(col, "Checklist: \"" + ev.optString("label") + "\" is now " + word(ev.optString("choice")), false, true);
                break;
            case "approval": okCard(col, ev.optJSONObject("approval")); break;
            case "end":
                if (!ev.optString("text").isEmpty()) bubble(col, ev.optString("text"), false, false);
                break;
            default: break;
        }
    }

    private void okCard(LinearLayout col, JSONObject a) {
        if (a == null) return;
        boolean tainted = a.optBoolean("tainted");
        LinearLayout b = box(col, tainted ? Ui.WARN : Ui.LINE);
        card(b, Api.describe(a, false), true);
        JSONObject args = a.optJSONObject("args");
        JSONArray names = args == null ? null : args.names();
        for (int i = 0; names != null && i < names.length(); i++) {
            card(b, names.optString(i) + ": " + cut(args.optString(names.optString(i)), 300), false);
        }
        TextView why = card(b, a.optString("reason"), false);
        if (tainted) why.setTextColor(Ui.WARN);
        String id = a.optString("id");
        bg(api -> { JSONObject live = api.approval(id); return new JSONObject().put("live", live != null); }, r -> {
            LinearLayout btns = row();
            b.addView(btns);
            if (!r.optBoolean("live")) {
                card(b, "Answered", false);
                return;
            }
            add(btns, Ui.chip(this, "Approve once", Ui.OK, true)).setOnClickListener(v ->
                    unlock("Approve once?", Api.describe(a, true), () -> decide(id, "approve")));
            add(btns, Ui.chip(this, "Always", Ui.LINE, true)).setOnClickListener(v ->
                    unlock("Always allow this?", "Approve, and let " + a.optString("agent")
                            + " do this job on its own from now on. You can change it in Settings.", () -> decide(id, "always")));
            add(btns, Ui.chip(this, "No", Ui.LINE, true)).setOnClickListener(v -> decide(id, "deny"));
            add(btns, Ui.chip(this, "Stop task", Ui.BAD, true)).setOnClickListener(v -> decide(id, "stop"));
        });
    }

    private void decide(String id, String verdict) {
        bg(api -> { api.decide(id, verdict); return new JSONObject(); }, r -> { lastSig = ""; refresh(true); });
    }

    // ------------------------------------------------------------------ Today

    private void drawToday() {
        title.setText("Today");
        bg(api -> api.get("/v1/today"), d -> {
            if (!"today".equals(tab)) return;
            LinearLayout col = column(null);
            LinearLayout top = row();
            col.addView(top);
            boolean tooMuch = d.optJSONObject("calm") != null && d.optJSONObject("calm").optBoolean("too_much");
            add(top, Ui.chip(this, "Just one thing", Ui.OK, true)).setOnClickListener(v -> {
                JSONObject one = d.optJSONObject("one_thing");
                new android.app.AlertDialog.Builder(this).setTitle("Just one thing")
                        .setMessage(one == null ? "Nothing needs you right now." :
                                one.optString("text") + "\n\nFirst step: " + one.optString("first_step"))
                        .setPositiveButton("OK", null).show();
            });
            add(top, Ui.chip(this, tooMuch ? "I'm OK now" : "Too much", Ui.LINE, true)).setOnClickListener(v ->
                    bg(api -> api.post("/v1/calm", new JSONObject().put("too_much", !tooMuch)), r -> drawToday()));
            add(top, Ui.chip(this, "+ Reminder", Ui.LINE, true)).setOnClickListener(v -> addReminder());
            TextView h = Ui.text(this, "Needs you", 18, Ui.TEXT, true);
            h.setPadding(0, Ui.dp(this, 14), 0, Ui.dp(this, 6));
            col.addView(h);
            JSONArray items = d.optJSONArray("items");
            if (items == null || items.length() == 0) card(col, "Nothing right now. Nice.", false);
            for (int i = 0; items != null && i < items.length(); i++) {
                JSONObject it = items.optJSONObject(i);
                LinearLayout b = box(col, 0);
                card(b, it.optString("text"), true);
                card(b, "First step: " + it.optString("first_step"), false);
                LinearLayout btns = row();
                b.addView(btns);
                String id = it.optString("id");
                if ("reminder".equals(it.optString("kind"))) {
                    add(btns, Ui.chip(this, "Done", Ui.OK, true)).setOnClickListener(v -> rem(id, "done", ""));
                    add(btns, Ui.chip(this, "Tonight", Ui.LINE, true)).setOnClickListener(v -> rem(id, "snooze", "tonight"));
                    add(btns, Ui.chip(this, "Tomorrow", Ui.LINE, true)).setOnClickListener(v -> rem(id, "snooze", "tomorrow"));
                    if (Api.linked(this)) {
                        add(btns, Ui.chip(this, "At the PC", Ui.LINE, true)).setOnClickListener(v -> rem(id, "snooze", "at_pc"));
                    } else {
                        add(btns, Ui.chip(this, "1 hour", Ui.LINE, true)).setOnClickListener(v -> rem(id, "snooze", "1h"));
                    }
                } else if ("ok".equals(it.optString("kind"))) {
                    add(btns, Ui.chip(this, "Open", Ui.ACCENT, true)).setOnClickListener(v -> openApproval(id));
                } else if ("capture".equals(it.optString("kind")) && !Api.linked(this)) {
                    add(btns, Ui.chip(this, "Sort now", Ui.ACCENT, true)).setOnClickListener(v -> show("note"));
                }
            }
            if (d.optInt("held") > 0) {
                card(col, d.optInt("held") + " more are held until you're ready. Nothing is lost.", false);
            }
            int q = Notes.queued(this).size();
            if (q > 0) card(col, q + " note" + (q > 1 ? "s" : "") + " waiting to reach the PC.", false);
        });
    }

    private void rem(String id, String what, String choice) {
        bg(api -> api.post("/v1/reminders/" + Api.enc(id) + "/" + what, new JSONObject().put("choice", choice)),
                r -> drawToday());
    }

    private void addReminder() {
        EditText e = new EditText(this);
        e.setHint("What do you want reminding about?");
        new android.app.AlertDialog.Builder(this).setTitle("Reminder").setView(e)
                .setPositiveButton("Add", (dlg, w) -> {
                    String text = e.getText().toString().trim();
                    if (!text.isEmpty()) bg(api -> api.post("/v1/reminders", new JSONObject().put("text", text)), r -> drawToday());
                })
                .setNegativeButton("Cancel", null).show();
    }

    private void openApproval(String id) {
        bg(api -> {
            JSONObject a = api.approval(id);
            if (a == null) return new JSONObject();
            JSONObject t = api.get("/v1/tasks/" + Api.enc(a.optString("task_id")));
            return new JSONObject().put("agent", t.optString("agent"));
        }, r -> {
            if (r.has("agent")) agent = r.optString("agent");
            show("chat");
        });
    }

    // ------------------------------------------------------------------ Note (brain dump)

    private void drawNote() {
        if (!Api.linked(this)) {
            drawLocalNote();
            return;
        }
        title.setText("Brain dump");
        LinearLayout col = column(null);
        card(col, "Dump everything. Messy is fine. It's locked on this phone before it goes anywhere, "
                + "and works with no signal. On the PC you'll tick the real tasks.", false);
        EditText e = new EditText(this);
        e.setMinLines(8);
        e.setGravity(Gravity.TOP);
        e.setTextColor(Ui.TEXT);
        e.setHintTextColor(Ui.MUTED);
        e.setHint("call dentist, buy milk, reply to landlord…");
        e.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        e.setBackground(Ui.round(this, Ui.PANEL2, 12, 0));
        int p = Ui.dp(this, 12);
        e.setPadding(p, p, p, p);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.topMargin = Ui.dp(this, 10);
        col.addView(e, lp);
        LinearLayout btns = row();
        col.addView(btns);
        TextView status = card(col, "", false);
        add(btns, Ui.chip(this, "Save", Ui.OK, true)).setOnClickListener(v -> {
            String text = e.getText().toString().trim();
            if (text.isEmpty()) return;
            try {
                Notes.save(this, text);
            } catch (Exception ex) {
                status.setText(ex.getMessage());
                return;
            }
            e.setText("");
            status.setText("Saved and locked. Sending to the PC…");
            io.execute(() -> {
                int sent = Notes.sendQueued(this);
                int left = Notes.queued(this).size();
                main.post(() -> status.setText(sent > 0 && left == 0 ? "On the PC now." :
                        left + " note" + (left == 1 ? "" : "s") + " waiting. They'll go when the PC is reachable, "
                                + "or tap Save to Drive."));
            });
        });
        add(btns, Ui.chip(this, "Save to Drive", Ui.LINE, true)).setOnClickListener(v -> saveToDrive());
        int q = Notes.queued(this).size();
        if (q > 0) status.setText(q + " note" + (q == 1 ? "" : "s") + " waiting to reach the PC.");
    }

    /** Puts the oldest waiting (already encrypted) note into a Drive folder Jack picks. */
    private void saveToDrive() {
        java.util.List<File> q = Notes.queued(this);
        if (q.isEmpty()) {
            toast("No notes waiting.");
            return;
        }
        driveFile = q.get(0);
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType("application/octet-stream").putExtra(Intent.EXTRA_TITLE, driveFile.getName());
        startActivityForResult(i, REQ_SAVE_DRIVE);
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req != REQ_SAVE_DRIVE || res != RESULT_OK || data == null || driveFile == null) return;
        Uri uri = data.getData();
        try (OutputStream out = getContentResolver().openOutputStream(uri)) {
            out.write(Files.readAllBytes(driveFile.toPath()));
            driveFile.delete();
            toast("Saved to Drive (still locked). The PC will pick it up.");
        } catch (Exception e) {
            toast("Couldn't save it there.");
        }
        driveFile = null;
        if ("note".equals(tab)) drawNote();
    }

    // ------------------------------------------------------------------ Settings

    private void drawSettings() {
        title.setText("Settings");
        if (settingsAgent != null) {
            drawAgentRows(settingsAgent);
            return;
        }
        bg(api -> {
            JSONObject all = new JSONObject();
            all.put("checklists", api.get("/v1/checklists"));
            all.put("calm", api.get("/v1/calm"));
            return all;
        }, d -> {
            if (!"settings".equals(tab)) return;
            LinearLayout col = column(null);
            TextView h = Ui.text(this, "Agents", 18, Ui.TEXT, true);
            col.addView(h);
            JSONArray list = d.optJSONObject("checklists").optJSONArray("agents");
            for (int i = 0; list != null && i < list.length(); i++) {
                JSONObject a = list.optJSONObject(i);
                LinearLayout b = box(col, 0);
                card(b, a.optString("name"), true);
                card(b, a.optString("text"), false);
                String key = a.optString("agent");
                b.setOnClickListener(v -> { settingsAgent = key; drawSettings(); });
            }
            JSONObject calm = d.optJSONObject("calm");
            TextView c = Ui.text(this, "Calm mode", 18, Ui.TEXT, true);
            c.setPadding(0, Ui.dp(this, 14), 0, Ui.dp(this, 4));
            col.addView(c);
            boolean linked = Api.linked(this);
            card(col, "Readout " + calm.optString("readout") + " · quiet hours " + calm.optString("quiet_start")
                    + "–" + calm.optString("quiet_end") + (linked ? " (change times on the PC)" : ""), false);
            LinearLayout r = row();
            col.addView(r);
            boolean quests = calm.optBoolean("quests");
            add(r, Ui.chip(this, "Quests and XP: " + (quests ? "On" : "Off"), Ui.OK, quests)).setOnClickListener(v ->
                    bg(api -> api.post("/v1/calm", new JSONObject().put("quests", !quests)), x -> drawSettings()));
            if (!linked) {
                add(r, Ui.chip(this, "Change times", Ui.LINE, true)).setOnClickListener(v -> editTimes(calm));
            }
            TextView l = Ui.text(this, "This phone", 18, Ui.TEXT, true);
            l.setPadding(0, Ui.dp(this, 14), 0, Ui.dp(this, 4));
            col.addView(l);
            if (!linked) {
                card(col, "Helper is running on this phone by itself. Linking your PC is optional: it adds the "
                        + "PC's agents, email and bigger AI.", false);
                LinearLayout r3 = row();
                col.addView(r3);
                add(r3, Ui.chip(this, "Link to PC (optional)", Ui.ACCENT, true)).setOnClickListener(v ->
                        startActivity(new Intent(this, SetupActivity.class)));
                return;
            }
            card(col, "Linked to " + KeyBox.prefs(this).getString("pc_host", "?") + " · key " + KeyBox.hint(KeyBox.load(this)), false);
            LinearLayout r2 = row();
            col.addView(r2);
            boolean watch = WatchService.wanted(this);
            add(r2, Ui.chip(this, "Notifications: " + (watch ? "On" : "Off"), Ui.OK, watch)).setOnClickListener(v -> {
                KeyBox.prefs(this).edit().putBoolean("watch", !watch).apply();
                if (watch) WatchService.stop(this); else WatchService.startIfWanted(this);
                drawSettings();
            });
            add(r2, Ui.chip(this, "Unlink this phone", Ui.BAD, true)).setOnClickListener(v ->
                    new android.app.AlertDialog.Builder(this).setTitle("Unlink?")
                            .setMessage("This phone forgets its key and goes back to running Helper by itself. "
                                    + "Remove it on the PC too (Settings › Phone link).")
                            .setPositiveButton("Unlink", (dlg, w) -> {
                                WatchService.stop(this);
                                KeyBox.clear(this);
                                agent = null;
                                loadAgents();
                            })
                            .setNegativeButton("Cancel", null).show());
        });
    }

    private void drawAgentRows(String key) {
        bg(api -> api.get("/v1/checklists/" + Api.enc(key)), a -> {
            if (!"settings".equals(tab)) return;
            LinearLayout col = column(null);
            LinearLayout head = row();
            col.addView(head);
            add(head, Ui.chip(this, "‹ Agents", Ui.LINE, true)).setOnClickListener(v -> { settingsAgent = null; drawSettings(); });
            TextView name = Ui.text(this, "  " + a.optString("name"), 18, Ui.TEXT, true);
            head.addView(name);
            LinearLayout presets = row();
            col.addView(presets);
            String[][] ps = {{"careful", "Careful"}, {"normal", "Normal"}, {"handsoff", "Hands-off"}};
            for (String[] p : ps) {
                add(presets, Ui.chip(this, p[1], Ui.LINE, true)).setOnClickListener(v ->
                        bg(api -> api.post("/v1/checklists/" + Api.enc(key), new JSONObject().put("preset", p[0])),
                                r -> drawAgentRows(key)));
            }
            JSONArray rows = a.optJSONArray("rows");
            for (int i = 0; rows != null && i < rows.length(); i++) {
                JSONObject r = rows.optJSONObject(i);
                LinearLayout b = box(col, 0);
                card(b, r.optString("label"), true);
                LinearLayout btns = row();
                b.addView(btns);
                for (int c = 0; c < CHOICES.length; c++) {
                    String ch = CHOICES[c];
                    boolean on = ch.equals(r.optString("choice"));
                    add(btns, Ui.chip(this, CHOICE_WORDS[c], CHOICE_COLORS[c], on)).setOnClickListener(v ->
                            bg(api -> api.post("/v1/checklists/" + Api.enc(key),
                                    new JSONObject().put("job", r.optString("job")).put("choice", ch)), x -> drawAgentRows(key)));
                }
            }
            boolean ns = a.optBoolean("not_sure_stop", true);
            card(col, "Not sure? Stop: after reading an email or web page, even Do jobs ask first.", false);
            LinearLayout r = row();
            col.addView(r);
            add(r, Ui.chip(this, ns ? "On" : "Off", Ui.OK, ns)).setOnClickListener(v ->
                    bg(api -> api.post("/v1/checklists/" + Api.enc(key), new JSONObject().put("not_sure_stop", !ns)),
                            x -> drawAgentRows(key)));
        });
    }

    private void editTimes(JSONObject calm) {
        LinearLayout f = new LinearLayout(this);
        f.setOrientation(LinearLayout.VERTICAL);
        int p = Ui.dp(this, 20);
        f.setPadding(p, Ui.dp(this, 8), p, 0);
        String[][] keys = {{"readout", "Morning readout"}, {"quiet_start", "Quiet from"}, {"quiet_end", "Quiet until"}};
        EditText[] boxes = new EditText[keys.length];
        for (int i = 0; i < keys.length; i++) {
            f.addView(Ui.text(this, keys[i][1], 13, Ui.MUTED, false));
            boxes[i] = new EditText(this);
            boxes[i].setText(calm.optString(keys[i][0]));
            boxes[i].setInputType(InputType.TYPE_CLASS_DATETIME | InputType.TYPE_DATETIME_VARIATION_TIME);
            f.addView(boxes[i]);
        }
        new android.app.AlertDialog.Builder(this).setTitle("Calm mode times").setView(f)
                .setPositiveButton("Save", (dlg, w) -> {
                    JSONObject b = new JSONObject();
                    try {
                        for (int i = 0; i < keys.length; i++) b.put(keys[i][0], boxes[i].getText().toString().trim());
                    } catch (Exception ignored) {
                        return;
                    }
                    bg(api -> api.post("/v1/calm", b), x -> drawSettings());
                })
                .setNegativeButton("Cancel", null).show();
    }

    // ------------------------------------------------------------------ Note on the phone by itself

    private void drawLocalNote() {
        title.setText("Brain dump");
        bg(api -> api.get("/v1/capture"), d -> {
            if (!"note".equals(tab)) return;
            LinearLayout col = column(null);
            card(col, "Dump everything. Messy is fine. It stays on this phone. Then tick the real tasks "
                    + "and each one becomes a reminder with a tiny first step.", false);
            EditText e = new EditText(this);
            e.setMinLines(6);
            e.setGravity(Gravity.TOP);
            e.setTextColor(Ui.TEXT);
            e.setHintTextColor(Ui.MUTED);
            e.setHint("call dentist, buy milk, reply to landlord…");
            e.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
            e.setBackground(Ui.round(this, Ui.PANEL2, 12, 0));
            int p = Ui.dp(this, 12);
            e.setPadding(p, p, p, p);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
            lp.topMargin = Ui.dp(this, 10);
            col.addView(e, lp);
            LinearLayout btns = row();
            col.addView(btns);
            add(btns, Ui.chip(this, "Save", Ui.OK, true)).setOnClickListener(v -> {
                String text = e.getText().toString().trim();
                if (text.isEmpty()) return;
                bg(api -> api.post("/v1/capture", new JSONObject().put("text", text)), r -> drawLocalNote());
            });
            JSONArray notes = d.optJSONArray("notes");
            for (int i = notes == null ? -1 : notes.length() - 1; i >= 0; i--) {
                JSONObject n = notes.optJSONObject(i);
                if (n == null || !"new".equals(n.optString("status"))) continue;
                LinearLayout b = box(col, Ui.ACCENT);
                card(b, "Tick the real tasks", true);
                JSONArray items = n.optJSONArray("items");
                java.util.List<android.widget.CheckBox> ticks = new java.util.ArrayList<>();
                for (int j = 0; items != null && j < items.length(); j++) {
                    JSONObject it = items.optJSONObject(j);
                    android.widget.CheckBox cb = new android.widget.CheckBox(this);
                    cb.setText(it.optString("text"));
                    cb.setTextColor(Ui.TEXT);
                    cb.setChecked("task".equals(it.optString("kind")));
                    cb.setTag(j);
                    ticks.add(cb);
                    b.addView(cb);
                }
                if (ticks.isEmpty()) card(b, n.optString("text"), false);
                LinearLayout nb = row();
                b.addView(nb);
                String id = n.optString("id");
                add(nb, Ui.chip(this, "Make reminders", Ui.OK, true)).setOnClickListener(v -> {
                    JSONArray keep = new JSONArray();
                    for (android.widget.CheckBox cb : ticks) if (cb.isChecked()) keep.put((int) cb.getTag());
                    bg(api -> api.post("/v1/capture/" + Api.enc(id) + "/sort", new JSONObject().put("keep", keep)), r -> {
                        toast(r.optInt("made") + " reminder" + (r.optInt("made") == 1 ? "" : "s") + " added to Today.");
                        drawLocalNote();
                    });
                });
                add(nb, Ui.chip(this, "Just keep it", Ui.LINE, true)).setOnClickListener(v ->
                        bg(api -> api.post("/v1/capture/" + Api.enc(id) + "/sort", new JSONObject().put("keep", new JSONArray())),
                                r -> drawLocalNote()));
            }
        });
    }

    // ------------------------------------------------------------------ Records

    private void drawRecords() {
        title.setText("Your records");
        if (Api.linked(this)) {
            LinearLayout col = column(null);
            card(col, "While this phone is linked, your records live in the PC app (Records tab).", false);
            return;
        }
        bg(api -> api.get("/v1/private"), d -> {
            if (!"records".equals(tab)) return;
            LinearLayout col = column(null);
            card(col, "Real-life things to remember: accounts, people, documents, routines, dates. Never a "
                    + "password, PIN, code or card number, only where it lives (\"in RoboForm\").", false);
            LinearLayout top = row();
            col.addView(top);
            add(top, Ui.chip(this, "+ Add a record", Ui.ACCENT, true)).setOnClickListener(v -> addRecord());
            JSONArray rs = d.optJSONArray("records");
            if (rs == null || rs.length() == 0) card(col, "Nothing yet.", false);
            for (int i = rs == null ? -1 : rs.length() - 1; i >= 0; i--) {
                JSONObject r = rs.optJSONObject(i);
                LinearLayout b = box(col, 0);
                card(b, r.optString("title"), true);
                card(b, r.optString("type") + " · " + r.optString("id"), false);
                if (!r.optString("body").isEmpty()) card(b, r.optString("body"), false);
                String id = r.optString("id");
                b.setOnLongClickListener(v -> {
                    new android.app.AlertDialog.Builder(this).setTitle("Remove this record?")
                            .setPositiveButton("Remove", (dlg, w) ->
                                    bg(api -> api.post("/v1/private/" + Api.enc(id) + "/remove", null), x -> drawRecords()))
                            .setNegativeButton("Cancel", null).show();
                    return true;
                });
            }
            if (rs != null && rs.length() > 0) card(col, "Press and hold a record to remove it.", false);
        });
    }

    private void addRecord() {
        LinearLayout f = new LinearLayout(this);
        f.setOrientation(LinearLayout.VERTICAL);
        int p = Ui.dp(this, 20);
        f.setPadding(p, Ui.dp(this, 8), p, 0);
        String[] type = {"note"};
        HorizontalScrollView hs = new HorizontalScrollView(this);
        LinearLayout types = row();
        hs.addView(types);
        java.util.List<Button> chips = new java.util.ArrayList<>();
        for (String t : Local.RECORD_TYPES) {
            Button b = Ui.chip(this, t, Ui.ACCENT, t.equals(type[0]));
            chips.add(b);
            b.setOnClickListener(v -> {
                type[0] = t;
                for (Button c : chips) c.setBackground(Ui.round(this, c == b ? Ui.ACCENT : Ui.LINE, 8, 0));
            });
            add(types, b);
        }
        f.addView(hs);
        EditText name = new EditText(this);
        name.setHint("Name, e.g. Council tax account");
        f.addView(name);
        EditText body = new EditText(this);
        body.setHint("Details, e.g. login is in RoboForm, paid by direct debit");
        body.setMinLines(3);
        f.addView(body);
        new android.app.AlertDialog.Builder(this).setTitle("Add a record").setView(f)
                .setPositiveButton("Save", (dlg, w) -> bg(api -> api.post("/v1/private/add", new JSONObject()
                        .put("type", type[0]).put("title", name.getText().toString())
                        .put("body", body.getText().toString())), x -> drawRecords()))
                .setNegativeButton("Cancel", null).show();
    }

    // ------------------------------------------------------------------ small helpers

    private static String cut(String s, int n) {
        return s.length() > n ? s.substring(0, n) + "…" : s;
    }

    private static String word(String choice) {
        for (int i = 0; i < CHOICES.length; i++) if (CHOICES[i].equals(choice)) return CHOICE_WORDS[i];
        return choice;
    }

    private static int parseColor(String s, int fallback) {
        try {
            return android.graphics.Color.parseColor(s);
        } catch (Exception e) {
            return fallback;
        }
    }
}
