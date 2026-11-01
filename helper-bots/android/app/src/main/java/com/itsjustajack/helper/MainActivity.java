package com.itsjustajack.helper;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Helper on the phone: the same app as Helper.exe, with the same engine and the same screens.
 *
 * Left rail: the Guild (one round avatar per agent), then Today, Inbox, Records and Settings.
 * Top bar: who you're talking to, the model light, "Needs your OK" and Stop all (on every screen).
 * Chat: your messages, the agent's steps, and OK cards with Approve once / Always / No / Stop task.
 * It runs on the phone by itself. Linking the PC is optional (Settings › Link to PC).
 * Approve and Always ask for a fingerprint or PIN first, and Settings opens with one.
 */
public class MainActivity extends Activity {
    private static final String[] CHOICES = {"never", "ask", "do"};
    private static final String[] CHOICE_WORDS = {"Never", "Ask me", "Do"};
    private static final int[] CHOICE_COLORS = {Ui.BAD, Ui.WARN, Ui.OK};

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private LinearLayout rail;
    private FrameLayout body;
    private TextView title, okPill, stopBtn, dot;
    private String page = "chat";
    private String agent = null;
    private JSONArray agents = new JSONArray();
    private String settingsTab = "agents";
    private String settingsAgent = null;
    private String recordsSection = "private";
    private boolean settingsUnlocked = false;
    private String pendingShare;
    private String lastSig = "";
    private boolean started = false;
    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            refreshTop();
            if ("chat".equals(page)) drawChat(false);
            main.postDelayed(this, 2000);
        }
    };

    // ------------------------------------------------------------------ lifecycle

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        CrashLog.install(this);
        Ui.channels(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.HORIZONTAL);
        root.setBackgroundColor(Ui.BG);
        root.setFitsSystemWindows(true);

        ScrollView railScroll = new ScrollView(this);
        railScroll.setBackgroundColor(Ui.RAIL);
        railScroll.setVerticalScrollBarEnabled(false);
        rail = new LinearLayout(this);
        rail.setOrientation(LinearLayout.VERTICAL);
        rail.setGravity(Gravity.CENTER_HORIZONTAL);
        rail.setPadding(0, Ui.dp(this, 6), 0, Ui.dp(this, 6));
        railScroll.addView(rail);
        root.addView(railScroll, new LinearLayout.LayoutParams(Ui.dp(this, 60), -1));

        LinearLayout right = new LinearLayout(this);
        right.setOrientation(LinearLayout.VERTICAL);
        right.addView(topBar());
        body = new FrameLayout(this);
        right.addView(body, new LinearLayout.LayoutParams(-1, 0, 1));
        root.addView(right, new LinearLayout.LayoutParams(0, -1, 1));
        setContentView(root);
        takeShare(getIntent());
        drawRail();
        message(body, "Starting Helper…");

        String crash = CrashLog.take(this);
        if (crash != null) showCrash(crash);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (takeShare(intent)) showChat(agent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (Build.VERSION.SDK_INT >= 33 && !started
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 7);
        }
        started = true;
        WatchService.startIfWanted(this);
        loadAgents();
        main.removeCallbacks(tick);
        main.postDelayed(tick, 2000);
    }

    @Override
    protected void onPause() {
        main.removeCallbacks(tick);
        super.onPause();
    }

    @Override
    protected void onStop() {
        settingsUnlocked = false;
        super.onStop();
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

    private void showCrash(String report) {
        TextView t = Ui.mono(this, report.length() > 6000 ? report.substring(0, 6000) : report);
        ScrollView sv = new ScrollView(this);
        sv.addView(t);
        new AlertDialog.Builder(this).setTitle("Helper closed last time")
                .setMessage("Sorry. Tap Copy and paste this to Claude so it can be fixed.")
                .setView(sv)
                .setPositiveButton("Copy", (d, w) -> {
                    ClipboardManager cm = getSystemService(ClipboardManager.class);
                    if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("Helper crash", report));
                    toast("Copied.");
                })
                .setNegativeButton("Close", null).show();
    }

    // ------------------------------------------------------------------ frame

    private View topBar() {
        LinearLayout bar = row();
        bar.setBackgroundColor(Ui.PANEL);
        int p = Ui.dp(this, 8);
        bar.setPadding(Ui.dp(this, 12), p, p, p);
        bar.setMinimumHeight(Ui.dp(this, 52));
        title = Ui.text(this, "Helper", 17, Ui.TEXT, true);
        title.setSingleLine(true);
        title.setEllipsize(android.text.TextUtils.TruncateAt.END);
        bar.addView(title, new LinearLayout.LayoutParams(0, -2, 1));
        dot = Ui.text(this, " ● ", 13, Ui.MUTED, false);
        bar.addView(dot);
        okPill = Ui.chip(this, "Needs OK: 0", Ui.LINE, false);
        okPill.setOnClickListener(v -> showToday());
        bar.addView(okPill);
        stopBtn = Ui.chip(this, "Stop all", Ui.BAD, true);
        stopBtn.setOnClickListener(v -> stopOrStart());
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-2, -2);
        lp.leftMargin = Ui.dp(this, 6);
        bar.addView(stopBtn, lp);
        return bar;
    }

    private void drawRail() {
        rail.removeAllViews();
        int size = Ui.dp(this, 44);
        for (int i = 0; i < agents.length(); i++) {
            JSONObject a = agents.optJSONObject(i);
            if (a == null) continue;
            String key = a.optString("key");
            AvatarView av = new AvatarView(this, parseColor(a.optString("color"), Ui.ACCENT), a.optString("avatar"),
                    "chat".equals(page) && key.equals(agent));
            av.setContentDescription(a.optString("name"));
            av.setOnClickListener(v -> showChat(key));
            av.setOnLongClickListener(v -> { toast(a.optString("name")); return true; });
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(size, size);
            lp.topMargin = Ui.dp(this, 8);
            rail.addView(av, lp);
        }
        View line = new View(this);
        line.setBackgroundColor(Ui.LINE);
        LinearLayout.LayoutParams llp = new LinearLayout.LayoutParams(Ui.dp(this, 36), Ui.dp(this, 1));
        llp.topMargin = Ui.dp(this, 12);
        llp.bottomMargin = Ui.dp(this, 6);
        rail.addView(line, llp);
        String[][] pages = {{"☀", "today", "Today"}, {"✉", "inbox", "Inbox"}, {"📖", "records", "Records"}, {"⚙", "settings", "Settings"}};
        for (String[] pg : pages) {
            TextView b = Ui.text(this, pg[0], 22, pg[1].equals(page) ? Ui.TEXT : Ui.MUTED, true);
            b.setGravity(Gravity.CENTER);
            b.setContentDescription(pg[2]);
            b.setPadding(0, Ui.dp(this, 8), 0, Ui.dp(this, 8));
            b.setOnClickListener(v -> open(pg[1]));
            b.setOnLongClickListener(v -> { toast(pg[2]); return true; });
            rail.addView(b, new LinearLayout.LayoutParams(-1, -2));
        }
    }

    private void open(String p) {
        switch (p) {
            case "today": showToday(); break;
            case "inbox": showInbox(); break;
            case "records": showRecords(recordsSection); break;
            case "settings": showSettings(settingsTab); break;
            default: showChat(agent); break;
        }
    }

    /** Clears the body for a page, like the PC's clear_body. */
    private void setPage(String p, String t) {
        page = p;
        title.setText(t);
        lastSig = "";
        drawRail();
    }

    private LinearLayout row() {
        LinearLayout r = new LinearLayout(this);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setGravity(Gravity.CENTER_VERTICAL);
        return r;
    }

    private LinearLayout column() {
        ScrollView sv = new ScrollView(this);
        sv.setFillViewport(true);
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        int p = Ui.dp(this, 12);
        col.setPadding(p, p, p, Ui.dp(this, 24));
        sv.addView(col);
        body.removeAllViews();
        body.addView(sv);
        return col;
    }

    private void message(FrameLayout where, String text) {
        where.removeAllViews();
        TextView t = Ui.text(this, text, 14, Ui.MUTED, false);
        t.setGravity(Gravity.CENTER);
        where.addView(t, new FrameLayout.LayoutParams(-1, -1));
    }

    private TextView label(LinearLayout parent, String text, float sp, int color, boolean bold) {
        TextView t = Ui.text(this, text, sp, color, bold);
        parent.addView(t);
        return t;
    }

    private TextView heading(LinearLayout parent, String text) {
        TextView h = Ui.text(this, text, 17, Ui.TEXT, true);
        h.setPadding(0, Ui.dp(this, 14), 0, Ui.dp(this, 6));
        parent.addView(h);
        return h;
    }

    private LinearLayout card(LinearLayout parent, int stroke) {
        LinearLayout b = new LinearLayout(this);
        b.setOrientation(LinearLayout.VERTICAL);
        b.setBackground(Ui.round(this, Ui.PANEL2, 10, stroke));
        int p = Ui.dp(this, 10);
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

    /** A row of buttons that scrolls sideways when it doesn't fit. */
    private LinearLayout buttons(LinearLayout parent) {
        HorizontalScrollView hs = new HorizontalScrollView(this);
        hs.setHorizontalScrollBarEnabled(false);
        LinearLayout r = row();
        hs.addView(r);
        parent.addView(hs);
        return r;
    }

    private void toast(String s) {
        if (s == null || s.isEmpty()) return;
        main.post(() -> Toast.makeText(this, s, Toast.LENGTH_SHORT).show());
    }

    /** Runs a call in the background, then `done` on the main thread with the answer. */
    private interface Call { JSONObject run(Api api) throws Exception; }
    private interface Done { void with(JSONObject res) throws Exception; }

    private void bg(Call call, Done done) {
        Api api = Api.from(this);
        io.execute(() -> {
            try {
                JSONObject res = call.run(api);
                main.post(() -> {
                    if (done == null || isFinishing()) return;
                    try {
                        done.with(res);
                    } catch (Exception e) {
                        toast("Couldn't show that: " + e.getMessage());
                    }
                });
            } catch (Api.HttpError e) {
                toast(e.code == 401 ? "This phone isn't linked any more. Link it again." : e.getMessage());
            } catch (Throwable e) {
                if (api.isLocal()) {
                    toast("Something went wrong: " + e.getMessage());
                } else {
                    toast("Can't reach the PC right now.");
                    main.post(() -> dot.setTextColor(Ui.BAD));
                }
            }
        });
    }

    private void refreshTop() {
        bg(api -> api.get("/v1/status"), st -> {
            int pend = st.optInt("pending", 0);
            okPill.setText("Needs OK: " + pend);
            okPill.setBackground(Ui.round(this, pend > 0 ? Ui.WARN : Ui.LINE, 8, 0));
            okPill.setTextColor(pend > 0 ? 0xFFFFFFFF : Ui.MUTED);
            JSONObject model = st.optJSONObject("model");
            dot.setTextColor(model != null && model.optBoolean("ok") ? Ui.OK : Ui.BAD);
            boolean stopped = st.optBoolean("stopped");
            stopBtn.setText(stopped ? "Start again" : "Stop all");
            stopBtn.setBackground(Ui.round(this, stopped ? Ui.OK : Ui.BAD, 8, 0));
        });
    }

    private void stopOrStart() {
        bg(api -> api.get("/v1/status"), st -> {
            boolean stopped = st.optBoolean("stopped");
            bg(api -> api.post(stopped ? "/v1/start" : "/v1/stop", null),
                    r -> { toast(stopped ? "Helper can take new jobs again." : "Stopped everything."); refreshTop(); });
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
            JSONArray list = res.optJSONArray("agents");
            agents = list == null ? new JSONArray() : list;
            if (agent == null || find(agent) == null) {
                agent = res.optString("default", agents.length() > 0 ? agents.optJSONObject(0).optString("key") : null);
            }
            if (pendingShare != null || "chat".equals(page)) showChat(agent);
            else drawRail();
            refreshTop();
        });
    }

    private JSONObject find(String key) {
        for (int i = 0; i < agents.length(); i++) {
            JSONObject a = agents.optJSONObject(i);
            if (a != null && a.optString("key").equals(key)) return a;
        }
        return null;
    }

    private String agentName(String key) {
        JSONObject a = find(key);
        return a == null ? (key == null ? "Helper" : key) : a.optString("name", key);
    }

    private LinearLayout chatCol;
    private ScrollView chatScroll;

    private void showChat(String key) {
        if (key == null) return;
        agent = key;
        setPage("chat", agentName(key));
        body.removeAllViews();
        LinearLayout pg = new LinearLayout(this);
        pg.setOrientation(LinearLayout.VERTICAL);
        body.addView(pg);
        chatScroll = new ScrollView(this);
        chatCol = new LinearLayout(this);
        chatCol.setOrientation(LinearLayout.VERTICAL);
        int p = Ui.dp(this, 10);
        chatCol.setPadding(p, p, p, p);
        chatScroll.addView(chatCol);
        pg.addView(chatScroll, new LinearLayout.LayoutParams(-1, 0, 1));

        LinearLayout input = row();
        input.setBackgroundColor(Ui.PANEL);
        input.setPadding(p, Ui.dp(this, 8), p, Ui.dp(this, 8));
        EditText box = new EditText(this);
        box.setHint("Message " + agentName(key));
        box.setHintTextColor(Ui.MUTED);
        box.setTextColor(Ui.TEXT);
        box.setTextSize(15);
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
            bg(api -> api.post("/v1/tasks", new JSONObject().put("goal", goal).put("agent", agent)), r -> {
                box.setText("");
                String a = r.optString("agent", agent);
                if (!a.equals(agent)) showChat(a);
                else drawChat(true);
            });
        });
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-2, -2);
        lp.leftMargin = Ui.dp(this, 8);
        input.addView(send, lp);
        pg.addView(input);
        drawChat(true);
    }

    private void drawChat(boolean force) {
        final String forAgent = agent;
        bg(api -> api.get("/v1/tasks"), res -> {
            if (!"chat".equals(page) || chatCol == null || forAgent == null || !forAgent.equals(agent)) return;
            JSONArray all = res.optJSONArray("tasks");
            List<JSONObject> mine = new ArrayList<>();
            StringBuilder sig = new StringBuilder(forAgent);
            for (int i = 0; all != null && i < all.length(); i++) {
                JSONObject t = all.optJSONObject(i);
                if (t != null && forAgent.equals(t.optString("agent"))) {
                    mine.add(t);
                    JSONArray ev = t.optJSONArray("events");
                    sig.append(t.optString("id")).append(t.optString("status")).append(ev == null ? 0 : ev.length());
                }
            }
            if (!force && sig.toString().equals(lastSig)) return;
            lastSig = sig.toString();
            renderChat(mine);
        });
    }

    private void renderChat(List<JSONObject> tasks) {
        chatCol.removeAllViews();
        if (tasks.isEmpty()) {
            JSONObject a = find(agent);
            LinearLayout box = new LinearLayout(this);
            box.setOrientation(LinearLayout.VERTICAL);
            box.setGravity(Gravity.CENTER_HORIZONTAL);
            box.setPadding(0, Ui.dp(this, 40), 0, 0);
            int size = Ui.dp(this, 64);
            box.addView(new AvatarView(this, parseColor(a == null ? "" : a.optString("color"), Ui.ACCENT),
                    a == null ? "" : a.optString("avatar"), false), new LinearLayout.LayoutParams(size, size));
            TextView n = Ui.text(this, agentName(agent), 18, Ui.TEXT, true);
            n.setGravity(Gravity.CENTER);
            n.setPadding(0, Ui.dp(this, 6), 0, Ui.dp(this, 2));
            box.addView(n);
            if (a != null) {
                TextView role = Ui.text(this, a.optString("role"), 13, Ui.MUTED, false);
                role.setGravity(Gravity.CENTER);
                box.addView(role);
            }
            TextView hint = Ui.text(this, "Type below. Start with @name to ask someone else, or \"from now on…\" "
                    + "to change what this agent may do on its own.", 13, Ui.MUTED, false);
            hint.setGravity(Gravity.CENTER);
            hint.setPadding(0, Ui.dp(this, 8), 0, 0);
            box.addView(hint);
            chatCol.addView(box);
        }
        for (JSONObject t : tasks) {
            JSONArray evs = t.optJSONArray("events");
            for (int j = 0; evs != null && j < evs.length(); j++) renderEvent(t, evs.optJSONObject(j));
        }
        chatScroll.post(() -> chatScroll.fullScroll(View.FOCUS_DOWN));
    }

    private LinearLayout bubble(String text, boolean mine, int color, boolean small) {
        LinearLayout r = row();
        r.setGravity(mine ? Gravity.END : Gravity.START);
        TextView t = Ui.text(this, text, small ? 13 : 15, small ? Ui.MUTED : Ui.TEXT, false);
        if (!small) {
            t.setBackground(Ui.round(this, color != 0 ? color : (mine ? Ui.ACCENT : Ui.PANEL2), 14, 0));
            int p = Ui.dp(this, 10);
            t.setPadding(p, Ui.dp(this, 7), p, Ui.dp(this, 7));
        }
        t.setMaxWidth(Math.round(getResources().getDisplayMetrics().widthPixels * 0.68f));
        r.addView(t);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.topMargin = Ui.dp(this, 5);
        chatCol.addView(r, lp);
        return r;
    }

    private void renderEvent(JSONObject task, JSONObject ev) {
        if (ev == null) return;
        switch (ev.optString("kind")) {
            case "user": bubble(ev.optString("text"), true, 0, false); break;
            case "step": {
                StringBuilder sb = new StringBuilder("→ " + ev.optString("tool") + "  ");
                JSONObject args = ev.optJSONObject("args");
                JSONArray names = args == null ? null : args.names();
                for (int i = 0; names != null && i < names.length(); i++) {
                    if (i > 0) sb.append(", ");
                    sb.append(names.optString(i)).append("=").append(args.optString(names.optString(i)));
                }
                bubble(cut(sb.toString(), 200), false, 0, true);
                break;
            }
            case "result": bubble((ev.optBoolean("ok") ? "✓ " : "✗ ") + cut(ev.optString("text"), 300), false, 0, true); break;
            case "denied": bubble("Not done: " + ev.optString("reason"), false, 0, true); break;
            case "system": bubble(ev.optString("text"), false, 0, true); break;
            case "checklist": {
                LinearLayout r = bubble("Checklist: \"" + ev.optString("label") + "\" is now " + word(ev.optString("choice")),
                        false, 0, true);
                String change = ev.optString("change");
                if (!change.isEmpty()) {
                    Button u = Ui.chip(this, "Undo", Ui.LINE, true);
                    u.setOnClickListener(v -> bg(api -> api.post("/v1/checklists/undo/" + Api.enc(change), null),
                            x -> toast("Undone.")));
                    add(r, u);
                }
                break;
            }
            case "approval": okCard(ev.optJSONObject("approval")); break;
            case "end":
                if (!ev.optString("text").isEmpty()) {
                    bubble(ev.optString("text"), false, "done".equals(task.optString("status")) ? Ui.PANEL2 : Ui.LINE, false);
                }
                break;
            default: break;
        }
    }

    private void okCard(JSONObject a) {
        if (a == null) return;
        boolean tainted = a.optBoolean("tainted");
        LinearLayout b = card(chatCol, tainted ? Ui.WARN : Ui.LINE);
        label(b, a.optString("agent") + " wants to: " + a.optString("job", a.optString("tool")), 15, Ui.TEXT, true);
        JSONObject args = a.optJSONObject("args");
        JSONArray names = args == null ? null : args.names();
        for (int i = 0; names != null && i < names.length(); i++) {
            label(b, cut(names.optString(i) + ": " + args.optString(names.optString(i)), 400), 13, Ui.MUTED, false);
        }
        label(b, a.optString("reason"), 13, tainted ? Ui.WARN : Ui.MUTED, false);
        String id = a.optString("id");
        bg(api -> new JSONObject().put("live", api.approval(id) != null), r -> {
            LinearLayout btns = buttons(b);
            if (!r.optBoolean("live")) {
                label(b, "Answered", 13, Ui.MUTED, false);
                return;
            }
            add(btns, Ui.chip(this, "Approve once", Ui.OK, true)).setOnClickListener(v ->
                    unlock("Approve once?", Api.describe(a, true), () -> decide(id, "approve")));
            add(btns, Ui.chip(this, "Always", Ui.LINE, true)).setOnClickListener(v ->
                    unlock("Always allow this?", "Approve, and let " + a.optString("agent")
                            + " do this job on its own from now on. You can change it back in Settings.",
                            () -> decide(id, "always")));
            add(btns, Ui.chip(this, "No", Ui.LINE, true)).setOnClickListener(v -> decide(id, "deny"));
            add(btns, Ui.chip(this, "Stop task", Ui.BAD, true)).setOnClickListener(v -> decide(id, "stop"));
        });
    }

    private void decide(String id, String verdict) {
        bg(api -> { api.decide(id, verdict); return new JSONObject(); }, r -> { lastSig = ""; drawChat(true); refreshTop(); });
    }

    // ------------------------------------------------------------------ Today (Calm mode)

    private void showToday() {
        setPage("today", "Today");
        bg(api -> {
            JSONObject all = new JSONObject();
            all.put("today", api.get("/v1/today"));
            all.put("done", api.get("/v1/done"));
            return all;
        }, all -> {
            if (!"today".equals(page)) return;
            JSONObject d = all.optJSONObject("today");
            LinearLayout col = column();
            LinearLayout top = buttons(col);
            JSONObject calm = d.optJSONObject("calm");
            boolean tooMuch = calm != null && calm.optBoolean("too_much");
            add(top, Ui.chip(this, "Just one thing", Ui.OK, true)).setOnClickListener(v -> {
                JSONObject one = d.optJSONObject("one_thing");
                new AlertDialog.Builder(this).setTitle("Just one thing")
                        .setMessage(one == null ? "Nothing needs you right now." :
                                one.optString("text") + "\n\nFirst step: " + one.optString("first_step"))
                        .setPositiveButton("OK", null).show();
            });
            add(top, Ui.chip(this, tooMuch ? "I'm OK now" : "Too much", Ui.LINE, true)).setOnClickListener(v ->
                    bg(api -> api.post("/v1/calm", new JSONObject().put("too_much", !tooMuch)), r -> showToday()));
            add(top, Ui.chip(this, "Brain dump", Ui.LINE, true)).setOnClickListener(v -> brainDump());
            add(top, Ui.chip(this, "+ Reminder", Ui.LINE, true)).setOnClickListener(v -> addReminder());
            if (d.optBoolean("quiet")) label(col, "Quiet hours", 12, Ui.MUTED, false);
            heading(col, "Needs you");
            JSONArray items = d.optJSONArray("items");
            if (items == null || items.length() == 0) label(col, "Nothing right now. Nice.", 14, Ui.MUTED, false);
            for (int i = 0; items != null && i < items.length(); i++) {
                JSONObject it = items.optJSONObject(i);
                LinearLayout b = card(col, 0);
                label(b, it.optString("text"), 15, Ui.TEXT, true);
                label(b, "First step: " + it.optString("first_step"), 13, Ui.MUTED, false);
                LinearLayout btns = buttons(b);
                String id = it.optString("id");
                switch (it.optString("kind")) {
                    case "reminder":
                        add(btns, Ui.chip(this, "Done", Ui.OK, true)).setOnClickListener(v -> rem(id, "done", ""));
                        String[][] snz = {{"1h", "1 hour"}, {"tonight", "Tonight"}, {"tomorrow", "Tomorrow"}, {"at_pc", "At the PC"}};
                        for (String[] s : snz) {
                            add(btns, Ui.chip(this, s[1], Ui.LINE, true)).setOnClickListener(v -> rem(id, "snooze", s[0]));
                        }
                        add(btns, Ui.chip(this, "Drop it", Ui.LINE, true)).setOnClickListener(v -> rem(id, "drop", ""));
                        break;
                    case "ok":
                        add(btns, Ui.chip(this, "Open", Ui.ACCENT, true)).setOnClickListener(v -> openApproval(id));
                        break;
                    case "capture":
                        add(btns, Ui.chip(this, "Sort now", Ui.ACCENT, true)).setOnClickListener(v -> sortNotes());
                        break;
                    default: break;
                }
            }
            if (d.optInt("held") > 0) {
                label(col, d.optInt("held") + " more are held until you're ready. Nothing is lost.", 13, Ui.MUTED, false);
            }
            JSONArray done = all.optJSONObject("done") == null ? null : all.optJSONObject("done").optJSONArray("done");
            if (done != null && done.length() > 0) {
                heading(col, "Done for you");
                for (int i = done.length() - 1; i >= Math.max(0, done.length() - 12); i--) {
                    JSONObject r = done.optJSONObject(i);
                    LinearLayout line = row();
                    col.addView(line);
                    TextView t = Ui.text(this, time(r.optDouble("ts", 0)) + "  " + r.optString("agent") + ": "
                            + cut(r.optString("text"), 110), 13, Ui.MUTED, false);
                    line.addView(t, new LinearLayout.LayoutParams(0, -2, 1));
                    if (r.optBoolean("can_undo")) {
                        String rid = r.optString("id");
                        add(line, Ui.chip(this, "Undo", Ui.LINE, true)).setOnClickListener(v ->
                                bg(api -> api.post("/v1/done/" + Api.enc(rid) + "/undo", null),
                                        x -> { toast(x.optString("text", "Undone.")); showToday(); }));
                    }
                }
            }
        });
    }

    private void rem(String id, String what, String choice) {
        bg(api -> api.post("/v1/reminders/" + Api.enc(id) + "/" + what, new JSONObject().put("choice", choice)),
                r -> showToday());
    }

    private EditText field(String hint, boolean multi) {
        EditText e = new EditText(this);
        e.setHint(hint);
        if (multi) {
            e.setMinLines(6);
            e.setGravity(Gravity.TOP);
            e.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        }
        return e;
    }

    private View padded(View v) {
        FrameLayout f = new FrameLayout(this);
        int p = Ui.dp(this, 20);
        f.setPadding(p, Ui.dp(this, 8), p, 0);
        f.addView(v);
        return f;
    }

    private void addReminder() {
        EditText e = field("What do you want reminding about?", false);
        new AlertDialog.Builder(this).setTitle("Reminder").setView(padded(e))
                .setPositiveButton("Add", (dlg, w) -> {
                    String text = e.getText().toString().trim();
                    if (!text.isEmpty()) bg(api -> api.post("/v1/reminders", new JSONObject().put("text", text)), r -> showToday());
                })
                .setNegativeButton("Cancel", null).show();
    }

    private void brainDump() {
        EditText e = field("call dentist, buy milk, reply to landlord…", true);
        new AlertDialog.Builder(this).setTitle("Brain dump")
                .setMessage("Dump everything. Messy is fine. You'll tick the real tasks after.")
                .setView(padded(e))
                .setPositiveButton("Sort it", (dlg, w) -> {
                    String text = e.getText().toString().trim();
                    if (!text.isEmpty()) bg(api -> api.post("/v1/capture", new JSONObject().put("text", text)), r -> sortNotes());
                })
                .setNegativeButton("Cancel", null).show();
    }

    private void sortNotes() {
        bg(api -> api.get("/v1/capture"), d -> {
            JSONArray notes = d.optJSONArray("notes");
            for (int n = 0; notes != null && n < notes.length(); n++) {
                JSONObject note = notes.optJSONObject(n);
                if (note == null) continue;
                LinearLayout f = new LinearLayout(this);
                f.setOrientation(LinearLayout.VERTICAL);
                List<CheckBox> ticks = new ArrayList<>();
                JSONArray items = note.optJSONArray("items");
                for (int i = 0; items != null && i < items.length(); i++) {
                    JSONObject it = items.optJSONObject(i);
                    CheckBox cb = new CheckBox(this);
                    cb.setText(it.optString("text"));
                    cb.setChecked("task".equals(it.optString("kind")));
                    ticks.add(cb);
                    f.addView(cb);
                }
                ScrollView sv = new ScrollView(this);
                sv.addView(f);
                String id = note.optString("id");
                new AlertDialog.Builder(this).setTitle("Tick the real tasks").setView(padded(sv))
                        .setPositiveButton("Make reminders", (dlg, w) -> {
                            JSONArray keep = new JSONArray();
                            for (int i = 0; i < ticks.size(); i++) if (ticks.get(i).isChecked()) keep.put(i);
                            bg(api -> api.post("/v1/capture/" + Api.enc(id) + "/sort", new JSONObject().put("keep", keep)),
                                    r -> { if ("today".equals(page)) showToday(); });
                        })
                        .setNegativeButton("Later", null).show();
            }
        });
    }

    private void openApproval(String id) {
        bg(api -> {
            JSONObject a = api.approval(id);
            if (a == null) return new JSONObject();
            JSONObject t = api.get("/v1/tasks/" + Api.enc(a.optString("task_id")));
            return new JSONObject().put("agent", t.optString("agent"));
        }, r -> {
            if (r.has("agent")) showChat(r.optString("agent"));
        });
    }

    // ------------------------------------------------------------------ Inbox

    private void showInbox() {
        setPage("inbox", "Inbox");
        bg(api -> api.get("/v1/inbox"), d -> {
            if (!"inbox".equals(page)) return;
            LinearLayout col = column();
            if (!d.optBoolean("linked")) {
                heading(col, "Gmail isn't linked yet.");
                label(col, "Link it in Settings › Accounts. It starts read-only: Inbox can sort and draft, "
                        + "and nothing is sent without your OK.", 14, Ui.MUTED, false);
                add(buttons(col), Ui.chip(this, "Go to Accounts", Ui.ACCENT, true)).setOnClickListener(v -> showSettings("accounts"));
                return;
            }
            JSONObject r = d.optJSONObject("readout");
            LinearLayout head = row();
            col.addView(head);
            TextView h = Ui.text(this, r != null ? "Morning readout " + r.optString("date") + " " + r.optString("time")
                    : "No readout yet today", 17, Ui.TEXT, true);
            head.addView(h, new LinearLayout.LayoutParams(0, -2, 1));
            add(head, Ui.chip(this, "Make it now", Ui.LINE, true)).setOnClickListener(v ->
                    bg(api -> api.post("/v1/inbox/readout", null), x -> showInbox()));
            if (r != null) label(card(col, 0), r.optString("text"), 14, Ui.TEXT, false);
            LinearLayout piles = new LinearLayout(this);
            piles.setOrientation(LinearLayout.VERTICAL);
            add(buttons(col), Ui.chip(this, "Show the piles", Ui.LINE, true)).setOnClickListener(v -> showPiles(piles));
            col.addView(piles);
        });
    }

    private void showPiles(LinearLayout piles) {
        piles.removeAllViews();
        label(piles, "Reading your email…", 13, Ui.MUTED, false);
        bg(api -> api.get("/v1/inbox/piles"), d -> {
            piles.removeAllViews();
            JSONObject all = d.optJSONObject("piles");
            JSONObject names = d.optJSONObject("names");
            JSONArray keys = all == null ? null : all.names();
            for (int i = 0; keys != null && i < keys.length(); i++) {
                String p = keys.optString(i);
                JSONArray rows = all.optJSONArray(p);
                if (rows == null || rows.length() == 0) continue;
                if ("newsletters".equals(p)) {
                    label(piles, "Newsletters: " + rows.length() + " (hidden)", 13, Ui.MUTED, false);
                    continue;
                }
                TextView h = label(piles, (names == null ? p : names.optString(p, p)) + " (" + rows.length() + ")", 15,
                        "scam".equals(p) ? Ui.BAD : Ui.TEXT, true);
                h.setPadding(0, Ui.dp(this, 10), 0, Ui.dp(this, 2));
                int max = "needs_you".equals(p) ? 3 : 10;
                for (int j = 0; j < rows.length() && j < max; j++) {
                    JSONObject m = rows.optJSONObject(j);
                    String subj = m.optString("subject");
                    StringBuilder t = new StringBuilder((subj.isEmpty() ? "(no subject)" : subj) + " — " + cut(m.optString("from"), 40));
                    JSONArray signs = m.optJSONArray("scam_signs");
                    if (signs != null && signs.length() > 0) {
                        t.append("\nWard: ");
                        for (int k = 0; k < signs.length(); k++) t.append(k > 0 ? "; " : "").append(signs.optString(k));
                    }
                    TextView l = label(piles, t.toString(), 13, "scam".equals(p) ? Ui.WARN : Ui.TEXT, false);
                    l.setPadding(Ui.dp(this, 8), 0, 0, Ui.dp(this, 4));
                }
            }
        });
    }

    // ------------------------------------------------------------------ Records (Ledger)

    private void showRecords(String section) {
        recordsSection = section;
        setPage("records", "Records");
        bg(api -> api.get("/v1/" + section), d -> {
            if (!"records".equals(page)) return;
            LinearLayout col = column();
            LinearLayout tabs = buttons(col);
            String[][] secs = {{"private", "Your records"}, {"ledger", "Story lore"}};
            for (String[] s : secs) {
                add(tabs, Ui.chip(this, s[1], Ui.ACCENT, s[0].equals(section))).setOnClickListener(v -> showRecords(s[0]));
            }
            JSONArray entries = d.optJSONArray("entries");
            List<JSONObject> drafts = new ArrayList<>(), real = new ArrayList<>();
            for (int i = 0; entries != null && i < entries.length(); i++) {
                JSONObject e = entries.optJSONObject(i);
                if ("draft".equals(e.optString("status"))) drafts.add(e);
                else if ("canon".equals(e.optString("status"))) real.add(e);
            }
            if (!drafts.isEmpty()) heading(col, "Drafts waiting for your tap");
            for (JSONObject e : drafts) {
                LinearLayout b = card(col, 0);
                label(b, e.optString("id") + " · " + e.optString("type") + " · " + e.optString("name"), 15, Ui.TEXT, true);
                label(b, e.optString("summary"), 13, Ui.MUTED, false);
                LinearLayout btns = buttons(b);
                String eid = e.optString("id");
                add(btns, Ui.chip(this, "Make it real", Ui.OK, true)).setOnClickListener(v ->
                        bg(api -> api.post("/v1/" + section + "/" + Api.enc(eid) + "/promote", null),
                                x -> { toast("Done."); showRecords(section); }));
                add(btns, Ui.chip(this, "Retire", Ui.LINE, true)).setOnClickListener(v -> retire(section, eid));
            }
            heading(col, "private".equals(section) ? "Real" : "Canon");
            for (JSONObject e : real) {
                TextView t = label(col, e.optString("id") + " · " + e.optString("name") + ": " + e.optString("summary"),
                        13, Ui.TEXT, false);
                t.setPadding(0, Ui.dp(this, 2), 0, Ui.dp(this, 2));
            }
            if (real.isEmpty()) label(col, "Nothing yet.", 14, Ui.MUTED, false);
        });
    }

    private void retire(String section, String eid) {
        EditText e = field("Why is it being retired?", false);
        new AlertDialog.Builder(this).setTitle("Retire").setView(padded(e))
                .setPositiveButton("Retire", (dlg, w) -> {
                    String why = e.getText().toString().trim();
                    if (!why.isEmpty()) bg(api -> api.post("/v1/" + section + "/" + Api.enc(eid) + "/retire",
                            new JSONObject().put("reason", why)), x -> showRecords(section));
                })
                .setNegativeButton("Cancel", null).show();
    }

    // ------------------------------------------------------------------ Settings

    private void showSettings(String tab) {
        if (!settingsUnlocked) {
            unlock("Open Settings", "Settings change what your agents may do", () -> {
                settingsUnlocked = true;
                showSettings(tab);
            });
            return;
        }
        settingsTab = tab;
        setPage("settings", "Settings");
        LinearLayout col = column();
        LinearLayout tabs = buttons(col);
        String[][] all = {{"agents", "Agents"}, {"accounts", "Accounts"}, {"calm", "Calm mode"},
                {"phone", "Link to PC"}, {"content", "Content & rules"}};
        for (String[] t : all) {
            add(tabs, Ui.chip(this, t[1], Ui.ACCENT, t[0].equals(tab))).setOnClickListener(v -> {
                if (!t[0].equals("agents")) settingsAgent = null;
                showSettings(t[0]);
            });
        }
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        col.addView(box);
        switch (tab) {
            case "accounts": settingsAccounts(box); break;
            case "calm": settingsCalm(box); break;
            case "phone": settingsLink(box); break;
            case "content": settingsContent(box); break;
            default: settingsAgents(box); break;
        }
    }

    private void settingsAgents(LinearLayout box) {
        if (settingsAgent != null) {
            agentRows(box, settingsAgent);
            return;
        }
        bg(api -> api.get("/v1/checklists"), d -> {
            JSONArray list = d.optJSONArray("agents");
            for (int i = 0; list != null && i < list.length(); i++) {
                JSONObject a = list.optJSONObject(i);
                LinearLayout b = card(box, 0);
                label(b, a.optString("name"), 15, Ui.TEXT, true);
                label(b, a.optString("text"), 13, Ui.MUTED, false);
                String key = a.optString("agent");
                b.setOnClickListener(v -> { settingsAgent = key; showSettings("agents"); });
            }
        });
    }

    private void agentRows(LinearLayout box, String key) {
        bg(api -> api.get("/v1/checklists/" + Api.enc(key)), a -> {
            LinearLayout head = row();
            box.addView(head);
            add(head, Ui.chip(this, "‹ Agents", Ui.LINE, true)).setOnClickListener(v -> { settingsAgent = null; showSettings("agents"); });
            TextView name = Ui.text(this, "  " + a.optString("name"), 17, Ui.TEXT, true);
            head.addView(name);
            LinearLayout presets = buttons(box);
            String[][] ps = {{"careful", "Careful"}, {"normal", "Normal"}, {"handsoff", "Hands-off"}};
            for (String[] p : ps) {
                add(presets, Ui.chip(this, p[1], Ui.LINE, true)).setOnClickListener(v ->
                        bg(api -> api.post("/v1/checklists/" + Api.enc(key), new JSONObject().put("preset", p[0])),
                                r -> showSettings("agents")));
            }
            JSONArray rows = a.optJSONArray("rows");
            for (int i = 0; rows != null && i < rows.length(); i++) {
                JSONObject r = rows.optJSONObject(i);
                LinearLayout b = card(box, 0);
                label(b, r.optString("label"), 14, Ui.TEXT, false);
                LinearLayout btns = row();
                b.addView(btns);
                for (int c = 0; c < CHOICES.length; c++) {
                    String ch = CHOICES[c];
                    boolean on = ch.equals(r.optString("choice"));
                    add(btns, Ui.chip(this, CHOICE_WORDS[c], CHOICE_COLORS[c], on)).setOnClickListener(v ->
                            bg(api -> api.post("/v1/checklists/" + Api.enc(key),
                                    new JSONObject().put("job", r.optString("job")).put("choice", ch)), x -> showSettings("agents")));
                }
            }
            boolean ns = a.optBoolean("not_sure_stop", true);
            label(box, "Not sure? Stop: after reading an email or web page, even Do jobs ask first.", 13, Ui.MUTED, false);
            add(buttons(box), Ui.chip(this, ns ? "On" : "Off", Ui.OK, ns)).setOnClickListener(v ->
                    bg(api -> api.post("/v1/checklists/" + Api.enc(key), new JSONObject().put("not_sure_stop", !ns)),
                            x -> showSettings("agents")));
            JSONArray hist = a.optJSONArray("history");
            if (hist != null && hist.length() > 0) {
                heading(box, "Recent changes");
                for (int i = hist.length() - 1; i >= Math.max(0, hist.length() - 8); i--) {
                    JSONObject h = hist.optJSONObject(i);
                    LinearLayout line = row();
                    box.addView(line);
                    line.addView(Ui.text(this, time(h.optDouble("ts", 0)) + "  " + cut(h.optString("why"), 80)
                            + "  (" + h.optString("by") + ")", 12, Ui.MUTED, false), new LinearLayout.LayoutParams(0, -2, 1));
                    if (!h.optBoolean("undone")) {
                        String hid = h.optString("id");
                        add(line, Ui.chip(this, "Undo", Ui.LINE, true)).setOnClickListener(v ->
                                bg(api -> api.post("/v1/checklists/undo/" + Api.enc(hid), null), x -> showSettings("agents")));
                    }
                }
            }
        });
    }

    private void settingsAccounts(LinearLayout box) {
        bg(api -> api.get("/v1/accounts"), d -> {
            JSONArray accs = d.optJSONArray("accounts");
            for (int i = 0; accs != null && i < accs.length(); i++) {
                JSONObject acc = accs.optJSONObject(i);
                LinearLayout b = card(box, 0);
                boolean linked = acc.optBoolean("linked");
                String name = acc.optString("name");
                String state = linked ? "Linked" + (acc.optString("who").isEmpty() ? "" : " as " + acc.optString("who"))
                        + ("gmail".equals(name) && !acc.optBoolean("can_change") ? " · read-only" : "") : "Not linked";
                label(b, acc.optString("label"), 16, Ui.TEXT, true);
                label(b, state, 13, linked ? Ui.OK : Ui.MUTED, false);
                LinearLayout btns = buttons(b);
                if (linked) {
                    if ("gmail".equals(name) && !acc.optBoolean("can_change")) {
                        add(btns, Ui.chip(this, "Allow changes", Ui.LINE, true)).setOnClickListener(v -> linkGmail(true));
                    }
                    add(btns, Ui.chip(this, "Unlink", Ui.BAD, true)).setOnClickListener(v ->
                            new AlertDialog.Builder(this).setTitle("Unlink")
                                    .setMessage("Remove Helper's sign-in for " + acc.optString("label") + "?")
                                    .setPositiveButton("Unlink", (dlg, w) -> bg(api -> api.post("/v1/accounts/" + name + "/unlink", null),
                                            x -> showSettings("accounts")))
                                    .setNegativeButton("Cancel", null).show());
                } else {
                    add(btns, Ui.chip(this, "Link", Ui.ACCENT, true)).setOnClickListener(v -> {
                        if ("gmail".equals(name)) linkGmail(false); else linkTrello();
                    });
                }
                JSONArray jobs = acc.optJSONArray("jobs");
                for (int j = 0; jobs != null && j < jobs.length(); j++) {
                    JSONObject job = jobs.optJSONObject(j);
                    JSONArray who = job.optJSONArray("agents");
                    StringBuilder sb = new StringBuilder();
                    for (int k = 0; who != null && k < who.length(); k++) {
                        JSONObject u = who.optJSONObject(k);
                        sb.append(k > 0 ? ", " : "").append(u.optString("name")).append(" (").append(word(u.optString("choice"))).append(")");
                    }
                    label(b, job.optString("label") + ": " + (sb.length() == 0 ? "no agent" : sb), 12, Ui.MUTED, false);
                }
            }
            label(box, "Change who may do what in Settings › Agents. Passwords never touch Helper. RoboForm isn't "
                    + "linked yet: whether it allows linking still needs checking.", 12, Ui.MUTED, false);
        });
    }

    private void linkGmail(boolean canChange) {
        LinearLayout f = new LinearLayout(this);
        f.setOrientation(LinearLayout.VERTICAL);
        EditText id = field("Google client ID", false);
        EditText sec = field("Client secret", false);
        sec.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        f.addView(id);
        f.addView(sec);
        new AlertDialog.Builder(this).setTitle("Link Gmail")
                .setMessage("From your free Google Cloud \"Desktop app\" client (see the README). Google's sign-in "
                        + "then opens in your browser.")
                .setView(padded(f))
                .setPositiveButton("Link", (dlg, w) -> bg(api -> api.post("/v1/accounts/gmail/link", new JSONObject()
                        .put("client_id", id.getText().toString()).put("client_secret", sec.getText().toString())
                        .put("can_change", canChange)), r -> toast(r.optString("text"))))
                .setNegativeButton("Cancel", null).show();
    }

    private void linkTrello() {
        EditText key = field("Your Trello API key (trello.com/power-ups/admin)", false);
        new AlertDialog.Builder(this).setTitle("Link Trello").setView(padded(key))
                .setPositiveButton("Next", (dlg, w) -> {
                    String k = key.getText().toString().trim();
                    if (k.isEmpty()) return;
                    Links.init(this);
                    Links.open("https://trello.com/1/authorize?expiration=never&scope=read,write&response_type=token"
                            + "&name=Helper&key=" + Api.enc(k));
                    EditText tok = field("Paste the token here", false);
                    tok.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
                    new AlertDialog.Builder(this).setTitle("Link Trello")
                            .setMessage("Press Allow in the browser, then paste the token.").setView(padded(tok))
                            .setPositiveButton("Link", (d2, w2) -> bg(api -> api.post("/v1/accounts/trello/link",
                                    new JSONObject().put("key", k).put("token", tok.getText().toString())),
                                    r -> { toast("Linked Trello as " + r.optString("who")); showSettings("accounts"); }))
                            .setNegativeButton("Cancel", null).show();
                })
                .setNegativeButton("Cancel", null).show();
    }

    private void settingsCalm(LinearLayout box) {
        bg(api -> api.get("/v1/calm"), c -> {
            String[][] keys = {{"readout", "Morning readout time"}, {"quiet_start", "Quiet hours start"}, {"quiet_end", "Quiet hours end"}};
            EditText[] boxes = new EditText[keys.length];
            for (int i = 0; i < keys.length; i++) {
                label(box, keys[i][1], 13, Ui.MUTED, false);
                boxes[i] = new EditText(this);
                boxes[i].setText(c.optString(keys[i][0]));
                boxes[i].setTextColor(Ui.TEXT);
                boxes[i].setInputType(InputType.TYPE_CLASS_DATETIME | InputType.TYPE_DATETIME_VARIATION_TIME);
                box.addView(boxes[i]);
            }
            boolean quests = c.optBoolean("quests");
            label(box, "Pip's quests and XP", 13, Ui.MUTED, false);
            LinearLayout r = buttons(box);
            add(r, Ui.chip(this, quests ? "On" : "Off", Ui.OK, quests)).setOnClickListener(v ->
                    bg(api -> api.post("/v1/calm", new JSONObject().put("quests", !quests)), x -> showSettings("calm")));
            add(buttons(box), Ui.chip(this, "Save times", Ui.ACCENT, true)).setOnClickListener(v -> {
                JSONObject b = new JSONObject();
                try {
                    for (int i = 0; i < keys.length; i++) b.put(keys[i][0], boxes[i].getText().toString().trim());
                } catch (Exception ignored) {
                    return;
                }
                bg(api -> api.post("/v1/calm", b), x -> { toast("Saved."); showSettings("calm"); });
            });
        });
    }

    private void settingsLink(LinearLayout box) {
        boolean linked = Api.linked(this);
        if (!linked) {
            label(box, "Helper is running on this phone by itself. Linking your PC is optional: then this phone "
                    + "uses Helper on the PC instead (its agents, email and bigger AI). Your phone and PC don't need "
                    + "the same Wi-Fi: put Tailscale on both.", 14, Ui.MUTED, false);
            add(buttons(box), Ui.chip(this, "Link to PC", Ui.ACCENT, true)).setOnClickListener(v ->
                    startActivity(new Intent(this, SetupActivity.class)));
            return;
        }
        label(box, "Linked to " + KeyBox.prefs(this).getString("pc_host", "?") + " · key " + KeyBox.hint(KeyBox.load(this)),
                14, Ui.TEXT, false);
        LinearLayout r2 = buttons(box);
        boolean watch = WatchService.wanted(this);
        add(r2, Ui.chip(this, "Notifications: " + (watch ? "On" : "Off"), Ui.OK, watch)).setOnClickListener(v -> {
            KeyBox.prefs(this).edit().putBoolean("watch", !watch).apply();
            if (watch) WatchService.stop(this); else WatchService.startIfWanted(this);
            showSettings("phone");
        });
        add(r2, Ui.chip(this, "Unlink this phone", Ui.BAD, true)).setOnClickListener(v ->
                new AlertDialog.Builder(this).setTitle("Unlink?")
                        .setMessage("This phone forgets its key and goes back to running Helper by itself. "
                                + "Remove it on the PC too (Settings › Phone link).")
                        .setPositiveButton("Unlink", (dlg, w) -> {
                            WatchService.stop(this);
                            KeyBox.clear(this);
                            agent = null;
                            loadAgents();
                        })
                        .setNegativeButton("Cancel", null).show());
    }

    private void settingsContent(LinearLayout box) {
        bg(api -> {
            JSONObject all = new JSONObject();
            all.put("content", api.get("/v1/content"));
            all.put("rules", api.get("/v1/rules"));
            return all;
        }, all -> {
            JSONObject c = all.optJSONObject("content");
            JSONObject r = all.optJSONObject("rules");
            heading(box, "Content");
            if (c.optBoolean("locked")) {
                label(box, "Filtered, locked in content.toml.", 14, Ui.MUTED, false);
            } else {
                boolean un = "unfiltered".equals(c.optString("mode"));
                label(box, "Now: " + (un ? "Unfiltered 18+ until " + time(c.optDouble("until", 0)) : "Filtered"), 14, Ui.TEXT, false);
                add(buttons(box), Ui.chip(this, un ? "Back to Filtered" : "Unfiltered 18+", un ? Ui.LINE : Ui.BAD, true))
                        .setOnClickListener(v -> {
                            if (un) {
                                setContent("filtered");
                            } else {
                                new AlertDialog.Builder(this).setTitle("Unfiltered 18+")
                                        .setMessage("Turn on Unfiltered 18+ for a while? It turns itself back off.")
                                        .setPositiveButton("Turn on", (d, w) -> setContent("unfiltered"))
                                        .setNegativeButton("Cancel", null).show();
                            }
                        });
                label(box, "Email and other outward agents always stay Filtered. Two limits hold in every mode: "
                        + "nothing sexual involving minors, and nothing sexual about real people.", 12, Ui.MUTED, false);
            }
            heading(box, "Your rule docs");
            JSONArray rules = r.optJSONArray("rules");
            for (int i = 0; rules != null && i < rules.length(); i++) {
                JSONObject d = rules.optJSONObject(i);
                label(box, d.optString("name") + ": " + d.optString("state"), 13, Ui.TEXT, false);
            }
            if (rules == null || rules.length() == 0) {
                label(box, "None picked yet. List them as rule_docs in policy/allowlist.toml, then approve the policy.", 13, Ui.MUTED, false);
            }
            heading(box, "Drive folders agents may read");
            JSONArray k = r.optJSONArray("knowledge");
            if (k == null || k.length() == 0) label(box, "None yet.", 13, Ui.MUTED, false);
            for (int i = 0; k != null && i < k.length(); i++) label(box, k.optString(i), 13, Ui.MUTED, false);
        });
    }

    private void setContent(String mode) {
        bg(api -> api.post("/v1/content", new JSONObject().put("mode", mode)), x -> showSettings("content"));
    }

    // ------------------------------------------------------------------ small helpers

    private static String cut(String s, int n) {
        return s.length() > n ? s.substring(0, n) + "…" : s;
    }

    private static String word(String choice) {
        for (int i = 0; i < CHOICES.length; i++) if (CHOICES[i].equals(choice)) return CHOICE_WORDS[i];
        return choice;
    }

    private static String time(double ts) {
        if (ts <= 0 || Double.isNaN(ts)) return "";
        return new SimpleDateFormat("EEE HH:mm", Locale.getDefault()).format(new Date((long) (ts * 1000)));
    }

    private static int parseColor(String s, int fallback) {
        try {
            return android.graphics.Color.parseColor(s);
        } catch (Exception e) {
            return fallback;
        }
    }
}
