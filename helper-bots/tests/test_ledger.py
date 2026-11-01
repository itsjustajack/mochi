import json
import unittest

from helper.ledger import LedgerStore, apply_patch, empty_ledger, report, validate
from helper.server import App
from tests.helpers import Env


def add(name, status="draft", **kw):
    return {"op": "add", "entry": {"type": "place", "name": name, "summary": f"{name} summary", "status": status, **kw}}


class LedgerRuleTests(unittest.TestCase):
    def setUp(self):
        self.led = empty_ledger()

    def apply(self, ops, approved=False, reason="test"):
        res = apply_patch(self.led, {"reason": reason, "ops": ops}, approved=approved, today="2026-11-01")
        if "ledger" in res:
            self.led = res["ledger"]
        return res

    def test_add_draft_gets_id_and_revision(self):
        res = self.apply([add("Saltglass Light")])
        self.assertEqual(res["notes"], ['added LORE-0001 "Saltglass Light" (draft)'])
        self.assertEqual(self.led["revision"], 2)
        self.assertEqual(self.led["changelog"][-1]["reason"], "test")
        self.assertEqual(validate(self.led), [])

    def test_agents_cannot_make_canon(self):
        self.assertIn("errors", self.apply([add("Heron", status="canon")]))
        self.apply([add("Heron")])
        self.assertIn("errors", self.apply([{"op": "promote", "id": "LORE-0001"}]))
        self.assertNotIn("errors", self.apply([{"op": "promote", "id": "LORE-0001"}], approved=True))
        self.assertEqual(self.led["entries"][0]["status"], "canon")
        # canon can't be changed or retired without Jack
        self.assertIn("errors", self.apply([{"op": "update", "id": "LORE-0001", "set": {"summary": "x"}}]))
        self.assertIn("errors", self.apply([{"op": "retire", "id": "LORE-0001", "reason": "x"}]))

    def test_at_key_links_and_retire_replace(self):
        self.apply([add("Old Port", key="a"), add("Harbor", key="b", related=["@a"])])
        self.assertEqual(self.led["entries"][1]["related"], ["LORE-0001"])
        res = self.apply([add("New Port", key="n"),
                          {"op": "update", "id": "LORE-0002", "set": {"related": ["@n"]}},
                          {"op": "retire", "id": "LORE-0001", "reason": "moved", "replaced_by": "@n"}])
        self.assertNotIn("errors", res, res.get("errors"))
        old = self.led["entries"][0]
        self.assertEqual((old["status"], old["replaced_by"]), ("retired", "LORE-0003"))
        self.assertEqual(self.led["entries"][2]["supersedes"], "LORE-0001")

    def test_link_to_retired_is_refused(self):
        self.apply([add("A"), add("B")])
        self.apply([{"op": "update", "id": "LORE-0002", "set": {"related": ["LORE-0001"]}}])
        res = self.apply([{"op": "retire", "id": "LORE-0001", "reason": "gone"}])
        self.assertIn("errors", res)

    def test_duplicate_names_refused(self):
        self.apply([add("Heron")])
        self.assertIn("errors", self.apply([add("heron")]))

    def test_bad_patches(self):
        self.assertIn("errors", apply_patch(self.led, {"ops": [add("x")]}))
        self.assertIn("errors", apply_patch(self.led, {"reason": "r", "ops": []}))
        self.assertIn("errors", self.apply([{"op": "delete", "id": "LORE-0001"}]))
        self.assertIn("errors", self.apply([{"op": "add", "entry": {"id": "LORE-0099", "type": "place",
                                                                   "name": "x", "summary": "y"}}]))
        self.assertIn("errors", self.apply([{"op": "add", "entry": {"type": "spaceship", "name": "x", "summary": "y"}}]))

    def test_report(self):
        self.apply([add("Heron")])
        self.assertIn("DRAFTS WAITING FOR YOUR APPROVAL\n LORE-0001 Heron", report(self.led))


