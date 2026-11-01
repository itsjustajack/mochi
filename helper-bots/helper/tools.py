"""Tool registry and the tool functions.

Rules:
- Tools take typed arguments only, never a shell string. There is no shell tool.
- Path arguments use the WorkPath type. The gate resolves them (following symlinks and ..)
  and rejects anything outside the agent's folders or inside a protected folder BEFORE the tool runs.
- Only the gate calls `execute`. The loop never imports tool functions directly.
- Every change keeps a copy in the trash folder, so it can be undone.
"""

from __future__ import annotations

import inspect
import random
import shutil
import time
import typing
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, NewType

WorkPath = NewType("WorkPath", str)


@dataclass
class ToolResult:
    ok: bool
    data: str          # always treated as untrusted by the loop
    source: str        # "local", "file:<path>", "web:<host>"
    taints: bool = False  # True for web pages, downloads, incoming messages


@dataclass
class ToolContext:
    roots: list[Path]
    home: Path
    trash: Path


@dataclass
class ToolSpec:
    name: str
    func: Callable
    doc: str
    params: dict[str, dict]      # name -> {"type": "string"|"integer"|"boolean", "path": bool, "required": bool, "default": ...}

    def schema(self) -> dict:
        props, req = {}, []
        for n, p in self.params.items():
            props[n] = {"type": p["type"]}
            if p["required"]:
                req.append(n)
        return {"name": self.name, "description": self.doc,
                "parameters": {"type": "object", "properties": props, "required": req}}


REGISTRY: dict[str, ToolSpec] = {}
_TYPES = {str: "string", int: "integer", bool: "boolean", WorkPath: "string"}


def tool(func: Callable) -> Callable:
    """Register a tool; its JSON schema comes from the type hints."""
    hints = typing.get_type_hints(func)
    params = {}
    for name, p in inspect.signature(func).parameters.items():
        if name == "ctx":
            continue
        t = hints.get(name, str)
        if t not in _TYPES:
            raise TypeError(f"tool {func.__name__}: unsupported type for {name}")
        params[name] = {
            "type": _TYPES[t],
            "path": t is WorkPath,
            "required": p.default is inspect.Parameter.empty,
            "default": None if p.default is inspect.Parameter.empty else p.default,
        }
    REGISTRY[func.__name__] = ToolSpec(func.__name__, func, (func.__doc__ or "").strip(), params)
    return func


class ArgError(ValueError):
    pass


def resolve_path(raw: str, roots: list[Path], protected: list[Path]) -> Path:
    if not isinstance(raw, str) or not raw.strip():
        raise ArgError("path is empty")
    if "\x00" in raw:
        raise ArgError("path contains a null byte")
    p = Path(raw).expanduser()
    if not p.is_absolute():
        if not roots:
            raise ArgError("this agent has no folders")
        p = roots[0] / p
    p = p.resolve()
    for pr in protected:
        if p == pr or pr in p.parents:
            raise ArgError(f"{raw} is inside a protected folder")
    if not any(p == r or r in p.parents for r in roots):
        raise ArgError(f"{raw} is outside the allowed folders")
    return p


def validate_args(spec: ToolSpec, args: dict, roots: list[Path], protected: list[Path]) -> dict:
    """Check types and resolve paths. Returns cleaned arguments or raises ArgError."""
    if not isinstance(args, dict):
        raise ArgError("args must be an object")
    unknown = set(args) - set(spec.params)
    if unknown:
        raise ArgError(f"unknown arguments: {sorted(unknown)}")
    clean = {}
    for name, p in spec.params.items():
        if name not in args:
            if p["required"]:
                raise ArgError(f"missing argument: {name}")
            continue
        v = args[name]
        want = {"string": str, "integer": int, "boolean": bool}[p["type"]]
        if want is int and isinstance(v, bool) or not isinstance(v, want):
            raise ArgError(f"{name} must be a {p['type']}")
        if p["path"]:
            v = resolve_path(v, roots, protected)
        clean[name] = v
    return clean


def execute(spec: ToolSpec, clean_args: dict, ctx: ToolContext) -> ToolResult:
    try:
        return spec.func(ctx, **clean_args)
    except Exception as e:  # a tool failing is a result, not a crash
        return ToolResult(False, f"{type(e).__name__}: {e}", "local")


def _rel(ctx: ToolContext, p: Path) -> str:
    for r in ctx.roots:
        if p == r or r in p.parents:
            return str(p.relative_to(r)) or "."
    return p.name


