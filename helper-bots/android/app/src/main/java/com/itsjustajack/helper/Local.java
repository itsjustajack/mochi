package com.itsjustajack.helper;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Helper on the phone by itself: no PC, no Wi-Fi needed.
 *
 * It answers the same /v1 routes as Helper on the PC, so every screen works the same either way.
 * Everything is kept in this app's private storage (Android encrypts it with the phone's lock).
 *
 * Today, reminders (tiny first steps, snooze, missed ones roll quietly to tomorrow), brain dump with
 * tick-the-real-tasks, Calm mode, your private records (a password, PIN, code or card number is
 * refused), and Pip's checklist (Do / Ask me / Never) with OK cards. Stop all stops Pip.
 * Pip understands plain requests by simple rules; chat with the on-phone AI comes on top of this.
 */
final class Local {
    private static final Object LOCK = new Object();
    private static final SecureRandom RNG = new SecureRandom();

    // Pip's jobs on the phone: key, label, starting choice.
    static final String[][] JOBS = {
            {"remind", "Add reminders", "do"},
            {"private_propose", "Add to your records", "ask"},
            {"drop_reminder", "Drop reminders", "ask"},
    };

    private final File file;

    Local(Context c) {
        file = new File(c.getFilesDir(), "helper-local.json");
    }

    // ------------------------------------------------------------------ storage

