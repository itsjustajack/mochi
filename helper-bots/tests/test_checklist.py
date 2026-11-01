import json
import unittest

from helper import checklist
from helper.server import App
from tests.helpers import Env


class ChecklistTests(unittest.TestCase):
    def setUp(self):
        self.env = Env()
        (self.env.work / "a.txt").write_text("hello")
        self.org = self.env.agents["organizer"]
        self.cl = self.env.gate.checklists

    def tearDown(self):
        self.env.close()

    def check(self, tool, args, **attrs):
        t = self.env.task()
        for k, v in attrs.items():
            setattr(t, k, v)
        return self.env.gate.check(t, tool, args)

    def test_defaults(self):
        rows = {r["job"]: r["choice"] for r in self.cl.rows(self.org)}
        self.assertEqual(rows["read_file"], "do")
        self.assertEqual(rows["write_file"], "ask")
        self.assertEqual(rows["delete_file"], "ask")
        self.assertEqual(self.cl.summary(self.org)["text"], "2 do, 3 ask me")

    def test_no_locked_rows_every_job_is_jacks_choice(self):
        self.cl.set(self.org, "delete_file", "do", by="test")
        self.assertEqual(self.check("delete_file", {"path": "a.txt"}).verdict, "allow")
        self.cl.set(self.org, "read_file", "never", by="test")
        d = self.check("read_file", {"path": "a.txt"})
        self.assertEqual(d.verdict, "deny")
        self.assertIn("Never", d.reason)

    def test_not_sure_stop_pauses_do_rows(self):
        self.cl.set(self.org, "write_file", "do", by="test")
        self.assertEqual(self.check("write_file", {"path": "b.txt", "text": "x"}).verdict, "allow")
        self.assertEqual(self.check("write_file", {"path": "b.txt", "text": "x"}, tainted=True).verdict, "ask")
        self.cl.set_not_sure(self.org, False, by="test")
        self.assertEqual(self.check("write_file", {"path": "b.txt", "text": "x"}, tainted=True).verdict, "allow")

    def test_presets_and_undo(self):
        e = self.cl.preset(self.org, "handsoff", by="test")
        rows = {r["job"]: r["choice"] for r in self.cl.rows(self.org)}
        self.assertEqual((rows["write_file"], rows["delete_file"]), ("do", "ask"))
        self.cl.undo(e["id"], by="test")
        rows = {r["job"]: r["choice"] for r in self.cl.rows(self.org)}
        self.assertEqual(rows["write_file"], "ask")
        self.assertIsNone(self.cl.undo(e["id"], by="test"), "can't undo twice")

    def test_cannot_set_job_agent_lacks(self):
        with self.assertRaises(ValueError):
            self.cl.set(self.org, "gmail_send", "do", by="test")

    def test_checklist_file_out_of_reach(self):
        self.cl.set(self.org, "write_file", "do", by="test")
        d = self.check("write_file", {"path": "../state/checklists.json", "text": "{}"})
        self.assertEqual(d.verdict, "deny")


class StandingOrderTests(unittest.TestCase):
    def setUp(self):
        self.env = Env()
        self.org = self.env.agents["organizer"]

    def tearDown(self):
        self.env.close()

    def p(self, text):
        return checklist.parse_standing_order(text, self.org)

    def test_parse(self):
        self.assertEqual(self.p("From now on just move files without asking"), {"job": "move_file", "choice": "do"})
        self.assertEqual(self.p("Never delete files"), {"job": "delete_file", "choice": "never"})
        self.assertEqual(self.p("stop deleting files"), {"job": "delete_file", "choice": "never"})
        self.assertEqual(self.p("always ask me first before you write files"), {"job": "write_file", "choice": "ask"})
        self.assertEqual(self.p("no need to ask to save files"), {"job": "write_file", "choice": "do"})

    def test_not_orders(self):
        self.assertIsNone(self.p("move files from inbox to archive"))
        self.assertIsNone(self.p("never mind, read files in work and summarise"))
        self.assertIsNone(self.p("should you always move files?"))
        self.assertIn("unclear", self.p("from now on do the thing"))

    def test_message_changes_row_with_undo(self):
        runner = self.env.runner([])
        t = runner.start("Organizer, from now on just move files", self.org, background=False)
        self.assertEqual(t.status, "done")
        self.assertIn("is now Do", t.answer)
        self.assertEqual(self.env.gate.checklists.choice(self.org, "move_file"), "do")
        self.assertEqual(self.env.model.calls, [], "the model is never asked")
        change = [e for e in t.events if e["kind"] == "checklist"][0]["change"]
        app = App(runner, self.env.agents, "k", self.env.settings, port=0)
        code, _ = app.handle("POST", f"/v1/checklists/undo/{change}", {})
        self.assertEqual(code, 200)
        self.assertEqual(self.env.gate.checklists.choice(self.org, "move_file"), "ask")

    def test_system_tasks_cannot_change_rows(self):
        runner = self.env.runner([{"action": "done", "args": {"answer": "ok"}}])
        runner.start("from now on just move files", self.org, background=False, from_jack=False)
        self.assertEqual(self.env.gate.checklists.choice(self.org, "move_file"), "ask")


