"""Linked accounts: Gmail and Trello, linked through each app's own sign-in.

Rules
- Nothing links on its own. Jack links an account himself (`helper link gmail`, or Link in Settings),
  and Unlink removes the sign-in at once.
- Gmail starts read-only. "Allow changes" links again with the scope that lets agents archive,
  label, draft and send; each of those is still a row on the agent's checklist (Do / Ask me / Never).
- Sign-in tokens are kept in Windows Credential Manager on the PC (or a locked file in the secret
  folder elsewhere). No agent tool can read them, and they never appear in the audit log.
- Email text is untrusted: every result from an email taints the task, so Not sure? Stop applies.
- Helper never stores, reads or types a password. RoboForm is not linked: whether it allows linking
  is still to be checked.

Only fixed hosts are called: Google's sign-in and Gmail API, and Trello's API.
"""

from __future__ import annotations

import base64
import datetime as dt
import email.utils
import hashlib
import json
import os
import re
import secrets
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from email.message import EmailMessage
from pathlib import Path

GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me"
TRELLO = "https://api.trello.com/1"
SCOPE_READ = "https://www.googleapis.com/auth/gmail.readonly"
SCOPE_CHANGE = "https://www.googleapis.com/auth/gmail.modify"
ALLOWED_HOSTS = {"accounts.google.com", "oauth2.googleapis.com", "gmail.googleapis.com", "api.trello.com"}

PROVIDERS = {
    "gmail": {"label": "Gmail", "jobs": ["gmail_search", "gmail_read", "gmail_draft", "gmail_send", "gmail_archive",
                                          "gmail_label", "gmail_trash", "gmail_unsubscribe"]},
    "trello": {"label": "Trello", "jobs": ["trello_boards", "trello_add_card"]},
}
_lock = threading.Lock()


class AccountError(Exception):
    pass


# ---------------------------------------------------------------- secret storage

class SecretBox:
    """Windows Credential Manager on Windows; a 0600 file in secret/ elsewhere (tests, Linux)."""

    def __init__(self, home_root: Path):
        self.dir = Path(home_root) / "secret" / "accounts"

    def _win(self) -> bool:
        return sys.platform == "win32" and not os.environ.get("HELPER_SECRETS_IN_FILES")

    def get(self, name: str) -> dict | None:
        if self._win():
            raw = _wincred_read(f"Helper/{name}")
            return json.loads(raw) if raw else None
        try:
            return json.loads((self.dir / f"{name}.json").read_text(encoding="utf-8"))
        except (FileNotFoundError, ValueError):
            return None

    def put(self, name: str, value: dict) -> None:
        data = json.dumps(value)
        if self._win():
            _wincred_write(f"Helper/{name}", data)
            return
        self.dir.mkdir(parents=True, exist_ok=True)
        p = self.dir / f"{name}.json"
        tmp = p.with_suffix(".tmp")
        tmp.write_text(data, encoding="utf-8")
        try:
            os.chmod(tmp, 0o600)
        except OSError:
            pass
        tmp.replace(p)

    def delete(self, name: str) -> None:
        if self._win():
            _wincred_delete(f"Helper/{name}")
            return
        (self.dir / f"{name}.json").unlink(missing_ok=True)


def _wincred():  # pragma: no cover - Windows only
    import ctypes
    from ctypes import wintypes

    class CREDENTIAL(ctypes.Structure):
        _fields_ = [("Flags", wintypes.DWORD), ("Type", wintypes.DWORD), ("TargetName", wintypes.LPWSTR),
                    ("Comment", wintypes.LPWSTR), ("LastWritten", wintypes.FILETIME),
                    ("CredentialBlobSize", wintypes.DWORD), ("CredentialBlob", ctypes.POINTER(ctypes.c_char)),
                    ("Persist", wintypes.DWORD), ("AttributeCount", wintypes.DWORD), ("Attributes", ctypes.c_void_p),
                    ("TargetAlias", wintypes.LPWSTR), ("UserName", wintypes.LPWSTR)]
    adv = ctypes.WinDLL("advapi32", use_last_error=True)
    return ctypes, CREDENTIAL, adv


