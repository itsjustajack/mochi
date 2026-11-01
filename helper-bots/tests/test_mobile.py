"""The phone runs the same engine through helper.mobile."""

import json
import tempfile
import unittest

from helper import mobile


class MobileTest(unittest.TestCase):
    def test_start_and_call(self):
        with tempfile.TemporaryDirectory() as d:
            mobile._engine = None
            opened = []
            mobile.set_open_url(opened.append)
            self.assertTrue(mobile.start(d))
            self.assertFalse(mobile.start(d))
            st = json.loads(mobile.call("GET", "/v1/status"))
            self.assertEqual(st["code"], 200)
            agents = json.loads(mobile.call("GET", "/v1/agents"))["body"]["agents"]
            self.assertTrue(any(a["key"] == "pip" for a in agents))
            r = json.loads(mobile.call("POST", "/v1/reminders", json.dumps({"text": "call the dentist"})))
            self.assertIn(r["code"], (200, 201))
            today = json.loads(mobile.call("GET", "/v1/today"))["body"]
            self.assertEqual(today["items"][0]["first_step"], "Find the number")
            import webbrowser
            webbrowser.open("https://example.com/")
            self.assertEqual(opened, ["https://example.com/"])
            mobile.stop()
            mobile._engine = None


if __name__ == "__main__":
    unittest.main()
