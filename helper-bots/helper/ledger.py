"""Guild Ledger: the shared store every agent reads and adds drafts to.

Follows Jack's lore_tool.js exactly (same file shape, same checks, same patch operations), ported to
Python so helperd needs no Node:
- entries have ids like LORE-0001, a type (place, character, rule, item, event, term), a status
  (canon, draft, retired), name, summary, details, related ids, source, added_rev and updated_rev
- the ledger has a revision number and a changelog; every change is a patch with a reason
- patch ops: add, update, promote, retire. Nothing is ever deleted, only retired.
- the whole new ledger is checked before saving; the old file is kept as .bak; writes are atomic

One Helper difference: in lore_tool.js a patch could say "approved_by": "user". In Helper an agent
can't set that. Agents may only add drafts and edit drafts (propose). Only Jack's click in the app
(or his typing in the CLI) passes approved=True, which is what makes or changes canon.
"""

from __future__ import annotations

import copy
import datetime as _dt
import json
import re
import shutil
import threading
from pathlib import Path

TYPES = ("place", "character", "rule", "item", "event", "term")
STATUSES = ("canon", "draft", "retired")
ID_RE = re.compile(r"^LORE-\d{4}$")

# Two separate ledgers with the same rules. "lore" is story canon. "private" is Jack's real life
# (accounts, people, documents, routines): kept in its own file, never shown to story agents, and it
# never holds a password, PIN, 2-step code or recovery key, only where one lives.
SECTIONS = {
    "lore": {"prefix": "LORE", "types": TYPES, "title": "Lore Ledger", "file": "lore_ledger.json"},
    "private": {"prefix": "REC", "types": ("account", "person", "place", "document", "routine", "date", "note"),
                "title": "Private records", "file": "private_ledger.json"},
}
_SECRET_RE = re.compile(
    r"\b(pass(?:word|wd|code|phrase)|pin|2fa|otp|one[- ]time code|recovery (?:key|code)|backup code|security answer|"
    r"cvv|card number)\b\s*(?:is|=|:|-)\s*\S+"
    r"|\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b",
    re.IGNORECASE)


def looks_secret(text: str) -> bool:
    """A password, PIN, code or card number written out. Saying where it lives is fine."""
    return bool(_SECRET_RE.search(text or ""))


def _sec(section: str) -> dict:
    if section not in SECTIONS:
        raise ValueError("section must be lore or private")
    return SECTIONS[section]


def empty_ledger() -> dict:
    return {"revision": 1, "updated": _dt.date.today().isoformat(), "entries": [],
            "changelog": [{"rev": 1, "date": _dt.date.today().isoformat(), "reason": "New ledger", "changes": []}]}


