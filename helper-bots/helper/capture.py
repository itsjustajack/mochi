"""Brain dump: quick notes from the phone (or the PC), sorted into things Jack ticks.

- On the phone, a note is encrypted before it leaves the app (helper.crypto, the shared notes key).
  It goes to the PC over Stub Link, or, when the PC can't be reached, Jack saves the encrypted file
  to his Drive and the PC picks it up from the capture folder. Drive only ever sees scrambled bytes.
- The PC opens the note and keeps it in the state folder (no agent tool can reach it).
- Helper pulls out likely tasks with simple rules (no model needed, works offline). Jack ticks the
  real ones and each becomes a reminder with a tiny first step. Nothing is acted on from a note.
"""

from __future__ import annotations

import json
import re
import secrets
import shutil
import threading
import time
from pathlib import Path

from helper import crypto

_lock = threading.Lock()
MAX_NOTE = 20_000
_TASKY = re.compile(
    r"^(?:to ?do:?\s*|todo:?\s*|- \[ \]\s*)|"
    r"\b(need to|have to|got to|gotta|must|remember to|don'?t forget|should|call|ring|phone|email|text|reply|"
    r"book|pay|buy|order|send|post|cancel|renew|fix|clean|wash|pick up|drop off|sign|fill in|apply|check|"
    r"ask|tell|sort out|make|get|find|return|change)\b",
    re.I)
_FIRST_STEP = [
    (re.compile(r"\b(call|ring|phone)\b", re.I), "Find the number"),
    (re.compile(r"\b(email|reply|text)\b", re.I), "Open the message"),
    (re.compile(r"\b(pay|renew)\b", re.I), "Open the bill or the account page"),
    (re.compile(r"\b(book|apply)\b", re.I), "Open the booking page"),
    (re.compile(r"\b(buy|order)\b", re.I), "Add it to the shopping list"),
    (re.compile(r"\b(fill in|sign)\b", re.I), "Find the form"),
    (re.compile(r"\b(clean|wash|tidy)\b", re.I), "Do just 5 minutes"),
]


def first_step(text: str) -> str:
    for rx, step in _FIRST_STEP:
        if rx.search(text):
            return step
    return "Spend 2 minutes on it"


def split_items(text: str) -> list[dict]:
    """Messy text in, likely tasks out. Each has a tiny first step. Jack ticks the real ones."""
    parts = []
    for line in re.split(r"[\r\n]+", text):
        line = re.sub(r"^\s*(?:[-*•]|\d+[.)])\s*", "", line).strip()
        if not line:
            continue
        # long lines: split on sentence ends and "and then" / ";"
        for piece in re.split(r"(?<=[.!?;])\s+|\s+(?:and then|then also|also)\s+", line):
            piece = piece.strip(" .;")
            if 3 <= len(piece) <= 300:
                parts.append(piece)
    out = []
    for p in parts[:60]:
        kind = "task" if _TASKY.search(p) else "note"
        out.append({"text": p[0].upper() + p[1:], "kind": kind, "first_step": first_step(p) if kind == "task" else ""})
    return out


class CaptureStore:
    def __init__(self, state_dir: Path):
        self.path = Path(state_dir) / "capture.json"

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

    def add(self, text: str, source: str) -> dict:
        text = text.strip()[:MAX_NOTE]
        if not text:
            raise ValueError("the note is empty")
        row = {"id": secrets.token_hex(5), "ts": time.time(), "source": source, "text": text,
               "items": split_items(text), "status": "new"}
        with _lock:
            rows = self._load()
            rows.append(row)
            self._save(rows)
        return row

    def list(self, status: str = "") -> list[dict]:
        return [r for r in self._load() if not status or r["status"] == status]

    def mark(self, note_id: str, status: str) -> dict | None:
        with _lock:
            rows = self._load()
            row = next((r for r in rows if r["id"] == note_id), None)
            if row is None:
                return None
            row["status"] = status
            self._save(rows)
            return row

    def add_encrypted(self, key: bytes, blob: bytes, source: str) -> dict:
        return self.add(crypto.decrypt_note(key, blob), source)

    def scan_folder(self, key: bytes, folder: Path) -> list[dict]:
        """Pick up encrypted notes (.hln) Jack saved to Drive from the phone. Opened ones move to
        folder/imported so they are not read twice. Files that don't open are left alone."""
        found = []
        folder = Path(folder)
        if not folder.is_dir():
            return found
        done = folder / "imported"
        for f in sorted(folder.glob("*.hln")):
            try:
                if f.stat().st_size > 4 * MAX_NOTE:
                    continue
                row = self.add_encrypted(key, f.read_bytes(), "drive")
            except (OSError, ValueError, UnicodeDecodeError):
                continue
            done.mkdir(exist_ok=True)
            shutil.move(str(f), str(done / f.name))
            found.append(row)
        return found