class AlwaysAndDoneLogTests(unittest.TestCase):
    def setUp(self):
        self.env = Env()
        self.org = self.env.agents["organizer"]

    def tearDown(self):
        self.env.close()

    def test_always_button_sets_do(self):
        runner = self.env.runner([
            {"action": "write_file", "args": {"path": "n.txt", "text": "hi"}},
            {"action": "done", "args": {"answer": "ok"}},
        ])
        self.env.answer_approvals("always")
        t = runner.start("write n.txt", self.org, background=False)
        self.assertEqual(t.status, "done")
        self.assertEqual(self.env.gate.checklists.choice(self.org, "write_file"), "do")

    def test_done_for_you_and_undo(self):
        (self.env.work / "a.txt").write_text("old")
        self.env.gate.checklists.set(self.org, "write_file", "do", by="test")
        self.env.gate.checklists.set(self.org, "move_file", "do", by="test")
        runner = self.env.runner([
            {"action": "write_file", "args": {"path": "a.txt", "text": "new"}},
            {"action": "move_file", "args": {"src": "a.txt", "dst": "b.txt"}},
            {"action": "done", "args": {"answer": "ok"}},
        ])
        runner.start("tidy", self.org, background=False)
        app = App(runner, self.env.agents, "k", self.env.settings, port=0)
        code, res = app.handle("GET", "/v1/done", None)
        self.assertEqual([r["tool"] for r in res["done"]], ["write_file", "move_file"])
        for row in reversed(res["done"]):
            code, out = app.handle("POST", f"/v1/done/{row['id']}/undo", {})
            self.assertEqual(code, 200, out)
        self.assertEqual((self.env.work / "a.txt").read_text(), "old")
        self.assertFalse((self.env.work / "b.txt").exists())
        self.assertEqual(app.handle("POST", f"/v1/done/{res['done'][0]['id']}/undo", {})[0], 404)


class SettingsApiTests(unittest.TestCase):
    def setUp(self):
        self.env = Env()
        self.app = App(self.env.runner([]), self.env.agents, "k", self.env.settings, port=0)

    def tearDown(self):
        self.env.close()

    def test_rows_set_preset(self):
        code, res = self.app.handle("GET", "/v1/checklists", None)
        self.assertEqual(code, 200)
        self.assertIn("organizer", [a["agent"] for a in res["agents"]])
        code, res = self.app.handle("GET", "/v1/checklists/organizer", None)
        self.assertIn("write_file", [r["job"] for r in res["rows"]])
        code, res = self.app.handle("POST", "/v1/checklists/organizer", {"job": "write_file", "choice": "never"})
        self.assertEqual(code, 200, res)
        self.assertEqual(self.app.handle("POST", "/v1/checklists/organizer", {"job": "x", "choice": "do"})[0], 400)
        self.assertEqual(self.app.handle("POST", "/v1/checklists/organizer", {"preset": "careful"})[0], 200)
        self.assertEqual(self.app.handle("POST", "/v1/checklists/organizer", {"not_sure_stop": False})[0], 200)
        _, res = self.app.handle("GET", "/v1/checklists/organizer", None)
        self.assertFalse(res["not_sure_stop"])
        self.assertTrue(res["history"])


if __name__ == "__main__":
    unittest.main()
