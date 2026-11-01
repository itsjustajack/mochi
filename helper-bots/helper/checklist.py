"""Per-agent checklists: every job an agent can do is a row set to Do, Ask me or Never.

Jack's rule (1 Nov 2026): no locked hard limits. Every permission is a tick box he controls, per agent.
- New rows start from a safe default: reading is Do, anything that changes things is Ask me.
- Only Jack changes rows: the Settings screen (PC or paired phone), the "Always" button on an OK card,
  or his own message ("Inbox, from now on archive newsletters"). Email, web pages, files and the model
  can never change a row, because none of those code paths call `set`.
- Every change can be undone. Presets (Careful, Normal, Hands-off) set all of one agent's rows at once.
- "Not sure? Stop" (on by default, per agent): if a task has read untrusted text (an email, a web page)
  even Do rows pause and ask, because that text might be trying to steer the agent.
- Stop all and the Done-for-you log with Undo always work, whatever the rows say.

The file lives in the state folder, which no agent tool can reach.
"""

from __future__ import annotations

import json
import re
import secrets
import threading
import time
from pathlib import Path

CHOICES = ("do", "ask", "never")
CHOICE_WORDS = {"do": "Do", "ask": "Ask me", "never": "Never"}
PRESETS = ("careful", "normal", "handsoff")

# Plain words for each job, and the words Jack might use for it in a message.
JOBS: dict[str, tuple[str, tuple[str, ...]]] = {
    "list_folder": ("Look inside folders", ("list folders", "look in folders", "list files")),
    "read_file": ("Read files", ("read files", "reading files", "open files")),
    "write_file": ("Write and save files", ("write files", "save files", "writing files", "edit files")),
    "move_file": ("Move or rename files", ("move files", "rename files", "moving files", "tidy files")),
    "delete_file": ("Delete files (to the trash)", ("delete files", "deleting files", "bin files")),
    "roll_dice": ("Roll dice", ("roll dice", "dice")),
    "check_code": ("Check code", ("check code", "checking code")),
    "ledger_search": ("Search the Guild Ledger", ("search the ledger", "look in the ledger")),
    "ledger_propose": ("Add draft Ledger cards", ("add ledger cards", "add to the ledger", "draft ledger")),
    "knowledge_search": ("Search your Drive notes", ("search drive", "search my notes")),
    "knowledge_read": ("Read your Drive notes", ("read drive", "read my notes")),
    "private_search": ("Search your private records", ("search private", "look up my records")),
    "private_propose": ("Add draft private records", ("add private records", "save records", "add records")),
    "gmail_search": ("Read and sort email", ("read email", "read my email", "sort email", "check email")),
    "gmail_read": ("Open an email", ("open email", "open emails")),
    "gmail_draft": ("Write email drafts", ("write drafts", "draft replies", "draft emails")),
    "gmail_send": ("Send email", ("send email", "send emails", "send replies", "sending email", "reply")),
    "gmail_archive": ("Archive email", ("archive", "archive email", "archive newsletters", "archiving")),
    "gmail_label": ("Label email", ("label email", "label emails", "labelling", "labeling")),
    "gmail_trash": ("Move email to the bin", ("delete email", "bin email", "trash email", "delete emails")),
    "gmail_unsubscribe": ("Unsubscribe from lists", ("unsubscribe", "unsubscribing")),
    "trello_boards": ("Read Trello", ("read trello", "look at trello", "check trello")),
    "trello_add_card": ("Add Trello cards", ("add trello cards", "add to trello", "trello cards", "add cards")),
    "remind": ("Set reminders", ("set reminders", "remind me", "reminders")),
}

_lock = threading.Lock()


def label(tool: str) -> str:
    return JOBS.get(tool, (tool.replace("_", " ").capitalize(), ()))[0]


def default_choice(agent, tool: str, tier: int, policy) -> str:
    """What a row is before Jack has touched it. Reading is Do; changing things is Ask me."""
    if tool in getattr(agent, "ask_always", set()):
        return "ask"
    if tier <= 1:
        return "do"
    if tier == 2 and tool in getattr(policy, "auto_allow", set()):
        return "do"
    return "ask"


def preset_choice(name: str, tier: int) -> str:
    if name == "careful":
        return "do" if tier == 0 else "ask"
    if name == "normal":
        return "do" if tier <= 1 else "ask"
    if name == "handsoff":
        return "do" if tier <= 2 else "ask"
    raise ValueError("preset must be careful, normal or handsoff")


