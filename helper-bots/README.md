# Helper (v0.2)

Free, local helper bots for Jack's Windows PC and Android phone. The model (Qwen in Ollama, free)
is treated as untrusted: it can only *propose* one tool call at a time, and a permission gate in
plain Python decides whether that call runs, using Jack's own settings, which the bots can't edit.

- **Windows:** `Helper.exe`, a real desktop app with its own icon. No browser page.
- **Phone:** `Helper.apk`, the same app with the same engine and screens, working **on its own**:
  no PC, no Wi-Fi, nothing to set up in Termux. Linking it to the PC is optional (Tailscale).
- Standard library Python only. No paid AI, no hosting, no update server: you update by replacing
  the file (`Helper.exe`, or installing the new `Helper.apk` over the old one).

## Get the apps

Every push builds both. Open the repo's **Actions** tab, pick the newest "Helper" run, and download
**Helper-windows** (`Helper.exe`) and **Helper-phone** (`Helper.apk`) from *Artifacts* at the bottom.
There is no GitHub release page any more.

- **Windows:** put `Helper.exe` anywhere and open it. The first start makes `C:\BotWork\.helper`
  with the default policy and agents. Install [Ollama](https://ollama.com) and run
  `ollama pull qwen3:8b` once. To update, close Helper and replace `Helper.exe`; your settings stay.
- **Phone:** install `Helper.apk` (switch Auto Blocker off just for the install) and open it. That's
  all: it runs by itself. Installing a newer APK over the old one keeps everything.

**Signing key (once).** So each new APK installs over the last one, it's signed with your own key,
kept as a GitHub secret and never in the repo:

```
keytool -genkeypair -keystore helper.keystore -alias helper -keyalg RSA -keysize 3072 -validity 10000 -dname "CN=Helper"
base64 -w0 helper.keystore     # PowerShell: [Convert]::ToBase64String([IO.File]::ReadAllBytes("helper.keystore"))
```

Add two repository secrets (Settings › Secrets and variables › Actions): `HELPER_KEYSTORE_B64` and
`HELPER_KEYSTORE_PASSWORD`. Keep `helper.keystore` safe.

## Your checklists: Do, Ask me or Never

Every job an agent can do is a row in **Settings › Agents**, set to **Do** (on its own), **Ask me**
or **Never**. Nothing is locked: sending email, deleting, making a Ledger card real, all of it is your
choice per agent.

- Rows you haven't touched start safe: reading is Do, anything that changes things is Ask me.
- **Presets** set a whole agent in one tap: Careful, Normal, Hands-off.
- **Always** on any OK card approves it and sets that job to Do for that agent.
- **"From now on…"**: type "Inbox, from now on archive newsletters" or "never delete files" and the
  row changes straight away, with Undo. Only your own typed message does this, never an email, a web
  page or the model.
- **Not sure? Stop** (on by default, per agent): after an agent reads an email or web page, even its
  Do jobs ask first, because that text could be trying to steer it.
- **Done for you**: everything agents did on their own, with **Undo** (files, email archive / label /
  bin, drafts, Trello cards, reminders).
- **Stop all** is on every screen, on the phone widget and in the quick-settings tile.
- The only fixed rules: no sexual content involving minors or anyone childlike, and none about real
  people. They hold in every mode.

## Today and Calm mode

Built to work on a bad-brain day.

- **Needs you**: OK cards and reminders, urgent first. **Just one thing** shows the single easiest
  next step. **Too much** shows only the top 3 and holds the rest (nothing is lost).
- **Reminders** each carry a tiny first step ("Find the number"). Snooze: 1 hour, tonight, tomorrow,
  or "when I'm at the PC". Missed ones move quietly to tomorrow: no red counters, no guilt.
- **Brain dump** (phone or PC): dump everything, then tick the real tasks; each becomes a reminder.
- **Quiet hours**, a fixed **morning readout** time, and Pip's quests and XP (off unless you turn
  them on), in Settings › Calm mode.

## Email, accounts and records

- **Gmail** (Settings › Accounts › Link): you sign in with Google in your own browser. It starts
  **read-only**: Inbox sorts mail into *Needs you, Waiting on others, Receipts, Newsletters* and
  *Scam?*, and writes the morning readout. *Allow changes* links again so agents can draft, archive,
  label, bin and send, each still a row on the checklist. Needs a free Google Cloud "Desktop app"
  OAuth client: console.cloud.google.com › APIs › enable Gmail API › Credentials › Create OAuth
  client ID › Desktop app; paste its ID and secret when Helper asks. Or `helper link gmail --client-id
  ID --client-secret SECRET`.
