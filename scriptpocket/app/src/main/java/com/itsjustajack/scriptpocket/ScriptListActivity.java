package com.itsjustajack.scriptpocket;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.ListView;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.List;

/** "My scripts": switch scripts on and off, edit, update, delete, back up. */
public class ScriptListActivity extends Activity {
    private static final int REQ_IMPORT = 1, REQ_BACKUP = 2, REQ_RESTORE = 3;

    private final List<ScriptStore.Entry> items = new ArrayList<>();
    private Adapter adapter;
    private ScriptStore store;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        setContentView(R.layout.activity_scripts);
        if (getActionBar() != null) getActionBar().setDisplayHomeAsUpEnabled(true);
        store = ScriptStore.get(this);

        Switch master = findViewById(R.id.master_switch);
        master.setChecked(ScriptStore.scriptsOn(this));
        master.setOnCheckedChangeListener((b, on) -> ScriptStore.setScriptsOn(this, on));

        ListView list = findViewById(R.id.list);
        list.setEmptyView(findViewById(R.id.empty));
        adapter = new Adapter();
        list.setAdapter(adapter);
        list.setOnItemClickListener((p, v, pos, id) -> edit(items.get(pos)));
        list.setOnItemLongClickListener((p, v, pos, id) -> { actions(items.get(pos)); return true; });
    }

    @Override
    protected void onResume() {
        super.onResume();
        refresh();
    }

    private void refresh() {
        items.clear();
        items.addAll(store.list());
        Collections.sort(items, (a, b) -> a.meta.name.compareToIgnoreCase(b.meta.name));
        adapter.notifyDataSetChanged();
    }

    private void edit(ScriptStore.Entry e) {
        startActivity(new Intent(this, EditorActivity.class).putExtra(EditorActivity.EXTRA_ID, e.id));
    }

    private void actions(ScriptStore.Entry e) {
        String[] labels = {"Edit", "Check for update", "Share code", "Delete"};
        new AlertDialog.Builder(this).setTitle(e.meta.name)
                .setItems(labels, (d, which) -> {
                    if (which == 0) edit(e);
                    else if (which == 1) InstallUi.checkUpdates(this, Collections.singletonList(e), this::refresh);
                    else if (which == 2) share(e);
                    else confirmDelete(e);
                }).show();
    }

    private void share(ScriptStore.Entry e) {
        Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain")
                .putExtra(Intent.EXTRA_SUBJECT, e.meta.name + ".user.js")
                .putExtra(Intent.EXTRA_TEXT, e.code);
        startActivity(Intent.createChooser(send, "Share " + e.meta.name));
    }

    private void confirmDelete(ScriptStore.Entry e) {
        new AlertDialog.Builder(this).setTitle("Delete " + e.meta.name + "?")
                .setMessage("The script and anything it saved will be removed.")
                .setPositiveButton("Delete", (d, w) -> { store.delete(e.id); refresh(); })
                .setNegativeButton("Cancel", null).show();
    }

    // ---------- menu ----------

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        getMenuInflater().inflate(R.menu.scripts, menu);
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        int id = item.getItemId();
        if (id == android.R.id.home) finish();
        else if (id == R.id.m_new) startActivity(new Intent(this, EditorActivity.class));
        else if (id == R.id.m_install) InstallUi.askForUrl(this, this::refresh);
        else if (id == R.id.m_import) pick(REQ_IMPORT);
        else if (id == R.id.m_updates) InstallUi.checkUpdates(this, store.list(), this::refresh);
        else if (id == R.id.m_backup) backup();
        else if (id == R.id.m_restore) pick(REQ_RESTORE);
        else if (id == R.id.m_log) MainActivity.showLog(this);
        else return super.onOptionsItemSelected(item);
        return true;
    }

    private void pick(int req) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
        startActivityForResult(i, req);
    }

    private void backup() {
        if (items.isEmpty()) {
            Toast.makeText(this, "No scripts to back up yet", Toast.LENGTH_SHORT).show();
            return;
        }
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType("application/json").putExtra(Intent.EXTRA_TITLE, "scriptpocket-backup.json");
        startActivityForResult(i, REQ_BACKUP);
    }

    @Override
    protected void onActivityResult(int req, int result, Intent data) {
        super.onActivityResult(req, result, data);
        if (result != RESULT_OK || data == null || data.getData() == null) return;
        Uri uri = data.getData();
        if (req == REQ_IMPORT) InstallUi.installFromUri(this, uri, this::refresh);
        else if (req == REQ_BACKUP) writeBackup(uri);
        else if (req == REQ_RESTORE) restore(uri);
    }

    private void writeBackup(Uri uri) {
        InstallUi.background(this, "Saving backup…", () -> {
            JSONObject root = new JSONObject();
            root.put("app", "ScriptPocket");
            root.put("format", 1);
            JSONArray arr = new JSONArray();
            for (ScriptStore.Entry e : store.list()) {
                JSONObject o = new JSONObject();
                o.put("code", e.code);
                o.put("enabled", e.enabled);
                o.put("source", e.source);
                o.put("values", store.valuesAsJson(e.id));
                arr.put(o);
            }
            root.put("scripts", arr);
            try (OutputStream out = getContentResolver().openOutputStream(uri, "wt")) {
                if (out == null) throw new IOException("Could not write the backup file");
                out.write(root.toString(1).getBytes(StandardCharsets.UTF_8));
            }
            return arr.length();
        }, n -> Toast.makeText(this, "Backed up " + n + " scripts", Toast.LENGTH_SHORT).show());
    }

    private void restore(Uri uri) {
        InstallUi.background(this, "Restoring scripts…", () -> {
            JSONObject root = new JSONObject(InstallUi.readUri(this, uri));
            JSONArray arr = root.getJSONArray("scripts");
            int n = 0;
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                ScriptStore.Entry e = Installer.install(this, o.getString("code"), o.optString("source"), null, true);
                store.setEnabled(e.id, o.optBoolean("enabled", true));
                JSONObject vals = o.optJSONObject("values");
                if (vals != null) {
                    android.content.SharedPreferences.Editor ed = store.values(e.id).edit();
                    Iterator<String> keys = vals.keys();
                    while (keys.hasNext()) { String k = keys.next(); ed.putString(k, vals.getString(k)); }
                    ed.apply();
                }
                n++;
            }
            return n;
        }, n -> { Toast.makeText(this, "Restored " + n + " scripts", Toast.LENGTH_SHORT).show(); refresh(); });
    }

    // ---------- list rows ----------

    private class Adapter extends BaseAdapter {
        @Override public int getCount() { return items.size(); }
        @Override public Object getItem(int i) { return items.get(i); }
        @Override public long getItemId(int i) { return i; }

        @Override
        public View getView(int pos, View v, ViewGroup parent) {
            if (v == null) v = LayoutInflater.from(ScriptListActivity.this).inflate(R.layout.row_script, parent, false);
            ScriptStore.Entry e = items.get(pos);
            TextView name = v.findViewById(R.id.name);
            TextView desc = v.findViewById(R.id.desc);
            TextView where = v.findViewById(R.id.where);
            Switch sw = v.findViewById(R.id.toggle);
            name.setText(e.meta.version.isEmpty() ? e.meta.name : e.meta.name + "  v" + e.meta.version);
            desc.setText(e.meta.description);
            desc.setVisibility(e.meta.description.isEmpty() ? View.GONE : View.VISIBLE);
            where.setText("Runs on " + e.meta.runsOn());
            sw.setOnCheckedChangeListener(null);
            sw.setChecked(e.enabled);
            final View row = v;
            sw.setOnCheckedChangeListener((b, on) -> {
                store.setEnabled(e.id, on);
                e.enabled = on;
                row.setAlpha(on ? 1f : 0.55f);
            });
            row.setAlpha(e.enabled ? 1f : 0.55f);
            return row;
        }
    }
}
