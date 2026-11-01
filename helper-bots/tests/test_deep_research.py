import unittest

from helper.skills import deep_research as dr
from tests.helpers import Env


class StageTests(unittest.TestCase):
    def test_stages(self):
        self.assertEqual(dr.stage_for("How did the Roman legion beat phalanxes?"), "plan")
        self.assertEqual(dr.stage_for("go"), "report")
        self.assertEqual(dr.stage_for("Go!"), "report")
        self.assertEqual(dr.stage_for("thanks"), "idle")
        self.assertEqual(dr.stage_for("show notes"), "notes")
        self.assertEqual(dr.stage_for("quick: what is combined arms?"), "quick")
        self.assertEqual(dr.stage_for("go deeper on angle 2"), "followup")
        self.assertEqual(dr.stage_for("compare the two tanks"), "followup")

    def test_whole_word_matching(self):
        # v3.3's fix: "expanded" must not count as "expand on", "f150" not as a key
        self.assertEqual(dr.stage_for("the expanded empire's logistics"), "plan")

    def test_topics(self):
        b = dr.build("Compare WW2 tank armor doctrine in the operational environment of North Africa")
        self.assertEqual(b["stage"], "followup")  # "compare" is a follow-up word, as in v3.3
        b = dr.build("How did tank armor evolve in WW2 in that theater?")
        self.assertEqual(b["stage"], "plan")
        self.assertIn("weapons", b["topics"])
        self.assertIn("history", b["topics"])
        self.assertNotIn("PMESII_PT", b["topics"], "analysis frames only join at the report stage")
        self.assertIn("Say \"go\" to start", b["text"])

    def test_go_uses_previous_plan(self):
        b = dr.build("go", previous="Title: Roman legion tactics\nAngles: 1. Doctrine")
        self.assertTrue(b["previous"])
        self.assertIn("<previous>", b["text"])
        self.assertIn("Roman legion tactics", b["text"])
        no = dr.build("go")
        self.assertIn("no earlier plan", no["text"])

    def test_v32_pieces_present(self):
        b = dr.build("go", window="analyze the theater with pmesii and mett-tc mission analysis", previous="plan")
        self.assertIn("PMESII_PT", b["topics"])
        self.assertIn("METT_TC", b["topics"])
        self.assertIn("[Unverified]", b["text"])
        self.assertIn("NOROLE", dr.build("let's roleplay a fight")["topics"])

    def test_safety_line_kept(self):
        self.assertIn("Do not give step-by-step instructions for building", dr.RULES)

    def test_threat_register(self):
        t = dr.next_threat(0.0, "contact front, incoming")
        self.assertAlmostEqual(t, 0.8)
        self.assertLess(dr.next_threat(t, "status?"), t)
        self.assertLessEqual(dr.next_threat(1.0, "ambush"), 1.0)


class AgentTests(unittest.TestCase):
    def setUp(self):
        self.env = Env()

    def tearDown(self):
        self.env.close()

    def test_plan_then_go_across_tasks(self):
        agent = self.env.agents["research"]
        self.assertEqual(agent.skill, "deep_research")
        runner = self.env.runner([
            {"action": "done", "args": {"answer": "Title: Legion vs phalanx\nAngles: 1. Doctrine 2. Terrain\nSay \"go\" to start."}},
            {"action": "done", "args": {"answer": "# Legions win on broken ground\nBottom line..."}},
        ])
        t1 = runner.start("How did Roman legions beat Macedonian phalanxes?", agent, background=False)
        self.assertEqual(t1.status, "done")
        sys1 = runner.model.calls[0][0]["content"]
        self.assertIn("[Stage: plan]", sys1)
        t2 = runner.start("go", agent, background=False)
        self.assertEqual(t2.status, "done")
        sys2 = runner.model.calls[1][0]["content"]
        self.assertIn("[Stage: research and report]", sys2)
        self.assertIn("Legion vs phalanx", sys2, "the plan from the first task is passed on")
        stages = [e["stage"] for t in (t1, t2) for e in t.events if e["kind"] == "skill"]
        self.assertEqual(stages, ["plan", "report"])

    def test_other_agents_have_no_skill(self):
        self.assertEqual(self.env.agents["organizer"].skill, "")


if __name__ == "__main__":
    unittest.main()
