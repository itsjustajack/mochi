"""Reminders and Calm mode: built to work on a bad-brain day.

Reminders
- Each one carries a tiny first step ("Find the number", not "Sort out the phone bill").
- Snooze choices: 1 hour, tonight, tomorrow, or "when I'm at the PC".
- A missed reminder moves quietly to tomorrow. No red counters, no "overdue" pile, no guilt.

Calm mode
- "Just one thing": the single easiest next step. Done it? The next one shows.
- "Too much": only the top 3 show, and non-urgent nudges pause until Jack says so.
- Quiet hours: no nudges at night unless something is due today.
- Same time, same layout: the readout time is fixed in settings and the layout never changes.
- Quests (Pip's XP for admin) are off unless Jack turns them on.
"""

from __future__ import annotations

import datetime as dt
import json
import secrets
import threading
import time
from pathlib import Path

_lock = threading.Lock()
SNOOZES = ("1h", "tonight", "tomorrow", "at_pc")


def _hm(text: str, default: str) -> dt.time:
    try:
        h, m = str(text or default).split(":")
        return dt.time(int(h) % 24, int(m) % 60)
    except ValueError:
        h, m = default.split(":")
        return dt.time(int(h), int(m))


class _Json:
    def __init__(self, path: Path, empty):
        self.path = Path(path)
        self.empty = empty

    def load(self):
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except (FileNotFoundError, ValueError):
            return self.empty()

    def save(self, data) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_name(self.path.name + ".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        tmp.replace(self.path)


class Calm:
    DEFAULTS = {"too_much": False, "quiet_start": "22:00", "quiet_end": "08:00", "readout": "07:00",
                "quests": False, "xp": 0}

    def __init__(self, state_dir: Path):
        self.file = _Json(Path(state_dir) / "calm.json", dict)

    def get(self) -> dict:
        return {**self.DEFAULTS, **self.file.load()}

    def set(self, **changes) -> dict:
        allowed = {"too_much": bool, "quiet_start": str, "quiet_end": str, "readout": str, "quests": bool}
        with _lock:
            data = self.get()
            for k, v in changes.items():
                if k not in allowed:
                    raise ValueError(f"unknown Calm setting: {k}")
                if allowed[k] is str:
                    t = _hm(v, "00:00")
                    v = f"{t.hour:02d}:{t.minute:02d}"
                data[k] = allowed[k](v)
            self.file.save(data)
        return data

    def add_xp(self, n: int) -> int:
        with _lock:
            data = self.get()
            if not data["quests"]:
                return data["xp"]
            data["xp"] = int(data["xp"]) + n
            self.file.save(data)
            return data["xp"]

    def quiet_now(self, now: dt.datetime | None = None) -> bool:
        c = self.get()
        t = (now or dt.datetime.now()).time()
        a, b = _hm(c["quiet_start"], "22:00"), _hm(c["quiet_end"], "08:00")
        return (a <= t or t < b) if a > b else (a <= t < b)


class Reminders:
    def __init__(self, state_dir: Path):
        self.file = _Json(Path(state_dir) / "reminders.json", list)

    def _find(self, rows, rid):
        r = next((r for r in rows if r["id"] == rid), None)
        if r is None:
            raise KeyError("no such reminder")
        return r

    def add(self, text: str, first_step: str = "", due: float | None = None, source: str = "you",
            urgent: bool = False) -> dict:
        from helper.capture import first_step as guess
        text = text.strip()[:300]
        if not text:
            raise ValueError("the reminder is empty")
        row = {"id": secrets.token_hex(5), "text": text, "first_step": (first_step or guess(text))[:120],
               "due": due, "snoozed_until": None, "at_pc": False, "urgent": bool(urgent), "status": "open",
               "created": time.time(), "source": source}
        with _lock:
            rows = self.file.load()
            rows.append(row)
            self.file.save(rows[-1000:])
        return row

    def list(self, status: str = "open") -> list[dict]:
        return [r for r in self.file.load() if not status or r["status"] == status]

    def done(self, rid: str) -> dict:
        with _lock:
            rows = self.file.load()
            r = self._find(rows, rid)
            r["status"], r["done_at"] = "done", time.time()
            self.file.save(rows)
        return r

    def drop(self, rid: str) -> dict:
        with _lock:
            rows = self.file.load()
            r = self._find(rows, rid)
            r["status"] = "dropped"
            self.file.save(rows)
        return r

    def snooze(self, rid: str, choice: str, now: dt.datetime | None = None) -> dict:
        if choice not in SNOOZES:
            raise ValueError("snooze is 1h, tonight, tomorrow or at_pc")
        now = now or dt.datetime.now()
        with _lock:
            rows = self.file.load()
            r = self._find(rows, rid)
            if choice == "at_pc":
                r["at_pc"], r["snoozed_until"] = True, None
            else:
                when = {"1h": now + dt.timedelta(hours=1),
                        "tonight": now.replace(hour=19, minute=0, second=0, microsecond=0),
                        "tomorrow": (now + dt.timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)}[choice]
                if when <= now:
                    when = now + dt.timedelta(hours=1)
                r["snoozed_until"], r["at_pc"] = when.timestamp(), False
            self.file.save(rows)
        return r

    def roll_missed(self, now: dt.datetime | None = None) -> int:
        """Anything due before today moves quietly to tomorrow morning. Returns how many moved."""
        now = now or dt.datetime.now()
        start = now.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
        tomorrow = (now + dt.timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0).timestamp()
        moved = 0
        with _lock:
            rows = self.file.load()
            for r in rows:
                if r["status"] == "open" and r.get("due") and r["due"] < start:
                    r["due"] = tomorrow
                    moved += 1
            if moved:
                self.file.save(rows)
        return moved

    def showing(self, now: dt.datetime | None = None, at_pc: bool = False) -> list[dict]:
        """Open reminders that should show now: not snoozed, due today or with no date, urgent first."""
        now = now or dt.datetime.now()
        end_today = now.replace(hour=23, minute=59, second=59).timestamp()
        out = []
        for r in self.list("open"):
            if r.get("snoozed_until") and r["snoozed_until"] > now.timestamp():
                continue
            if r.get("at_pc") and not at_pc:
                continue
            if r.get("due") and r["due"] > end_today:
                continue
            out.append(r)
        return sorted(out, key=lambda r: (not r.get("urgent"), r.get("due") or 1e12, r["created"]))


def needs_you(reminders: Reminders, calm: Calm, approvals: list, capture_new: int,
              now: dt.datetime | None = None, at_pc: bool = False) -> dict:
    """What the home screen and the widget show. With Too much on, only the top 3."""
    items = []
    for a in approvals:
        items.append({"kind": "ok", "id": a["id"], "text": f"{a['agent']} wants to: {a.get('job') or a['tool']}",
                      "first_step": "Look at the card", "urgent": True})
    for r in reminders.showing(now, at_pc):
        items.append({"kind": "reminder", "id": r["id"], "text": r["text"], "first_step": r["first_step"],
                      "urgent": bool(r.get("urgent"))})
    if capture_new:
        items.append({"kind": "capture", "id": "", "text": f"Sort {capture_new} brain dump note{'s' * (capture_new > 1)}",
                      "first_step": "Tick the real tasks", "urgent": False})
    c = calm.get()
    held = 0
    if c["too_much"]:
        held = max(0, len(items) - 3)
        items = items[:3]
    return {"items": items, "held": held, "too_much": c["too_much"], "quiet": calm.quiet_now(now)}


def one_thing(view: dict) -> dict | None:
    """The single easiest next step: an OK card first (it unblocks an agent), then the first reminder."""
    items = view["items"]
    return items[0] if items else None
