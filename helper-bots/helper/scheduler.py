"""Background jobs on the PC, once a minute: nothing here runs a model or a tool.

- Missed reminders move quietly to tomorrow.
- Encrypted phone notes saved to Drive (the capture folder) are picked up.
- The morning readout is built once a day at the readout time (Settings > Calm), same layout every
  day, and kept for the apps to show. If the PC was off at that time, it is built when it starts.
"""

from __future__ import annotations

import datetime as dt
import json
import threading
from pathlib import Path


class Scheduler:
    def __init__(self, home_root: Path, settings: dict, audit, clock=dt.datetime.now):
        self.home = Path(home_root)
        self.settings = settings
        self.audit = audit
        self.clock = clock
        self._stop = threading.Event()

    @property
    def state(self) -> Path:
        return self.home / "state"

    def readout_path(self) -> Path:
        return self.state / "readout.json"

    def latest_readout(self) -> dict | None:
        try:
            return json.loads(self.readout_path().read_text(encoding="utf-8"))
        except (FileNotFoundError, ValueError):
            return None

    def build_readout(self, messages=None) -> dict:
        from helper import accounts
        from helper.calm import Reminders
        rem = Reminders(self.state)
        r = accounts.morning_readout(self.home, rem.showing(self.clock()), self.clock(), messages=messages)
        self.state.mkdir(parents=True, exist_ok=True)
        self.readout_path().write_text(json.dumps(r, ensure_ascii=False), encoding="utf-8")
        self.audit.write("system", event="readout", piles=r["piles"])
        return r

    def tick(self) -> list[str]:
        from helper import crypto
        from helper.calm import Calm, Reminders, _hm
        from helper.capture import CaptureStore
        done = []
        if Reminders(self.state).roll_missed(self.clock()):
            done.append("reminders")
        folder = str(self.settings.get("capture", {}).get("folder", "") or "")
        if folder:
            found = CaptureStore(self.state).scan_folder(crypto.notes_key(self.home), Path(folder).expanduser())
            if found:
                done.append(f"notes:{len(found)}")
        now = self.clock()
        at = _hm(Calm(self.state).get()["readout"], "07:00")
        last = self.latest_readout()
        if now.time() >= at and (last is None or last.get("date") != now.strftime("%Y-%m-%d")):
            self.build_readout()
            done.append("readout")
        return done

    def run(self, every: float = 60.0) -> None:
        while not self._stop.wait(every):
            try:
                self.tick()
            except Exception as e:  # noqa: BLE001 - keep the loop alive; it's logged
                self.audit.write("system", event="scheduler_error", error=repr(e))

    def start(self) -> threading.Thread:
        t = threading.Thread(target=self.run, daemon=True, name="scheduler")
        t.start()
        return t

    def stop(self) -> None:
        self._stop.set()
