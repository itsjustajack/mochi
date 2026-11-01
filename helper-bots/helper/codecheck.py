"""Code check: find what's wrong with a script and explain it in plain English.

Inspired by OnHand (paste, detect, explain, fix) and ScriptForge (write, check, critique, fix).
This first part covers detect and check for Python, Bash, JavaScript (Node), Janitor AI
scripts (strict ES5) and JSON.

Nothing here runs the code being checked. Python is parsed with the `ast` module. JavaScript
and Bash use `node --check` and `bash -n`, which only read the file, when those programs exist;
otherwise a bracket and quote balance check stands in.

Each finding has a level, shown on the Code check screen:
  stops  - the script won't run at all (syntax, or ES5-only features on Janitor)
  crash  - it runs but will fail on some input (empty list, divide by zero, no match)
  watch  - works, but worth knowing (style, risky patterns)
"""

from __future__ import annotations

import ast
import json
import os
import re
import shutil
import subprocess
import tempfile

LANGS = ("python", "bash", "javascript", "janitor", "json")
LEVEL_ORDER = {"stops": 0, "crash": 1, "watch": 2}
MAX_CODE = 200_000


def finding(code: str, level: str, line: int | None, message: str, hint: str = "") -> dict:
    return {"code": code, "level": level, "line": line, "message": message, "hint": hint}


# ---------------------------------------------------------------- detect

def detect_language(code: str, filename: str = "") -> str:
    ext = os.path.splitext(filename.lower())[1]
    by_ext = {".py": "python", ".sh": "bash", ".bash": "bash", ".json": "json", ".js": "javascript",
              ".mjs": "javascript", ".cjs": "javascript"}
    first = code.lstrip().splitlines()[0] if code.strip() else ""
    if "context.character" in code or "context.chat" in code:
        return "janitor"
    if ext in by_ext:
        return by_ext[ext]
    if first.startswith("#!"):
        if "python" in first:
            return "python"
        if "bash" in first or first.endswith("/sh"):
            return "bash"
        if "node" in first:
            return "javascript"
    stripped = code.strip()
    if stripped[:1] in "{[":
        try:
            json.loads(stripped)
            return "json"
        except ValueError:
            if re.match(r'[\[{]\s*("|\]|\}|\[|\{|-?\d)', stripped) and not re.search(r"\b(function|var|let|const|return)\b", stripped):
                return "json"
    scores = {
        "python": len(re.findall(r"^\s*(def |import |from \w+ import |class \w+.*:|elif |print\()", code, re.M)),
        "bash": len(re.findall(r"^\s*(fi|done|esac|then|echo |local |set -[a-z]+)\b|\$\{?\w+\}?|\[\[", code, re.M)),
        "javascript": len(re.findall(r"\b(function|var|let|const|=>|console\.log|require\(|===)\b|;\s*$", code, re.M)),
    }
    best = max(scores, key=scores.get)
    return best if scores[best] else "javascript"


# ---------------------------------------------------------------- shared helpers

def _strip_js(code: str) -> str:
    """Blank out comments, strings, template literals and regex literals, keeping line breaks."""
    out, i, n = [], 0, len(code)
    prev = ""
    while i < n:
        c = code[i]
        two = code[i:i + 2]
        if two == "//":
            j = code.find("\n", i)
            j = n if j < 0 else j
            out.append(" " * (j - i))
            i = j
            continue
        if two == "/*":
            j = code.find("*/", i + 2)
            j = n if j < 0 else j + 2
            out.append(re.sub(r"[^\n]", " ", code[i:j]))
            i = j
            continue
        if c in "\"'`":
            j = i + 1
            while j < n and code[j] != c:
                if code[j] == "\\":
                    j += 1
                elif code[j] == "\n" and c != "`":
                    break
                j += 1
            seg = code[i:j + 1]
            keep = "`" if c == "`" else '"'
            out.append(keep + re.sub(r"[^\n]", " ", seg[1:-1]) + keep if len(seg) > 1 else seg)
            i = j + 1
            prev = keep
            continue
        if c == "/" and prev and prev in "(,=:[!&|?{};" :
            j = i + 1
            while j < n and code[j] not in "/\n":
                if code[j] == "\\":
                    j += 1
                elif code[j] == "[":
                    k = code.find("]", j)
                    j = k if k > 0 else j
                j += 1
            if j < n and code[j] == "/":
                out.append("/" + " " * (j - i - 1) + "/")
                i = j + 1
                prev = "/"
                continue
        out.append(c)
        if not c.isspace():
            prev = c
        i += 1
    return "".join(out)


