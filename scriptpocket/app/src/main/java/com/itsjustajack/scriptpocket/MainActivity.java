package com.itsjustajack.scriptpocket;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.KeyEvent;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.webkit.ScriptHandler;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** The browser: an address bar, a WebView, and the menu that reaches everything else. */
public class MainActivity extends Activity implements Bridge.Host {
    private static final int REQ_FILE_CHOOSER = 1;
    private static final String DEFAULT_HOME = "https://duckduckgo.com/";
    private static final String DESKTOP_UA =
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

    private WebView web;
    private EditText address;
    private ProgressBar progress;
    private Bridge bridge;
    private String mobileUa;

    private final List<ScriptHandler> handlers = new ArrayList<>();
    private List<String> fallbackScripts = new ArrayList<>();
    private boolean docStart;
    private int appliedChange = -1;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        setContentView(R.layout.activity_main);
        web = findViewById(R.id.web);
        address = findViewById(R.id.address);
        progress = findViewById(R.id.progress);
        ImageButton scriptsButton = findViewById(R.id.scripts_button);
        ImageButton more = findViewById(R.id.more_button);

        bridge = new Bridge(this, this);
        setUpWebView();

        address.setOnEditorActionListener((v, actionId, event) -> {
            boolean enter = event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER
                    && event.getAction() == KeyEvent.ACTION_DOWN;
            if (actionId == EditorInfo.IME_ACTION_GO || enter) {
                go(address.getText().toString());
                return true;
            }
            return false;
        });
        address.setOnFocusChangeListener((v, has) -> { if (has) address.selectAll(); });
        scriptsButton.setOnClickListener(v -> startActivity(new Intent(this, ScriptListActivity.class)));
        more.setOnClickListener(this::showMenu);