def _wincred_write(target: str, data: str) -> None:  # pragma: no cover
    ctypes, CREDENTIAL, adv = _wincred()
    blob = data.encode("utf-8")
    buf = ctypes.create_string_buffer(blob, len(blob))
    c = CREDENTIAL()
    c.Type, c.TargetName, c.Persist = 1, target, 2   # GENERIC, LOCAL_MACHINE persistence
    c.CredentialBlobSize, c.CredentialBlob, c.UserName = len(blob), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)), "Helper"
    if not adv.CredWriteW(ctypes.byref(c), 0):
        raise AccountError(f"Windows Credential Manager refused (error {ctypes.get_last_error()})")


def _wincred_read(target: str) -> str | None:  # pragma: no cover
    ctypes, CREDENTIAL, adv = _wincred()
    p = ctypes.POINTER(CREDENTIAL)()
    if not adv.CredReadW(target, 1, 0, ctypes.byref(p)):
        return None
    try:
        return ctypes.string_at(p.contents.CredentialBlob, p.contents.CredentialBlobSize).decode("utf-8")
    finally:
        adv.CredFree(p)


def _wincred_delete(target: str) -> None:  # pragma: no cover
    ctypes, _, adv = _wincred()
    adv.CredDeleteW(target, 1, 0)


# ---------------------------------------------------------------- HTTP (fixed hosts only)