def _line_of(text: str, pos: int) -> int:
    return text.count("\n", 0, pos) + 1


def _balance(code: str, comment: str) -> list[dict]:
    pairs = {")": "(", "]": "[", "}": "{"}
    stack: list[tuple[str, int]] = []
    clean = _strip_js(code) if comment == "//" else re.sub(r"#[^\n]*|\"(?:\\.|[^\"\\])*\"|'[^']*'", '""', code)
    for ln, line in enumerate(clean.splitlines(), 1):
        for ch in line:
            if ch in "([{":
                stack.append((ch, ln))
            elif ch in ")]}":
                if not stack or stack[-1][0] != pairs[ch]:
                    return [finding("S001", "stops", ln, f"'{ch}' has no matching opening bracket")]
                stack.pop()
    if stack:
        ch, ln = stack[-1]
        return [finding("S001", "stops", ln, f"'{ch}' is never closed")]
    return []


def _parse_only(cmd: list[str], suffix: str, code: str) -> tuple[bool, str] | None:
    """Run a parse-only check (node --check, bash -n). None when the program isn't installed."""
    exe = shutil.which(cmd[0])
    if not exe:
        return None
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "check" + suffix)
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(code)
        try:
            p = subprocess.run([exe] + cmd[1:] + [path], capture_output=True, text=True, timeout=20)
        except (OSError, subprocess.TimeoutExpired):
            return None
        return p.returncode == 0, (p.stderr or p.stdout).replace(path, "line")


# ---------------------------------------------------------------- Python

def _py_funcs(tree):
    return [n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]


def _py_guarded(func, name: str) -> bool:
    """Is there an early return/raise that tests `name` (empty or zero)?"""
    for n in ast.walk(func):
        if isinstance(n, ast.If) and any(isinstance(s, (ast.Return, ast.Raise)) for s in n.body):
            if name in {x.id for x in ast.walk(n.test) if isinstance(x, ast.Name)}:
                return True
    return False


