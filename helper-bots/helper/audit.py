"""Append-only JSONL audit log: one line per model call, tool call, decision and result."""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path

KINDS = {"task_start", "model_call", "tool_call", "decision", "approval", "task_end", "system"}
_SECRET_KEYS = {"token", "api_key", "key", "password", "secret", "authorization"}


def _scrub(obj):
    if isinstance(obj, dict):
        return {k: ("***" if k.lower() in _SECRET_KEYS else _scrub(v)) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_scrub(v) for v in obj]
    return obj


class Audit:
    def __init__(self, logs_dir: Path):
        self.dir = Path(logs_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def path(self) -> Path:
        return self.dir / time.strftime("audit-%Y-%m.jsonl")

    def write(self, kind: str, **data) -> dict:
        if kind not in KINDS:
            raise ValueError(f"unknown audit kind {kind}")
        event = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "kind": kind, **_scrub(data)}
        line = json.dumps(event, ensure_ascii=False, default=str)
        with self._lock, open(self.path(), "a", encoding="utf-8") as f:
            f.write(line + "\n")
            f.flush()
        return event

    def tail(self, n: int = 200) -> list[dict]:
        p = self.path()
        if not p.exists():
            return []
        lines = p.read_text(encoding="utf-8").splitlines()[-n:]
        out = []
        for ln in lines:
            try:
                out.append(json.loads(ln))
            except json.JSONDecodeError:
                continue
        return out