class Checklists:
    def __init__(self, path: Path, policy):
        self.path = Path(path)
        self.policy = policy

    # ------------------------------------------------------------ storage

    def _load(self) -> dict:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (FileNotFoundError, ValueError):
            data = {}
        data.setdefault("agents", {})
        data.setdefault("history", [])
        return data

    def _save(self, data: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        data["history"] = data["history"][-300:]
        tmp = self.path.with_name(self.path.name + ".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(self.path)

    # ------------------------------------------------------------ reading

    def _tier(self, tool: str) -> int:
        t = self.policy.tier(tool)
        return 3 if t is None else t

    def choice(self, agent, tool: str, tier: int | None = None) -> str:
        tier = self._tier(tool) if tier is None else tier
        row = self._load()["agents"].get(agent.key, {}).get("rows", {}).get(tool)
        return row if row in CHOICES else default_choice(agent, tool, tier, self.policy)

    def not_sure_stop(self, agent) -> bool:
        return bool(self._load()["agents"].get(agent.key, {}).get("not_sure_stop", True))

    def rows(self, agent) -> list[dict]:
        data = self._load()["agents"].get(agent.key, {}).get("rows", {})
        out = []
        for tool in agent.tools:
            tier = self._tier(tool)
            default = default_choice(agent, tool, tier, self.policy)
            set_ = data.get(tool)
            out.append({"job": tool, "label": label(tool), "tier": tier,
                        "choice": set_ if set_ in CHOICES else default, "default": default,
                        "changed": set_ in CHOICES})
        return out

    def summary(self, agent) -> dict:
        counts = {c: 0 for c in CHOICES}
        for r in self.rows(agent):
            counts[r["choice"]] += 1
        text = ", ".join(f"{n} {CHOICE_WORDS[c].lower()}" for c, n in counts.items() if n)
        return {"agent": agent.key, "name": agent.name, "counts": counts, "text": text,
                "not_sure_stop": self.not_sure_stop(agent)}

    def history(self, n: int = 50) -> list[dict]:
        return self._load()["history"][-n:]

    # ------------------------------------------------------------ changing (Jack only)

    def _change(self, data: dict, agent_key: str, rows: dict, by: str, why: str, not_sure=None) -> dict:
        a = data["agents"].setdefault(agent_key, {"rows": {}, "not_sure_stop": True})
        a.setdefault("rows", {})
        before = {k: a["rows"].get(k) for k in rows}
        for k, v in rows.items():
            if v is None:
                a["rows"].pop(k, None)
            else:
                a["rows"][k] = v
        entry = {"id": secrets.token_hex(5), "ts": time.time(), "agent": agent_key, "before": before,
                 "after": dict(rows), "by": by, "why": why}
        if not_sure is not None:
            entry["not_sure_before"] = a.get("not_sure_stop", True)
            entry["not_sure_after"] = bool(not_sure)
            a["not_sure_stop"] = bool(not_sure)
        data["history"].append(entry)
        return entry

    def set(self, agent, tool: str, choice: str, by: str, why: str = "") -> dict:
        if choice not in CHOICES:
            raise ValueError("choice must be do, ask or never")
        if tool not in agent.tools:
            raise ValueError(f"{agent.name} doesn't have the job {tool}")
        with _lock:
            data = self._load()
            entry = self._change(data, agent.key, {tool: choice}, by, why or f"{label(tool)}: {CHOICE_WORDS[choice]}")
            self._save(data)
        return entry

    def set_not_sure(self, agent, on: bool, by: str) -> dict:
        with _lock:
            data = self._load()
            entry = self._change(data, agent.key, {}, by, f"Not sure? Stop: {'on' if on else 'off'}", not_sure=on)
            self._save(data)
        return entry

    def preset(self, agent, name: str, by: str) -> dict:
        rows = {t: preset_choice(name, self._tier(t)) for t in agent.tools}
        with _lock:
            data = self._load()
            entry = self._change(data, agent.key, rows, by, f"Preset: {name}")
            self._save(data)
        return entry

    def undo(self, change_id: str, by: str) -> dict | None:
        with _lock:
            data = self._load()
            old = next((h for h in data["history"] if h["id"] == change_id), None)
            if old is None or old.get("undone"):
                return None
            entry = self._change(data, old["agent"], dict(old["before"]), by, "Undo: " + old.get("why", ""),
                                 not_sure=old.get("not_sure_before"))
            old["undone"] = True
            self._save(data)
        return entry


# ---------------------------------------------------------------- "from now on..." in Jack's own message

_DO = re.compile(r"\b(always|go ahead and|just|you can|feel free to|don'?t ask (?:me )?(?:before|to|about)?|no need to ask)\b", re.I)
_NEVER = re.compile(r"\b(never|stop|don'?t|do not|no more)\b", re.I)
_ASK = re.compile(r"\b(ask me (?:first|before)|check with me|ask before|ask first)\b", re.I)
_STANDING = re.compile(r"\b(from now on|going forward|in future|from here on|any ?more|always|never|stop|no more|"
                       r"ask me (?:first|before)|no need to ask|don'?t ask)\b", re.I)


def parse_standing_order(text: str, agent) -> dict | None:
    """Turn Jack's own words into a row change, or None if this isn't one.

    Returns {"job", "choice"} when exactly one job and one choice are clear, or {"unclear": reason}
    when it looks like an order but can't be read safely (then Helper asks instead of guessing).
    """
    t = " " + re.sub(r"\s+", " ", text.lower()) + " "
    t = re.sub(r"\bnever ?mind\b", " ", t)
    if not _STANDING.search(t) or t.strip().endswith("?"):
        return None
    if not re.search(r"\b(from now on|going forward|in future)\b", t) and len(t) > 120:
        return None  # long messages are tasks, not standing orders, unless they say "from now on"
    jobs = set()
    for tool in agent.tools:
        words = JOBS.get(tool, ("", ()))[1]
        if any(re.search(r"\b" + re.escape(w) + r"\b", t) for w in words):
            jobs.add(tool)
    if not jobs:
        if re.search(r"\b(from now on|going forward)\b", t):
            return {"unclear": "I couldn't tell which job you meant."}
        return None
    if _ASK.search(t):
        choice = "ask"
    elif re.search(r"\bdon'?t ask\b|\bno need to ask\b", t):
        choice = "do"
    elif _NEVER.search(t):
        choice = "never"
    elif _DO.search(t) or re.search(r"\b(from now on|going forward)\b", t):
        choice = "do"
    else:
        return None
    if len(jobs) > 1:
        # "send email" also matches "reply"; prefer the longest matched phrase
        best = max(jobs, key=lambda j: max((len(w) for w in JOBS[j][1] if re.search(r"\b" + re.escape(w) + r"\b", t)), default=0))
        scores = sorted((max((len(w) for w in JOBS[j][1] if re.search(r"\b" + re.escape(w) + r"\b", t)), default=0)
                         for j in jobs), reverse=True)
        if scores[0] == scores[1]:
            return {"unclear": "That could mean more than one job: " + ", ".join(label(j) for j in sorted(jobs)) + "."}
        jobs = {best}
    return {"job": jobs.pop(), "choice": choice}


# ---------------------------------------------------------------- Done for you log (with Undo)

class DoneLog:
    """What agents did on their own (Do rows), newest last, with an Undo where one is possible."""

    def __init__(self, path: Path):
        self.path = Path(path)

    def _load(self) -> list[dict]:
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except (FileNotFoundError, ValueError):
            return []

    def _save(self, rows: list[dict]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_name(self.path.name + ".tmp")
        tmp.write_text(json.dumps(rows[-500:], ensure_ascii=False), encoding="utf-8")
        tmp.replace(self.path)

    def add(self, agent: str, tool: str, text: str, undo: dict | None) -> dict:
        row = {"id": secrets.token_hex(5), "ts": time.time(), "agent": agent, "tool": tool,
               "label": label(tool), "text": text[:300], "undo": undo, "undone": False}
        with _lock:
            rows = self._load()
            rows.append(row)
            self._save(rows)
        return row

    def list(self, n: int = 100) -> list[dict]:
        return [{k: v for k, v in r.items() if k != "undo"} | {"can_undo": bool(r.get("undo")) and not r["undone"]}
                for r in self._load()[-n:]]

    def take_undo(self, row_id: str) -> dict | None:
        with _lock:
            rows = self._load()
            row = next((r for r in rows if r["id"] == row_id), None)
            if row is None or row["undone"] or not row.get("undo"):
                return None
            row["undone"] = True
            self._save(rows)
            return row