def check_python(code: str) -> list[dict]:
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return [finding("S001", "stops", e.lineno, f"Syntax error: {e.msg}.",
                        "Check the line above it too: a missing ':' or bracket often shows up one line later.")]
    out = []
    for func in _py_funcs(tree):
        params = {a.arg for a in func.args.posonlyargs + func.args.args + func.args.kwonlyargs}
        for d in func.args.defaults + [k for k in func.args.kw_defaults if k]:
            if isinstance(d, (ast.List, ast.Dict, ast.Set)):
                out.append(finding("P001", "crash", d.lineno,
                                   f"'{func.name}' uses a list or dict as a default value, so every call shares it.",
                                   "Use None as the default and create the list inside the function."))
        for n in ast.walk(func):
            if isinstance(n, ast.BinOp) and isinstance(n.op, (ast.Div, ast.FloorDiv, ast.Mod)):
                r = n.right
                if isinstance(r, ast.Call) and getattr(r.func, "id", "") == "len" and r.args \
                        and isinstance(r.args[0], ast.Name) and r.args[0].id in params \
                        and not _py_guarded(func, r.args[0].id):
                    out.append(finding("P010", "crash", n.lineno,
                                       f"Divides by len({r.args[0].id}), which fails when it's empty.",
                                       f"Return early when {r.args[0].id} is empty."))
                elif isinstance(r, ast.Name) and r.id in params and not _py_guarded(func, r.id):
                    out.append(finding("P011", "crash", n.lineno, f"Divides by {r.id} with no check for zero.",
                                       f"Check {r.id} == 0 first."))
            if isinstance(n, ast.Call) and getattr(n.func, "id", "") in ("max", "min") and len(n.args) == 1 \
                    and isinstance(n.args[0], ast.Name) and n.args[0].id in params and not n.keywords \
                    and not _py_guarded(func, n.args[0].id):
                out.append(finding("P012", "crash", n.lineno,
                                   f"{n.func.id}({n.args[0].id}) fails when {n.args[0].id} is empty.",
                                   "Add default=... or return early when it's empty."))
            if isinstance(n, ast.While) and isinstance(n.test, ast.Constant) and n.test.value is True \
                    and not any(isinstance(x, (ast.Break, ast.Return, ast.Raise)) for x in ast.walk(n)):
                out.append(finding("P020", "crash", n.lineno, "'while True' loop never ends.",
                                   "Add a break or return."))
            if isinstance(n, ast.Assign) and isinstance(n.value, ast.Call) \
                    and getattr(n.value.func, "id", "") == "open":
                out.append(finding("P030", "watch", n.lineno, "File opened without 'with', so it may stay open on an error.",
                                   "Use: with open(...) as f:"))
    for n in ast.walk(tree):
        if isinstance(n, ast.ExceptHandler) and n.type is None:
            out.append(finding("P040", "watch", n.lineno, "Bare 'except:' also hides Ctrl+C and typos.",
                               "Catch Exception, or the specific error you expect."))
        if isinstance(n, ast.Call) and getattr(n.func, "id", "") in ("eval", "exec"):
            out.append(finding("P050", "watch", n.lineno, f"{n.func.id}() runs any text as code.",
                               "Parse the data instead (json.loads, int(), ...)."))
        if isinstance(n, ast.Call) and any(k.arg == "shell" and getattr(k.value, "value", None) is True
                                           for k in n.keywords):
            out.append(finding("P051", "watch", n.lineno, "shell=True passes the command through the shell.",
                               "Pass a list of arguments instead."))
        if isinstance(n, ast.Compare) and any(isinstance(o, (ast.Eq, ast.NotEq)) for o in n.ops) \
                and any(isinstance(c, ast.Constant) and c.value is None for c in n.comparators):
            out.append(finding("P060", "watch", n.lineno, "Compares to None with == or !=.", "Use 'is None'."))
    return out


# ---------------------------------------------------------------- Bash

def check_bash(code: str) -> list[dict]:
    res = _parse_only(["bash", "-n"], ".sh", code)
    if res is None:
        syn = _balance(code, "#")
        if syn:
            return syn
    elif not res[0]:
        m = re.search(r"line (\d+)", res[1])
        msg = res[1].strip().splitlines()[-1] if res[1].strip() else "syntax error"
        return [finding("S001", "stops", int(m.group(1)) if m else None, f"Syntax error: {msg.split(': ', 2)[-1]}")]
    out = []
    lines = code.splitlines()
    if not lines or not lines[0].startswith("#!"):
        out.append(finding("B001", "watch", 1, "No #!/usr/bin/env bash line at the top.",
                           "Add it so the script runs with bash, not sh."))
    if not re.search(r"^\s*set\s+-\w*e\w*", code, re.M):
        out.append(finding("B002", "watch", 1, "Errors don't stop the script, so it carries on after a failure.",
                           "Add: set -euo pipefail"))
    for i, line in enumerate(lines, 1):
        bare = re.sub(r"'[^']*'|\"(?:\\.|[^\"\\])*\"|#.*$", "", line)
        if re.search(r"\beval\b", bare):
            out.append(finding("B010", "watch", i, "eval runs text as a command.", "Avoid eval."))
        if re.search(r"\brm\s+-\w*r\w*f?\w*\s+(/|\"?\$\w+\"?/?)(\s|$)", bare):
            out.append(finding("B011", "crash", i, "rm -rf on / or on a bare variable can wipe far more than meant.",
                               "Check the variable isn't empty first, and use \"${dir:?}\"."))
        if re.search(r"(curl|wget)\b[^|]*\|\s*(ba)?sh\b", bare):
            out.append(finding("B012", "watch", i, "Downloads and runs a script in one go.",
                               "Download it, read it, then run it."))
        if re.search(r"(^|[\s(])\$\{?[1-9@*]\}?(\s|$|;)", bare) and not re.search(r"\[\[|\(\(", bare) \
                and not re.match(r"\s*(local\s+)?\w+=", bare):
            out.append(finding("B020", "watch", i, "An argument is used without quotes, so spaces split it.",
                               "Wrap it in quotes: \"$1\""))
    for m in re.finditer(r"while\s+(true|:)\s*;\s*do", code):
        rest = code[m.end():]
        end = rest.find("done")
        if not re.search(r"\b(break|return|exit)\b", rest[:end if end >= 0 else None]):
            out.append(finding("B030", "crash", _line_of(code, m.start()), "'while true' loop never ends.",
                               "Add a break."))
    return out