def validate(ledger, section: str = "lore") -> list[str]:
    sec = _sec(section)
    id_re = re.compile(rf"^{sec['prefix']}-\d{{4}}$")
    types = sec["types"]
    errors: list[str] = []
    err = errors.append
    if not isinstance(ledger, dict):
        return ["The ledger must be a JSON object."]
    rev = ledger.get("revision")
    if not isinstance(rev, int) or isinstance(rev, bool) or rev < 1:
        err("revision must be a whole number of 1 or more.")
        rev = 1
    entries = ledger.get("entries")
    if not isinstance(entries, list):
        return errors + ["entries must be a list."]
    if not isinstance(ledger.get("changelog"), list):
        err("changelog must be a list.")
    by_id: dict[str, dict] = {}
    for e in entries:
        if not isinstance(e, dict):
            err("An entry is not an object.")
            continue
        eid = e.get("id") if isinstance(e.get("id"), str) else "(no id)"
        if not id_re.match(eid):
            err(f"{eid}: id must look like {sec['prefix']}-0001.")
        if eid in by_id:
            err(f"{eid}: duplicate id.")
        by_id[eid] = e
        if e.get("type") not in types:
            err(f"{eid}: type must be one of {', '.join(types)}.")
        if section == "private" and any(looks_secret(str(e.get(f, ""))) for f in ("name", "summary", "details")):
            err(f"{eid}: looks like it holds a password, PIN or code. Only say where it lives (for example \"in RoboForm\").")
        if e.get("status") not in STATUSES:
            err(f"{eid}: status must be one of {', '.join(STATUSES)}.")
        for f in ("name", "summary"):
            if not isinstance(e.get(f), str) or not e[f].strip():
                err(f"{eid}: {f} is required.")
        if "details" in e and not isinstance(e["details"], str):
            err(f"{eid}: details must be text.")
        rel = e.get("related")
        if rel is not None and not (isinstance(rel, list) and all(isinstance(r, str) for r in rel)):
            err(f"{eid}: related must be a list of ids.")
        ar, ur = e.get("added_rev"), e.get("updated_rev")
        if not isinstance(ar, int) or ar < 1 or ar > rev:
            err(f"{eid}: added_rev must be between 1 and {rev}.")
        if not isinstance(ur, int) or not isinstance(ar, int) or ur < ar or ur > rev:
            err(f"{eid}: updated_rev must be between added_rev and {rev}.")
        if e.get("status") == "retired" and not (isinstance(e.get("retired_reason"), str) and e["retired_reason"].strip()):
            err(f"{eid}: a retired entry needs retired_reason.")
    names: dict[str, str] = {}
    for e in entries:
        if not isinstance(e, dict):
            continue
        if e.get("status") != "retired" and isinstance(e.get("name"), str):
            key = e["name"].strip().lower()
            if key in names:
                err(f"{e.get('id')}: the name \"{e['name']}\" is already used by {names[key]}.")
            else:
                names[key] = e.get("id")
        for r in e.get("related") or [] if isinstance(e.get("related"), list) else []:
            t = by_id.get(r)
            if r == e.get("id"):
                err(f"{e.get('id')}: an entry cannot relate to itself.")
            elif t is None:
                err(f"{e.get('id')}: related id {r} does not exist.")
            elif t.get("status") == "retired" and e.get("status") != "retired":
                err(f"{e.get('id')}: it links to retired entry {r}. Update or remove that link in the same patch.")
        if "replaced_by" in e:
            if e.get("status") != "retired":
                err(f"{e.get('id')}: replaced_by only belongs on retired entries.")
            if e["replaced_by"] not in by_id:
                err(f"{e.get('id')}: replaced_by {e['replaced_by']} does not exist.")
        if "supersedes" in e:
            t = by_id.get(e["supersedes"])
            if t is None:
                err(f"{e.get('id')}: supersedes {e['supersedes']}, which does not exist.")
            elif t.get("status") != "retired":
                err(f"{e.get('id')}: supersedes {e['supersedes']}, which is not retired.")
    log = ledger.get("changelog")
    if isinstance(log, list):
        prev = 0
        for c in log:
            if not isinstance(c, dict) or not isinstance(c.get("rev"), int) or c["rev"] <= prev:
                err(f"changelog: revisions must increase (problem near rev {c.get('rev') if isinstance(c, dict) else '?'}).")
                break
            prev = c["rev"]
            if not isinstance(c.get("reason"), str) or not c["reason"].strip():
                err(f"changelog rev {c['rev']}: a reason is required.")
        if prev != rev:
            err(f"changelog ends at rev {prev} but the ledger is at rev {rev}.")
    return errors


ADD_FIELDS = {"key", "type", "name", "summary", "details", "related", "source", "status", "supersedes"}
UPDATE_FIELDS = {"name", "type", "summary", "details", "related"}


