# Tests

`run-browser.js` loads the exact JavaScript the app injects into real Chromium, with a fake
bridge in place of the Android side, and checks matching, run timing, the GM_* APIs, and that
one broken script can't break another.

The injected code is produced by the app's own `UserScript` and `Injector` classes via
`java/BuildBlobs.java`, which needs the Android framework classes on the classpath (the
Robolectric `android-all` jar from Maven Central works) plus stub `androidx.webkit` and
`R`/`BuildConfig` classes to compile the app sources:

    java -cp android-all.jar:app-classes:. BuildBlobs app/src/main/assets/runtime.js tests/scripts tests/out
    node tests/run-browser.js
