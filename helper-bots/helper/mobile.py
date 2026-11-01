"""Helper on the phone: the same engine as the PC, started inside the Android app.

The Android app carries this Python package (the same code as Helper.exe) and calls `start` once,
then `call` for every screen, exactly like the Windows app's screens call Engine.call. So the gate,
checklists, agents, Today, Inbox, Records and Settings are the same on both.

- The Helper folder lives in the app's private storage (Android encrypts it with the phone's lock).
- Sign-ins are kept in a 0600 file there (no Windows Credential Manager on a phone).
- No local API or Stub Link listener runs on the phone; nothing on the network can reach it.
- Links (Google or Trello sign-in) open in the phone's browser through `open_url`, set by the app.
"""

from __future__ import annotations

import json
import os
import threading
import webbrowser
from pathlib import Path

_engine = None
_lock = threading.Lock()
_open_url = None


class _PhoneBrowser(webbrowser.BaseBrowser):
    def open(self, url, new=0, autoraise=True):  # noqa: D401 - webbrowser API
        if _open_url is None:
            return False
        _open_url(url)
        return True


def set_open_url(fn) -> None:
    """The app passes a function that opens a link in the phone's browser."""
    global _open_url
    _open_url = fn
    webbrowser.register("helper-phone", None, _PhoneBrowser("helper-phone"), preferred=True)


def use_android() -> None:
    """Inside the Android app: links open through the app (com.itsjustajack.helper.Links)."""
    from java import jclass  # provided by the app's Python runtime
    links = jclass("com.itsjustajack.helper.Links")
    set_open_url(lambda url: links.open(url))


def start(home_dir: str) -> bool:
    """Starts the engine once (first start makes the Helper folder). Safe to call again."""
    global _engine
    with _lock:
        if _engine is not None:
            return False
        os.environ["HELPER_SECRETS_IN_FILES"] = "1"
        os.environ["HELPER_HOME"] = str(home_dir)
        from helper.config import Home
        from helper.desktop.engine import Engine
        from helper.scheduler import Scheduler
        _engine = Engine(Home(Path(home_dir)), start_servers=False)
        Scheduler(_engine.home.root, _engine.settings, _engine.audit).start()
        return _engine.first_run


def call(method: str, path: str, body_json: str | None = None) -> str:
    """One screen request. Returns JSON: {"code": 200, "body": {...}}."""
    if _engine is None:
        return json.dumps({"code": 503, "body": {"error": "Helper is still starting"}})
    try:
        body = json.loads(body_json) if body_json else None
    except ValueError:
        return json.dumps({"code": 400, "body": {"error": "bad request"}})
    code, res = _engine.call(method, path, body)
    return json.dumps({"code": code, "body": res}, default=str)


def stop() -> None:
    if _engine is not None:
        _engine.stop()
