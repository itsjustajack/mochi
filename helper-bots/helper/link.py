"""Stub Link: the private connection between Jack's phone and the PC.

How it works
- Pairing: Jack presses "Link a new device" in the PC app. helperd shows a one-time code
  (and the same code as a QR payload). The phone sends the code once and gets back its own key.
  The code works once, for 5 minutes, and is cancelled after 5 wrong tries.
- A key per device: each device gets its own random key. Only a SHA-256 of it is kept on the PC,
  in the state folder that no tool can touch. Jack can remove a device at any time.
- What a linked device can do: everything the PC app does for Jack (jobs, OK cards, Stop all,
  Settings and checklists, reminders, Calm mode, records), through /v2/app/..., plus sending
  encrypted brain dump notes. The phone asks for Jack's fingerprint before it approves.
  It can never pair or remove devices or see keys: those stay on the PC.
- The link listener is off until Jack turns it on in settings.toml ([link] enabled = true) and gives
  the PC's home Wi-Fi address. It never listens on every address (0.0.0.0).

Standard library only, like the rest of helperd.
"""

from __future__ import annotations

import hashlib
import json
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, urlparse

from helper.loop import pick_agent

PAIR_TTL_S = 5 * 60
PAIR_MAX_TRIES = 5
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I: easy to read off a screen
MAX_DEVICES = 8
MAX_BODY = 16 * 1024
DEFAULT_PORT = 8766


def _hash(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


class DeviceRegistry:
    """Linked devices and the current pairing code, saved as JSON in the state folder."""

    def __init__(self, path: Path, clock=time.time):
        self.path = path
        self.clock = clock
        self._lock = threading.Lock()
        self._pairing: dict | None = None
        self.devices: dict[str, dict] = {}
        if path.exists():
            try:
                data = json.loads(path.read_text())
                self.devices = {d["id"]: d for d in data.get("devices", [])}
            except (ValueError, KeyError, TypeError):
                self.devices = {}

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"devices": list(self.devices.values())}, indent=2))
        tmp.replace(self.path)

    # ------------------------------------------------------------ pairing (PC side, Jack's click)

    def start_pairing(self) -> dict:
        with self._lock:
            code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(8))
            self._pairing = {"code": code, "expires": self.clock() + PAIR_TTL_S, "tries": 0}
            return {"code": code, "expires": self._pairing["expires"]}

    def pairing(self) -> dict | None:
        with self._lock:
            p = self._pairing
            if p and self.clock() > p["expires"]:
                self._pairing = p = None
            return dict(p) if p else None

    def cancel_pairing(self) -> None:
        with self._lock:
            self._pairing = None

    def complete_pairing(self, code: str, name: str) -> dict | None:
        """Phone side. Returns {"id", "key"} once; the key is never shown again."""
        with self._lock:
            p = self._pairing
            if not p or self.clock() > p["expires"]:
                self._pairing = None
                return None
            given = (code or "").strip().upper().replace("-", "").replace(" ", "")
            if not secrets.compare_digest(given.encode(), p["code"].encode()):
                p["tries"] += 1
                if p["tries"] >= PAIR_MAX_TRIES:
                    self._pairing = None
                return None
            self._pairing = None  # one use only
            if len([d for d in self.devices.values() if not d.get("removed")]) >= MAX_DEVICES:
                return None
            dev_id = "dev_" + secrets.token_hex(4)
            key = "hl_" + secrets.token_urlsafe(32)
            clean = "".join(ch for ch in str(name or "") if ch.isprintable())[:40].strip() or "Phone"
            self.devices[dev_id] = {"id": dev_id, "name": clean, "key_hash": _hash(key), "key_hint": key[-4:],
                                    "linked": self.clock(), "last_seen": None, "removed": False}
            self._save()
            return {"id": dev_id, "key": key}

    # ------------------------------------------------------------ keys

    def verify(self, key: str) -> dict | None:
        if not key:
            return None
        h = _hash(key)
        found = None
        with self._lock:
            for d in self.devices.values():  # compare against every device, constant time each
                if secrets.compare_digest(h, d["key_hash"]) and not d.get("removed"):
                    found = d
            if found:
                found["last_seen"] = self.clock()
        return found

    def remove(self, dev_id: str) -> bool:
        with self._lock:
            d = self.devices.get(dev_id)
            if not d or d.get("removed"):
                return False
            d["removed"] = True
            d["key_hash"] = "removed"
            self._save()
            return True

    def touch_save(self) -> None:
        with self._lock:
            self._save()

    def public(self) -> list[dict]:
        with self._lock:
            return [{k: d[k] for k in ("id", "name", "key_hint", "linked", "last_seen")}
                    for d in self.devices.values() if not d.get("removed")]