def http(method: str, url: str, body: dict | bytes | None = None, headers: dict | None = None,
         form: bool = False, timeout: float = 30) -> dict:
    """Tests replace this function. Refuses any host that isn't Google sign-in, Gmail or Trello."""
    host = urllib.parse.urlparse(url).hostname or ""
    if host not in ALLOWED_HOSTS or not url.startswith("https://"):
        raise AccountError(f"refusing to call {host}")
    data = None
    hdrs = dict(headers or {})
    if isinstance(body, dict):
        if form:
            data = urllib.parse.urlencode(body).encode()
            hdrs["Content-Type"] = "application/x-www-form-urlencoded"
        else:
            data = json.dumps(body).encode()
            hdrs["Content-Type"] = "application/json"
    elif isinstance(body, bytes):
        data = body
    req = urllib.request.Request(url, data=data, method=method, headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
    except urllib.error.HTTPError as e:
        detail = e.read()[:300].decode("utf-8", "replace")
        raise AccountError(f"{host} said {e.code}: {detail}") from None
    except urllib.error.URLError as e:
        raise AccountError(f"couldn't reach {host}: {e.reason}") from None
    return json.loads(raw) if raw.strip() else {}


# ---------------------------------------------------------------- linked accounts list

class Linked:
    def __init__(self, home_root: Path):
        self.home = Path(home_root)
        self.path = self.home / "state" / "accounts.json"
        self.box = SecretBox(self.home)

    def _load(self) -> dict:
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except (FileNotFoundError, ValueError):
            return {}

    def _save(self, data: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(data, indent=1), encoding="utf-8")

    def info(self, name: str) -> dict | None:
        return self._load().get(name)

    def mark(self, name: str, **info) -> None:
        with _lock:
            data = self._load()
            data[name] = {**data.get(name, {}), **info, "linked": True, "since": data.get(name, {}).get("since") or time.time()}
            self._save(data)

    def unlink(self, name: str) -> None:
        with _lock:
            self.box.delete(name)
            data = self._load()
            data.pop(name, None)
            self._save(data)

    def public(self, agents: dict | None = None, checklists=None) -> list[dict]:
        data = self._load()
        out = []
        for name, p in PROVIDERS.items():
            row = {"name": name, "label": p["label"], "linked": name in data and bool(self.box.get(name)),
                   "since": data.get(name, {}).get("since"), "who": data.get(name, {}).get("who", ""),
                   "can_change": data.get(name, {}).get("can_change", False), "jobs": []}
            for job in p["jobs"]:
                from helper.checklist import label
                users = []
                for a in (agents or {}).values():
                    if job in a.tools:
                        users.append({"agent": a.key, "name": a.name,
                                      "choice": checklists.choice(a, job) if checklists else None})
                row["jobs"].append({"job": job, "label": label(job), "agents": users})
            out.append(row)
        return out


# ---------------------------------------------------------------- Gmail sign-in (loopback + PKCE)

def gmail_auth_url(client_id: str, redirect: str, can_change: bool, state: str, verifier: str) -> str:
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    q = {"client_id": client_id, "redirect_uri": redirect, "response_type": "code",
         "scope": SCOPE_CHANGE if can_change else SCOPE_READ, "access_type": "offline", "prompt": "consent",
         "state": state, "code_challenge": challenge, "code_challenge_method": "S256"}
    return GOOGLE_AUTH + "?" + urllib.parse.urlencode(q)


def link_gmail(home_root: Path, client_id: str, client_secret: str, can_change: bool = False,
               open_browser=None, timeout: float = 300) -> dict:
    """Jack's own sign-in in his browser. Listens once on 127.0.0.1 for Google's answer.
    client_id/secret: a free "Desktop app" OAuth client from Google Cloud (see the README)."""
    from http.server import BaseHTTPRequestHandler, HTTPServer
    import webbrowser
    state, verifier = secrets.token_urlsafe(16), secrets.token_urlsafe(48)
    got: dict = {}

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
            if q.get("state") == state:
                got.update(q)
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write("Helper: you can close this tab now.".encode())

    srv = HTTPServer(("127.0.0.1", 0), H)
    srv.timeout = 2
    redirect = f"http://127.0.0.1:{srv.server_address[1]}/"
    url = gmail_auth_url(client_id, redirect, can_change, state, verifier)
    (open_browser or webbrowser.open)(url)
    end = time.time() + timeout
    try:
        while not got and time.time() < end:
            srv.handle_request()
    finally:
        srv.server_close()
    if "code" not in got:
        raise AccountError(got.get("error") or "no answer from Google sign-in in time")
    tok = http("POST", GOOGLE_TOKEN, {"code": got["code"], "client_id": client_id, "client_secret": client_secret,
                                      "redirect_uri": redirect, "grant_type": "authorization_code",
                                      "code_verifier": verifier}, form=True)
    if "refresh_token" not in tok:
        raise AccountError("Google didn't give a lasting sign-in; try Link again")
    linked = Linked(home_root)
    linked.box.put("gmail", {"client_id": client_id, "client_secret": client_secret,
                             "refresh_token": tok["refresh_token"], "access_token": tok.get("access_token", ""),
                             "expires": time.time() + int(tok.get("expires_in", 0)) - 60})
    who = ""
    try:
        who = Gmail(home_root).profile().get("emailAddress", "")
    except AccountError:
        pass
    linked.mark("gmail", can_change=can_change, who=who)
    return {"linked": "gmail", "who": who, "can_change": can_change}


# ---------------------------------------------------------------- Gmail

def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64url(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


class Gmail:
    def __init__(self, home_root: Path):
        self.linked = Linked(home_root)

    def _token(self) -> str:
        cred = self.linked.box.get("gmail")
        if not cred:
            raise AccountError("Gmail isn't linked. Link it in Settings > Accounts.")
        if cred.get("access_token") and cred.get("expires", 0) > time.time():
            return cred["access_token"]
        tok = http("POST", GOOGLE_TOKEN, {"client_id": cred["client_id"], "client_secret": cred["client_secret"],
                                          "refresh_token": cred["refresh_token"], "grant_type": "refresh_token"}, form=True)
        cred["access_token"] = tok["access_token"]
        cred["expires"] = time.time() + int(tok.get("expires_in", 3600)) - 60
        self.linked.box.put("gmail", cred)
        return cred["access_token"]

    def _call(self, method: str, path: str, body=None) -> dict:
        return http(method, GMAIL + path, body, headers={"Authorization": f"Bearer {self._token()}"})

    def _needs_change(self) -> None:
        if not (self.linked.info("gmail") or {}).get("can_change"):
            raise AccountError("Gmail is linked read-only. Press Allow changes in Settings > Accounts first.")

    def profile(self) -> dict:
        return self._call("GET", "/profile")

    def search(self, query: str, limit: int = 20) -> list[dict]:
        q = urllib.parse.urlencode({"q": query or "in:inbox newer_than:2d", "maxResults": max(1, min(limit, 50))})
        ids = [m["id"] for m in self._call("GET", f"/messages?{q}").get("messages", [])]
        out = []
        for mid in ids:
            m = self._call("GET", f"/messages/{mid}?format=metadata&metadataHeaders=From&metadataHeaders=Subject"
                                  f"&metadataHeaders=Date&metadataHeaders=List-Unsubscribe&metadataHeaders=Precedence"
                                  f"&metadataHeaders=Reply-To")
            out.append(summarise(m))
        return out

    def read(self, mid: str) -> dict:
        m = self._call("GET", f"/messages/{urllib.parse.quote(mid)}?format=full")
        s = summarise(m)
        s["body"] = _body_text(m.get("payload", {}))[:20000]
        return s

    def draft(self, to: str, subject: str, body: str, reply_to_id: str = "") -> dict:
        self._needs_change()
        msg = EmailMessage()
        msg["To"], msg["Subject"] = to, subject
        msg.set_content(body)
        payload: dict = {"message": {}}
        if reply_to_id:
            orig = self._call("GET", f"/messages/{urllib.parse.quote(reply_to_id)}?format=metadata&metadataHeaders=Message-ID")
            mid = _header(orig, "Message-ID")
            if mid:
                msg["In-Reply-To"], msg["References"] = mid, mid
            payload["message"]["threadId"] = orig.get("threadId")
        payload["message"]["raw"] = _b64url(msg.as_bytes())
        d = self._call("POST", "/drafts", payload)
        return {"draft_id": d.get("id"), "to": to, "subject": subject}

    def send_draft(self, draft_id: str) -> dict:
        self._needs_change()
        return self._call("POST", "/drafts/send", {"id": draft_id})

    def modify(self, mid: str, add: list[str] | None = None, remove: list[str] | None = None) -> dict:
        self._needs_change()
        return self._call("POST", f"/messages/{urllib.parse.quote(mid)}/modify",
                          {"addLabelIds": add or [], "removeLabelIds": remove or []})

    def label_id(self, name: str, create: bool = True) -> str:
        labels = self._call("GET", "/labels").get("labels", [])
        for lb in labels:
            if lb["name"].lower() == name.lower():
                return lb["id"]
        if not create:
            raise AccountError(f"no label called {name}")
        self._needs_change()
        return self._call("POST", "/labels", {"name": name})["id"]

    def trash(self, mid: str, back: bool = False) -> dict:
        self._needs_change()
        return self._call("POST", f"/messages/{urllib.parse.quote(mid)}/{'untrash' if back else 'trash'}")

    def delete_draft(self, draft_id: str) -> None:
        self._call("DELETE", f"/drafts/{urllib.parse.quote(draft_id)}")


def _header(m: dict, name: str) -> str:
    for h in m.get("payload", {}).get("headers", []):
        if h.get("name", "").lower() == name.lower():
            return h.get("value", "")
    return ""


def _body_text(part: dict) -> str:
    if part.get("mimeType", "").startswith("text/plain") and part.get("body", {}).get("data"):
        return _unb64url(part["body"]["data"]).decode("utf-8", "replace")
    for p in part.get("parts", []) or []:
        t = _body_text(p)
        if t:
            return t
    if part.get("mimeType", "").startswith("text/html") and part.get("body", {}).get("data"):
        html = _unb64url(part["body"]["data"]).decode("utf-8", "replace")
        return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", re.sub(r"(?is)<(script|style).*?</\1>", " ", html)))
    return ""


# ---------------------------------------------------------------- triage (rules, no model)

BRANDS = ("paypal", "amazon", "apple", "microsoft", "google", "netflix", "spotify", "hmrc", "dvla", "royal mail",
          "dhl", "fedex", "ups", "bank", "barclays", "lloyds", "hsbc", "natwest", "santander", "monzo", "ebay", "steam")
_URGENT = re.compile(r"\b(account (?:is )?(?:locked|suspended|on hold|limited)|verify your (?:account|identity)|"
                     r"unusual (?:activity|sign[- ]in)|confirm your (?:details|payment)|final notice|"
                     r"you(?:'ve| have) won|claim your|gift card|refund (?:is )?pending|act now|within 24 hours)\b", re.I)
_RECEIPT = re.compile(r"\b(receipt|your order|order confirm|invoice|payment (?:received|confirmation)|"
                      r"we(?:'ve| have) received your payment|statement is ready|bill is ready|dispatched|delivered)\b", re.I)
_NOREPLY = re.compile(r"no-?reply|do-?not-?reply|notifications?@|mailer|news(?:letter)?@|marketing@|info@|hello@", re.I)
_LOOKALIKE = str.maketrans({"0": "o", "1": "l", "3": "e", "5": "s", "@": "a", "$": "s"})
PILES = ("needs_you", "waiting", "receipts", "newsletters", "scam")
PILE_WORDS = {"needs_you": "Needs you", "waiting": "Waiting on others", "receipts": "Receipts",
              "newsletters": "Newsletters", "scam": "Scam?"}


def scam_signs(sender: str, subject: str, snippet: str) -> list[str]:
    name, addr = email.utils.parseaddr(sender)
    domain = addr.rsplit("@", 1)[-1].lower() if "@" in addr else ""
    signs = []
    text = f"{subject} {snippet}"
    for b in BRANDS:
        b2 = b.replace(" ", "")
        if len(b2) > 3 and b2 not in domain and b2 in domain.translate(_LOOKALIKE):
            signs.append(f"{domain} looks like {b2} but isn't")
            break
        if b in name.lower() and b2 not in domain:
            signs.append(f"says it's from {b.title()} but comes from {domain or 'an unknown address'}")
            break
    if _URGENT.search(text):
        signs.append("pushes you to act fast")
    return signs


def pile_for(sender: str, subject: str, snippet: str, labels: list[str], bulk: bool, me: str = "") -> str:
    signs = scam_signs(sender, subject, snippet)
    if any("looks like" in s or "says it's" in s for s in signs):
        return "scam"   # pretends to be someone else
    if signs:
        return "needs_you"  # urgent words from a real sender (e.g. a new sign-in alert): top, never buried
    if "SENT" in labels and me and me.lower() in sender.lower():
        return "waiting"
    if _RECEIPT.search(subject) or "CATEGORY_UPDATES" in labels and _RECEIPT.search(snippet):
        return "receipts"
    if bulk or "CATEGORY_PROMOTIONS" in labels or "CATEGORY_SOCIAL" in labels or "CATEGORY_FORUMS" in labels:
        return "newsletters"
    if _NOREPLY.search(sender):
        return "newsletters" if "CATEGORY_UPDATES" not in labels else "receipts"
    return "needs_you"


def summarise(m: dict) -> dict:
    sender, subject = _header(m, "From"), _header(m, "Subject")
    snippet = m.get("snippet", "")
    labels = m.get("labelIds", []) or []
    bulk = bool(_header(m, "List-Unsubscribe")) or _header(m, "Precedence").lower() in ("bulk", "list")
    pile = pile_for(sender, subject, snippet, labels, bulk)
    return {"id": m.get("id"), "thread": m.get("threadId"), "from": sender[:200], "subject": subject[:300],
            "snippet": snippet[:300], "date": _header(m, "Date"), "pile": pile,
            "scam_signs": scam_signs(sender, subject, snippet),
            "unsubscribe": _header(m, "List-Unsubscribe")[:500], "unread": "UNREAD" in labels}


def unsubscribe_target(header: str) -> dict | None:
    """From a List-Unsubscribe header: a mailto address (preferred) or an https one-click link."""
    parts = re.findall(r"<([^>]+)>", header or "")
    for p in parts:
        if p.lower().startswith("mailto:"):
            addr = urllib.parse.urlparse(p).path
            q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(p).query))
            return {"kind": "mailto", "to": addr, "subject": q.get("subject", "unsubscribe")}
    for p in parts:
        if p.lower().startswith("https://"):
            return {"kind": "https", "url": p}
    return None


