"""helperd's local web app and API on 127.0.0.1:8765.

Security rules (learned from the Stub / Muse teardown):
- Every /v1 route needs the bearer token, including from 127.0.0.1. Compared in constant time.
- Only answers when the Host header is 127.0.0.1, localhost or [::1] (blocks DNS rebinding).
- No CORS headers at all, so other sites in the browser cannot read or call the API.
- Strict Content-Security-Policy, no inline scripts; bodies capped at 64 KB; 120 requests a minute.
- Approvals can only be granted here (Jack's click) or in the CLI (Jack's typing).
Standard library only, so it runs unchanged in Termux.
"""

from __future__ import annotations

import json
import mimetypes
import secrets
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from helper.loop import Runner, pick_agent

WEB = Path(__file__).parent / "web"
STATIC = {"/": "index.html", "/app.css": "app.css", "/app.js": "app.js", "/icon.svg": "icon.svg",
          "/manifest.webmanifest": "manifest.webmanifest"}
MAX_BODY = 64 * 1024
HEADERS = {
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
                               "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
}


class App:
    """Everything the HTTP handler needs, so tests can build one without a socket."""

    def __init__(self, runner: Runner, agents: dict, token: str, settings: dict,
                 status_fn=None, port: int = 8765, registry=None, link_cfg: dict | None = None):
        self.runner = runner
        self.agents = agents
        self.token = token
        self.settings = settings
        self.status_fn = status_fn or (lambda: {"ok": False, "message": "unknown"})
        self.port = port
        self.registry = registry  # Stub Link devices (helper.link.DeviceRegistry), PC-side admin only
        self.link_cfg = link_cfg or {}
        self._hits: deque[float] = deque()
        self._hits_lock = threading.Lock()
        self._model_status = {"ok": False, "message": "checking...", "checked": 0.0}

    def rate_ok(self) -> bool:
        now = time.time()
        with self._hits_lock:
            while self._hits and now - self._hits[0] > 60:
                self._hits.popleft()
            if len(self._hits) >= 120:
                return False
            self._hits.append(now)
            return True

    def model_status(self) -> dict:
        if time.time() - self._model_status["checked"] > 15:
            st = dict(self.status_fn())
            st["checked"] = time.time()
            self._model_status = st
        return {k: v for k, v in self._model_status.items() if k != "checked"}

    # ------------------------------------------------------------ API

    def handle(self, method: str, path: str, body: dict | None, by: str = "ui:pc") -> tuple[int, dict]:
        gate = self.runner.gate
        default = self.settings.get("general", {}).get("default_agent", "organizer")
        if method == "GET" and path == "/v1/status":
            return 200, {
                "model": self.model_status(),
                "stopped": gate.kill.stopped,
                "policy_ok": gate._integrity_ok(),
                "profile": self.settings.get("general", {}).get("profile", "home"),
                "pending": len(gate.approvals.pending()),
            }
        if method == "GET" and path == "/v1/agents":
            return 200, {"agents": [a.public() for a in self.agents.values()], "default": default}
        if method == "GET" and path == "/v1/tasks":
            ts = sorted(self.runner.tasks.values(), key=lambda t: t.started)
            return 200, {"tasks": [t.public() for t in ts[-100:]]}
        if method == "POST" and path == "/v1/tasks":
            goal = str((body or {}).get("goal", "")).strip()
            if not goal:
                return 400, {"error": "goal is empty"}
            agent_key = str((body or {}).get("agent") or "")
            agent, goal = pick_agent(goal, self.agents, agent_key or default)
            if agent is None:
                return 400, {"error": "no such agent"}
            if gate.kill.stopped:
                return 409, {"error": "All tasks are stopped. Press Start to allow new tasks."}
            task = self.runner.start(goal, agent)
            return 201, {"id": task.id, "agent": agent.key}
        if method == "GET" and path.startswith("/v1/tasks/"):
            t = self.runner.tasks.get(path.rsplit("/", 1)[1])
            return (200, t.public()) if t else (404, {"error": "no such task"})
        if method == "GET" and path == "/v1/approvals":
            return 200, {"approvals": [a.public() for a in gate.approvals.pending()]}
        if method == "POST" and path.startswith("/v1/approvals/"):
            verdict = str((body or {}).get("verdict", ""))
            if verdict not in ("approve", "always", "deny", "stop"):
                return 400, {"error": "verdict must be approve, always, deny or stop"}
            a = gate.approvals.resolve(path.rsplit("/", 1)[1], verdict, by=by)
            return (200, a.public()) if a else (404, {"error": "no pending approval with that id"})
        if method == "POST" and path == "/v1/stop":
            self.runner.stop_all(by=by)
            return 200, {"stopped": True}
        if method == "POST" and path == "/v1/start":
            gate.kill.start()
            self.runner.audit.write("system", event="start", by=by)
            return 200, {"stopped": False}
        if method == "POST" and path == "/v1/code/check":
            from helper import codecheck
            code = str((body or {}).get("code", ""))
            if not code.strip():
                return 400, {"error": "paste some code first"}
            try:
                return 200, codecheck.check(code, str((body or {}).get("language", "")),
                                            str((body or {}).get("filename", "")))
            except ValueError as e:
                return 400, {"error": str(e)}
        if path == "/v1/content":
            from helper import knowledge
            state = self.runner.home_root / "state"
            if method == "GET":
                return 200, knowledge.current_mode(state, self.runner.policy)
            if method == "POST":
                try:
                    res = knowledge.set_mode(state, self.runner.policy, str((body or {}).get("mode", "")))
                except ValueError as e:
                    return 400, {"error": str(e)}
                self.runner.audit.write("system", event="content_mode", mode=res["mode"], by=by)
                return 200, res
        if method == "GET" and path == "/v1/rules":
            from helper import knowledge
            pol = self.runner.policy
            return 200, {"rules": knowledge.rules_status(pol.rule_docs, self.runner.home_root / "state"),
                         "knowledge": [str(k) for k in pol.knowledge]}
        if path.startswith("/v1/checklists") or path.startswith("/v1/done"):
            return self.handle_checklists(method, path, body or {}, by=by)
        if path.split("/")[2] in ("today", "calm", "reminders", "capture"):
            return self.handle_today(method, path, body or {}, by)
        if path.startswith("/v1/ledger"):
            return self.handle_ledger(method, path, body or {})
        if path.startswith("/v1/private"):
            return self.handle_ledger(method, path.replace("/v1/private", "/v1/ledger", 1), body or {}, "private")
        if path.startswith("/v1/link"):
            return self.handle_link(method, path)
        if method == "GET" and path == "/v1/activity":
            return 200, {"events": self.runner.audit.tail(200)}
        return 404, {"error": "not found"}

    def handle_today(self, method: str, path: str, body: dict, by: str) -> tuple[int, dict]:
        """Needs you, Just one thing, Too much, quiet hours, reminders and the brain dump."""
        import datetime as dt
        from helper.calm import SNOOZES, Calm, Reminders, needs_you, one_thing
        from helper.capture import CaptureStore
        state = self.runner.home_root / "state"
        calm, rem, cap = Calm(state), Reminders(state), CaptureStore(state)
        parts = [p for p in path.split("/") if p]
        if method == "GET" and parts == ["v1", "today"]:
            rem.roll_missed()
            view = needs_you(rem, calm, [a.public() for a in self.runner.gate.approvals.pending()],
                             len(cap.list("new")), at_pc=by.startswith("ui:"))
            return 200, {**view, "one_thing": one_thing(view), "calm": calm.get()}
        if parts == ["v1", "calm"]:
            if method == "GET":
                return 200, calm.get()
            try:
                res = calm.set(**body)
            except (ValueError, TypeError) as e:
                return 400, {"error": str(e)}
            self.runner.audit.write("system", event="calm", changes=sorted(body), by=by)
            return 200, res
        if parts[1] == "reminders":
            if method == "GET" and len(parts) == 2:
                return 200, {"reminders": rem.list("open"), "snoozes": list(SNOOZES)}
            if method == "POST" and len(parts) == 2:
                due = body.get("due")
                try:
                    r = rem.add(str(body.get("text", "")), str(body.get("first_step", "")),
                                float(due) if due else None, source=by, urgent=bool(body.get("urgent")))
                except ValueError as e:
                    return 400, {"error": str(e)}
                return 201, r
            if method == "POST" and len(parts) == 4 and parts[3] in ("done", "drop", "snooze"):
                try:
                    if parts[3] == "done":
                        r = rem.done(parts[2])
                        calm.add_xp(10)
                    elif parts[3] == "drop":
                        r = rem.drop(parts[2])
                    else:
                        r = rem.snooze(parts[2], str(body.get("choice", "")), dt.datetime.now())
                except KeyError:
                    return 404, {"error": "no such reminder"}
                except ValueError as e:
                    return 400, {"error": str(e)}
                return 200, r
        if parts[1] == "capture":
            if method == "GET" and len(parts) == 2:
                return 200, {"notes": cap.list("new")}
            if method == "POST" and len(parts) == 2:
                try:
                    return 201, cap.add(str(body.get("text", "")), source=by)
                except ValueError as e:
                    return 400, {"error": str(e)}
            if method == "POST" and len(parts) == 4 and parts[3] == "sort":
                note = next((n for n in cap.list() if n["id"] == parts[2]), None)
                if note is None:
                    return 404, {"error": "no such note"}
                picked = body.get("keep", [])
                if not isinstance(picked, list) or not all(isinstance(i, int) for i in picked):
                    return 400, {"error": "keep must be a list of item numbers"}
                made = []
                for i in picked:
                    if 0 <= i < len(note["items"]):
                        it = note["items"][i]
                        made.append(rem.add(it["text"], it.get("first_step", ""), source="brain dump"))
                cap.mark(note["id"], "sorted")
                return 200, {"reminders": made}
        return 404, {"error": "not found"}

    def handle_checklists(self, method: str, path: str, body: dict, by: str) -> tuple[int, dict]:
        """Settings > Agents: Do / Ask me / Never rows, presets, Not sure? Stop, Undo, Done for you.
        Reached only with the PC key or a paired phone's key, so every change here is Jack's."""
        from helper import checklist, tools as toolmod
        gate = self.runner.gate
        cl, log = gate.checklists, gate.done_log
        parts = [p for p in path.split("/") if p]   # v1, checklists, ...
        if parts[1] == "done":
            if method == "GET" and len(parts) == 2:
                return 200, {"done": log.list()}
            if method == "POST" and len(parts) == 4 and parts[3] == "undo":
                row = log.take_undo(parts[2])
                if row is None:
                    return 404, {"error": "nothing to undo there"}
                agent = self.agents.get(row["agent"])
                ctx = toolmod.ToolContext(roots=agent.roots if agent else [], home=self.runner.home_root,
                                          trash=self.runner.home_root / "trash")
                try:
                    text = toolmod.run_undo(row["undo"], ctx)
                except Exception as e:  # noqa: BLE001 - shown to Jack
                    return 409, {"error": f"Couldn't undo: {e}"}
                self.runner.audit.write("system", event="undo", row=row["id"], tool=row["tool"], by=by)
                return 200, {"undone": row["id"], "text": text}
            return 404, {"error": "not found"}
        if method == "GET" and len(parts) == 2:
            return 200, {"agents": [cl.summary(a) for a in self.agents.values()], "presets": list(checklist.PRESETS),
                         "history": cl.history(30)}
        if method == "POST" and len(parts) == 4 and parts[2] == "undo":
            entry = cl.undo(parts[3], by=by)
            if entry is None:
                return 404, {"error": "nothing to undo there"}
            self.runner.audit.write("system", event="checklist_undo", change=parts[3], by=by)
            return 200, {"change": entry}
        agent = self.agents.get(parts[2]) if len(parts) == 3 else None
        if agent is None:
            return 404, {"error": "no such agent"}
        if method == "GET":
            return 200, {**cl.summary(agent), "rows": cl.rows(agent),
                         "history": [h for h in cl.history(100) if h["agent"] == agent.key][-20:]}
        if method == "POST":
            try:
                if "preset" in body:
                    entry = cl.preset(agent, str(body["preset"]), by=by)
                elif "not_sure_stop" in body:
                    entry = cl.set_not_sure(agent, bool(body["not_sure_stop"]), by=by)
                else:
                    entry = cl.set(agent, str(body.get("job", "")), str(body.get("choice", "")), by=by)
            except ValueError as e:
                return 400, {"error": str(e)}
            self.runner.audit.write("system", event="checklist_change", agent=agent.key, change=entry["id"],
                                    why=entry["why"], by=by)
            return 200, {"change": entry, "rows": cl.rows(agent)}
        return 404, {"error": "not found"}

    def handle_ledger(self, method: str, path: str, body: dict, section: str = "lore") -> tuple[int, dict]:
        """Guild Ledger panel (lore, or Jack's private records). Promote and retire here are Jack's own
        clicks, so they count as approval."""
        from helper.ledger import LedgerStore, report
        store = LedgerStore.for_home(self.runner.home_root, section)
        if method == "GET" and path == "/v1/ledger":
            led = store.load()
            return 200, {"section": section, "revision": led["revision"], "report": report(led, section),
                         "entries": led["entries"]}
        parts = path.split("/")
        if method == "POST" and len(parts) == 5 and parts[4] in ("promote", "retire"):
            eid = parts[3]
            if parts[4] == "promote":
                op = {"op": "promote", "id": eid}
                reason = f"Jack approved {eid}"
            else:
                why = str(body.get("reason", "")).strip()
                if not why:
                    return 400, {"error": "say why it's being retired"}
                op = {"op": "retire", "id": eid, "reason": why}
                if body.get("replaced_by"):
                    op["replaced_by"] = str(body["replaced_by"])
                reason = f"Jack retired {eid}: {why}"
            res = store.apply({"reason": reason, "ops": [op]}, approved=True)
            if "errors" in res:
                return 400, {"error": " ".join(res["errors"])}
            self.runner.audit.write("system", event=f"{section}_" + parts[4], entry=eid, by="ui:pc")
            return 200, {"revision": res["ledger"]["revision"], "notes": res["notes"]}
        return 404, {"error": "not found"}

    def handle_link(self, method: str, path: str) -> tuple[int, dict]:
        """Linked devices panel. Only reachable from this PC with the main key."""
        from helper.link import DEFAULT_PORT, qr_payload
        if self.registry is None:
            return 404, {"error": "Stub Link is not set up"}
        host = str(self.link_cfg.get("host", ""))
        port = int(self.link_cfg.get("port", DEFAULT_PORT))
        if method == "GET" and path == "/v1/link":
            p = self.registry.pairing()
            pairing = None
            if p:
                pairing = {"code": p["code"], "expires": p["expires"],
                           "qr": qr_payload(host, port, p["code"]) if host else None}
            return 200, {"enabled": bool(self.link_cfg.get("enabled")), "running": bool(self.link_cfg.get("running")),
                         "address": f"{host}:{port}" if host else None,
                         "devices": self.registry.public(), "pairing": pairing}
        if method == "POST" and path == "/v1/link/pair":
            p = self.registry.start_pairing()
            self.runner.audit.write("system", event="link_pair_started", by="ui:web")
            return 201, {"code": p["code"], "expires": p["expires"],
                         "qr": qr_payload(host, port, p["code"]) if host else None}
        if method == "POST" and path == "/v1/link/pair/cancel":
            self.registry.cancel_pairing()
            return 200, {"ok": True}
        if method == "POST" and path.startswith("/v1/link/devices/") and path.endswith("/remove"):
            dev_id = path.split("/")[4]
            if not self.registry.remove(dev_id):
                return 404, {"error": "no such device"}
            self.runner.audit.write("system", event="link_device_removed", device=dev_id, by="ui:web")
            return 200, {"removed": dev_id}
        return 404, {"error": "not found"}


