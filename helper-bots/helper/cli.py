"""The `helper` command.

  helper init              set up ~/.helper (policy, settings, agents, key) and approve the policy
  helper serve             run helperd: the web app and API on 127.0.0.1:8765
  helper ask "goal"        run one task in this terminal; approvals are asked here
  helper stop | start      kill switch for a running helperd
  helper policy approve    approve the current policy files after you edit them by hand
  helper policy check      show whether the policy matches what you approved
  helper status            check the model server and the policy
  helper agents            list agents and anything capped by policy
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request

from helper import __version__
from helper.audit import Audit
from helper.config import (ConfigError, Home, approve_policy, default_home, init_home, load_agents,
                           load_policy, load_settings, platform_name, policy_is_approved, read_token)
from helper.gate import ApprovalQueue, Gate
from helper.loop import Runner, pick_agent
from helper.runtime import ModelError, OllamaClient


def _build(home: Home):
    policy = load_policy(home)
    settings = load_settings(home)
    agents = load_agents(home, policy, settings)
    if not agents:
        raise ConfigError("No agents found. Run `helper init`.")
    audit = Audit(home.logs_dir)
    gate = Gate(home, policy, audit, ApprovalQueue())
    model_cfg = settings.get("model", {})
    model = OllamaClient.from_settings(model_cfg)
    runner = Runner(gate, model, audit, home.root, policy)
    return policy, settings, agents, audit, gate, model, runner


def cmd_init(home: Home, args) -> int:
    created = init_home(home, force=args.force)
    digest = approve_policy(home)
    print(f"Helper home: {home.root}  ({platform_name()})")
    for c in created:
        print(f"  created {c}")
    print(f"Policy approved: {digest[:16]}...")
    print("Next: `ollama pull qwen3:8b` on the PC (qwen3:4b on the phone), then `helper serve`.")
    return 0


def cmd_policy(home: Home, args) -> int:
    if args.action == "approve":
        policy = load_policy(home)
        print("Policy files:")
        print(f"  tools and tiers: {policy.tiers}  disabled: {sorted(policy.disabled) or 'none'}")
        print(f"  folders: {[str(r) for r in policy.roots]}  auto-allow: {sorted(policy.auto_allow) or 'none'}")
        print(f"  limits: {policy.limits}")
        if not args.yes and input("Approve this policy? Type yes: ").strip().lower() != "yes":
            print("Not approved.")
            return 1
        print(f"Approved {approve_policy(home)[:16]}... Restart helperd to use it.")
        return 0
    policy = load_policy(home)
    ok = policy_is_approved(home, policy)
    print("Policy matches what you approved." if ok else
          "Policy has changed since you approved it. Tier 2 and 3 actions are blocked until `helper policy approve`.")
    return 0 if ok else 2


def cmd_status(home: Home, args) -> int:
    policy, settings, agents, *_rest, model, _runner = _build(home)
    st = model.status()
    print(f"Model: {st['message']}")
    print(f"Policy approved: {policy_is_approved(home, policy)}")
    print(f"Agents: {', '.join(a.name for a in agents.values())}")
    return 0 if st["ok"] else 1


def cmd_agents(home: Home, args) -> int:
    _policy, _settings, agents, *_ = _build(home)
    for a in agents.values():
        print(f"@{a.key}  {a.name}: {', '.join(a.tools)}  limits {a.limits}")
        for c in a.caps:
            print(f"    capped: {c}")
    return 0


def cmd_ask(home: Home, args) -> int:
    policy, settings, agents, audit, gate, model, runner = _build(home)
    default = args.agent or settings.get("general", {}).get("default_agent", "organizer")
    agent, goal = pick_agent(" ".join(args.goal), agents, default)
    if agent is None:
        print("No such agent. Try `helper agents`.")
        return 1

    # The CLI is a ui: it answers approvals from what Jack types, nothing else.
    import threading
    task_holder = {}

    def run():
        task_holder["t"] = runner.start(goal, agent, background=False)

    th = threading.Thread(target=run, daemon=True)
    th.start()
    seen = 0
    try:
        while th.is_alive():
            for a in gate.approvals.pending():
                print(f"\n[{agent.name}] wants to run {a.tool} (tier {a.tier}): {a.reason}")
                for k, v in a.args.items():
                    print(f"    {k} = {v}")
                if a.tainted:
                    print("    WARNING: this task read untrusted content.")
                ans = input("Approve once? [y]es / [n]o / [s]top task: ").strip().lower()
                verdict = {"y": "approve", "yes": "approve", "s": "stop", "stop": "stop"}.get(ans, "deny")
                gate.approvals.resolve(a.id, verdict, by="ui:cli")
            t = task_holder.get("t") or next(iter(runner.tasks.values()), None)
            if t:
                for e in t.events[seen:]:
                    if e["kind"] == "step":
                        print(f"  > {e['tool']} {json.dumps(e['args'])}")
                    elif e["kind"] == "denied":
                        print(f"  x refused: {e['reason']}")
                    elif e["kind"] == "system":
                        print(f"  ! {e['text']}")
                seen = len(t.events)
            th.join(0.2)
    except KeyboardInterrupt:
        runner.stop_all(by="ui:cli")
        th.join(2)
    t = task_holder.get("t")
    if t:
        print(f"\n{agent.name} ({t.status}): {t.answer}")
        return 0 if t.status == "done" else 1
    return 1


def cmd_serve(home: Home, args) -> int:
    from helper.server import App, serve
    policy, settings, agents, audit, gate, model, runner = _build(home)
    token = read_token(home)
    srv = settings.get("server", {})
    port = int(args.port or srv.get("port", 8765))
    if not policy_is_approved(home, policy):
        print("Warning: policy not approved. Tier 2 and 3 actions will be refused. Run `helper policy approve`.")
    app = App(runner, agents, token, settings, status_fn=model.status, port=port)
    httpd = serve(app, "127.0.0.1", port)
    audit.write("system", event="serve", port=port)
    print(f"helperd {__version__} on http://127.0.0.1:{port}")
    print(f"Open this once to sign the app in (keep it private):\n  http://127.0.0.1:{port}/#key={token}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        runner.stop_all(by="ui:cli")
    return 0


def _post_local(home: Home, path: str) -> int:
    settings = load_settings(home)
    port = settings.get("server", {}).get("port", 8765)
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=b"{}", method="POST")
    req.add_header("Authorization", f"Bearer {read_token(home)}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            print(r.read().decode())
        return 0
    except OSError as e:
        print(f"Could not reach helperd: {e}")
        return 1


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="helper", description="Helper: local helper bots with a permission gate.")
    p.add_argument("--home", help="Helper home folder (default ~/.helper or C:\\BotWork\\.helper)")
    p.add_argument("--version", action="version", version=__version__)
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("init")
    s.add_argument("--force", action="store_true", help="overwrite files with the defaults")
    s = sub.add_parser("serve")
    s.add_argument("--port", type=int)
    s = sub.add_parser("ask")
    s.add_argument("--agent")
    s.add_argument("goal", nargs="+")
    sub.add_parser("stop")
    sub.add_parser("start")
    sub.add_parser("status")
    sub.add_parser("agents")
    s = sub.add_parser("policy")
    s.add_argument("action", choices=["approve", "check"])
    s.add_argument("--yes", action="store_true")
    args = p.parse_args(argv)
    home = Home(default_home() if not args.home else __import__("pathlib").Path(args.home).expanduser())
    try:
        if args.cmd == "init":
            return cmd_init(home, args)
        if args.cmd == "policy":
            return cmd_policy(home, args)
        if args.cmd == "status":
            return cmd_status(home, args)
        if args.cmd == "agents":
            return cmd_agents(home, args)
        if args.cmd == "ask":
            return cmd_ask(home, args)
        if args.cmd == "serve":
            return cmd_serve(home, args)
        if args.cmd in ("stop", "start"):
            return _post_local(home, f"/v1/{args.cmd}")
    except (ConfigError, ModelError) as e:
        print(f"Error: {e}", file=sys.stderr)
        return 2
    return 1