# ---------------------------------------------------------------- Trello

class Trello:
    def __init__(self, home_root: Path):
        self.linked = Linked(home_root)

    def _auth(self) -> dict:
        cred = self.linked.box.get("trello")
        if not cred:
            raise AccountError("Trello isn't linked. Link it in Settings > Accounts.")
        return {"key": cred["key"], "token": cred["token"]}

    def _call(self, method: str, path: str, params: dict | None = None) -> dict | list:
        q = urllib.parse.urlencode({**(params or {}), **self._auth()})
        return http(method, f"{TRELLO}{path}?{q}")

    def boards(self) -> list[dict]:
        return [{"id": b["id"], "name": b["name"]} for b in self._call("GET", "/members/me/boards", {"filter": "open"})]

    def lists(self, board_id: str) -> list[dict]:
        return [{"id": x["id"], "name": x["name"]} for x in
                self._call("GET", f"/boards/{urllib.parse.quote(board_id)}/lists", {"filter": "open"})]

    def cards(self, list_id: str) -> list[dict]:
        return [{"id": c["id"], "name": c["name"], "due": c.get("due")} for c in
                self._call("GET", f"/lists/{urllib.parse.quote(list_id)}/cards")]

    def add_card(self, list_id: str, name: str, desc: str = "", due: str = "") -> dict:
        p = {"idList": list_id, "name": name[:300], "desc": desc[:5000]}
        if due:
            p["due"] = due
        c = self._call("POST", "/cards", p)
        return {"id": c["id"], "name": c["name"], "url": c.get("shortUrl", "")}

    def archive_card(self, card_id: str) -> None:
        self._call("PUT", f"/cards/{urllib.parse.quote(card_id)}", {"closed": "true"})