    private JSONObject load() {
        try {
            return new JSONObject(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private void save(JSONObject d) throws IOException {
        File tmp = new File(file.getPath() + ".tmp");
        Files.write(tmp.toPath(), d.toString().getBytes(StandardCharsets.UTF_8));
        if (!tmp.renameTo(file)) throw new IOException("couldn't save");
    }

    private static JSONArray arr(JSONObject d, String k) throws JSONException {
        JSONArray a = d.optJSONArray(k);
        if (a == null) {
            a = new JSONArray();
            d.put(k, a);
        }
        return a;
    }

    private static JSONObject obj(JSONObject d, String k) throws JSONException {
        JSONObject o = d.optJSONObject(k);
        if (o == null) {
            o = new JSONObject();
            d.put(k, o);
        }
        return o;
    }

    static String newId() {
        byte[] b = new byte[5];
        RNG.nextBytes(b);
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format(Locale.ROOT, "%02x", x));
        return sb.toString();
    }

    static double now() {
        return System.currentTimeMillis() / 1000.0;
    }

    // ------------------------------------------------------------------ routes

    JSONObject get(String path) throws IOException {
        return handle("GET", path, new JSONObject());
    }

    JSONObject post(String path, JSONObject body) throws IOException {
        return handle("POST", path, body == null ? new JSONObject() : body);
    }

    private JSONObject handle(String method, String path, JSONObject body) throws IOException {
        synchronized (LOCK) {
            try {
                JSONObject d = load();
                rollMissed(d);
                JSONObject out = route(method, path, body, d);
                save(d);
                return out;
            } catch (JSONException e) {
                throw new IOException(e);
            } catch (IllegalArgumentException e) {
                throw new Api.HttpError(400, e.getMessage());
            }
        }
    }

    private JSONObject route(String m, String path, JSONObject b, JSONObject d) throws JSONException {
        String[] p = path.replaceFirst("^/v1/", "").split("/");
        String head = p[0];
        boolean post = "POST".equals(m);
        switch (head) {
            case "status": {
                return new JSONObject().put("pending", arr(d, "approvals").length())
                        .put("stopped", d.optBoolean("stopped"))
                        .put("model", new JSONObject().put("ok", true).put("name", "on this phone"))
                        .put("local", true);
            }
            case "stop": d.put("stopped", true); return new JSONObject().put("stopped", true);
            case "start": d.put("stopped", false); return new JSONObject().put("stopped", false);
            case "agents": {
                JSONArray a = new JSONArray().put(new JSONObject().put("key", "pip").put("name", "Pip")
                        .put("color", "#4cc38a").put("about", "One thing at a time"));
                return new JSONObject().put("agents", a).put("default", "pip");
            }
            case "tasks": {
                if (p.length > 1) {
                    JSONObject t = find(arr(d, "tasks"), p[1]);
                    if (t == null) throw new IllegalArgumentException("no such task");
                    return t;
                }
                if (post) return pip(d, b.optString("goal").trim());
                return new JSONObject().put("tasks", arr(d, "tasks"));
            }
            case "approvals": {
                if (p.length > 1 && post) return decide(d, p[1], b.optString("verdict"));
                return new JSONObject().put("approvals", arr(d, "approvals"));
            }
            case "today": return today(d);
            case "calm": {
                JSONObject c = calm(d);
                if (post) {
                    if (b.has("too_much")) c.put("too_much", b.optBoolean("too_much"));
                    if (b.has("quests")) c.put("quests", b.optBoolean("quests"));
                    for (String k : new String[]{"readout", "quiet_start", "quiet_end"}) {
                        if (b.has(k)) c.put(k, hm(b.optString(k)));
                    }
                }
                return c;
            }
            case "reminders": {
                if (p.length == 1) {
                    if (post) return addReminder(d, b.optString("text"), b.optString("first_step"), 0, "you");
                    return new JSONObject().put("reminders", openReminders(d));
                }
                JSONObject r = find(arr(d, "reminders"), p[1]);
                if (r == null) throw new IllegalArgumentException("no such reminder");
                String what = p.length > 2 ? p[2] : "";
                if ("done".equals(what)) {
                    r.put("status", "done").put("done_at", now());
                    JSONObject c = calm(d);
                    if (c.optBoolean("quests")) c.put("xp", c.optInt("xp") + 10);
                } else if ("drop".equals(what)) {
                    r.put("status", "dropped");
                } else if ("snooze".equals(what)) {
                    snooze(r, b.optString("choice"));
                }
                return r;
            }
            case "capture": {
                if (p.length == 1) {
                    if (post) return addCapture(d, b.optString("text"));
                    return new JSONObject().put("notes", arr(d, "capture"));
                }
                JSONObject n = find(arr(d, "capture"), p[1]);
                if (n == null) throw new IllegalArgumentException("no such note");
                if (p.length > 2 && "sort".equals(p[2])) {
                    JSONArray keep = b.optJSONArray("keep");
                    JSONArray items = n.optJSONArray("items");
                    int made = 0;
                    for (int i = 0; keep != null && i < keep.length(); i++) {
                        JSONObject it = items == null ? null : items.optJSONObject(keep.optInt(i, -1));
                        if (it != null) {
                            addReminder(d, it.optString("text"), it.optString("first_step"), 0, "brain dump");
                            made++;
                        }
                    }
                    n.put("status", "sorted");
                    return new JSONObject().put("made", made);
                }
                return n;
            }
            case "private": {
                if (p.length > 1 && "add".equals(p[1]) && post) {
                    return addRecord(d, b.optString("type", "note"), b.optString("title"), b.optString("body"));
                }
                if (p.length > 2 && "remove".equals(p[2]) && post) {
                    JSONArray rs = arr(d, "records");
                    for (int i = 0; i < rs.length(); i++) {
                        if (p[1].equals(rs.optJSONObject(i).optString("id"))) {
                            rs.remove(i);
                            break;
                        }
                    }
                    return new JSONObject().put("removed", p[1]);
                }
                return new JSONObject().put("records", arr(d, "records"));
            }
            case "checklists": {
                if (p.length == 1) {
                    JSONArray list = new JSONArray().put(new JSONObject().put("agent", "pip").put("name", "Pip")
                            .put("text", summary(d)));
                    return new JSONObject().put("agents", list);
                }
                if (!"pip".equals(p[1])) throw new IllegalArgumentException("no such agent");
                if (post) {
                    JSONObject rows = obj(d, "checklist");
                    String preset = b.optString("preset");
                    if (!preset.isEmpty()) {
                        for (String[] j : JOBS) {
                            rows.put(j[0], "careful".equals(preset) ? "ask"
                                    : "handsoff".equals(preset) ? "do" : j[2]);
                        }
                    }
                    String job = b.optString("job"), ch = b.optString("choice");
                    if (!job.isEmpty()) {
                        if (!ch.matches("do|ask|never") || label(job) == null) throw new IllegalArgumentException("bad row");
                        rows.put(job, ch);
                    }
                    if (b.has("not_sure_stop")) d.put("not_sure_stop", b.optBoolean("not_sure_stop"));
                }
                JSONArray rows = new JSONArray();
                for (String[] j : JOBS) {
                    rows.put(new JSONObject().put("job", j[0]).put("label", j[1]).put("choice", choice(d, j[0])));
                }
                return new JSONObject().put("agent", "pip").put("name", "Pip").put("rows", rows)
                        .put("not_sure_stop", d.optBoolean("not_sure_stop", true));
            }
            case "done": return new JSONObject().put("done", arr(d, "done"));
            default:
                throw new IllegalArgumentException("Needs the PC: link it in Settings");
        }
    }

    private static JSONObject find(JSONArray a, String id) {
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o != null && id.equals(o.optString("id"))) return o;
        }
        return null;
    }