def make_handler(app: App):
    allowed_hosts = {f"127.0.0.1:{app.port}", f"localhost:{app.port}", f"[::1]:{app.port}",
                     "127.0.0.1", "localhost", "[::1]"}

    class Handler(BaseHTTPRequestHandler):
        server_version = "helperd"
        sys_version = ""

        def log_message(self, fmt, *args):  # no request logs: URLs could carry text you typed
            pass

        def _send(self, code: int, payload: bytes, ctype: str) -> None:
            self.send_response(code)
            for k, v in HEADERS.items():
                self.send_header(k, v)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def _json(self, code: int, obj: dict) -> None:
            self._send(code, json.dumps(obj, ensure_ascii=False, default=str).encode(), "application/json")

        def _guard(self) -> bool:
            if self.headers.get("Host", "") not in allowed_hosts:
                self._json(421, {"error": "wrong host"})
                return False
            if not app.rate_ok():
                self._json(429, {"error": "too many requests"})
                return False
            return True

        def _authed(self) -> bool:
            auth = self.headers.get("Authorization", "")
            given = auth[7:] if auth.startswith("Bearer ") else ""
            if not given or not secrets.compare_digest(given.encode(), app.token.encode()):
                self._json(401, {"error": "missing or wrong key"})
                return False
            return True

        def do_GET(self):
            if not self._guard():
                return
            path = urlparse(self.path).path
            if path in STATIC:
                f = WEB / STATIC[path]
                ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
                if f.suffix == ".webmanifest":
                    ctype = "application/manifest+json"
                return self._send(200, f.read_bytes(), ctype + ("; charset=utf-8" if ctype.startswith("text") else ""))
            if not path.startswith("/v1/"):
                return self._json(404, {"error": "not found"})
            if self._authed():
                self._json(*app.handle("GET", path, None))

        def do_POST(self):
            if not self._guard():
                return
            path = urlparse(self.path).path
            if not path.startswith("/v1/") or not self._authed():
                if not path.startswith("/v1/"):
                    self._json(404, {"error": "not found"})
                return
            if "application/json" not in self.headers.get("Content-Type", ""):
                return self._json(415, {"error": "send JSON"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                return self._json(400, {"error": "bad length"})
            if length > MAX_BODY:
                return self._json(413, {"error": "body too large"})
            raw = self.rfile.read(length) if length else b"{}"
            try:
                body = json.loads(raw or b"{}")
                if not isinstance(body, dict):
                    raise ValueError
            except ValueError:
                return self._json(400, {"error": "body is not a JSON object"})
            self._json(*app.handle("POST", path, body))

        def do_PUT(self):
            self._json(405, {"error": "method not allowed"})

        do_DELETE = do_PATCH = do_OPTIONS = do_PUT

    return Handler


def serve(app: App, host: str = "127.0.0.1", port: int = 8765) -> ThreadingHTTPServer:
    if host not in ("127.0.0.1", "localhost", "::1"):
        raise ValueError("helperd's web app only listens on 127.0.0.1")
    httpd = ThreadingHTTPServer((host, port), make_handler(app))
    httpd.daemon_threads = True
    return httpd
