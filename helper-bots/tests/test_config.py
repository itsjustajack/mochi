import unittest

from helper.config import ConfigError, approve_policy, build_agent, load_policy
from tests.helpers import Env


class ConfigTests(unittest.TestCase):
    def setUp(self):
        self.env = Env()

    def tearDown(self):
        self.env.close()

    def test_starter_agents_load(self):
        self.assertEqual(set(self.env.agents), {"organizer", "notes", "storyteller"})

    def test_agent_cannot_exceed_policy_limits(self):
        a = build_agent("x", {"tools": ["read_file"], "limits": {"max_steps": 999}},
                        self.env.policy, {"limits": {}}, self.env.home)
        self.assertEqual(a.limits["max_steps"], 15)
        self.assertTrue(any("capped by policy" in c for c in a.caps))

    def test_agent_cannot_exceed_settings(self):
        a = build_agent("x", {"limits": {"max_steps": 14}}, self.env.policy, {"limits": {"max_steps": 12}}, self.env.home)
        self.assertEqual(a.limits["max_steps"], 12)
        self.assertTrue(any("capped by settings" in c for c in a.caps))

    def test_task_override_can_only_narrow(self):
        a = build_agent("x", {}, self.env.policy, {}, self.env.home, task_limits={"max_steps": 3})
        self.assertEqual(a.limits["max_steps"], 3)
        a = build_agent("x", {}, self.env.policy, {}, self.env.home, task_limits={"max_steps": 300})
        self.assertEqual(a.limits["max_steps"], 15)

    def test_agent_cannot_add_unknown_tool_or_folder(self):
        a = build_agent("x", {"tools": ["read_file", "run_shell"], "roots": ["work", "/etc"]},
                        self.env.policy, {}, self.env.home)
        self.assertEqual(a.tools, ["read_file"])
        self.assertEqual(len(a.roots), 1)
        self.assertEqual(len(a.caps), 2)

    def test_adult_content_cannot_be_enabled(self):
        p = self.env.home.policy_dir / "content.toml"
        p.write_text(p.read_text().replace('adult_content = "never"', 'adult_content = "allowed"'))
        with self.assertRaises(ConfigError):
            load_policy(self.env.home)
        with self.assertRaises(ConfigError):
            approve_policy(self.env.home)

    def test_bad_tier_rejected(self):
        p = self.env.home.policy_dir / "tiers.toml"
        p.write_text(p.read_text().replace("delete_file = 3", "delete_file = 9"))
        with self.assertRaises(ConfigError):
            load_policy(self.env.home)

    def test_family_rule_comes_first_in_every_prompt(self):
        from helper.loop import build_system_prompt
        for a in self.env.agents.values():
            prompt = build_system_prompt(self.env.home.root, a, self.env.policy)
            self.assertTrue(prompt.startswith("FIXED RULE"))
            self.assertIn("suitable for all ages", prompt.split("\n")[0])


if __name__ == "__main__":
    unittest.main()