def apply_patch(ledger: dict, patch: dict, approved: bool = False, today: str | None = None,
                section: str = "lore") -> dict:
    """Returns {"ledger", "notes"} or {"errors"}. `approved` is True only for Jack's own click."""
    today = today or _dt.date.today().isoformat()
    if not isinstance(patch, dict):
        return {"errors": ["The patch must be a JSON object."]}
    early = []
    if not isinstance(patch.get("reason"), str) or not patch["reason"].strip():
        early.append("The patch needs a reason.")
    ops = patch.get("ops")
    if not isinstance(ops, list) or not ops:
        early.append("The patch needs a non-empty ops list.")
    if early:
        return {"errors": early}
    prefix = _sec(section)["prefix"]
    before = validate(ledger, section)
    if before:
        return {"errors": ["The ledger already has problems. Fix these first:"] + before}

    nxt = copy.deepcopy(ledger)
    rev = ledger["revision"] + 1
    find = lambda i: next((e for e in nxt["entries"] if e["id"] == i), None)  # noqa: E731
    errors, notes = [], []
    counter = max([0] + [int(e["id"].split("-")[1]) for e in nxt["entries"]])
    id_for_op, keys = {}, {}
    for i, op in enumerate(ops):
        if isinstance(op, dict) and op.get("op") == "add":
            counter += 1
            nid = f"{prefix}-{counter:04d}"
            id_for_op[i] = nid
            k = (op.get("entry") or {}).get("key") if isinstance(op.get("entry"), dict) else None
            if k is not None:
                if k in keys:
                    errors.append(f"op {i + 1}: the key \"{k}\" is used twice.")
                keys[k] = nid

    def resolve(lst):
        return [keys.get(r[1:], r) if isinstance(r, str) and r.startswith("@") else r
                for r in (lst if isinstance(lst, list) else [])]

    for i, op in enumerate(ops):
        kind = op.get("op") if isinstance(op, dict) else None
        tag = f"op {i + 1} ({kind})"
        if kind == "add":
            s = op.get("entry")
            if not isinstance(s, dict):
                errors.append(f"{tag}: entry is missing.")
                continue
            for k in s:
                if k not in ADD_FIELDS:
                    errors.append(f"{tag}: unknown field \"{k}\" (ids are assigned by the ledger).")
            status = s.get("status", "draft")
            if status not in ("draft", "canon"):
                errors.append(f"{tag}: a new entry must be draft or canon.")
            if status == "canon" and not approved:
                errors.append(f"{tag}: a new canon entry needs Jack's approval.")
            nid = id_for_op[i]
            e = {"id": nid, "type": s.get("type"), "status": status, "name": s.get("name"),
                 "summary": s.get("summary"), "details": s.get("details", ""), "related": resolve(s.get("related")),
                 "source": s.get("source", "unknown"), "added_rev": rev, "updated_rev": rev}
            if s.get("supersedes"):
                e["supersedes"] = s["supersedes"]
            nxt["entries"].append(e)
            notes.append(f"added {nid} \"{s.get('name')}\" ({status})")
        elif kind == "update":
            e = find(op.get("id"))
            if not e:
                errors.append(f"{tag}: {op.get('id')} does not exist.")
                continue
            if e["status"] == "retired":
                errors.append(f"{tag}: {op['id']} is retired and cannot be edited.")
                continue
            if e["status"] == "canon" and not approved:
                errors.append(f"{tag}: {op['id']} is canon, so changing it needs Jack's approval.")
                continue
            st = op.get("set") if isinstance(op.get("set"), dict) else {}
            if not st:
                errors.append(f"{tag}: nothing to change.")
                continue
            for k, v in st.items():
                if k not in UPDATE_FIELDS:
                    errors.append(f"{tag}: cannot change \"{k}\".")
                    continue
                e[k] = resolve(v) if k == "related" else v
            e["updated_rev"] = rev
            notes.append(f"updated {e['id']} ({', '.join(st)})")
        elif kind == "promote":
            e = find(op.get("id"))
            if not e:
                errors.append(f"{tag}: {op.get('id')} does not exist.")
                continue
            if e["status"] != "draft":
                errors.append(f"{tag}: {op['id']} is not a draft.")
                continue
            if not approved:
                errors.append(f"{tag}: making something canon needs Jack's approval.")
                continue
            e["status"] = "canon"
            e["updated_rev"] = rev
            notes.append(f"promoted {e['id']} \"{e['name']}\" to canon")
        elif kind == "retire":
            e = find(op.get("id"))
            if not e:
                errors.append(f"{tag}: {op.get('id')} does not exist.")
                continue
            if e["status"] == "retired":
                errors.append(f"{tag}: {op['id']} is already retired.")
                continue
            if e["status"] == "canon" and not approved:
                errors.append(f"{tag}: {op['id']} is canon, so retiring it needs Jack's approval.")
                continue
            if not isinstance(op.get("reason"), str) or not op["reason"].strip():
                errors.append(f"{tag}: a reason is required.")
                continue
            e["status"] = "retired"
            e["retired_reason"] = op["reason"]
            e["updated_rev"] = rev
            if op.get("replaced_by"):
                rid = resolve([op["replaced_by"]])[0]
                e["replaced_by"] = rid
                r = find(rid)
                if r and r["status"] != "retired" and not r.get("supersedes"):
                    r["supersedes"] = e["id"]
                    r["updated_rev"] = rev
            notes.append(f"retired {e['id']} \"{e['name']}\"" + (f" (replaced by {e['replaced_by']})" if op.get("replaced_by") else ""))
        else:
            errors.append(f"{tag}: unknown operation. Use add, update, promote, or retire.")
    if errors:
        return {"errors": errors}
    nxt["revision"] = rev
    nxt["updated"] = today
    nxt["changelog"].append({"rev": rev, "date": today, "reason": patch["reason"], "changes": notes})
    after = validate(nxt, section)
    if after:
        return {"errors": ["The change would break the ledger:"] + after}
    return {"ledger": nxt, "notes": notes}


