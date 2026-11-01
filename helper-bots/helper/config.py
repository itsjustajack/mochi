"""Helper home folder, policy files and the four settings layers.

Layers, strongest first: policy (hard limits) > settings.toml > agents/<name>/agent.toml > task words.
A lower layer can only narrow the one above it. Values that try to go past a limit are capped
and reported in `caps`, so the UI can show "Capped by policy" instead of silently clipping.
"""

from __future__ import annotations

import hashlib
import os
import secrets
import shutil
import sys
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

DEFAULTS = Path(__file__).parent / "defaults"
POLICY_FILES = ("tiers.toml", "allowlist.toml", "content.toml")
# Folders inside the home that no tool may ever touch, whatever the allowlist says.
PROTECTED_DIRS = ("policy", "state", "secret", "agents", "logs", "prompts", "profiles")
PROTECTED_FILES = ("settings.toml",)


class ConfigError(Exception):
    pass


def default_home() -> Path:
    env = os.environ.get("HELPER_HOME")
    if env:
        return Path(env).expanduser()
    if sys.platform == "win32":
        return Path(r"C:\BotWork\.helper")
    return Path.home() / ".helper"


def platform_name() -> str:
    if sys.platform == "win32":
        return "windows"
    if "com.termux" in os.environ.get("PREFIX", ""):
        return "android"
    return "linux"


@dataclass
class Home:
    root: Path

    @property
    def policy_dir(self) -> Path:
        env = os.environ.get("HELPER_POLICY_DIR")  # e.g. C:\ProgramData\helper\policy on Windows
        return Path(env) if env else self.root / "policy"

    @property
    def state_dir(self) -> Path:
        return self.root / "state"

    @property
    def logs_dir(self) -> Path:
        return self.root / "logs"

    @property
    def token_file(self) -> Path:
        return self.root / "secret" / "token"

    @property
    def approved_hash_file(self) -> Path:
        return self.state_dir / "policy.approved"

    def protected_paths(self) -> list[Path]:
        out = [(self.root / d) for d in PROTECTED_DIRS] + [self.root / f for f in PROTECTED_FILES]
        out.append(self.policy_dir)
        return [p.resolve() for p in out]


def init_home(home: Home, force: bool = False) -> list[str]:
    """Copy default policy, settings, prompts and agents into the home folder. Never overwrites."""
    done = []
    home.root.mkdir(parents=True, exist_ok=True)
    pairs = [
        (DEFAULTS / "policy", home.policy_dir),
        (DEFAULTS / "prompts", home.root / "prompts"),
        (DEFAULTS / "agents", home.root / "agents"),
    ]
    for src, dst in pairs:
        for f in src.rglob("*"):
            if f.is_file():
                target = dst / f.relative_to(src)
                if force or not target.exists():
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(f, target)
                    done.append(str(target))
    settings = home.root / "settings.toml"
    if force or not settings.exists():
        shutil.copy2(DEFAULTS / "settings.toml", settings)
        done.append(str(settings))
    for d in ("work", "state", "logs", "trash"):
        (home.root / d).mkdir(exist_ok=True)
    if not home.token_file.exists():
        home.token_file.parent.mkdir(parents=True, exist_ok=True)
        home.token_file.write_text(secrets.token_urlsafe(32))
        try:
            os.chmod(home.token_file, 0o600)
            os.chmod(home.token_file.parent, 0o700)
        except OSError:
            pass
        done.append(str(home.token_file))
    return done


def read_token(home: Home) -> str:
    if not home.token_file.exists():
        raise ConfigError("No token yet. Run `helper init` first.")
    return home.token_file.read_text().strip()


def _load_toml(path: Path) -> dict:
    try:
        with open(path, "rb") as f:
            return tomllib.load(f)
    except FileNotFoundError:
        raise ConfigError(f"Missing {path}. Run `helper init`.") from None
    except tomllib.TOMLDecodeError as e:
        raise ConfigError(f"{path} is not valid TOML: {e}") from None


