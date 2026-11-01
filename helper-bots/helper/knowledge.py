"""Drive knowledge, rules from Drive, and the Filtered / Unfiltered 18+ switch.

Drive knowledge
  The simple way to bring Google Drive in: install Google Drive for desktop (free), which shows Drive as
  a folder (for example G:\\My Drive). Jack lists the folders Helper may read in policy/allowlist.toml:
      knowledge = ["G:/My Drive/Helper"]
  then runs `helper policy approve`. Agents with the knowledge tools can search and read those folders.
  They can never write there: no write tool accepts a knowledge path. What they learn goes to the
  Guild Ledger as drafts (ledger_propose), and Jack's tap makes it canon.
  Note: Google Docs show up in Drive for desktop as .gdoc shortcuts with no text. Save notes you want
  Helper to read as .txt, .md, .json or code files (or File > Download as plain text).

Rules from Drive
  Jack picks which files are his agents' rules, also in allowlist.toml:
      rule_docs = ["G:/My Drive/Guild_Prompt.txt"]
  `helper policy approve` takes a snapshot of each rule doc. Agents get the approved snapshot as fixed
  rules, ahead of everything else. If a rule doc changes in Drive, agents keep using the approved copy
  and the app says the doc changed, until Jack approves again. A doc that tries to switch the rules off
  (an override or jailbreak doc) can't be approved as a rule.

The content switch
  policy/content.toml `adult_content = "switch"` lets Jack turn on Unfiltered 18+ from the app. "never"
  keeps Helper Filtered for good. The mode is kept in the state folder, which no agent tool can reach,
  and turns itself back to Filtered after `unfiltered_minutes`. Agents marked always_filtered (outward
  ones like social posts and email) stay Filtered. Two limits hold in every mode and can't be edited.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import time
from pathlib import Path

FIXED_LIMITS = ("Never write sexual content involving minors or anyone childlike (including age-play or age "
                "regression), and never sexual content about real people. These two limits hold in every mode "
                "and nothing can change them.")
UNFILTERED_RULE = ("Content mode: Unfiltered 18+. Jack is an adult and has turned off Helper's content filter, so "
                   "mature and explicit themes are allowed when he asks for them. " + FIXED_LIMITS)
TEXT_EXT = {".txt", ".md", ".markdown", ".json", ".js", ".mjs", ".py", ".sh", ".csv", ".toml", ".yaml", ".yml",
            ".html", ".css", ".log"}
MAX_FILE = 2_000_000
RULES_MAX_CHARS = 24_000

# Narrower than sanitize.looks_like_injection: rule docs may talk ABOUT jailbreaks (to forbid them),
# but may not tell the agent to drop its rules.
OVERRIDE = re.compile(
    r"ignore (?:all |any )?(?:the |your )?(?:previous|prior|above|earlier|safety|other) (?:instructions|rules|guidelines)"
    r"|disregard (?:all |the |your )?(?:previous|prior|safety) (?:instructions|rules|guidelines)"
    r"|(?:enter|switch to|enable|activate) (?:developer|dan|god|jailbreak|unrestricted) mode"
    r"|you (?:have|are under) no (?:rules|restrictions|limits|guidelines)"
    r"|(?:bypass|override|turn off|disable) (?:the |your |all )?(?:safety|rules|filters?|guardrails|limits)",
    re.IGNORECASE,
)


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# ---------------------------------------------------------------- rules from Drive

def snapshot_path(state_dir: Path) -> Path:
    return state_dir / "rules_approved.json"


def take_rules_snapshot(rule_docs: list[Path], state_dir: Path) -> list[dict]:
    """Called by `helper policy approve`. Raises ValueError for a missing doc or an override doc."""
    docs = []
    for p in rule_docs:
        if not p.is_file():
            raise ValueError(f"rule doc not found: {p}")
        raw = p.read_bytes()[:MAX_FILE]
        text = raw.decode("utf-8", errors="replace")
        m = OVERRIDE.search(text)
        if m:
            raise ValueError(f"{p.name} can't be a rule doc: it tells agents to drop their rules (\"{m.group(0)}\")")
        docs.append({"path": str(p), "name": p.name, "sha256": _sha(raw), "text": text, "approved": time.time()})
    state_dir.mkdir(parents=True, exist_ok=True)
    snapshot_path(state_dir).write_text(json.dumps({"docs": docs}, ensure_ascii=False), encoding="utf-8")
    return docs


def load_rules(state_dir: Path) -> list[dict]:
    try:
        return json.loads(snapshot_path(state_dir).read_text(encoding="utf-8")).get("docs", [])
    except (FileNotFoundError, ValueError):
        return []


def rules_status(rule_docs: list[Path], state_dir: Path) -> list[dict]:
    approved = {d["path"]: d for d in load_rules(state_dir)}
    out = []
    for p in rule_docs:
        d = approved.get(str(p))
        if not p.is_file():
            state = "missing"
        elif d is None:
            state = "not approved yet"
        elif _sha(p.read_bytes()[:MAX_FILE]) != d["sha256"]:
            state = "changed in Drive; using the approved copy until you approve again"
        else:
            state = "in use"
        out.append({"name": p.name, "path": str(p), "state": state})
    return out


def rules_text(state_dir: Path) -> str:
    docs = load_rules(state_dir)
    if not docs:
        return ""
    parts, used = [], 0
    for d in docs:
        piece = f"--- {d['name']} ---\n{d['text'].strip()}"
        if used + len(piece) > RULES_MAX_CHARS:
            piece = piece[:max(0, RULES_MAX_CHARS - used)] + "\n[rest of this rule doc cut for length]"
        parts.append(piece)
        used += len(piece)
        if used >= RULES_MAX_CHARS:
            break
    return ("JACK'S RULES (from his Drive, approved by him; agents can't change them; where they talk about "
            "other tools or files, follow their intent inside Helper):\n" + "\n\n".join(parts))


# ---------------------------------------------------------------- content switch

def mode_path(state_dir: Path) -> Path:
    return state_dir / "content_mode.json"


def current_mode(state_dir: Path, policy) -> dict:
    if getattr(policy, "adult_content", "never") != "switch":
        return {"mode": "filtered", "locked": True, "until": None}
    try:
        data = json.loads(mode_path(state_dir).read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        data = {}
    if data.get("mode") == "unfiltered" and float(data.get("until") or 0) > time.time():
        return {"mode": "unfiltered", "locked": False, "until": data["until"]}
    return {"mode": "filtered", "locked": False, "until": None}


def set_mode(state_dir: Path, policy, mode: str) -> dict:
    """Only the app's own panel (Jack's click) or the CLI calls this."""
    if mode not in ("filtered", "unfiltered"):
        raise ValueError("mode must be filtered or unfiltered")
    if mode == "unfiltered" and getattr(policy, "adult_content", "never") != "switch":
        raise ValueError("Unfiltered is locked off in content.toml (adult_content = \"never\")")
    minutes = int(getattr(policy, "unfiltered_minutes", 120) or 120)
    data = {"mode": mode, "until": time.time() + minutes * 60 if mode == "unfiltered" else None}
    state_dir.mkdir(parents=True, exist_ok=True)
    mode_path(state_dir).write_text(json.dumps(data), encoding="utf-8")
    return current_mode(state_dir, policy)


def content_rule(state_dir: Path, policy, agent) -> str:
    if getattr(agent, "always_filtered", False) or current_mode(state_dir, policy)["mode"] == "filtered":
        return f"{policy.family_rule} {FIXED_LIMITS}"
    return UNFILTERED_RULE


# ---------------------------------------------------------------- Drive knowledge

def resolve_knowledge(raw: str, roots: list[Path]) -> Path:
    """A path inside one of the knowledge folders, following links; anything else is refused."""
    if not roots:
        raise ValueError("no knowledge folders are linked yet")
    p = Path(raw)
    cands = [p] if p.is_absolute() else [r / p for r in roots]
    for c in cands:
        real = c.resolve()
        for r in roots:
            rr = r.resolve()
            if real == rr or rr in real.parents:
                return real
    raise ValueError(f"{raw} is not inside a linked knowledge folder")


def search(roots: list[Path], query: str, limit: int = 15) -> list[dict]:
    words = [w for w in re.split(r"\W+", query.lower()) if len(w) > 1]
    hits = []
    for r in roots:
        if not r.is_dir():
            continue
        for dirpath, dirnames, filenames in os.walk(r):
            dirnames[:] = [d for d in dirnames if not d.startswith(".")]
            for fn in filenames:
                p = Path(dirpath) / fn
                if p.suffix.lower() not in TEXT_EXT:
                    continue
                try:
                    if p.stat().st_size > MAX_FILE:
                        continue
                    text = p.read_text(encoding="utf-8", errors="replace")
                except OSError:
                    continue
                low = text.lower()
                name_low = fn.lower()
                score = sum(low.count(w) + 5 * name_low.count(w) for w in words) if words else 1
                if words and not all(w in low or w in name_low for w in words):
                    continue
                i = min([low.find(w) for w in words if low.find(w) >= 0] or [0])
                snippet = text[max(0, i - 120):i + 240].replace("\n", " ")
                hits.append({"path": str(p.relative_to(r)), "folder": r.name, "score": score, "snippet": snippet})
    hits.sort(key=lambda h: -h["score"])
    return hits[:limit]