    // ------------------------------------------------------------------ checklist

    static String label(String job) {
        for (String[] j : JOBS) if (j[0].equals(job)) return j[1];
        return null;
    }

    private static String choice(JSONObject d, String job) {
        JSONObject rows = d.optJSONObject("checklist");
        String def = "ask";
        for (String[] j : JOBS) if (j[0].equals(job)) def = j[2];
        return rows == null ? def : rows.optString(job, def);
    }

    private static String summary(JSONObject d) {
        int doN = 0, ask = 0, never = 0;
        for (String[] j : JOBS) {
            String c = choice(d, j[0]);
            if ("do".equals(c)) doN++;
            else if ("never".equals(c)) never++;
            else ask++;
        }
        return doN + " on its own · " + ask + " ask me · " + never + " never";
    }

    // ------------------------------------------------------------------ Calm, reminders

    private static JSONObject calm(JSONObject d) throws JSONException {
        JSONObject c = obj(d, "calm");
        if (!c.has("readout")) {
            c.put("too_much", false).put("quiet_start", "22:00").put("quiet_end", "08:00")
                    .put("readout", "07:00").put("quests", false).put("xp", 0);
        }
        return c;
    }

    private static String hm(String s) {
        Matcher mm = Pattern.compile("^(\\d{1,2}):(\\d{2})$").matcher(s.trim());
        if (!mm.find()) throw new IllegalArgumentException("times look like 07:00");
        return String.format(Locale.ROOT, "%02d:%02d", Integer.parseInt(mm.group(1)) % 24, Integer.parseInt(mm.group(2)) % 60);
    }

    private static final Pattern TASKY = Pattern.compile(
            "^(?:to ?do:?\\s*|todo:?\\s*|- \\[ \\]\\s*)|"
                    + "\\b(need to|have to|got to|gotta|must|remember to|don'?t forget|should|call|ring|phone|email|text|reply|"
                    + "book|pay|buy|order|send|post|cancel|renew|fix|clean|wash|pick up|drop off|sign|fill in|apply|check|"
                    + "ask|tell|sort out|make|get|find|return|change)\\b", Pattern.CASE_INSENSITIVE);
    private static final String[][] FIRST_STEP = {
            {"\\b(call|ring|phone)\\b", "Find the number"},
            {"\\b(email|reply|text)\\b", "Open the message"},
            {"\\b(pay|renew)\\b", "Open the bill or the account page"},
            {"\\b(book|apply)\\b", "Open the booking page"},
            {"\\b(buy|order)\\b", "Add it to the shopping list"},
            {"\\b(fill in|sign)\\b", "Find the form"},
            {"\\b(clean|wash|tidy)\\b", "Do just 5 minutes"},
    };

    static String firstStep(String text) {
        for (String[] f : FIRST_STEP) {
            if (Pattern.compile(f[0], Pattern.CASE_INSENSITIVE).matcher(text).find()) return f[1];
        }
        return "Spend 2 minutes on it";
    }