def link_trello(home_root: Path, key: str, token: str) -> dict:
    key, token = key.strip(), token.strip()
    if not re.fullmatch(r"[0-9a-f]{32}", key) or not re.fullmatch(r"[0-9A-Za-z]{40,100}", token):
        raise AccountError("that doesn't look like a Trello key and token")
    linked = Linked(home_root)
    linked.box.put("trello", {"key": key, "token": token})
    try:
        me = Trello(home_root)._call("GET", "/members/me", {"fields": "username"})
    except AccountError:
        linked.box.delete("trello")
        raise
    linked.mark("trello", who=me.get("username", ""))
    return {"linked": "trello", "who": me.get("username", "")}


def trello_token_url(key: str) -> str:
    return ("https://trello.com/1/authorize?" + urllib.parse.urlencode(
        {"expiration": "never", "scope": "read,write", "response_type": "token", "name": "Helper", "key": key}))


# ---------------------------------------------------------------- Undo for account changes

def run_undo(undo: dict, home_root: Path) -> str:
    what = undo.get("what")
    if what == "unarchive":
        Gmail(home_root).modify(undo["id"], add=["INBOX"])
        return "Moved the email back to the inbox"
    if what == "unlabel":
        Gmail(home_root).modify(undo["id"], remove=[undo["label"]])
        return "Took the label off"
    if what == "untrash":
        Gmail(home_root).trash(undo["id"], back=True)
        return "Took the email out of the bin"
    if what == "delete_draft":
        Gmail(home_root).delete_draft(undo["id"])
        return "Deleted the draft"
    if what == "archive_card":
        Trello(home_root).archive_card(undo["id"])
        return "Archived the Trello card"
    raise ValueError("this can't be undone")


