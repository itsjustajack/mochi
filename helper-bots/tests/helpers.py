"""Shared test fixtures: a temporary Helper home and a scripted fake model."""

import json
import tempfile
import threading
import time
from pathlib import Path

from helper.audit import Audit
from helper.config import Home, approve_policy, init_home, load_agents, load_policy, load_settings
from helper.gate import ApprovalQueue, Gate
from helper.loop import Runner, Task
from helper.runtime import ChatReply


class FakeModel:
    """Replies with a fixed script of steps (dicts or raw strings)."""

    def __init__(self, script):
        self.script = list(script)
        self.calls = []

    def chat(self, messages, schema):
        self.calls.append(messages)
        nxt = self.script.pop(0) if self.script else {"action": "done", "args": {"answer": "out of script"}}
        return ChatReply(nxt if isinstance(nxt, str) else json.dumps(nxt), 10)


class Env:
    def __init__(self, tiers_extra: str = "", allow_extra: str = ""):
        self._tmp = tempfile.TemporaryDirectory()
        self.home = Home(Path(self._tmp.name) / "h")
        init_home(self.home)
        if tiers_extra or allow_extra:
            if allow_extra:
                p = self.home.policy_dir / "allowlist.toml"
                p.write_text(p.read_text().replace("auto_allow = []", allow_extra))
            if tiers_extra:
                p = self.home.policy_dir / "tiers.toml"
                p.write_text(p.read_text() + "\n" + tiers_extra)
        approve_policy(self.home)
        self.reload()

    def reload(self):
        self.policy = load_policy(self.home)
        self.settings = load_settings(self.home)
        self.agents = load_agents(self.home, self.policy, self.settings)
        self.audit = Audit(self.home.logs_dir)
        self.gate = Gate(self.home, self.policy, self.audit, ApprovalQueue())
        self.work = self.home.root / "work"

    def task(self, agent="organizer", goal="test"):
        t = Task(goal=goal, agent=self.agents[agent])
        t.on_waiting = lambda a: None
        return t

    def runner(self, script):
        self.model = FakeModel(script)
        return Runner(self.gate, self.model, self.audit, self.home.root, self.policy)

    def answer_approvals(self, verdict, count=1, timeout=5.0):
        """Play Jack: answer the next `count` approvals from another thread."""
        def go():
            done = 0
            end = time.time() + timeout
            while done < count and time.time() < end:
                for a in self.gate.approvals.pending():
                    self.gate.approvals.resolve(a.id, verdict, by="test")
                    done += 1
                time.sleep(0.02)
        th = threading.Thread(target=go, daemon=True)
        th.start()
        return th

    def close(self):
        self._tmp.cleanup()
