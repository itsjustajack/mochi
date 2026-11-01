"""Model client for the one shared Ollama (Qwen) on the PC.

The model is untrusted. It only ever returns a JSON step that matches a schema built per task,
so it cannot name a tool that was not offered. Bad JSON gets one retry, then the step fails.
Standard library only (urllib), so it works the same in Termux and on Windows.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import urlparse


class ModelError(Exception):
    pass


@dataclass
class Step:
    action: str
    args: dict
    thought: str = ""


@dataclass
class ChatReply:
    text: str
    tokens: int


class ChatModel(Protocol):
    def chat(self, messages: list[dict], schema: dict) -> ChatReply: ...


def step_schema(actions: list[str]) -> dict:
    return {
        "type": "object",
        "properties": {
            "thought": {"type": "string"},
            "action": {"type": "string", "enum": actions + ["done", "ask_user"]},
            "args": {"type": "object"},
        },
        "required": ["action", "args"],
    }


def parse_step(text: str, actions: list[str]) -> Step:
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text[text.find("{"):]
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        raise ModelError("reply was not JSON")
    try:
        obj = json.loads(text[start:end + 1])
    except json.JSONDecodeError as e:
        raise ModelError(f"reply was not valid JSON: {e}") from None
    if not isinstance(obj, dict):
        raise ModelError("reply was not a JSON object")
    action = obj.get("action")
    args = obj.get("args", {})
    if action not in actions + ["done", "ask_user"]:
        raise ModelError(f"reply named an action that was not offered: {action!r}")
    if not isinstance(args, dict):
        raise ModelError("args was not an object")
    return Step(action=action, args=args, thought=str(obj.get("thought", ""))[:2000])


def is_local_url(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return host in ("127.0.0.1", "localhost", "::1")


class OllamaClient:
    def __init__(self, base_url: str = "http://127.0.0.1:11434", model: str = "qwen3:8b",
                 temperature: float = 0.2, num_ctx: int = 16384, think: bool = False,
                 timeout_s: float = 180, api_key: str | None = None):
        if not urlparse(base_url).scheme in ("http", "https"):
            raise ModelError("model base_url must be http or https")
        if not is_local_url(base_url) and not api_key:
            # Phone -> PC must go through a key-protected route, never a bare Ollama on Wi-Fi.
            raise ModelError("a model address that is not 127.0.0.1 needs an api_key")
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.temperature = temperature
        self.num_ctx = num_ctx
        self.think = think
        self.timeout_s = timeout_s
        self.api_key = api_key

    @classmethod
    def from_settings(cls, model_cfg: dict, api_key: str | None = None) -> "OllamaClient":
        return cls(
            base_url=model_cfg.get("base_url", "http://127.0.0.1:11434"),
            model=model_cfg.get("model", "qwen3:8b"),
            temperature=float(model_cfg.get("temperature", 0.2)),
            num_ctx=int(model_cfg.get("num_ctx", 16384)),
            think=bool(model_cfg.get("think", False)),
            timeout_s=float(model_cfg.get("timeout_s", 180)),
            api_key=api_key or model_cfg.get("api_key") or None,
        )

    def _post(self, path: str, body: dict | None, method: str = "POST") -> dict:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base_url + path, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        if self.api_key:
            req.add_header("Authorization", f"Bearer {self.api_key}")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_s) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            raise ModelError(f"model server said {e.code}: {e.read()[:300].decode(errors='replace')}") from None
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            raise ModelError(f"cannot reach the model server at {self.base_url}: {e}") from None
        except json.JSONDecodeError:
            raise ModelError("model server sent something that is not JSON") from None

    def chat(self, messages: list[dict], schema: dict) -> ChatReply:
        body = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "format": schema,  # constrained output: the reply must match the step schema
            "think": self.think,
            "options": {"temperature": self.temperature, "num_ctx": self.num_ctx},
        }
        r = self._post("/api/chat", body)
        text = (r.get("message") or {}).get("content", "")
        tokens = int(r.get("prompt_eval_count", 0)) + int(r.get("eval_count", 0))
        return ChatReply(text=text, tokens=tokens)

    def status(self) -> dict:
        """Is the server up, and is our model installed / loaded?"""
        try:
            tags = self._post("/api/tags", None, method="GET")
        except ModelError as e:
            return {"ok": False, "message": str(e)}
        names = [m.get("name", "") for m in tags.get("models", [])]
        installed = any(n == self.model or n.split(":")[0] == self.model for n in names)
        loaded = []
        try:
            loaded = [m.get("name") for m in self._post("/api/ps", None, method="GET").get("models", [])]
        except ModelError:
            pass
        msg = "ready" if installed else f"model {self.model} not installed; run: ollama pull {self.model}"
        return {"ok": installed, "message": msg, "model": self.model, "loaded": loaded}


def next_step(model: ChatModel, messages: list[dict], actions: list[str]) -> tuple[Step, int]:
    """Ask for one step; retry once on bad output. Returns (step, tokens used)."""
    schema = step_schema(actions)
    reply = model.chat(messages, schema)
    used = reply.tokens
    try:
        return parse_step(reply.text, actions), used
    except ModelError as first:
        retry = messages + [
            {"role": "assistant", "content": reply.text[:2000]},
            {"role": "user", "content": f"That reply was invalid ({first}). Reply with one JSON object only."},
        ]
        reply = model.chat(retry, schema)
        used += reply.tokens
        return parse_step(reply.text, actions), used