# ---------------------------------------------------------------- policy

@dataclass
class Policy:
    limits: dict
    tiers: dict[str, int]
    disabled: set[str]
    roots: list[Path]
    hosts: list[str]
    auto_allow: set[str]
    adult_content: str
    family_rule: str
    digest: str
    knowledge: list[Path] = field(default_factory=list)   # read-only Drive folders
    rule_docs: list[Path] = field(default_factory=list)   # Jack's rule docs (snapshotted on approve)
    unfiltered_minutes: int = 120

    def tier(self, tool: str) -> int | None:
        if tool in self.disabled:
            return None
        return self.tiers.get(tool)


def policy_digest(home: Home) -> str:
    h = hashlib.sha256()
    for name in POLICY_FILES:
        h.update(name.encode())
        h.update(b"\0")
        h.update((home.policy_dir / name).read_bytes())
        h.update(b"\0")
    return h.hexdigest()


def load_policy(home: Home) -> Policy:
    tiers = _load_toml(home.policy_dir / "tiers.toml")
    allow = _load_toml(home.policy_dir / "allowlist.toml")
    content = _load_toml(home.policy_dir / "content.toml")
    tools = dict(tiers.get("tools", {}))
    disabled = set(tools.pop("disabled", []))
    bad = {k: v for k, v in tools.items() if not (isinstance(v, int) and 0 <= v <= 3)}
    if bad:
        raise ConfigError(f"tiers.toml: tiers must be 0 to 3, got {bad}")
    roots = []
    for r in allow.get("roots", []):
        p = Path(r).expanduser()
        roots.append((p if p.is_absolute() else home.root / p).resolve())
    adult = content.get("adult_content", "never")
    if adult not in ("never", "switch"):
        # "never" locks Filtered; "switch" lets Jack turn on Unfiltered 18+ from the app. Nothing else.
        raise ConfigError("content.toml: adult_content must be \"never\" or \"switch\".")
    minutes = content.get("unfiltered_minutes", 120)
    if not isinstance(minutes, int) or isinstance(minutes, bool) or not 1 <= minutes <= 24 * 60:
        raise ConfigError("content.toml: unfiltered_minutes must be a whole number from 1 to 1440.")

    def _paths(key):
        out = []
        for r in allow.get(key, []):
            p = Path(str(r)).expanduser()
            out.append((p if p.is_absolute() else home.root / p).resolve())
        return out
    return Policy(
        limits=dict(tiers.get("limits", {})),
        tiers=tools,
        disabled=disabled,
        roots=roots,
        hosts=list(allow.get("hosts", [])),
        auto_allow=set(allow.get("auto_allow", [])),
        adult_content=adult,
        family_rule=content.get("family_rule", "").strip()
        or "Everything you write must be suitable for all ages.",
        digest=policy_digest(home),
        knowledge=_paths("knowledge"),
        rule_docs=_paths("rule_docs"),
        unfiltered_minutes=minutes,
    )


def approve_policy(home: Home) -> str:
    policy = load_policy(home)  # refuse to approve a broken policy
    from helper.knowledge import take_rules_snapshot
    try:
        take_rules_snapshot(policy.rule_docs, home.state_dir)  # Jack's rule docs, as approved now
    except ValueError as e:
        raise ConfigError(str(e)) from None
    digest = policy_digest(home)
    home.state_dir.mkdir(parents=True, exist_ok=True)
    home.approved_hash_file.write_text(digest)
    return digest


def policy_is_approved(home: Home, policy: Policy) -> bool:
    try:
        return secrets.compare_digest(home.approved_hash_file.read_text().strip(), policy.digest)
    except FileNotFoundError:
        return False


# ---------------------------------------------------------------- settings and agents

LIMIT_KEYS = ("max_steps", "max_minutes", "max_tokens", "max_tier2_calls")


