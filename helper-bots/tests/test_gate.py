import os
import threading
import unittest

from tests.helpers import Env


class GateTests(unittest.TestCase):
    def setUp(self):
        self.env = Env()
        (self.env.work / "a.txt").write_text("hello")

    def tearDown(self):
        self.env.close()

    def check(self, tool, args, agent="organizer", **task_attrs):
        t = self.env.task(agent)
        for k, v in task_attrs.items():
            setattr(t, k, v)
        return self.env.gate.check(t, tool, args)

    def test_tier0_allows(self):
        self.assertEqual(self.check("read_file", {"path": "a.txt"}).verdict, "allow")

    def test_tier3_always_asks(self):
        self.assertEqual(self.check("delete_file", {"path": "a.txt"}).verdict, "ask")

    def test_tier3_asks_even_if_allowlisted(self):
        env = Env(allow_extra='auto_allow = ["delete_file", "write_file"]')
        try:
            (env.work / "a.txt").write_text("x")
            d = env.gate.check(env.task(), "delete_file", {"path": "a.txt"})
            self.assertEqual(d.verdict, "ask")
            d = env.gate.check(env.task(), "write_file", {"path": "b.txt", "text": "x"})
            self.assertEqual(d.verdict, "allow")
        finally:
            env.close()

    def test_tier2_asks_when_not_allowlisted(self):
        self.assertEqual(self.check("write_file", {"path": "b.txt", "text": "x"}).verdict, "ask")

    def test_tainted_tier2_off_allowlist_denied(self):
        d = self.check("write_file", {"path": "b.txt", "text": "x"}, tainted=True)
        self.assertEqual(d.verdict, "deny")

    def test_tainted_task_never_gets_tier3_without_asking(self):
        d = self.check("delete_file", {"path": "a.txt"}, tainted=True)
        self.assertEqual(d.verdict, "ask")

    def test_allowlisted_tier2_asks_when_suspicious(self):
        env = Env(allow_extra='auto_allow = ["write_file"]')
        try:
            t = env.task()
            t.suspicious = True
            self.assertEqual(env.gate.check(t, "write_file", {"path": "b.txt", "text": "x"}).verdict, "ask")
        finally:
            env.close()

    def test_unknown_tool_denied(self):
        self.assertEqual(self.check("run_shell", {"cmd": "rm -rf /"}).verdict, "deny")

    def test_tool_not_offered_to_agent_denied(self):
        d = self.check("delete_file", {"path": "a.txt"}, agent="notes")
        self.assertEqual(d.verdict, "deny")

    def test_disabled_tool_denied(self):
        env = Env(tiers_extra="")
        try:
            p = env.home.policy_dir / "tiers.toml"
            p.write_text(p.read_text().replace("disabled = []", 'disabled = ["read_file"]'))
            from helper.config import approve_policy
            approve_policy(env.home)
            env.reload()
            (env.work / "a.txt").write_text("x")
            self.assertEqual(env.gate.check(env.task(), "read_file", {"path": "a.txt"}).verdict, "deny")
        finally:
            env.close()

    def test_path_outside_roots_denied(self):
        for bad in ["../settings.toml", "/etc/passwd", "../../outside.txt", "~/x"]:
            d = self.check("read_file", {"path": bad})
            self.assertEqual(d.verdict, "deny", bad)

    def test_policy_folder_protected_even_if_listed_as_root(self):
        env = Env()
        try:
            p = env.home.policy_dir / "allowlist.toml"
            p.write_text(p.read_text().replace('roots = ["work"]', 'roots = ["work", "."]'))
            from helper.config import approve_policy
            approve_policy(env.home)
            env.reload()
            agent = env.agents["organizer"]
            agent.roots = list(env.policy.roots)
            t = env.task()
            for target in ["policy/tiers.toml", "settings.toml", "secret/token", "agents/organizer/agent.toml",
                           "state/policy.approved", "logs/x"]:
                d = env.gate.check(t, "write_file", {"path": str(env.home.root / target), "text": "pwned"})
                self.assertEqual(d.verdict, "deny", target)
                self.assertIn("protected", d.reason)
        finally:
            env.close()

    @unittest.skipIf(os.name == "nt", "symlinks need admin on Windows")
    def test_symlink_escape_denied(self):
        os.symlink(self.env.home.root / "policy", self.env.work / "link")
        d = self.check("read_file", {"path": "link/tiers.toml"})
        self.assertEqual(d.verdict, "deny")

    def test_bad_arg_types_denied(self):
        self.assertEqual(self.check("read_file", {"path": 5}).verdict, "deny")
        self.assertEqual(self.check("read_file", {"path": "a.txt", "extra": 1}).verdict, "deny")
        self.assertEqual(self.check("read_file", {}).verdict, "deny")
        self.assertEqual(self.check("read_file", "a.txt").verdict, "deny")

    def test_kill_switch(self):
        self.env.gate.kill.stop()
        self.assertEqual(self.check("read_file", {"path": "a.txt"}).verdict, "deny")
        self.env.gate.kill.start()
        self.assertEqual(self.check("read_file", {"path": "a.txt"}).verdict, "allow")

    def test_policy_edit_blocks_tier2_until_approved(self):
        p = self.env.home.policy_dir / "allowlist.toml"
        p.write_text(p.read_text().replace("auto_allow = []", 'auto_allow = ["write_file"]'))
        d = self.check("write_file", {"path": "b.txt", "text": "x"})
        self.assertEqual(d.verdict, "deny")
        self.assertIn("policy", d.reason)
        # tier 0 still works
        self.assertEqual(self.check("read_file", {"path": "a.txt"}).verdict, "allow")

    def test_rate_limit(self):
        d = self.check("write_file", {"path": "b.txt", "text": "x"}, tier2_calls=10)
        self.assertEqual(d.verdict, "deny")

    def test_approval_fatigue(self):
        import time
        d = self.check("delete_file", {"path": "a.txt"}, approval_times=[time.time()] * 5)
        self.assertEqual(d.verdict, "deny")
        self.assertIn("too many", d.reason)

    def test_call_runs_tool_only_after_approval(self):
        t = self.env.task()
        self.env.answer_approvals("deny")
        out = self.env.gate.call(t, "delete_file", {"path": "a.txt"})
        self.assertEqual(out.decision.verdict, "deny")
        self.assertTrue((self.env.work / "a.txt").exists())
        self.env.answer_approvals("approve")
        out = self.env.gate.call(t, "delete_file", {"path": "a.txt"})
        self.assertTrue(out.result.ok)
        self.assertFalse((self.env.work / "a.txt").exists())
        self.assertTrue(any((self.env.home.root / "trash").rglob("a.txt")), "deleted file should be in trash")

    def test_approval_timeout_is_deny(self):
        p = self.env.home.policy_dir / "tiers.toml"
        self.env.policy.limits["approval_timeout_s"] = 0.2
        out = self.env.gate.call(self.env.task(), "delete_file", {"path": "a.txt"})
        self.assertEqual(out.decision.verdict, "deny")
        self.assertTrue((self.env.work / "a.txt").exists())

    def test_model_cannot_approve(self):
        # An "approved_by" in arguments is just an unknown argument; it never grants anything.
        d = self.check("delete_file", {"path": "a.txt", "approved_by": "user"})
        self.assertEqual(d.verdict, "deny")

    def test_decisions_are_audited(self):
        self.env.gate.call(self.env.task(), "read_file", {"path": "a.txt"})
        kinds = [e["kind"] for e in self.env.audit.tail()]
        self.assertEqual(kinds[:2], ["decision", "tool_call"])


if __name__ == "__main__":
    unittest.main()