class StoreAndToolTests(unittest.TestCase):
    def setUp(self):
        self.env = Env()
        self.store = LedgerStore(self.env.home.state_dir / "lore_ledger.json")

    def tearDown(self):
        self.env.close()

    def test_store_keeps_backup(self):
        self.store.apply({"reason": "one", "ops": [add("A")]})
        self.store.apply({"reason": "two", "ops": [add("B")]})
        bak = json.loads((self.env.home.state_dir / "lore_ledger.json.bak").read_text())
        self.assertEqual(bak["revision"], 2)
        self.assertEqual(self.store.load()["revision"], 3)
        self.assertEqual([e["name"] for e in self.store.search("b")], ["B"])

    def test_quill_files_a_draft_and_jack_promotes(self):
        runner = self.env.runner([
            {"action": "ledger_search", "args": {"query": "Saltglass"}},
            {"action": "ledger_propose", "args": {"type": "place", "name": "Saltglass Light",
                                                  "summary": "A lighthouse on the north reef.", "source": "Quill"}},
            {"action": "done", "args": {"answer": "Filed LORE-0001 as a draft."}},
        ])
        task = runner.start("file the Saltglass Light", self.env.agents["quill"], background=False)
        self.assertEqual(task.status, "done")
        results = [e for e in task.events if e["kind"] == "result"]
        self.assertIn("that isn't in the ledger", results[0]["text"])
        self.assertEqual(self.store.load()["entries"][0]["status"], "draft")
        app = App(runner, self.env.agents, "k", self.env.settings, port=0)
        code, res = app.handle("POST", "/v1/ledger/LORE-0001/promote", {})
        self.assertEqual(code, 200, res)
        self.assertEqual(self.store.load()["entries"][0]["status"], "canon")
        code, info = app.handle("GET", "/v1/ledger", None)
        self.assertIn("Canon: 1", info["report"])
        self.assertEqual(app.handle("POST", "/v1/ledger/LORE-0001/retire", {})[0], 400)

    def test_ledger_file_is_out_of_reach_of_file_tools(self):
        self.store.apply({"reason": "one", "ops": [add("A")]})
        runner = self.env.runner([
            {"action": "write_file", "args": {"path": "../state/lore_ledger.json", "text": "{}"}},
            {"action": "done", "args": {"answer": "x"}},
        ])
        task = runner.start("break the ledger", self.env.agents["organizer"], background=False)
        self.assertTrue(any(e["kind"] == "denied" for e in task.events))
        self.assertEqual(self.store.load()["entries"][0]["name"], "A")


class PrivateSectionTests(unittest.TestCase):
    def setUp(self):
        self.env = Env()

    def tearDown(self):
        self.env.close()

    def test_private_is_separate_and_refuses_secrets(self):
        priv = LedgerStore.for_home(self.env.home.root, "private")
        res = priv.apply({"reason": "r", "ops": [{"op": "add", "entry": {
            "type": "account", "name": "Spotify", "summary": "Music. Password in RoboForm. 2-step off."}}]})
        self.assertNotIn("errors", res, res.get("errors"))
        self.assertEqual(priv.load()["entries"][0]["id"], "REC-0001")
        self.assertEqual(LedgerStore.for_home(self.env.home.root).load()["entries"], [], "lore untouched")
        bad = priv.apply({"reason": "r", "ops": [{"op": "add", "entry": {
            "type": "account", "name": "Bank", "summary": "password: hunter22"}}]})
        self.assertIn("errors", bad)
        bad = priv.apply({"reason": "r", "ops": [{"op": "add", "entry": {
            "type": "note", "name": "Card", "summary": "4111 1111 1111 1111"}}]})
        self.assertIn("errors", bad)
        self.assertIn("errors", priv.apply({"reason": "r", "ops": [{"op": "add", "entry": {
            "type": "place", "name": "x", "summary": "y", "id": "LORE-0001"}}]}))

    def test_story_agents_never_see_private(self):
        t = self.env.task("storyteller")
        t.agent.tools.append("private_search")
        d = self.env.gate.check(t, "private_search", {"query": "bank"})
        self.assertEqual(d.verdict, "deny")
        self.assertIn("story agents", d.reason)

    def test_quill_files_private_draft_and_jack_approves(self):
        runner = self.env.runner([
            {"action": "private_propose", "args": {"type": "account", "name": "Spotify",
                                                   "summary": "Music subscription; password lives in RoboForm."}},
            {"action": "done", "args": {"answer": "Filed REC-0001."}},
        ])
        t = runner.start("note my Spotify account", self.env.agents["quill"], background=False)
        self.assertEqual(t.status, "done")
        app = App(runner, self.env.agents, "k", self.env.settings, port=0)
        code, res = app.handle("GET", "/v1/private", None)
        self.assertEqual((code, res["section"]), (200, "private"))
        self.assertIn("Private records", res["report"])
        self.assertEqual(app.handle("POST", "/v1/private/REC-0001/promote", {})[0], 200)
        self.assertEqual(LedgerStore.for_home(self.env.home.root, "private").load()["entries"][0]["status"], "canon")


if __name__ == "__main__":
    unittest.main()