def qr_payload(host: str, port: int, code: str) -> str:
    """What the PC's QR code holds. The phone reads it, then calls POST /v2/pair."""
    return f"helper-link:v1?host={quote(host)}&port={int(port)}&code={code}"


class LinkApp:
    """Phone-facing routes. A device can send and follow jobs, nothing more."""

    # What a paired phone can reach on the PC app (Settings works fully from the phone).
    # Pairing and the device list stay on the PC: /v1/link is never reachable from a phone.
    PHONE_ROUTES = ("status", "agents", "tasks", "approvals", "stop", "start", "checklists", "done", "today",
                    "calm", "reminders", "capture", "ledger", "private", "content", "rules", "accounts", "inbox")

    def __init__(self, registry: DeviceRegistry, runner, agents: dict, settings: dict, version: str = "",
                 pc_app=None):
        self.pc_app = pc_app
        self.registry = registry
        self.runner = runner
        self.agents = agents
        self.settings = settings
        self.version = version
        self.owner: dict[str, str] = {}  # job id -> device id
        self._hits: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def rate_ok(self, who: str, per_min: int = 60) -> bool:
        now = time.time()
        with self._lock:
            hits = [t for t in self._hits.get(who, []) if now - t < 60]
            if len(hits) >= per_min:
                self._hits[who] = hits
                return False
            hits.append(now)
            self._hits[who] = hits
            return True

    def pair(self, body: dict) -> tuple[int, dict]:
        res = self.registry.complete_pairing(str(body.get("code", "")), str(body.get("name", "")))
        if not res:
            return 403, {"error": "that code didn't work. Make a new one on the PC and try again."}
        self.runner.audit.write("system", event="link_paired", device=res["id"])
        import base64
        from helper import crypto
        notes_key = base64.b64encode(crypto.notes_key(self.runner.home_root)).decode()
        return 201, {"device_id": res["id"], "key": res["key"], "notes_key": notes_key}

    def handle(self, method: str, path: str, body: dict | None, device: dict) -> tuple[int, dict]:
        gate = self.runner.gate
        who = f"link:{device['id']}"
        if method == "GET" and path == "/v2/health":
            return 200, {"ok": True, "app": "helperd", "version": self.version,
                         "stopped": gate.kill.stopped, "device": device["name"]}
        if method == "POST" and path == "/v2/jobs":
            goal = str((body or {}).get("goal", "")).strip()[:4000]
            if not goal:
                return 400, {"error": "goal is empty"}
            default = self.settings.get("general", {}).get("default_agent", "organizer")
            agent, goal = pick_agent(goal, self.agents, str((body or {}).get("agent") or default))
            if agent is None:
                return 400, {"error": "no such agent"}
            if gate.kill.stopped:
                return 409, {"error": "Helper is stopped on the PC."}
            task = self.runner.start(goal, agent)
            self.owner[task.id] = device["id"]
            self.runner.audit.write("system", event="link_job", device=device["id"], task=task.id, by=who)
            return 201, {"id": task.id, "agent": agent.key}
        if method == "GET" and path.startswith("/v2/jobs/"):
            jid = path.rsplit("/", 1)[1]
            t = self.runner.tasks.get(jid)
            if not t or self.owner.get(jid) != device["id"]:
                return 404, {"error": "no such job"}
            return 200, t.public()
        if method == "GET" and path == "/v2/approvals":
            return 200, {"pending": len(gate.approvals.pending())}
        if method == "POST" and path == "/v2/notes":
            # An encrypted brain dump note from the phone (see helper.capture).
            import base64
            import binascii
            from helper import crypto
            from helper.capture import CaptureStore
            try:
                blob = base64.b64decode(str((body or {}).get("note", "")), validate=True)
                row = CaptureStore(self.runner.home_root / "state").add_encrypted(
                    crypto.notes_key(self.runner.home_root), blob, f"phone:{device['name'][:30]}")
            except (ValueError, binascii.Error, UnicodeDecodeError):
                return 400, {"error": "that note didn't open (wrong key or damaged)"}
            return 201, {"id": row["id"], "items": len(row["items"])}
        if path.startswith("/v2/app/") and self.pc_app is not None:
            route = path[len("/v2/app/"):].split("/", 1)[0]
            if route not in self.PHONE_ROUTES:
                return 404, {"error": "not found"}
            return self.pc_app.handle(method, "/v1/" + path[len("/v2/app/"):], body, by=who)
        return 404, {"error": "not found"}


HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
}


def make_link_handler(app: LinkApp, host: str, port: int):
    allowed_hosts = {f"{host}:{port}", host}

    class Handler(BaseHTTPRequestHandler):
        server_version = "helperd-link"
        sys_version = ""

        def log_message(self, fmt, *args):
            pass

        def _json(self, code: int, obj: dict) -> None:
            data = json.dumps(obj, ensure_ascii=False, default=str).encode()
            self.send_response(code)
            for k, v in HEADERS.items():
                self.send_header(k, v)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _start(self) -> str | None:
            if self.headers.get("Host", "") not in allowed_hosts:
                self._json(421, {"error": "wrong host"})
                return None
            path = urlparse(self.path).path
            if not path.startswith("/v2/"):
                self._json(404, {"error": "not found"})
                return None
            if not app.rate_ok(self.client_address[0]):
                self._json(429, {"error": "too many requests"})
                return None
            return path

        def _device(self) -> dict | None:
            auth = self.headers.get("Authorization", "")
            dev = app.registry.verify(auth[7:] if auth.startswith("Bearer ") else "")
            if not dev:
                self._json(401, {"error": "missing or wrong device key"})
            return dev

        def _body(self) -> dict | None:
            if "application/json" not in self.headers.get("Content-Type", ""):
                self._json(415, {"error": "send JSON"})
                return None
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                length = -1
            if length < 0 or length > MAX_BODY:
                self._json(413, {"error": "body too large"})
                return None
            try:
                body = json.loads(self.rfile.read(length) or b"{}")
            except ValueError:
                body = None
            if not isinstance(body, dict):
                self._json(400, {"error": "body is not a JSON object"})
                return None
            return body

        def do_GET(self):
            path = self._start()
            if path is None:
                return
            dev = self._device()
            if dev:
                self._json(*app.handle("GET", path, None, dev))

        def do_POST(self):
            path = self._start()
            if path is None:
                return
            if path == "/v2/pair":
                if not app.rate_ok("pair:" + self.client_address[0], per_min=10):
                    return self._json(429, {"error": "too many tries"})
                body = self._body()
                if body is not None:
                    self._json(*app.pair(body))
                return
            dev = self._device()
            if not dev:
                return
            body = self._body()
            if body is not None:
                self._json(*app.handle("POST", path, body, dev))

        def do_PUT(self):
            self._json(405, {"error": "method not allowed"})

        do_DELETE = do_PATCH = do_OPTIONS = do_PUT

    return Handler


def check_bind_host(host: str) -> None:
    if not host:
        raise ValueError("set [link] host to the PC's home Wi-Fi address, for example 192.168.1.20")
    if host in ("0.0.0.0", "::", "*"):
        raise ValueError("Stub Link never listens on every address; give the PC's Wi-Fi address")


def serve_link(app: LinkApp, host: str, port: int = DEFAULT_PORT) -> ThreadingHTTPServer:
    check_bind_host(host)
    httpd = ThreadingHTTPServer((host, port), make_link_handler(app, host, port))
    httpd.daemon_threads = True
    return httpd