# ---------------------------------------------------------------- morning readout (rules, same layout every day)

def morning_readout(home_root: Path, reminders: list[dict], now: dt.datetime | None = None,
                    messages: list[dict] | None = None) -> dict:
    """Same time, same shape, every day. Built without the model so it's predictable."""
    now = now or dt.datetime.now()
    if messages is None:
        try:
            messages = Gmail(home_root).search("in:inbox newer_than:1d", 40)
        except AccountError as e:
            messages, err = [], str(e)
        else:
            err = ""
    else:
        err = ""
    piles = {p: [m for m in messages if m["pile"] == p] for p in PILES}
    need = piles["needs_you"][:3] + piles["scam"][:1]
    n = len(piles["needs_you"]) + len(reminders)
    lines = [f"Morning, Jack. {n or 'Nothing'} thing{'s' * (n != 1)} need{'s' * (n == 1)} you."]
    for m in need:
        tag = "Ward: scam?" if m["pile"] == "scam" else "email"
        lines.append(f"- {m['subject'] or '(no subject)'} ({tag})")
    for r in reminders[:3]:
        lines.append(f"- {r['text']} (first step: {r['first_step']})")
    also = []
    for p in ("waiting", "receipts", "newsletters"):
        if piles[p]:
            also.append(f"{len(piles[p])} {PILE_WORDS[p].lower()}")
    if also:
        lines.append("Also: " + " · ".join(also) + (" (hidden)" if piles["newsletters"] else ""))
    if err:
        lines.append(f"(Email not checked: {err})")
    return {"date": now.strftime("%Y-%m-%d"), "time": now.strftime("%H:%M"), "text": "\n".join(lines),
            "piles": {p: len(v) for p, v in piles.items()}, "needs_you": need}