def _to_trash(ctx: ToolContext, p: Path) -> Path:
    stamp = time.strftime("%Y%m%d-%H%M%S")
    dest = ctx.trash / stamp / p.name
    n = 1
    while dest.exists():
        dest = ctx.trash / f"{stamp}-{n}" / p.name
        n += 1
    dest.parent.mkdir(parents=True, exist_ok=True)
    if p.is_dir():
        shutil.copytree(p, dest)
    else:
        shutil.copy2(p, dest)
    return dest


# ---------------------------------------------------------------- tools

@tool
def list_folder(ctx: ToolContext, path: WorkPath = WorkPath(".")) -> ToolResult:
    """List files and folders in a folder (one level)."""
    p = Path(path)
    if not p.is_dir():
        return ToolResult(False, f"{_rel(ctx, p)} is not a folder", "local")
    rows = []
    for c in sorted(p.iterdir(), key=lambda c: (not c.is_dir(), c.name.lower()))[:500]:
        rows.append(f"{c.name}/" if c.is_dir() else f"{c.name}  ({c.stat().st_size} bytes)")
    return ToolResult(True, "\n".join(rows) or "(empty folder)", f"file:{_rel(ctx, p)}")


@tool
def read_file(ctx: ToolContext, path: WorkPath, max_chars: int = 20000) -> ToolResult:
    """Read a text file."""
    p = Path(path)
    if not p.is_file():
        return ToolResult(False, f"{_rel(ctx, p)} is not a file", "local")
    text = p.read_text(encoding="utf-8", errors="replace")[: max(1, min(max_chars, 100000))]
    # Files that came from outside (downloads) count as untrusted input.
    taints = "download" in str(p).lower()
    return ToolResult(True, text, f"file:{_rel(ctx, p)}", taints=taints)


@tool
def write_file(ctx: ToolContext, path: WorkPath, text: str) -> ToolResult:
    """Write text to a file in the work folder (an old version is kept in the trash)."""
    p = Path(path)
    if p.is_dir():
        return ToolResult(False, f"{_rel(ctx, p)} is a folder", "local")
    backup = _to_trash(ctx, p) if p.exists() else None
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(p.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(p)
    note = f" (old version saved to trash/{backup.parent.name})" if backup else ""
    return ToolResult(True, f"Wrote {len(text)} characters to {_rel(ctx, p)}{note}", "local")


@tool
def move_file(ctx: ToolContext, src: WorkPath, dst: WorkPath) -> ToolResult:
    """Move or rename a file or folder inside the allowed folders. Never overwrites."""
    s, d = Path(src), Path(dst)
    if not s.exists():
        return ToolResult(False, f"{_rel(ctx, s)} does not exist", "local")
    if d.is_dir():
        d = d / s.name
    if d.exists():
        return ToolResult(False, f"{_rel(ctx, d)} already exists", "local")
    d.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(s), str(d))
    return ToolResult(True, f"Moved {_rel(ctx, s)} to {_rel(ctx, d)}", "local")


@tool
def delete_file(ctx: ToolContext, path: WorkPath) -> ToolResult:
    """Delete a file or folder. It goes to the trash folder so it can be restored."""
    p = Path(path)
    if not p.exists():
        return ToolResult(False, f"{_rel(ctx, p)} does not exist", "local")
    if any(p == r for r in ctx.roots):
        return ToolResult(False, "refusing to delete a whole allowed folder", "local")
    dest = _to_trash(ctx, p)
    if p.is_dir():
        shutil.rmtree(p)
    else:
        p.unlink()
    return ToolResult(True, f"Deleted {_rel(ctx, p)} (restorable from trash/{dest.parent.name})", "local")


@tool
def roll_dice(ctx: ToolContext, sides: int = 20, count: int = 1) -> ToolResult:
    """Roll dice, e.g. sides=20 count=1 for a d20. Shows every roll."""
    if sides not in (2, 4, 6, 8, 10, 12, 20, 100) or not 1 <= count <= 20:
        return ToolResult(False, "use sides of 2, 4, 6, 8, 10, 12, 20 or 100 and 1 to 20 dice", "local")
    rolls = [random.SystemRandom().randint(1, sides) for _ in range(count)]
    return ToolResult(True, f"{count}d{sides}: {rolls} total {sum(rolls)}", "local")
