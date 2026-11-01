"""The permission gate: the only code path from a model's tool call to a tool.

Every call runs the same checks, in order, and stops at the first that fails:
  1. Known tool     - exists, enabled by policy, offered to this agent
  2. Valid args     - types match; paths resolve inside the agent's folders, never a protected folder
  3. Kill switch    - after "Stop all", deny everything until "Start"
  4. Integrity      - policy files must match the hash Jack approved, or tier 2+ is denied
  5. Rate limit     - at most max_tier2_calls tier 2+ calls per task
  6. Checklist      - Jack's row for this agent and job: Do runs, Ask me asks, Never refuses.
                      Rows Jack hasn't set: tier 0/1 Do, tier 2 Ask me (Do if allowlisted), tier 3 Ask me.
     Not sure? Stop - a task that read untrusted content pauses even Do rows and asks (per agent, on by default)
     Fatigue        - after fatigue_max approval requests in the window, the task pauses instead of asking again
  7. Record         - the decision is written to the audit log before the tool runs

Nothing in here trusts the model. Only the ui (Jack's click or typed answer) can grant an approval
or change a checklist row.
"""

from __future__ import annotations

import hashlib
import json
import secrets
import threading
import time
from dataclasses import dataclass, field
from typing import Literal

from helper import checklist
from helper import tools as toolmod
from helper.audit import Audit
from helper.config import Home, Policy, policy_digest, policy_is_approved


@dataclass
class Decision:
    verdict: Literal["allow", "ask", "deny"]
    reason: str
    tool: str
    tier: int | None = None
    args: dict = field(default_factory=dict)     # cleaned arguments (paths resolved)
    approval_id: str | None = None


@dataclass
class Approval:
    id: str
    task_id: str
    agent: str
    tool: str
    tier: int
    args: dict
    reason: str
    tainted: bool
    created: float
    shown_hash: str
    status: Literal["pending", "approved", "denied", "stopped", "expired"] = "pending"
    decided_by: str | None = None
    decided_at: float | None = None
    always: bool = False   # Jack pressed "Always": approve, and set this job to Do for this agent
    _event: threading.Event = field(default_factory=threading.Event, repr=False)

    def public(self) -> dict:
        return {
            "id": self.id, "task_id": self.task_id, "agent": self.agent, "tool": self.tool,
            "tier": self.tier, "args": {k: str(v) for k, v in self.args.items()},
            "reason": self.reason, "tainted": self.tainted, "status": self.status,
            "job": _label(self.tool),
            "created": self.created,
        }


def _label(tool: str) -> str:
    return checklist.label(tool)


class ApprovalQueue:
    def __init__(self):
        self._items: dict[str, Approval] = {}
        self._lock = threading.Lock()

    def create(self, task, decision: Decision) -> Approval:
        shown = {k: str(v) for k, v in decision.args.items()}
        a = Approval(
            id=secrets.token_urlsafe(9), task_id=task.id, agent=task.agent.name,
            tool=decision.tool, tier=decision.tier or 0, args=decision.args,
            reason=decision.reason, tainted=bool(task.tainted or task.suspicious),
            created=time.time(),
            shown_hash=hashlib.sha256(json.dumps([decision.tool, shown], sort_keys=True).encode()).hexdigest(),
        )
        with self._lock:
            self._items[a.id] = a
        return a

    def pending(self) -> list[Approval]:
        with self._lock:
            return [a for a in self._items.values() if a.status == "pending"]

    def get(self, approval_id: str) -> Approval | None:
        with self._lock:
            return self._items.get(approval_id)

    def resolve(self, approval_id: str, verdict: str, by: str) -> Approval | None:
        """Called ONLY by the ui module, in response to Jack."""
        if verdict not in ("approve", "always", "deny", "stop"):
            raise ValueError("verdict must be approve, always, deny or stop")
        always = verdict == "always"
        if always:
            verdict = "approve"
        with self._lock:
            a = self._items.get(approval_id)
            if not a or a.status != "pending":
                return None
            a.status = {"approve": "approved", "deny": "denied", "stop": "stopped"}[verdict]
            a.decided_by, a.decided_at = by, time.time()
            a.always = always
        a._event.set()
        return a

    def deny_all(self, by: str) -> None:
        for a in self.pending():
            self.resolve(a.id, "stop", by)

    def wait(self, a: Approval, timeout: float, cancelled: threading.Event) -> str:
        end = time.time() + timeout
        while a.status == "pending":
            if cancelled.is_set():
                with self._lock:
                    if a.status == "pending":
                        a.status = "stopped"
                break
            left = end - time.time()
            if left <= 0:
                with self._lock:
                    if a.status == "pending":
                        a.status = "expired"
                break
            a._event.wait(min(left, 0.5))
        return a.status


class KillSwitch:
    def __init__(self):
        self._stopped = threading.Event()

    def stop(self):
        self._stopped.set()

    def start(self):
        self._stopped.clear()

    @property
    def stopped(self) -> bool:
        return self._stopped.is_set()


@dataclass
class Outcome:
    decision: Decision
    result: toolmod.ToolResult | None = None
    approval: Approval | None = None


