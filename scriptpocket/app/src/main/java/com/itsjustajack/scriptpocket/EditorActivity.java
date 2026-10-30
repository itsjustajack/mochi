package com.itsjustajack.scriptpocket;

import android.app.Activity;
import android.app.AlertDialog;
import android.net.Uri;
import android.os.Bundle;
import android.view.Menu;
import android.view.MenuItem;
import android.widget.EditText;
import android.widget.Toast;

/** A plain code editor for one script. */
public class EditorActivity extends Activity {
    public static final String EXTRA_ID = "id";
    public static final String EXTRA_MATCH_URL = "match_url";

    private EditText editor;
    private String id;
    private String savedText;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        setContentView(R.layout.activity_editor);
        if (getActionBar() != null) getActionBar().setDisplayHomeAsUpEnabled(true);
        editor = findViewById(R.id.editor);
        editor.setHorizontallyScrolling(true);

        id = saved != null ? saved.getString(EXTRA_ID) : getIntent().getStringExtra(EXTRA_ID);
        ScriptStore.Entry e = ScriptStore.get(this).find(id);
        if (e != null) {
            savedText = e.code;
            setTitle(e.meta.name);
        } else {
            id = null;
            savedText = template(getIntent().getStringExtra(EXTRA_MATCH_URL));
            setTitle("New script");
        }
        if (saved == null) editor.setText(savedText);
    }

    private static String template(String pageUrl) {
        String match = "https://*/*";
        if (pageUrl != null) {
            Uri u = Uri.parse(pageUrl);
            if (u.getHost() != null && ("http".equals(u.getScheme()) || "https".equals(u.getScheme()))) {
                match = u.getScheme() + "://" + u.getHost() + "/*";
            }
        }
        return "// ==UserScript==\n"
                + "// @name         My new script\n"
                + "// @namespace    scriptpocket\n"
                + "// @version      0.1\n"
                + "// @description  What this script does\n"
                + "// @match        " + match + "\n"
                + "// @grant        none\n"
                + "// ==/UserScript==\n"
                + "\n"
                + "(function () {\n"
                + "    'use strict';\n"
                + "\n"
                + "    // Your code here. It runs on every page matched by @match above.\n"
                + "\n"
                + "})();\n";
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        out.putString(EXTRA_ID, id);
    }

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        getMenuInflater().inflate(R.menu.editor, menu);
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        int itemId = item.getItemId();
        if (itemId == android.R.id.home) { onBackPressed(); return true; }
        if (itemId == R.id.m_save) { save(null); return true; }
        return super.onOptionsItemSelected(item);
    }

    private void save(Runnable after) {
        String code = editor.getText().toString();
        UserScript s = UserScript.parse(code);
        if (!s.hasHeader) {
            new AlertDialog.Builder(this).setTitle("Header missing")
                    .setMessage("Scripts need a // ==UserScript== … // ==/UserScript== block at the top "
                            + "so the app knows their name and which sites to run on.")
                    .setPositiveButton("OK", null).show();
            return;
        }
        InstallUi.background(this, "Saving…", () -> Installer.install(this, code, null, id, false), e -> {
            id = e.id;
            savedText = code;
            setTitle(e.meta.name);
            Toast.makeText(this, "Saved", Toast.LENGTH_SHORT).show();
            if (after != null) after.run();
        });
    }

    @Override
    public void onBackPressed() {
        if (editor.getText().toString().equals(savedText)) {
            super.onBackPressed();
            return;
        }
        new AlertDialog.Builder(this).setTitle("Save changes?")
                .setPositiveButton("Save", (d, w) -> save(this::finish))
                .setNegativeButton("Discard", (d, w) -> finish())
                .setNeutralButton("Keep editing", null)
                .show();
    }
}