        applyScripts();
        if (saved != null) web.restoreState(saved);
        if (!handleIntent(getIntent()) && web.getUrl() == null) web.loadUrl(home());
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setUpWebView() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setAllowFileAccess(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        mobileUa = s.getUserAgentString();
        applyDesktopMode();
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        web.addJavascriptInterface(bridge, Bridge.NAME);
        docStart = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                if (!req.isForMainFrame()) return false;
                return interceptUrl(req.getUrl().toString());
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                bridge.newPage();
                if (!address.hasFocus()) address.setText(url);
                injectFallback();
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (!address.hasFocus()) address.setText(url);
                injectFallback();
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int p) {
                progress.setProgress(p);
                progress.setVisibility(p >= 100 ? View.INVISIBLE : View.VISIBLE);
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE_CHOOSER);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });

        web.setDownloadListener((url, userAgent, contentDisposition, mimeType, length) -> {
            if (InstallUi.looksLikeUserScriptUrl(url)) {
                InstallUi.installFromUrl(this, url, this::reloadAfterChange);
            } else {
                openExternally(Uri.parse(url));
            }
        });
    }

    /** True when we handled the link ourselves instead of letting the page load it. */
    private boolean interceptUrl(String url) {
        Uri uri = Uri.parse(url);
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
        if (scheme.equals("http") || scheme.equals("https")) {
            if (InstallUi.looksLikeUserScriptUrl(url)) {
                InstallUi.installFromUrl(this, url, this::reloadAfterChange);
                return true;
            }
            return false;
        }
        if (scheme.equals("about") || scheme.equals("data") || scheme.equals("blob") || scheme.equals("javascript")) {
            return false;
        }
        try {
            Intent i = scheme.equals("intent") ? Intent.parseUri(url, Intent.URI_INTENT_SCHEME)
                    : new Intent(Intent.ACTION_VIEW, uri);
            i.addCategory(Intent.CATEGORY_BROWSABLE);
            i.setComponent(null);
            i.setSelector(null);
            startActivity(i);
        } catch (Exception e) {
            String fallback = null;
            if (scheme.equals("intent")) {
                try { fallback = Intent.parseUri(url, Intent.URI_INTENT_SCHEME).getStringExtra("browser_fallback_url"); }
                catch (Exception ignored) { }
            }
            if (fallback != null) web.loadUrl(fallback);
            else Toast.makeText(this, "No app can open this link", Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    private void openExternally(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "No app can open this download", Toast.LENGTH_SHORT).show();
        }
    }

    // ---------- scripts ----------

    /** Hands the current scripts to the WebView. They take effect on the next page load. */
    private void applyScripts() {
        appliedChange = ScriptStore.changeCount();
        List<String> blobs = Injector.buildAll(this, bridge.token, bridge.key);
        if (docStart) {
            for (ScriptHandler h : handlers) h.remove();
            handlers.clear();
            for (String js : blobs) {
                handlers.add(WebViewCompat.addDocumentStartJavaScript(web, js, Collections.singleton("*")));
            }
        } else {
            fallbackScripts = blobs;
        }
    }

    /** Older WebViews can't run scripts before the page, so we inject them as early as we can. */
    private void injectFallback() {
        if (docStart) return;
        for (String js : fallbackScripts) web.evaluateJavascript(js, null);
    }

    private void reloadAfterChange() {
        if (ScriptStore.changeCount() != appliedChange) {
            applyScripts();
            if (web.getUrl() != null) web.reload();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        reloadAfterChange();
    }

    @Override
    protected void onPause() {
        web.onPause();
        CookieManager.getInstance().flush();
        super.onPause();
    }

    // ---------- navigation ----------

    private void go(String text) {
        text = text.trim();
        if (text.isEmpty()) return;
        String url;
        if (text.matches("^[a-zA-Z][a-zA-Z0-9+.\\-]*:.*") && !text.contains(" ")) {
            url = text;
        } else if (!text.contains(" ") && text.matches("^[^/]+\\.[a-zA-Z]{2,}(:\\d+)?(/.*)?$")) {
            url = "https://" + text;
        } else {
            url = "https://duckduckgo.com/?q=" + Uri.encode(text);
        }
        web.requestFocus();
        InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
        if (imm != null) imm.hideSoftInputFromWindow(address.getWindowToken(), 0);
        if (!interceptUrl(url)) web.loadUrl(url);
    }

    @Override
    public void openUrl(String url) {
        if (!interceptUrl(url)) web.loadUrl(url);
    }

    private String home() {
        return ScriptStore.settings(this).getString("home", DEFAULT_HOME);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    // ---------- intents (opening .user.js files and links from other apps) ----------

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleIntent(intent);
    }

    private boolean handleIntent(Intent intent) {
        if (intent == null) return false;
        String action = intent.getAction();
        if (Intent.ACTION_VIEW.equals(action) && intent.getData() != null) {
            Uri uri = intent.getData();
            String scheme = uri.getScheme() == null ? "" : uri.getScheme();
            if (scheme.equals("content") || scheme.equals("file")) {
                InstallUi.installFromUri(this, uri, this::reloadAfterChange);
            } else if (InstallUi.looksLikeUserScriptUrl(uri.toString())) {
                InstallUi.installFromUrl(this, uri.toString(), this::reloadAfterChange);
            } else {
                web.loadUrl(uri.toString());
            }
            return true;
        }
        if (Intent.ACTION_SEND.equals(action)) {
            String text = intent.getStringExtra(Intent.EXTRA_TEXT);
            Uri stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (text != null && text.contains("==UserScript==")) {
                InstallUi.confirm(this, text, "", this::reloadAfterChange);
            } else if (text != null && text.trim().matches("^https?://\\S+$")) {
                go(text.trim());
            } else if (stream != null) {
                InstallUi.installFromUri(this, stream, this::reloadAfterChange);
            } else if (text != null) {
                go(text);
            }
            return true;
        }
        return false;
    }

    // ---------- menu ----------

    private void showMenu(View anchor) {
        PopupMenu pm = new PopupMenu(this, anchor);
        pm.getMenuInflater().inflate(R.menu.browser, pm.getMenu());
        pm.getMenu().findItem(R.id.m_forward).setEnabled(web.canGoForward());
        int ran = bridge.ranScriptIds().size();
        int cmds = bridge.menuCommands().size();
        pm.getMenu().findItem(R.id.m_this_page).setTitle("On this page (" + ran + " running"
                + (cmds > 0 ? ", " + cmds + " command" + (cmds == 1 ? "" : "s") : "") + ")");
        pm.setOnMenuItemClickListener(item -> {
            int id = item.getItemId();
            if (id == R.id.m_back) { if (web.canGoBack()) web.goBack(); }
            else if (id == R.id.m_forward) web.goForward();
            else if (id == R.id.m_reload) web.reload();
            else if (id == R.id.m_home) web.loadUrl(home());
            else if (id == R.id.m_this_page) showThisPage();
            else if (id == R.id.m_scripts) startActivity(new Intent(this, ScriptListActivity.class));
            else if (id == R.id.m_new) startActivity(new Intent(this, EditorActivity.class).putExtra(EditorActivity.EXTRA_MATCH_URL, web.getUrl()));
            else if (id == R.id.m_install) InstallUi.askForUrl(this, this::reloadAfterChange);
            else if (id == R.id.m_log) showLog(this);
            else if (id == R.id.m_settings) showSettings();
            else return false;
            return true;
        });
        pm.show();
    }

    private void showThisPage() {
        ScriptStore store = ScriptStore.get(this);
        List<Bridge.MenuCommand> cmds = bridge.menuCommands();
        List<String> ran = bridge.ranScriptIds();
        List<String> labels = new ArrayList<>();
        for (Bridge.MenuCommand c : cmds) {
            ScriptStore.Entry e = store.find(c.scriptId);
            labels.add("▶  " + c.name + (e != null ? "   (" + e.meta.name + ")" : ""));
        }
        for (String id : ran) {
            ScriptStore.Entry e = store.find(id);
            labels.add("✓  " + (e != null ? e.meta.name : "removed script") + " ran here");
        }
        AlertDialog.Builder b = new AlertDialog.Builder(this).setTitle("On this page");
        if (labels.isEmpty()) {
            b.setMessage(ScriptStore.scriptsOn(this)
                    ? "No scripts ran on this page.\n\nIf you just added one, reload the page."
                    : "Scripts are switched off. Turn them back on in My scripts.");
        } else {
            b.setItems(labels.toArray(new String[0]), (d, which) -> {
                if (which < cmds.size()) web.evaluateJavascript(bridge.menuCallJs(cmds.get(which)), null);
            });
        }
        b.setPositiveButton("Close", null).show();
    }

    static void showLog(Activity a) {
        TextView tv = new TextView(a);
        tv.setText(Bridge.logText());
        tv.setTextIsSelectable(true);
        tv.setTypeface(android.graphics.Typeface.MONOSPACE);
        tv.setTextSize(12);
        int p = InstallUi.dp(a, 16);
        tv.setPadding(p, p, p, p);
        android.widget.ScrollView sv = new android.widget.ScrollView(a);
        sv.addView(tv);
        new AlertDialog.Builder(a).setTitle("Script log").setView(sv)
                .setPositiveButton("Close", null)
                .setNeutralButton("Clear", (d, w) -> Bridge.clearLog())
                .show();
    }

    private void showSettings() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        TextView label = new TextView(this);
        label.setText("Home page");
        EditText homeField = new EditText(this);
        homeField.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        homeField.setText(home());
        CheckBox desktop = new CheckBox(this);
        desktop.setText("Request desktop sites");
        desktop.setChecked(ScriptStore.settings(this).getBoolean("desktop", false));
        CheckBox scriptsOn = new CheckBox(this);
        scriptsOn.setText("Run userscripts");
        scriptsOn.setChecked(ScriptStore.scriptsOn(this));
        box.addView(label);
        box.addView(homeField);
        box.addView(desktop);
        box.addView(scriptsOn);
        new AlertDialog.Builder(this).setTitle("Settings")
                .setView(InstallUi.padded(this, box))
                .setPositiveButton("Save", (d, w) -> {
                    String h = homeField.getText().toString().trim();
                    if (!h.isEmpty() && !h.contains("://")) h = "https://" + h;
                    ScriptStore.settings(this).edit()
                            .putString("home", h.isEmpty() ? DEFAULT_HOME : h)
                            .putBoolean("desktop", desktop.isChecked()).apply();
                    if (scriptsOn.isChecked() != ScriptStore.scriptsOn(this)) ScriptStore.setScriptsOn(this, scriptsOn.isChecked());
                    applyDesktopMode();
                    reloadAfterChange();
                    web.reload();
                })
                .setNegativeButton("Cancel", null).show();
    }

    private void applyDesktopMode() {
        boolean desktop = ScriptStore.settings(this).getBoolean("desktop", false);
        String ua = desktop ? DESKTOP_UA : mobileUa;
        web.getSettings().setUserAgentString(ua);
        bridge.setUserAgent(ua);
    }

    // ---------- lifecycle ----------

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE_CHOOSER && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }
}