def report(ledger: dict, section: str = "lore") -> str:
    sec = _sec(section)
    by = lambda s: [e for e in ledger["entries"] if e["status"] == s]  # noqa: E731
    lines = [f"{sec['title']}, revision {ledger['revision']} ({ledger.get('updated', 'no date')})",
             f"Canon: {len(by('canon'))} | Drafts waiting for approval: {len(by('draft'))} | Retired: {len(by('retired'))}",
             "", "CANON"]
    for t in sec["types"]:
        lst = [e for e in by("canon") if e["type"] == t]
        if lst:
            lines.append(f" {t}: " + ", ".join(f"{e['name']} ({e['id']})" for e in lst))
    lines += ["", "DRAFTS WAITING FOR YOUR APPROVAL"]
    drafts = by("draft")
    lines += [f" {e['id']} {e['name']}: {e['summary']}" for e in drafts] or [" none"]
    lines += ["", "RECENT CHANGES"]
    lines += [f" rev {c['rev']} ({c.get('date')}): {c['reason']}" for c in ledger["changelog"][-5:]]
    return "\n".join(lines)


class LedgerStore:
    """lore_ledger.json (or private_ledger.json) in Helper's state folder (no tool can write there directly)."""

    def __init__(self, path: Path, section: str = "lore"):
        self.path = path
        self.section = _sec(section) and section
        self._lock = threading.Lock()

    @classmethod
    def for_home(cls, home: Path, section: str = "lore") -> "LedgerStore":
        return cls(Path(home) / "state" / _sec(section)["file"], section)

    def load(self) -> dict:
        if not self.path.exists():
            return empty_ledger()
        return json.loads(self.path.read_text(encoding="utf-8"))

    def apply(self, patch: dict, approved: bool = False) -> dict:
        with self._lock:
            res = apply_patch(self.load(), patch, approved=approved, section=self.section)
            if "errors" in res:
                return res
            self.path.parent.mkdir(parents=True, exist_ok=True)
            if self.path.exists():
                shutil.copy2(self.path, self.path.with_suffix(".json.bak"))
            tmp = self.path.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(res["ledger"], indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            tmp.replace(self.path)
            return res

    def search(self, query: str = "", status: str = "", limit: int = 20) -> list[dict]:
        words = [w for w in re.split(r"\W+", query.lower()) if w]
        out = []
        for e in self.load()["entries"]:
            if status and e["status"] != status:
                continue
            if not status and e["status"] == "retired":
                continue
            hay = " ".join(str(e.get(k, "")) for k in ("id", "name", "summary", "details", "type")).lower()
            if all(w in hay for w in words):
                out.append(e)
        return out[:limit]
