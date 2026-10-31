package com.itsjustajack.helper;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.net.URLEncoder;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Helper's phone front end. It shows helperd's own web app (running in Termux on 127.0.0.1)
 * in a locked-down WebView, and adds what a web page can't do: a fingerprint/PIN check before
 * Approve, notifications, a share target, a home-screen widget and a quick-settings Stop tile.
 * It holds no model and no tools; every action still goes through helperd's gate.
 */
public class MainActivity extends Activity {
    private WebView web;
    private View offline;
    private TextView offlineMsg;
    private FrameLayout root;
    private String pendingShare;
    private boolean loadedOnce;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Ui.channels(this);
        WebView.setWebContentsDebuggingEnabled(false);
        root = new FrameLayout(this);
        root.setBackgroundColor(Ui.BG);
        root.setFitsSystemWindows(true);
        setContentView(root);
        takeShare(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (takeShare(intent) && web != null) load();
    }

    @Override
    protected void onResume() {
        super.onResume();
        Api api = Api.from(this);
        if (api == null) {
            startActivity(new Intent(this, SetupActivity.class));
            return;
        }
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 7);
        }
        WatchService.startIfWanted(this);
        if (web == null) buildWeb();
        if (!loadedOnce || pendingShare != null) load();
        else web.evaluateJavascript("window.helperRefresh && helperRefresh()", null);
    }

    @Override
    protected void onDestroy() {
        io.shutdownNow();
        if (web != null) {
            web.removeJavascriptInterface("HelperApp");
            web.destroy();
        }
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
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

    // ------------------------------------------------------------------ WebView

    private boolean isHelperUrl(Uri u) {
        return u != null && "http".equals(u.getScheme()) && Api.HOST.equals(u.getHost())
                && u.getPort() == Api.port(this);
    }

    private void buildWeb() {
        web = new WebView(this);
        web.setBackgroundColor(Ui.BG);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setGeolocationEnabled(false);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setSafeBrowsingEnabled(true);
        // Named actions only. The page can ask for an approval check; it cannot approve by itself.
        web.addJavascriptInterface(new Bridge(), "HelperApp");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                return !isHelperUrl(r.getUrl()); // anything else simply doesn't open
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                if (isHelperUrl(r.getUrl())) return null;
                return new WebResourceResponse("text/plain", "utf-8", 403, "Blocked", null,
                        new ByteArrayInputStream("Offline".getBytes()));
            }

            @Override
            public void onPageStarted(WebView v, String url, Bitmap icon) {
                showOffline(false, null);
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame()) {
                    showOffline(true, "Helper's engine isn't running on this phone yet.");
                }
            }
        });
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        offline = buildOffline();
        root.addView(offline, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        offline.setVisibility(View.GONE);
    }

    private void load() {
        String key = KeyBox.load(this);
        if (key == null) return;
        // The key goes in the #fragment, which the WebView never sends over the network;
        // the page saves it and clears it from the address bar straight away.
        StringBuilder url = new StringBuilder(Api.baseUrl(this)).append("#key=").append(key);
        try {
            if (pendingShare != null) url.append("&share=").append(URLEncoder.encode(pendingShare, "UTF-8"));
        } catch (Exception ignored) {
        }
        pendingShare = null;
        loadedOnce = true;
        web.loadUrl(url.toString());
    }

    // ------------------------------------------------------------------ offline screen

    private View buildOffline() {
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Ui.BG);
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER_HORIZONTAL);
        int p = Ui.dp(this, 24);
        box.setPadding(p, Ui.dp(this, 64), p, p);
        scroll.addView(box);

        TextView face = Ui.text(this, "• •", 22, Ui.BG, true);
        face.setGravity(Gravity.CENTER);
        face.setBackground(Ui.round(this, Ui.ACCENT, 999, 0));
        box.addView(face, new LinearLayout.LayoutParams(Ui.dp(this, 64), Ui.dp(this, 64)));

        TextView title = Ui.text(this, "Helper isn't running", 22, Ui.TEXT, true);
        title.setGravity(Gravity.CENTER);
        title.setPadding(0, Ui.dp(this, 16), 0, Ui.dp(this, 8));
        box.addView(title);

        offlineMsg = Ui.text(this, "", 15, Ui.MUTED, false);
        offlineMsg.setGravity(Gravity.CENTER);
        box.addView(offlineMsg);

        TextView how = Ui.text(this, "Start it from here, or open Termux and run:", 14, Ui.MUTED, false);
        how.setPadding(0, Ui.dp(this, 20), 0, Ui.dp(this, 8));
        box.addView(how);
        box.addView(Ui.mono(this, "helper serve"));

        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = Ui.dp(this, 24);
        android.widget.Button start = Ui.button(this, "Start Helper in Termux", true);
        start.setOnClickListener(v -> {
            String err = Termux.startHelper(this);
            if (err != null) {
                offlineMsg.setText(err);
            } else {
                offlineMsg.setText("Starting… this takes a few seconds.");
                main.postDelayed(this::load, 3500);
            }
        });
        box.addView(start, lp);

        LinearLayout.LayoutParams lp2 = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp2.topMargin = Ui.dp(this, 10);
        android.widget.Button retry = Ui.button(this, "Try again", false);
        retry.setOnClickListener(v -> load());
        box.addView(retry, lp2);

        android.widget.Button setup = Ui.button(this, "Connection settings", false);
        setup.setOnClickListener(v -> startActivity(new Intent(this, SetupActivity.class)));
        LinearLayout.LayoutParams lp3 = new LinearLayout.LayoutParams(lp2);
        box.addView(setup, lp3);
        return scroll;
    }

    private void showOffline(boolean show, String msg) {
        if (offline == null) return;
        offline.setVisibility(show ? View.VISIBLE : View.GONE);
        if (msg != null) offlineMsg.setText(msg);
    }

    // ------------------------------------------------------------------ approve with fingerprint / PIN

    /** Called by the page's Approve once button. Shows the action as helperd reports it, not as the page says. */
    private void approveWithCheck(String id) {
        Api api = Api.from(this);
        if (api == null) return;
        io.execute(() -> {
            JSONObject a;
            try {
                a = api.approval(id);
            } catch (Exception e) {
                a = null;
            }
            final JSONObject found = a;
            main.post(() -> {
                if (found == null) {
                    Toast.makeText(this, "That request is no longer waiting.", Toast.LENGTH_SHORT).show();
                    refreshPage();
                    return;
                }
                askDevice(found, () -> io.execute(() -> {
                    String err = null;
                    try {
                        api.decide(id, "approve");
                    } catch (Exception e) {
                        err = e.getMessage();
                    }
                    final String fe = err;
                    main.post(() -> {
                        if (fe != null) Toast.makeText(this, "Not approved: " + fe, Toast.LENGTH_LONG).show();
                        refreshPage();
                    });
                }));
            });
        });
    }

    private void askDevice(JSONObject a, Runnable onOk) {
        int auth = BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.DEVICE_CREDENTIAL;
        BiometricManager bm = getSystemService(BiometricManager.class);
        if (bm == null || bm.canAuthenticate(auth) != BiometricManager.BIOMETRIC_SUCCESS) {
            Toast.makeText(this, "Set a screen lock (PIN, pattern or fingerprint) to approve from the phone.", Toast.LENGTH_LONG).show();
            refreshPage();
            return;
        }
        String detail = Api.describe(a, true) + "\nTier " + a.optInt("tier")
                + (a.optBoolean("tainted") ? "\nWarning: this task read untrusted content." : "");
        BiometricPrompt prompt = new BiometricPrompt.Builder(this)
                .setTitle("Approve once?")
                .setSubtitle(a.optString("agent", "Helper") + " is waiting on you")
                .setDescription(detail.length() > 900 ? detail.substring(0, 900) + "…" : detail)
                .setAllowedAuthenticators(auth)
                .setConfirmationRequired(true)
                .build();
        prompt.authenticate(new CancellationSignal(), getMainExecutor(), new BiometricPrompt.AuthenticationCallback() {
            @Override
            public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                onOk.run();
            }

            @Override
            public void onAuthenticationError(int code, CharSequence msg) {
                refreshPage(); // cancelled: nothing approved, the card stays as it was
            }
        });
    }

    private void refreshPage() {
        if (web != null) web.evaluateJavascript("window.helperRefresh && helperRefresh()", null);
    }

    final class Bridge {
        @JavascriptInterface
        public boolean isApp() {
            return true;
        }

        @JavascriptInterface
        public void approve(String id) {
            if (id == null || !id.matches("[A-Za-z0-9_\\-]{4,40}")) return;
            main.post(() -> approveWithCheck(id));
        }
    }
}
