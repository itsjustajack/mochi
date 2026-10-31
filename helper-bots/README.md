# Helper (v0.1, first working core)

Free, local helper bots for Jack's Windows PC and Android phone (Termux). The model is treated as
untrusted: it can only *propose* one tool call at a time, and a small permission gate in plain Python
decides whether that call runs, using policy files the bots cannot edit.

This first version is the core from build steps 1 to 3 of the design doc: model client, agent config,
the gate, the task loop, the audit log, a local web app with approval cards, and a CLI.
It uses the Python standard library only, so it installs the same way in Termux and on Windows.

## What works now

- **Permission gate** (`helper/gate.py`): every tool call goes through the same checks in order:
  known tool, valid arguments and folders, kill switch, policy integrity hash, rate limit,
  tier rule with taint and approval-fatigue rules, then an audit record before anything runs.
  Tier 3 always asks. There is no "always allow" button and no shell tool.
- **Policy you control** (`~/.helper/policy/`): `tiers.toml`, `allowlist.toml`, `content.toml`.
  Edit them by hand, then run `helper policy approve`. Until you do, every tier 2 and 3 action is refused.
- **Family-friendly rule locked in**: `content.toml` only accepts `adult_content = "never"`, and the rule
  is the first line of every agent's prompt. No setting, agent or task can remove it.
- **Agents you can customise** (`~/.helper/agents/<name>/agent.toml`): name, colour, emoji avatar, role,
  tools, folders, limits, model and temperature. Starter agents: Organizer, Notes, Storyteller (dice).
  Each layer can only narrow the one above (policy > settings.toml > agent.toml > task);
  anything capped is listed by `helper agents`.
- **Ollama client** (`helper/runtime.py`): talks to the one shared Ollama on `127.0.0.1:11434`
  with a JSON schema, so the model can only name tools it was offered. A model address that is not
  `127.0.0.1` is refused unless it has a key (never an open Ollama on Wi-Fi).
- **Untrusted text handling**: tool results are sanitised (ChatML tokens, role look-alikes, control
  characters) and wrapped in `<untrusted>` tags. Text that looks like an injection marks the task
  suspicious, after which even allowlisted changes need your OK. Three refusals in one task stop it.
- **Undo**: writes, moves and deletes keep a copy in `~/.helper/trash/`.
- **Web app** on `127.0.0.1:8765`: avatar rail, agent pill, chat bubbles, step lines, Draft cards with
  *Approve once / Discard / Stop task*, a Stop-all button, and a phone layout. Every API route needs the
  key, the Host header is checked, there is no CORS, and a strict Content-Security-Policy is set.

## Not in this version yet

Memory (SQLite), skills and the sandbox, the Helper.apk shell and home-screen widgets, Windows tray and
toasts, Settings screen, reminders, sync between devices, the Muse model route, the consistency-check
model call, and the eval set. These follow the build order in the design doc.

## Try it on the PC

```powershell
# Python 3.11 or newer, and Ollama already installed
ollama pull qwen3:8b
cd helper-bots
python -m helper init          # creates C:\BotWork\.helper (or ~/.helper) and approves the policy
python -m helper status        # checks the model and the policy
python -m helper ask "list what is in my work folder"
python -m helper serve         # then open the link it prints once
```

On the phone (Termux): `pkg install python`, then the same commands with `qwen3:4b` in
`~/.helper/settings.toml`. Files the bots may touch go in `~/.helper/work/`.

## Tests

```
python -m unittest discover -s tests -t .
```

The gate tests cover: tier 3 always asks, tainted tasks never get tier 2 off the allowlist, paths outside
the folders and symlink escapes are refused, the policy, settings, agents and key folders are refused
even if listed as allowed, edits to the policy block changes until re-approved, the kill switch, the rate
limit and approval fatigue. The loop tests include a model that tries to rewrite its own policy.
