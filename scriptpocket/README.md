# ScriptPocket

An Android browser with a userscript manager built in. It installs, edits, switches on and off,
and runs userscripts (the `.user.js` scripts you'd find on Greasy Fork or OpenUserJS), right on
your phone. No extension or desktop browser needed.

## Getting it on your phone

1. On your phone, open **https://github.com/itsjustajack/mochi/releases** and find
   **ScriptPocket (latest build)**.
2. Tap **ScriptPocket.apk** to download it, then open the download.
3. Android will ask whether your browser may install apps. Allow it, go back, and tap **Install**.
   (Play Protect may warn that it doesn't know the app. That's because it isn't from the Play
   Store. Tap "Install anyway".)

A new APK is built automatically every time the code in `scriptpocket/` changes. Installing a
newer one over the old one keeps your scripts and their saved data.

## Using it

- **Browse** with the address bar at the top. Type a web address or a search.
- **Install a script**: open any link that ends in `.user.js` (for example the green Install
  button on greasyfork.org) and the app asks whether to install it. You can also use
  ⋮ → *Install from a link*, open a `.user.js` file from your file manager, or share a link or
  script text to ScriptPocket.
- **My scripts** (the `</>` button): switch each script on or off, tap one to edit it, press
  and hold for *Check for update*, *Share code* and *Delete*. The switch at the top turns all
  scripts off at once. The menu there has *Back up all scripts* and *Restore a backup*.
- **Write your own**: ⋮ → *New script for this site* opens the editor with a starter script
  already set to run on the page you're looking at. Save with the ✓ button; the page reloads
  so you see the change straight away.
- **On this page** (in ⋮) lists the scripts that ran on the current page and any menu commands
  they added. **Script log** shows script errors and anything printed with `GM_log`.

## What scripts can use

Header lines: `@name`, `@namespace`, `@version`, `@description`, `@author`, `@match`,
`@include`, `@exclude`, `@exclude-match`, `@require`, `@resource`, `@run-at`
(`document-start`, `document-body`, `document-end`, `document-idle`), `@noframes`,
`@updateURL`, `@downloadURL`.

Functions: `GM_getValue`, `GM_setValue`, `GM_deleteValue`, `GM_listValues`,
`GM_addValueChangeListener`, `GM_removeValueChangeListener`, `GM_xmlhttpRequest`,
`GM_addStyle`, `GM_addElement`, `GM_registerMenuCommand`, `GM_unregisterMenuCommand`,
`GM_notification`, `GM_setClipboard`, `GM_openInTab`, `GM_log`, `GM_getResourceText`,
`GM_getResourceURL`, `GM_info`, `unsafeWindow`, and the promise versions under `GM.`
(`GM.getValue`, `GM.xmlHttpRequest`, and so on).

Every script gets all of these regardless of its `@grant` lines.

## Limits worth knowing

- It's one tab at a time. `GM_openInTab` opens the link in that same tab.
- `GM_download` opens the file link instead of saving it silently.
- Value change listeners only fire for changes made on the same page.
- Menu commands are collected from the main page, not from frames inside it.

## How it's built

- `app/src/main/assets/runtime.js` is the script engine. The app injects one copy per enabled
  script before the page's own code runs, so a broken script can't stop the others. The user's
  code runs in its own function and never sees the secret token that guards the app's bridge.
- `Bridge.java` is the Android side of the GM_* functions (storage, network, clipboard).
- `ScriptStore.java` keeps scripts as files inside the app; `Installer.java` downloads
  `@require` and `@resource` files when a script is saved.
- `.github/workflows/scriptpocket.yml` builds and signs the APK on GitHub and publishes it to
  the release page.

To build it on a computer instead: install Android Studio, open the `scriptpocket` folder, and
press Run, or run `gradle assembleRelease` with Gradle 8.9 or newer.

The signing key (`app/scriptpocket.keystore`, password `scriptpocket`) is in the repo on
purpose, so every build can update the last one. It's fine for an app you install yourself,
but don't reuse it for anything you publish to the Play Store.