- **Trello**: get your key at trello.com/power-ups/admin, press Link, allow, paste the token.
- Sign-ins live in **Windows Credential Manager**. *Unlink* removes them at once.
- Email text is untrusted: agents never follow instructions in an email and never open its links.
  Unsubscribing only uses the list's own unsubscribe email, and never for anything Ward flagged.
- **Your records** (Records tab) are a private section of the Guild Ledger for real life: accounts,
  people, documents, routines. Kept apart from story lore, never shown to story agents, and a record
  that contains a password, PIN, code or card number is refused. Records say *where* a password lives
  ("in RoboForm"), never the password. RoboForm isn't linked: whether it allows linking is unchecked.

Agents: **Pip** (one thing at a time, plain-English letters, phone-call scripts), **Inbox** (email),
**Vault** (account map), **Ward** (scam and account checks, defensive only), **Quill** (Ledger and
records), plus Organizer, Notes, Storyteller, Jace (code check) and Deep Research.

## Phone notes are encrypted

A brain dump note is encrypted on the phone the moment you save it (ChaCha20-Poly1305 with a key the
PC gives the phone when it pairs). It goes to the PC over Stub Link, or, with no connection, waits on
the phone until you tap *Save to Drive* and pick a Drive folder. Set that folder as
`[capture] folder = "G:/My Drive/Helper/Capture"` in `settings.toml` and the PC picks notes up from
there. Drive only ever sees scrambled bytes.

## The phone on its own

The phone app is the same app as Helper.exe: it carries the same Python engine (helper/, run inside
the app by Chaquopy, free and open source) and has the same screens: the Guild avatars down the
left, then Today, Inbox, Records and Settings, with "Needs your OK" and Stop all at the top. It needs
no PC and no Wi-Fi. Everything is kept in the app's private storage.

- Chat needs a model. Free on-phone AI is next; until then the light at the top is red and chat
  answers that the model isn't ready, the same as the PC without Ollama.
- If Helper ever closes by itself, the next time it opens it shows what went wrong with a Copy button.
- Linking the PC is optional (Settings › Link to PC). While linked, the screens use the PC's Helper.

## Stub Link (phone to PC, optional)

Your phone and PC don't need the same Wi-Fi: put Tailscale (free) on both and use the PC's 100.x
address as the Phone link host.

Pairing uses a one-time code (works once, for 5 minutes, stops after 5 wrong tries). Each phone gets
its own key; the PC keeps only a hash. A paired phone can do what the PC app does (chat, OK cards,
Stop all, Settings, reminders, records) except pair or remove devices, which stay on the PC.
Approve and Always ask for your fingerprint or PIN first, and Settings opens with one.

Not yet: the QR code, TLS on the link (until then, use home Wi-Fi or Tailscale only), and Windows Hello
for the PC's Settings.

## Google Drive, rules and the content switch

1. Install **Google Drive for desktop** (free). Drive appears as a folder, for example `G:\My Drive`.
2. In `policy/allowlist.toml` list the folders agents may read, and the docs that are their rules:
   `knowledge = ["G:/My Drive/Helper"]` and `rule_docs = ["G:/My Drive/Helper/Guild_Prompt.txt"]`,
   then run `helper policy approve`.
3. Agents can search and read those folders, never write. What they learn is filed as a draft for your tap.
4. Rule docs are snapshotted when you approve. A doc that tells agents to drop their rules can't be one.
5. **Content** (Settings › Content & rules): Unfiltered 18+ turns itself back to Filtered after a while.
   Email and other outward agents always stay Filtered.

Google Docs show up in Drive for desktop as `.gdoc` shortcuts with no text. Save notes you want Helper
to read as `.txt` or `.md`.

## Skills

- **Code check** (Jace): finds problems in Python, Bash, JavaScript, Janitor ES5 scripts and JSON and
  explains them plainly. It never runs the code.
- **Deep research**: Jack's Deep Tactical Research Agent, v3.2 and v3.3 merged. Ask for a plan, say "go".
- **Guild Ledger** (Quill): the shared store, built to the rules of Jack's lore_tool.js.

## From the command line (optional)

```powershell
cd helper-bots
python -m helper.desktop          # the Windows app, from source
python -m helper init             # make the Helper folder without opening the app
python -m helper ask "list what is in my work folder"
python -m helper serve            # the engine without a window
python -m helper link gmail --client-id ID --client-secret SECRET
python -m helper stop             # Stop all, from a terminal
```

## Tests

```
python -m unittest discover -s tests -t .
```

They cover the gate (checklists, Never, Not sure? Stop, protected folders, symlink escapes, the kill
switch, policy integrity, rate limits, approval fatigue), "from now on" parsing, Undo, the private
records' password check, note encryption (RFC 8439 test vector), the phone link's routes, Gmail sorting
and scam signs with a fake Google, the scheduler, and the Windows app's engine.