    /** Messy text in, likely tasks out (same rules as the PC). */
    static JSONArray splitItems(String text) throws JSONException {
        List<String> parts = new ArrayList<>();
        for (String line : text.split("[\\r\\n]+")) {
            line = line.replaceFirst("^\\s*(?:[-*•]|\\d+[.)])\\s*", "").trim();
            if (line.isEmpty()) continue;
            for (String piece : line.split("(?<=[.!?;])\\s+|\\s+(?:and then|then also|also)\\s+")) {
                piece = piece.replaceAll("^[ .;]+|[ .;]+$", "");
                if (piece.length() >= 3 && piece.length() <= 300) parts.add(piece);
            }
        }
        JSONArray out = new JSONArray();
        for (int i = 0; i < parts.size() && i < 60; i++) {
            String s = parts.get(i);
            boolean task = TASKY.matcher(s).find();
            out.put(new JSONObject().put("text", Character.toUpperCase(s.charAt(0)) + s.substring(1))
                    .put("kind", task ? "task" : "note").put("first_step", task ? firstStep(s) : ""));
        }
        return out;
    }

    private static JSONObject addReminder(JSONObject d, String text, String step, double due, String source)
            throws JSONException {
        text = text.trim();
        if (text.isEmpty()) throw new IllegalArgumentException("The reminder is empty.");
        if (text.length() > 300) text = text.substring(0, 300);
        JSONObject r = new JSONObject().put("id", newId()).put("text", text)
                .put("first_step", step == null || step.isEmpty() ? firstStep(text) : step)
                .put("due", due > 0 ? due : JSONObject.NULL).put("snoozed_until", JSONObject.NULL)
                .put("urgent", false).put("status", "open").put("created", now()).put("source", source);
        JSONArray rs = arr(d, "reminders");
        rs.put(r);
        while (rs.length() > 1000) rs.remove(0);
        return r;
    }

    private static JSONArray openReminders(JSONObject d) throws JSONException {
        JSONArray out = new JSONArray();
        JSONArray rs = arr(d, "reminders");
        for (int i = 0; i < rs.length(); i++) {
            if ("open".equals(rs.optJSONObject(i).optString("status"))) out.put(rs.optJSONObject(i));
        }
        return out;
    }

    private static Calendar at(int addDays, int hour) {
        Calendar c = Calendar.getInstance();
        c.add(Calendar.DAY_OF_YEAR, addDays);
        c.set(Calendar.HOUR_OF_DAY, hour);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        return c;
    }

    private static void snooze(JSONObject r, String choice) throws JSONException {
        double until;
        switch (choice) {
            case "1h": until = now() + 3600; break;
            case "tonight": until = at(0, 19).getTimeInMillis() / 1000.0; break;
            case "tomorrow": until = at(1, 9).getTimeInMillis() / 1000.0; break;
            default: throw new IllegalArgumentException("Snooze is 1 hour, tonight or tomorrow.");
        }
        if (until <= now()) until = now() + 3600;
        r.put("snoozed_until", until);
    }

    /** Anything due before today moves quietly to tomorrow morning. No red counters. */
    private static void rollMissed(JSONObject d) throws JSONException {
        JSONArray rs = d.optJSONArray("reminders");
        if (rs == null) return;
        double start = at(0, 0).getTimeInMillis() / 1000.0;
        double tomorrow = at(1, 9).getTimeInMillis() / 1000.0;
        for (int i = 0; i < rs.length(); i++) {
            JSONObject r = rs.optJSONObject(i);
            double due = r.optDouble("due", 0);
            if ("open".equals(r.optString("status")) && due > 0 && due < start) r.put("due", tomorrow);
        }
    }

