# Script Builder for Janitor AI

Make Janitor AI Advanced scripts without writing code. Pick the kind of bot, switch on what you want, and copy one ready-to-paste script. It works fully offline: no API, no account, and nothing you type leaves your device.

## Get it

| Where | How |
| --- | --- |
| **Android phone** | Open the [Script Builder release page](https://github.com/itsjustajack/mochi/releases/tag/script-builder-latest), tap **ScriptBuilder.apk**, open it, and allow installing from your browser if asked. A newer build installs over the old one and keeps your projects. |
| **Computer** | Download **janitor-script-builder.html** from the same page and open it in any browser. |

The Android app has no internet permission at all. Links such as janitorai.com open in your normal browser.

## Make a script in four steps

The app opens on **Quick start**:

1. **What kind of bot is it?** Friend or companion, Romance, Adventure / RPG, Horror, Mystery, Fantasy world, Group of characters, or Start empty. Each one is a working example.
2. **Name it.** Character name, script name and your time zone (one tap uses your phone's).
3. **Choose what it can do.** Plain switches like "Remembers you", "Keeps score" and "Better writing". "Edit" opens the details, but the defaults already work.
4. **Copy it into Janitor.** Copy, test in the built-in chat, save or share, then follow the four install steps shown.

**Simple mode** (the default) shows only the features you switched on, the test chat and the guide. Tap **Simple** at the top to switch to **Full** mode with every tool. On a phone, the ☰ button opens the menu and the back button steps back.

## What's new in version 2

| Feature | What it does |
| --- | --- |
| **Keeps score** (Stat Tracker) | HP, gold, days, torches: the bot ends each reply with a status line and the script reads it back next time, so numbers last between replies. Your own messages are never read for numbers, so typing "HP: 999" doesn't cheat. Rules can check stats. |
| **Real dice** | Write `<<1d20>>` or `<<2d6+3>>` in the card and it becomes a fresh roll every reply, or hand the bot a pool of pre-rolled dice to use in order. |
| **Better writing** (anti-slop) | Rotates worn-out phrases ("a shiver ran down", "barely above a whisper") into an avoid list, and names any the bot just used. |
| **Slop check** | Paste a card or some replies to find clichés and over-used words. |
| **Foreshadowing** | Quiet hints from one point in the story, then a payoff at another. |
| **Story Spine helper** | Seven lines ("Once upon a time… Until one day… Because of that…") become story phases where each part follows from the last. |
| **Recap nudges** | Every N messages the bot writes a short recap, so long chats keep their early events. |
| **Word forms** | A lore key like "goblin" also fires on "goblins", "city" on "cities". |
| **Obsidian notes** | Paste Markdown notes with `keys:` or `aliases:` front matter and they become lorebook entries. |
| **Sharper script checker** | Also flags `indexOf("word")` matching inside longer words, empty `catch` blocks and loose `==`. |
| **Open with Script Builder** | On Android, open or share a character card (PNG/JSON), lorebook or script into the app to import it. |
| **New starters** | Everyday companion, Dungeon crawl (RPG) and Mystery. |

Everything from version 1 is still there: time and seasons, memory, emotions with negation, states, meters, ensemble cast, a full Janitor-style lorebook, pacing, random events, ambient details, combined rules, import and export of almost any card or lorebook format, the analyzer, tester and fuzzer, the chat simulator, the ES5 checker and fixer, and card blocks.

## Installing a script on Janitor AI

1. Open janitorai.com/scripts, tap **Create**, then **Advanced**.
2. Delete the example code, paste your script, and save.
3. Tap **Assign to your Characters** and pick your bot. The script does nothing until it is assigned.
4. Open a **Test Chat**, tap **Show Debug Panel**, send a message and look at the **Changes** tab.

## Credits

Version 2 adapts ideas, not code, from these projects and guides: [janitor-ai-eval](https://github.com/neolaw84/janitor-ai-eval) (state read back from the chat, dice placeholders, periodic memory summaries), [Tydorius's JanitorAI script templates](https://github.com/Tydorius) (persistent flags, anti-omniscience, drop-in characters), [anti-slop](https://github.com/dmmulroy/anti-slop) (flagging low-signal patterns), [Show Me The Story](https://github.com/Nigh/show-me-the-story) (foreshadowing and continuity), [Writers Room Story Engine](https://github.com/jackterror/writers-room-story-engine) (Story Spine and "therefore / but" causality), [DeepLore](https://github.com/pixelnull/sillytavern-DeepLore) (lore that fires without the exact word, Obsidian vaults), the [JanitorAI Scripts guidebook](https://fcgod.github.io/JanitorAI-Scripts-Centralized-Repository/GuideBookSite/book/print.html) and the [Lorebook Compendium](https://aceeenvw.github.io/lorebook-compendium/). Version 1 was built from the MellowFlloww v0.2.7 module set, the Icehellionx script patterns, the MythOS Studio ensemble ideas and the Chatbot Creation Guide templates.

## For developers

```
script-builder/
  src/runtime.es5.js   the engine that ends up inside every script (strict ES5)
  src/generator.js     project -> script compiler, defaults and the analyzer
  src/presets.js       the starter projects
  src/checker.js       ES5 checker and fixer
  src/io.js            import and export formats
  src/tester.js        sandbox runner
  src/app-*.js, style.css, body.html   the interface (app-easy.js = Quick start, Slop check, Simple mode)
  tests/run.js, tests/io.js            test suites
  android/             the Android app: a WebView around the built page
```

```
npm ci
node tests/run.js     # 18,000+ checks: strict ES5 parse, fuzzing, every module and preset, the checker
node tests/io.js      # import/export round trips
node build.js         # dist/janitor-script-builder.html, one offline file
```

The GitHub Actions workflow `.github/workflows/script-builder.yml` runs the tests, builds the page, copies it to `android/app/src/main/assets/index.html`, builds a signed APK and publishes both files to the `script-builder-latest` release. The APK signing key is never committed. Put a keystore (base64) in the repository secret `SB_KEYSTORE_B64` and its password in `SB_KEY_PASSWORD` (alias `scriptbuilder`) so every build installs over the last one. Without them, each build uses a throwaway key.
