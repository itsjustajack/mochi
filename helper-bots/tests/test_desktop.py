import tempfile
import tomllib
import unittest
from pathlib import Path

from helper.config import Home
from helper.desktop.engine import Engine
from tests.helpers import FakeModel


class EngineTests(unittest.TestCase):
    """The Windows app's engine, without the window (tkinter isn't needed here)."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.home = Home(Path(self._tmp.name) / "h")

    def tearDown(self):
        self._tmp.cleanup()

    def test_first_run_sets_everything_up(self):
        e = Engine(self.home, model=FakeModel([]), start_servers=False)
        self.assertTrue(e.first_run)
        self.assertTrue(e.policy_ok)
        self.assertIn("inbox", e.agents)
        code, res = e.call("GET", "/v1/today")
        self.assertEqual(code, 200)
        self.assertFalse(Engine(self.home, model=FakeModel([]), start_servers=False).first_run)

    def test_task_and_approval_from_the_app(self):
        e = Engine(self.home, model=FakeModel([{"action": "write_file", "args": {"path": "a.txt", "text": "x"}},
                                               {"action": "done", "args": {"answer": "ok"}}]), start_servers=False)
        code, res = e.call("POST", "/v1/tasks", {"goal": "write a.txt", "agent": "organizer"})
        self.assertEqual(code, 201)
        import time
        for _ in range(100):
            pend = e.gate.approvals.pending()
            if pend:
                break
            time.sleep(0.02)
        self.assertEqual(pend[0].decided_by, None)
        e.call("POST", f"/v1/approvals/{pend[0].id}", {"verdict": "approve"})
        for _ in range(100):
            if e.runner.tasks[res["id"]].status == "done":
                break
            time.sleep(0.02)
        self.assertEqual(e.runner.tasks[res["id"]].status, "done")
        self.assertEqual(pend[0].decided_by, "ui:pc")

    def test_phone_link_setting_is_valid_toml(self):
        e = Engine(self.home, model=FakeModel([]), start_servers=False)
        e.set_link(True, "192.168.1.20")
        cfg = tomllib.loads((self.home.root / "settings.toml").read_text())
        self.assertEqual(cfg["link"], {"enabled": True, "host": "192.168.1.20", "port": 8766})
        self.assertIn("model", cfg)
        e.set_link(False, "192.168.1.20")
        self.assertFalse(tomllib.loads((self.home.root / "settings.toml").read_text())["link"]["enabled"])

    def test_errors_do_not_crash_screens(self):
        e = Engine(self.home, model=FakeModel([]), start_servers=False)
        self.assertEqual(e.call("GET", "/v1/nope")[0], 404)


if __name__ == "__main__":
    unittest.main()