class Gate:
    def __init__(self, home: Home, policy: Policy, audit: Audit,
                 approvals: ApprovalQueue | None = None, kill: KillSwitch | None = None):
        self.home = home
        self.policy = policy
        self.audit = audit
        self.approvals = approvals or ApprovalQueue()
        self.kill = kill or KillSwitch()
        self.protected = home.protected_paths()
        self.checklists = checklist.Checklists(home.state_dir / "checklists.json", policy)
        self.done_log = checklist.DoneLog(home.state_dir / "done_for_you.json")

    # ------------------------------------------------------------ checks

    def _integrity_ok(self) -> bool:
        try:
            current = policy_digest(self.home)
        except OSError:
            return False
        return current == self.policy.digest and policy_is_approved(self.home, self.policy)

    def check(self, task, action: str, args: dict) -> Decision:
        p = self.policy
        agent = task.agent
        # 1. Known tool
        spec = toolmod.REGISTRY.get(action)
        tier = p.tier(action)
        if spec is None or tier is None:
            return Decision("deny", f"unknown or disabled tool: {action}", action)
        if action not in agent.tools:
            return Decision("deny", f"{agent.name} is not set up to use {action}", action, tier)
        if agent.story and action.startswith("private_"):
            return Decision("deny", "story agents never see your private records", action, tier)
        # 2. Valid args (paths resolved inside this agent's folders, never protected folders)
        try:
            clean = toolmod.validate_args(spec, args, agent.roots, self.protected)
        except toolmod.ArgError as e:
            return Decision("deny", f"bad arguments: {e}", action, tier)
        d = lambda v, r: Decision(v, r, action, tier, clean)  # noqa: E731
        # 3. Kill switch
        if self.kill.stopped:
            return d("deny", "all tasks are stopped (kill switch)")
        # 4. Integrity
        if tier >= 2 and not self._integrity_ok():
            return d("deny", "policy files changed or not approved; run `helper policy approve`")
        # 5. Rate limit
        limit = agent.limits.get("max_tier2_calls") or p.limits.get("max_tier2_calls", 10)
        if tier >= 2 and task.tier2_calls >= limit:
            return d("deny", f"rate limit: {limit} changing actions per task")
        # 6. Jack's checklist for this agent (Do / Ask me / Never), taint and fatigue rules
        dirty = task.tainted or task.suspicious
        choice = self.checklists.choice(agent, action, tier)
        job = checklist.label(action)
        if choice == "never":
            return d("deny", f"your checklist for {agent.name} says Never for \"{job}\"")
        if choice == "do":
            if not dirty or tier == 0:
                return d("allow", f"your checklist says Do for \"{job}\"")
            if not self.checklists.not_sure_stop(agent):
                return d("allow", f"your checklist says Do for \"{job}\" (Not sure? Stop is off)")
            verdict, reason = "ask", (f"\"{job}\" is Do on your checklist, but this task read outside text, "
                                      "so it pauses (Not sure? Stop)")
        else:
            verdict = "ask"
            reason = f"\"{job}\" is Ask me on your checklist"
            if dirty:
                reason += " (this task read outside text: check it carefully)"
        window = p.limits.get("fatigue_window_s", 600)
        recent = [t for t in task.approval_times if time.time() - t < window]
        if len(recent) >= p.limits.get("fatigue_max", 5):
            return d("deny", "paused: too many approval requests in a short time")
        return d(verdict, reason)

    # ------------------------------------------------------------ the one way to run a tool

    def call(self, task, action: str, args: dict) -> Outcome:
        decision = self.check(task, action, args)
        # 7. Record before anything runs
        self.audit.write("decision", task=task.id, agent=task.agent.key, tool=action,
                         args={k: str(v) for k, v in (decision.args or args or {}).items()} if isinstance(args, dict) else str(args),
                         verdict=decision.verdict, reason=decision.reason, tier=decision.tier)
        approval = None
        if decision.verdict == "ask":
            task.approval_times.append(time.time())
            approval = self.approvals.create(task, decision)
            decision.approval_id = approval.id
            task.on_waiting(approval)
            status = self.approvals.wait(
                approval, self.policy.limits.get("approval_timeout_s", 600), task.cancelled)
            self.audit.write("approval", task=task.id, approval=approval.id, tool=action,
                             status=status, by=approval.decided_by, shown_hash=approval.shown_hash)
            if status == "stopped":
                task.cancelled.set()
            if status != "approved":
                decision = Decision("deny", {"denied": "you said no", "expired": "no answer in time (counts as no)",
                                             "stopped": "you stopped the task"}.get(status, status),
                                    action, decision.tier, decision.args, approval.id)
                return Outcome(decision, None, approval)
            # Re-check after the wait: the kill switch or policy may have changed meanwhile.
            if self.kill.stopped or (decision.tier or 0) >= 2 and not self._integrity_ok():
                return Outcome(Decision("deny", "stopped or policy changed while waiting", action,
                                        decision.tier, decision.args, approval.id), None, approval)
        if decision.verdict == "deny":
            return Outcome(decision, None, approval)
        if (decision.tier or 0) >= 2:
            task.tier2_calls += 1
        ctx = toolmod.ToolContext(roots=task.agent.roots, home=self.home.root, trash=self.home.root / "trash",
                                  knowledge=list(self.policy.knowledge))
        result = toolmod.execute(toolmod.REGISTRY[action], decision.args, ctx)
        self.audit.write("tool_call", task=task.id, tool=action, ok=result.ok, source=result.source,
                         taints=result.taints, chars=len(result.data))
        if result.ok and approval is None and (decision.tier or 0) >= 1:
            # Done on its own (a Do row): goes in the Done for you log, with Undo where possible
            self.done_log.add(task.agent.key, action, result.data, result.undo)
        if result.ok and approval is not None and approval.always:
            self.checklists.set(task.agent, action, "do", by=approval.decided_by or "ui",
                                why=f"{checklist.label(action)}: Do (Always on an OK card)")
        return Outcome(decision, result, approval)
