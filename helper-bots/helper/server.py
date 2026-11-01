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
                 status_fn=None, port: int = 8765):
        self.runner = runner
        self.agents = agents
        self.token = token
        self.settings = settings
        self.status_fn = status_fn or (lambda: {"ok": False, "message": "unknown"})
        self.port = port
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

    def handle(self, method: str, path: str, body: dict | None) -> tuple[int, dict]:
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
            if verdict not in ("approve", "deny", "stop"):
                return 400, {"error": "verdict must be approve, deny or stop"}
            a = gate.approvals.resolve(path.rsplit("/", 1)[1], verdict, by="ui:web")
            return (200, a.public()) if a else (404, {"error": "no pending approval with that id"})
        if method == "POST" and path == "/v1/stop":
            self.runner.stop_all(by="ui:web")
            return 200, {"stopped": True}
        if method == "POST" and path == "/v1/start":
            gate.kill.start()
            self.runner.audit.write("system", event="start", by="ui:web")
            return 200, {"stopped": False}
        if method == "GET" and path == "/v1/activity":
            return 200, {"events": self.runner.audit.tail(200)}
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