# ---------------------------------------------------------------- JavaScript and Janitor ES5

ES5_RULES = [
    (r"\blet\s+[\w$\[{]", "let"), (r"\bconst\s+[\w$\[{]", "const"), (r"=>", "arrow function (=>)"),
    (r"`", "template string (`...`)"), (r"\bclass\s+\w", "class"), (r"\.\.\.", "spread or rest (...)"),
    (r"\bfor\s*\([^)]*\bof\b", "for...of"), (r"\basync\b|\bawait\b", "async / await"),
    (r"\?\.", "optional chaining (?.)"), (r"\?\?", "?? operator"), (r"\*\*", "** operator"),
    (r"function\s*\w*\s*\([^)]*=", "default parameter values"),
    (r"\b(Promise|Symbol|Map|Set|WeakMap)\b", "a newer built-in (Promise, Map, Set...)"),
    (r"\.(includes|startsWith|endsWith|padStart|padEnd|find|findIndex|repeat)\s*\(", "a newer method"),
]


def _js_common(clean: str) -> list[dict]:
    out = []
    for m in re.finditer(r"\beval\s*\(|\bnew\s+Function\s*\(", clean):
        out.append(finding("J050", "watch", _line_of(clean, m.start()), "Runs text as code.", "Avoid eval / new Function."))
    for m in re.finditer(r"while\s*\(\s*(true|1)\s*\)", clean):
        rest = clean[m.end():]
        if not re.search(r"\b(break|return|throw)\b", rest[:2000]):
            out.append(finding("J020", "crash", _line_of(clean, m.start()), "'while (true)' loop never ends.",
                               "Add a break."))
    for m in re.finditer(r"/\s*([\w$.]+)\.length\b", clean):
        name = m.group(1)
        if not re.search(r"if\s*\([^)]*(!\s*" + re.escape(name) + r"\b|" + re.escape(name) + r"\.length\s*(===?|<|<=)\s*[01])",
                         clean):
            out.append(finding("J010", "crash", _line_of(clean, m.start()),
                               f"Divides by {name}.length, which gives NaN when it's empty.",
                               f"Check {name}.length first."))
    return out


def check_javascript(code: str) -> list[dict]:
    res = _parse_only(["node", "--check"], ".js", code)
    if res is None:
        syn = _balance(code, "//")
        if syn:
            return syn
    elif not res[0]:
        m = re.search(r"line:(\d+)", res[1])
        msg = next((ln for ln in res[1].splitlines() if "Error" in ln), "syntax error").strip()
        return [finding("S001", "stops", int(m.group(1)) if m else None, msg)]
    clean = _strip_js(code)
    out = _js_common(clean)
    for m in re.finditer(r"\bvar\s+\w", clean):
        out.append(finding("J001", "watch", _line_of(clean, m.start()), "'var' leaks out of blocks.",
                           "Use let or const (fine to keep for Janitor scripts)."))
    for m in re.finditer(r"[^=!<>]==[^=]|!=[^=]", clean):
        out.append(finding("J002", "watch", _line_of(clean, m.start()), "== and != convert types first ('1' == 1).",
                           "Use === and !==."))
    return out