@dataclass
class Agent:
    key: str
    name: str
    role: str
    color: str
    avatar: str
    story: bool
    tools: list[str]
    roots: list[Path]
    ask_always: set[str]
    limits: dict
    model: dict
    caps: list[str] = field(default_factory=list)
    always_filtered: bool = False   # outward agents (social, email) ignore the Unfiltered switch
    skill: str = ""   # optional prompt skill, e.g. "deep_research" (see helper/skills)

    def public(self) -> dict:
        return {
            "key": self.key,
            "name": self.name,
            "role": self.role,
            "color": self.color,
            "avatar": self.avatar,
            "tools": self.tools,
            "limits": self.limits,
            "model": self.model.get("model"),
            "caps": self.caps,
            "skill": self.skill,
        }


def load_settings(home: Home) -> dict:
    return _load_toml(home.root / "settings.toml")


def _narrow_limits(policy: Policy, *layers: tuple[str, dict]) -> tuple[dict, list[str]]:
    """Each layer may only lower a limit set by the layers above it."""
    eff, caps = {}, []
    for key in LIMIT_KEYS:
        value, source = policy.limits.get(key), "policy"
        for layer_name, layer in layers:
            want = layer.get(key)
            if want is None:
                continue
            if isinstance(want, bool) or not isinstance(want, int) or want < 1:
                caps.append(f"{key}: {layer_name} value {want!r} ignored (must be a whole number above 0)")
                continue
            if value is not None and want > value:
                caps.append(f"{key}: {layer_name} asked for {want}, capped by {source} at {value}")
                continue
            value, source = want, layer_name
        eff[key] = value
    return eff, caps


def load_agents(home: Home, policy: Policy, settings: dict) -> dict[str, Agent]:
    agents = {}
    base = home.root / "agents"
    if not base.exists():
        return agents
    found = []
    for d in base.iterdir():
        f = d / "agent.toml"
        if d.is_dir() and f.exists():
            raw = _load_toml(f)
            found.append((raw.get("order", 99), d.name, raw))
    for _order, key, raw in sorted(found, key=lambda x: (x[0], x[1])):
        agents[key] = build_agent(key, raw, policy, settings, home)
    return agents


def build_agent(key: str, raw: dict, policy: Policy, settings: dict, home: Home,
                task_limits: dict | None = None) -> Agent:
    caps: list[str] = []
    # Tools: only ones the policy knows and has not disabled.
    tools = []
    for t in raw.get("tools", []):
        if policy.tier(t) is None:
            caps.append(f"tool {t}: not allowed by policy, left out")
        else:
            tools.append(t)
    # Folders: each must sit inside a policy root.
    roots = []
    for r in raw.get("roots", []) or []:
        p = Path(r).expanduser()
        p = (p if p.is_absolute() else home.root / p).resolve()
        if any(p == pr or pr in p.parents for pr in policy.roots):
            roots.append(p)
        else:
            caps.append(f"folder {r}: outside the policy folders, left out")
    if not raw.get("roots"):
        roots = list(policy.roots)
    limits, lcaps = _narrow_limits(
        policy,
        ("settings", settings.get("limits", {})),
        ("agent", raw.get("limits", {})),
        ("task", task_limits or {}),
    )
    model = {**settings.get("model", {}), **raw.get("model", {})}
    from helper.skills import SKILLS
    skill = str(raw.get("skill", "") or "")
    if skill and skill not in SKILLS:
        caps.append(f"skill {skill}: not installed, left out")
        skill = ""
    return Agent(
        key=key,
        name=str(raw.get("name", key.title())),
        role=str(raw.get("role", "")),
        color=str(raw.get("color", "#8fa8f0")),
        avatar=str(raw.get("avatar", "")),
        story=bool(raw.get("story", False)),
        tools=tools,
        roots=roots,
        ask_always=set(raw.get("ask_always", [])),
        limits=limits,
        model=model,
        caps=caps + lcaps,
        skill=skill,
        always_filtered=bool(raw.get("always_filtered", False)),
    )
