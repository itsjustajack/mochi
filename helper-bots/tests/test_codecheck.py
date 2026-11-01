import unittest
from pathlib import Path

from helper import codecheck
from helper.codecheck import check, detect_language
from helper.server import App
from tests.helpers import Env

JANITOR_BAD = '''// give XP when the player wins
var won = context.chat.last_message.indexOf("victory") > -1;
let xp = won ? 50 : 0;
if (context.character.scenario.match(/level (\\d+)/)[1] > 3) {
  xp = xp * 2;
}
context.character.scenario += " [XP +" + xp + "]";
'''

JANITOR_GOOD = '''var m = context.character.scenario.match(/level (\\d+)/);
if (m && parseInt(m[1], 10) > 3) {
  context.character.scenario += " [double XP]";
}
'''


def codes(result):
    return {f["code"] for f in result["findings"]}


class DetectTests(unittest.TestCase):
    def test_detect(self):
        self.assertEqual(detect_language("def f(x):\n    return x\n"), "python")
        self.assertEqual(detect_language("#!/usr/bin/env bash\necho hi\n"), "bash")
        self.assertEqual(detect_language("const a = () => 1;\nconsole.log(a());\n"), "javascript")
        self.assertEqual(detect_language(JANITOR_GOOD), "janitor")
        self.assertEqual(detect_language('{"a": 1}'), "json")
        self.assertEqual(detect_language('{"a": 1,}'), "json")
        self.assertEqual(detect_language("x", "run.sh"), "bash")


class PythonTests(unittest.TestCase):
    def test_syntax_error_stops(self):
        r = check("def f(:\n    pass\n", "python")
        self.assertEqual(r["findings"][0]["level"], "stops")

    def test_empty_and_zero_hazards(self):
        r = check("def avg(xs):\n    return sum(xs) / len(xs)\n\ndef d(a, b):\n    return a / b\n", "python")
        self.assertTrue({"P010", "P011"} <= codes(r))

    def test_guard_clears_hazard(self):
        r = check("def avg(xs):\n    if not xs:\n        return 0\n    return sum(xs) / len(xs)\n", "python")
        self.assertNotIn("P010", codes(r))

    def test_patterns(self):
        r = check("def f(a=[]):\n    try:\n        return eval(a)\n    except:\n        return None\n", "python")
        self.assertTrue({"P001", "P040", "P050"} <= codes(r))

    def test_clean(self):
        r = check('def add(a: int, b: int) -> int:\n    """Add."""\n    return a + b\n', "python")
        self.assertEqual(r["findings"], [])
        self.assertEqual(r["summary"], "No problems found.")


class JanitorTests(unittest.TestCase):
    def test_bad_script(self):
        r = check(JANITOR_BAD)
        self.assertEqual(r["language"], "janitor")
        self.assertTrue({"E001", "E010", "E020"} <= codes(r))
        self.assertEqual(r["findings"][0]["level"], "stops", "worst first")

    def test_good_script(self):
        self.assertEqual(check(JANITOR_GOOD)["findings"], [])

    def test_jacks_research_script_is_clean(self):
        src = Path(codecheck.__file__).parent / "skills" / "originals" / "deep-tactical-research-agent-v3.3.js"
        self.assertEqual(check(src.read_text(encoding="utf-8"))["findings"], [])

    def test_replacing_scenario_is_flagged(self):
        self.assertIn("E030", codes(check('context.character.scenario = "You are";')))
        self.assertNotIn("E030", codes(check('context.character.scenario = "";')))


class OtherLanguageTests(unittest.TestCase):
    def test_bash(self):
        r = check("echo $1\nrm -rf $DIR/\nwhile true; do echo hi; done\n", "bash")
        self.assertTrue({"B001", "B002", "B011", "B030"} <= codes(r))

    def test_json(self):
        self.assertEqual(check('{"a": [1, 2]}')["findings"], [])
        self.assertEqual(check('{"a": 1,}')["findings"][0]["level"], "stops")

    def test_javascript(self):
        r = check('var a = 1;\nif (a == "1") { console.log(a); }\nfunction m(x) { return 3 / x.length; }\n',
                  "javascript")
        self.assertTrue({"J001", "J002", "J010"} <= codes(r))

    def test_unknown_language(self):
        with self.assertRaises(ValueError):
            check("x", "cobol")


class ApiAndToolTests(unittest.TestCase):
    def setUp(self):
        self.env = Env()

    def tearDown(self):
        self.env.close()

    def test_api_route(self):
        app = App(self.env.runner([]), self.env.agents, "k", self.env.settings, port=0)
        code, res = app.handle("POST", "/v1/code/check", {"code": JANITOR_BAD})
        self.assertEqual(code, 200)
        self.assertEqual(res["language"], "janitor")
        self.assertEqual(app.handle("POST", "/v1/code/check", {"code": " "})[0], 400)

    def test_jace_can_check_a_file(self):
        (self.env.work / "quest.js").write_text(JANITOR_BAD)
        runner = self.env.runner([
            {"action": "check_code", "args": {"path": "quest.js"}},
            {"action": "done", "args": {"answer": "Line 3 uses let."}},
        ])
        task = runner.start("check quest.js", self.env.agents["jace"], background=False)
        self.assertEqual(task.status, "done")
        result = [e for e in task.events if e["kind"] == "result"][0]
        self.assertTrue(result["ok"])
        self.assertIn("E001", result["text"])


if __name__ == "__main__":
    unittest.main()