    private JSONObject today(JSONObject d) throws JSONException {
        JSONArray items = new JSONArray();
        JSONArray ap = arr(d, "approvals");
        for (int i = 0; i < ap.length(); i++) {
            JSONObject a = ap.optJSONObject(i);
            items.put(new JSONObject().put("kind", "ok").put("id", a.optString("id"))
                    .put("text", a.optString("agent") + " wants to: " + a.optString("job"))
                    .put("first_step", "Look at the card").put("urgent", true));
        }
        double end = at(1, 0).getTimeInMillis() / 1000.0;
        List<JSONObject> show = new ArrayList<>();
        JSONArray rs = openReminders(d);
        for (int i = 0; i < rs.length(); i++) {
            JSONObject r = rs.optJSONObject(i);
            if (r.optDouble("snoozed_until", 0) > now()) continue;
            if (r.optDouble("due", 0) > end) continue;
            show.add(r);
        }
        show.sort((a, b) -> {
            if (a.optBoolean("urgent") != b.optBoolean("urgent")) return a.optBoolean("urgent") ? -1 : 1;
            double da = a.optDouble("due", 1e12), db = b.optDouble("due", 1e12);
            if (Double.isNaN(da)) da = 1e12;
            if (Double.isNaN(db)) db = 1e12;
            if (da != db) return Double.compare(da, db);
            return Double.compare(a.optDouble("created"), b.optDouble("created"));
        });
        for (JSONObject r : show) {
            items.put(new JSONObject().put("kind", "reminder").put("id", r.optString("id"))
                    .put("text", r.optString("text")).put("first_step", r.optString("first_step"))
                    .put("urgent", r.optBoolean("urgent")));
        }
        int unsorted = 0;
        JSONArray cap = arr(d, "capture");
        for (int i = 0; i < cap.length(); i++) if ("new".equals(cap.optJSONObject(i).optString("status"))) unsorted++;
        if (unsorted > 0) {
            items.put(new JSONObject().put("kind", "capture").put("id", "")
                    .put("text", "Sort " + unsorted + " brain dump note" + (unsorted > 1 ? "s" : ""))
                    .put("first_step", "Tick the real tasks").put("urgent", false));
        }
        JSONObject c = calm(d);
        int held = 0;
        if (c.optBoolean("too_much") && items.length() > 3) {
            held = items.length() - 3;
            JSONArray top = new JSONArray();
            for (int i = 0; i < 3; i++) top.put(items.get(i));
            items = top;
        }
        return new JSONObject().put("items", items).put("held", held).put("calm", c)
                .put("one_thing", items.length() > 0 ? items.get(0) : JSONObject.NULL);
    }

    // ------------------------------------------------------------------ brain dump

    private static JSONObject addCapture(JSONObject d, String text) throws JSONException {
        text = text.trim();
        if (text.isEmpty()) throw new IllegalArgumentException("The note is empty.");
        if (text.length() > 20000) text = text.substring(0, 20000);
        JSONObject n = new JSONObject().put("id", newId()).put("text", text).put("items", splitItems(text))
                .put("status", "new").put("created", now());
        JSONArray cap = arr(d, "capture");
        cap.put(n);
        while (cap.length() > 300) cap.remove(0);
        return n;
    }

    // ------------------------------------------------------------------ private records

    static final String[] RECORD_TYPES = {"account", "person", "place", "document", "routine", "date", "note"};
    // Same rule as the PC (helper/ledger.py looks_secret): a secret written out, not where it lives.
    private static final Pattern SECRET = Pattern.compile(
            "\\b(pass(?:word|wd|code|phrase)|pin|2fa|otp|one[- ]time code|recovery (?:key|code)|backup code|security answer|"
            + "cvv|card number)\\b\\s*(?:is|=|:|-)\\s*\\S+"
            + "|\\b\\d{4}[ -]?\\d{4}[ -]?\\d{4}[ -]?\\d{4}\\b", Pattern.CASE_INSENSITIVE);

    static boolean looksSecret(String s) {
        return SECRET.matcher(s).find();
    }

    private static JSONObject addRecord(JSONObject d, String type, String title, String body) throws JSONException {
        title = title.trim();
        body = body.trim();
        if (title.isEmpty()) throw new IllegalArgumentException("Give the record a name.");
        boolean ok = false;
        for (String t : RECORD_TYPES) ok |= t.equals(type);
        if (!ok) throw new IllegalArgumentException("Unknown record type.");
        if (looksSecret(title + "\n" + body)) {
            throw new IllegalArgumentException("That looks like a password, PIN, code or card number. "
                    + "Records say where it lives (\"in RoboForm\"), never the thing itself.");
        }
        JSONArray rs = arr(d, "records");
        int n = rs.length() + 1;
        JSONObject r = new JSONObject().put("id", String.format(Locale.ROOT, "REC-%04d", n)).put("type", type)
                .put("title", title.length() > 120 ? title.substring(0, 120) : title)
                .put("body", body.length() > 4000 ? body.substring(0, 4000) : body).put("created", now());
        while (find(rs, r.optString("id")) != null) r.put("id", String.format(Locale.ROOT, "REC-%04d", ++n));
        rs.put(r);
        return r;
    }

