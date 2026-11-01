"""Everything the desktop app needs, started inside the app: no separate server to run.

- First start: makes the Helper folder (C:\\BotWork\\.helper) with the default policy and agents.
- The screens call `Engine.call(...)`, which goes through the same checks as every other route.
- The local API on 127.0.0.1 stays on for the `helper` command (stop, start, ask), with its key.
- Stub Link for the phone starts if it's turned on in Settings > Phone link.
"""

from __future__ import annotations

import threading
from pathlib import Path

from helper import __version__
from helper.audit import Audit
from helper.config import (Home, approve_policy, default_home, init_home, load_agents, load_policy,
                           load_settings, policy_is_approved, read_token)
from helper.gate import ApprovalQueue, Gate
from helper.loop import Runner
from helper.runtime import OllamaClient


class Engine:
    def __init__(self, home: Home | None = None, model=None, start_servers: bool = True):
        self.home = home or Home(default_home())
        self.first_run = not (self.home.root / "settings.toml").exists()
        if self.first_run:
            init_home(self.home)
            approve_policy(self.home)
        self.policy = load_policy(self.home)
        self.settings = load_settings(self.home)
        self.agents = load_agents(self.home, self.policy, self.settings)
        self.audit = Audit(self.home.logs_dir)
        self.gate = Gate(self.home, self.policy, self.audit, ApprovalQueue())
        self.model = model or OllamaClient.from_settings(self.settings.get("model", {}))
        self.runner = Runner(self.gate, self.model, self.audit, self.home.root, self.policy)
        from helper.link import DeviceRegistry
        from helper.server import App
        self.link_cfg = dict(self.settings.get("link", {}))
        self.registry = DeviceRegistry(self.home.state_dir / "link_devices.json")
        self.app = App(self.runner, self.agents, read_token(self.home), self.settings,
                       status_fn=getattr(self.model, "status", None),
                       port=int(self.settings.get("server", {}).get("port", 8765)),
                       registry=self.registry, link_cfg=self.link_cfg)
        self.notes: list[str] = []
        if start_servers:
            self._start_servers()

    @property
    def policy_ok(self) -> bool:
        return policy_is_approved(self.home, self.policy)

    def call(self, method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
        try:
            return self.app.handle(method, path, body or ({} if method == "POST" else None), by="ui:pc")
        except Exception as e:  # noqa: BLE001 - a screen should show the problem, not crash
            self.audit.write("system", event="ui_error", path=path, error=repr(e))
            return 500, {"error": f"{type(e).__name__}: {e}"}

    def _start_servers(self) -> None:
        from helper.scheduler import Scheduler
        from helper.server import serve
        Scheduler(self.home.root, self.settings, self.audit).start()
        try:
            httpd = serve(self.app, "127.0.0.1", self.app.port)
            threading.Thread(target=httpd.serve_forever, daemon=True, name="api").start()
        except OSError as e:
            self.notes.append(f"Local API is off ({e}). Is another Helper open?")
        if self.link_cfg.get("enabled"):
            from helper.link import DEFAULT_PORT, LinkApp, serve_link
            port = int(self.link_cfg.get("port", DEFAULT_PORT))
            try:
                lhttpd = serve_link(LinkApp(self.registry, self.runner, self.agents, self.settings, __version__,
                                            pc_app=self.app), str(self.link_cfg.get("host", "")), port)
            except (ValueError, OSError) as e:
                self.notes.append(f"Phone link is off: {e}")
            else:
                threading.Thread(target=lhttpd.serve_forever, daemon=True, name="link").start()
                self.link_cfg["running"] = True

    def set_link(self, enabled: bool, host: str) -> None:
        """Settings > Phone link: writes [link] in settings.toml (Jack's click). Takes effect on restart."""
        p = self.home.root / "settings.toml"
        text = p.read_text(encoding="utf-8")
        import re
        if host.strip() and not re.fullmatch(r"[0-9A-Za-z.\-:]{3,64}", host.strip()):
            raise ValueError("that isn't a Wi-Fi address")
        block = f'[link]\nenabled = {"true" if enabled else "false"}\nhost = "{host.strip()}"\nport = {int(self.link_cfg.get("port", 8766))}\n'
        if re.search(r"(?m)^\[link\]", text):
            text = re.sub(r"(?ms)^\[link\]\n.*?(?=^\[|\Z)", block, text)
        else:
            text += "\n" + block
        p.write_text(text, encoding="utf-8")
        self.link_cfg.update(enabled=enabled, host=host.strip())

    def stop(self) -> None:
        self.runner.stop_all(by="ui:pc (closing)")