def check_janitor(code: str) -> list[dict]:
    """Janitor AI runs scripts as strict ES5 and stops silently on anything newer."""
    syn = _balance(code, "//")
    if syn:
        return syn
    clean = _strip_js(code)
    out = []
    for pattern, what in ES5_RULES:
        for m in re.finditer(pattern, clean):
            out.append(finding("E001", "stops", _line_of(clean, m.start()),
                               f"Uses {what}. Janitor only runs ES5 and stops with no error message.",
                               "Rewrite it in ES5 (var, function(){}, string + string)."))
            break  # one per feature is enough
    out += _js_common(clean)
    for m in re.finditer(r"\.match\([^;\n]*\)\s*\[\s*\d+\s*\]", clean):
        out.append(finding("E010", "crash", _line_of(clean, m.start()),
                           "Reads a match result without checking there was a match.",
                           "Save the match in a var and check it isn't null first."))
    for m in re.finditer(r"\.indexOf\(\s*\"", clean):
        out.append(finding("E020", "watch", _line_of(clean, m.start()),
                           "indexOf matches inside words, so \"cat\" also fires on \"catch\".",
                           "Match whole words (pad with spaces, or use a \\b regex)."))
        break
    for m in re.finditer(r"context\.character\.(personality|scenario)\s*=(?!=)(?!\s*\"\"\s*[;}])(?!\s*String\()", clean):
        out.append(finding("E030", "watch", _line_of(clean, m.start()),
                           "Replaces the whole personality or scenario instead of adding to it.",
                           "Use += unless you mean to replace it."))
        break
    return out


def check_json(code: str) -> list[dict]:
    try:
        json.loads(code)
    except json.JSONDecodeError as e:
        hint = "JSON has no trailing commas and needs double quotes." if "Expecting" in e.msg else ""
        return [finding("S001", "stops", e.lineno, f"Not valid JSON: {e.msg}.", hint)]
    return []


CHECKERS = {"python": check_python, "bash": check_bash, "javascript": check_javascript,
            "janitor": check_janitor, "json": check_json}


def check(code: str, language: str = "", filename: str = "") -> dict:
    """Check `code`. Returns {"language", "findings", "summary"} with the worst findings first."""
    if len(code) > MAX_CODE:
        return {"language": language or "unknown", "findings": [
            finding("X001", "stops", None, "That's too long to check in one go (200 KB max).")],
            "summary": "Too long to check."}
    lang = language.lower().strip() if language else detect_language(code, filename)
    if lang in ("js", "node", "nodejs"):
        lang = "javascript"
    if lang in ("sh", "shell"):
        lang = "bash"
    if lang in ("py", "python3"):
        lang = "python"
    if lang not in CHECKERS:
        raise ValueError(f"Code check doesn't know {language!r} yet. It knows: {', '.join(LANGS)}")
    found = CHECKERS[lang](code)
    seen, uniq = set(), []
    for f in found:
        key = (f["code"], f["line"])
        if key not in seen:
            seen.add(key)
            uniq.append(f)
    uniq.sort(key=lambda f: (LEVEL_ORDER[f["level"]], f["line"] or 0))
    counts = {lvl: sum(1 for f in uniq if f["level"] == lvl) for lvl in LEVEL_ORDER}
    if not uniq:
        summary = "No problems found."
    else:
        parts = [f"{n} {lvl}" for lvl, n in counts.items() if n]
        summary = "Found " + ", ".join(parts) + "."
    return {"language": lang, "findings": uniq, "summary": summary}