    // ------------------------------------------------------------------ Pip

    private static final Pattern REMIND = Pattern.compile(
            "^(?:please\\s+)?(?:remind me(?: to| about)?|reminder:?|add (?:a )?reminder(?: to)?)\\s+(.+)$",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern RECORD = Pattern.compile(
            "^(?:remember|record|note)(?: that)?:?\\s+(.+)$", Pattern.CASE_INSENSITIVE);
    private static final Pattern FROM_NOW = Pattern.compile("\\bfrom now on\\b", Pattern.CASE_INSENSITIVE);

    private JSONObject pip(JSONObject d, String goal) throws JSONException {
        if (goal.isEmpty()) throw new IllegalArgumentException("Type something first.");
        if (goal.length() > 4000) goal = goal.substring(0, 4000);
        JSONObject t = new JSONObject().put("id", newId()).put("agent", "pip").put("goal", goal)
                .put("status", "done").put("created", now());
        JSONArray ev = new JSONArray().put(new JSONObject().put("kind", "user").put("text", goal));
        t.put("events", ev);
        JSONArray tasks = arr(d, "tasks");
        tasks.put(t);
        while (tasks.length() > 200) tasks.remove(0);

        if (d.optBoolean("stopped")) {
            ev.put(new JSONObject().put("kind", "system").put("text", "Everything is stopped. Tap Start again first."));
            return t;
        }
        String low = goal.toLowerCase(Locale.ROOT);

        // "from now on…": only Jack's own typed message changes a row, never anything an agent read.
        if (FROM_NOW.matcher(goal).find()) {
            String job = low.contains("record") ? "private_propose"
                    : low.contains("drop") ? "drop_reminder" : low.contains("remind") ? "remind" : null;
            if (job != null) {
                String ch = low.matches(".*\\b(never|don'?t|do not|stop)\\b.*") ? "never"
                        : low.matches(".*\\b(ask|check with me)\\b.*") ? "ask" : "do";
                obj(d, "checklist").put(job, ch);
                ev.put(new JSONObject().put("kind", "checklist").put("label", label(job)).put("choice", ch));
                return t;
            }
        }
        Matcher m = REMIND.matcher(goal);
        if (m.find()) {
            String what = m.group(1).trim();
            double due = 0;
            if (Pattern.compile("\\btomorrow\\b", Pattern.CASE_INSENSITIVE).matcher(what).find()) {
                due = at(1, 9).getTimeInMillis() / 1000.0;
                what = what.replaceAll("(?i)\\s*\\btomorrow\\b", "");
            } else if (Pattern.compile("\\btonight\\b", Pattern.CASE_INSENSITIVE).matcher(what).find()) {
                due = at(0, 19).getTimeInMillis() / 1000.0;
                what = what.replaceAll("(?i)\\s*\\btonight\\b", "");
            }
            what = what.trim();
            if (what.isEmpty()) what = goal;
            JSONObject args = new JSONObject().put("text", Character.toUpperCase(what.charAt(0)) + what.substring(1));
            if (due > 0) args.put("due", due);
            return act(d, t, "remind", args);
        }
        m = RECORD.matcher(goal);
        if (m.find()) {
            String what = m.group(1).trim();
            if (looksSecret(what)) {
                ev.put(new JSONObject().put("kind", "denied").put("reason",
                        "That looks like a password, PIN, code or card number. I don't keep those, only where they live."));
                return t;
            }
            JSONObject args = new JSONObject().put("type", "note")
                    .put("title", what.length() > 60 ? what.substring(0, 60) + "…" : what).put("body", what);
            return act(d, t, "private_propose", args);
        }
        if (low.matches(".*\\b(one thing|what now|what next|where do i start)\\b.*")) {
            JSONObject one = today(d).optJSONObject("one_thing");
            ev.put(end(one == null ? "Nothing needs you right now. Rest is allowed."
                    : "Just this: " + one.optString("text") + "\nFirst step: " + one.optString("first_step")));
            return t;
        }
        if (low.matches(".*\\b(too much|overwhelm\\w*)\\b.*")) {
            calm(d).put("too_much", true);
            ev.put(end("Okay. I've turned on Too much: Today shows only the top 3 and holds the rest. Nothing is lost."));
            return t;
        }
        if (low.matches(".*\\b(what('?s| is) on|my reminders|list)\\b.*")) {
            JSONArray rs = openReminders(d);
            StringBuilder sb = new StringBuilder(rs.length() == 0 ? "No reminders. Nice." : "Your reminders:");
            for (int i = 0; i < rs.length() && i < 10; i++) sb.append("\n• ").append(rs.optJSONObject(i).optString("text"));
            ev.put(end(sb.toString()));
            return t;
        }
        ev.put(end(Ai.reply(goal)));
        return t;
    }

    private static JSONObject end(String text) throws JSONException {
        return new JSONObject().put("kind", "end").put("text", text);
    }

    /** The phone's gate: Pip's checklist row decides Do, Ask me or Never. */
    private JSONObject act(JSONObject d, JSONObject t, String job, JSONObject args) throws JSONException {
        JSONArray ev = t.getJSONArray("events");
        String ch = choice(d, job);
        if ("never".equals(ch)) {
            ev.put(new JSONObject().put("kind", "denied").put("reason",
                    "\"" + label(job) + "\" is set to Never for Pip. Change it in Settings."));
            return t;
        }
        if ("ask".equals(ch)) {
            JSONObject a = new JSONObject().put("id", newId()).put("agent", "Pip").put("agent_key", "pip")
                    .put("tool", job).put("job", label(job)).put("args", args).put("task_id", t.optString("id"))
                    .put("reason", "Your checklist says Ask me for this.").put("tainted", false).put("created", now());
            arr(d, "approvals").put(a);
            t.put("status", "waiting");
            ev.put(new JSONObject().put("kind", "approval").put("approval", a));
            return t;
        }
        ev.put(run(d, job, args));
        return t;
    }

    private JSONObject run(JSONObject d, String job, JSONObject args) throws JSONException {
        String text;
        if ("remind".equals(job)) {
            JSONObject r = addReminder(d, args.optString("text"), "", args.optDouble("due", 0), "Pip");
            text = "Reminder added: " + r.optString("text") + " (first step: " + r.optString("first_step") + ")";
        } else if ("private_propose".equals(job)) {
            JSONObject r = addRecord(d, args.optString("type", "note"), args.optString("title"), args.optString("body"));
            text = "Saved to your records as " + r.optString("id");
        } else {
            text = "Done";
        }
        JSONArray done = arr(d, "done");
        done.put(new JSONObject().put("id", newId()).put("agent", "Pip").put("job", label(job)).put("text", text).put("at", now()));
        while (done.length() > 300) done.remove(0);
        return new JSONObject().put("kind", "result").put("ok", true).put("text", text);
    }

    private JSONObject decide(JSONObject d, String id, String verdict) throws JSONException {
        JSONArray ap = arr(d, "approvals");
        JSONObject a = null;
        for (int i = 0; i < ap.length(); i++) {
            if (id.equals(ap.optJSONObject(i).optString("id"))) {
                a = ap.optJSONObject(i);
                ap.remove(i);
                break;
            }
        }
        if (a == null) throw new IllegalArgumentException("That card was already answered.");
        JSONObject t = find(arr(d, "tasks"), a.optString("task_id"));
        JSONArray ev = t == null ? new JSONArray() : t.getJSONArray("events");
        if (t != null) t.put("status", "done");
        switch (verdict) {
            case "always":
                obj(d, "checklist").put(a.optString("tool"), "do");
                ev.put(new JSONObject().put("kind", "checklist").put("label", a.optString("job")).put("choice", "do"));
                // fall through: Always also approves this one
            case "approve":
                if (d.optBoolean("stopped")) {
                    ev.put(new JSONObject().put("kind", "system").put("text", "Everything is stopped, so it wasn't done."));
                } else {
                    ev.put(run(d, a.optString("tool"), a.optJSONObject("args")));
                }
                break;
            case "deny":
                ev.put(new JSONObject().put("kind", "denied").put("reason", "You said no."));
                break;
            default:
                ev.put(new JSONObject().put("kind", "system").put("text", "Task stopped."));
                break;
        }
        return new JSONObject().put("ok", true);
    }
}
