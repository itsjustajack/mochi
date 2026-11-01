import base64
import datetime as dt
import unittest

from helper import crypto
from helper.calm import Calm, Reminders, needs_you, one_thing
from helper.capture import CaptureStore, split_items
from helper.server import App
from tests.helpers import Env


class CryptoTests(unittest.TestCase):
    def test_rfc8439_vector(self):
        key = bytes(range(0x80, 0xA0))
        nonce = bytes.fromhex("070000004041424344454647")
        aad = bytes.fromhex("50515253c0c1c2c3c4c5c6c7")
        pt = (b"Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, "
              b"sunscreen would be it.")
        out = crypto.seal(key, nonce, pt, aad)
        self.assertEqual(out[-16:].hex(), "1ae10b594f09e26a7e902ecbd0600691")
        self.assertEqual(out[:16].hex(), "d31a8d34648e60db7b86afbc53ef7ec2")
        self.assertEqual(crypto.open_(key, nonce, out, aad), pt)

    def test_note_round_trip_and_tamper(self):
        key = b"k" * 32
        blob = crypto.encrypt_note(key, "café list ✓")
        self.assertEqual(crypto.decrypt_note(key, blob), "café list ✓")
        self.assertNotIn(b"caf", blob)
        bad = bytearray(blob)
        bad[-1] ^= 1
        with self.assertRaises(ValueError):
            crypto.decrypt_note(key, bytes(bad))
        with self.assertRaises(ValueError):
            crypto.decrypt_note(b"j" * 32, blob)


class CaptureTests(unittest.TestCase):
    def setUp(self):
        self.env = Env()

    def tearDown(self):
        self.env.close()

    def test_split(self):
        items = split_items("- need to call the dentist\n- that film was good\nemail landlord about boiler and then buy milk")
        self.assertEqual([i["kind"] for i in items], ["task", "note", "task", "task"])
        self.assertEqual(items[0]["first_step"], "Find the number")

    def test_drive_folder_pickup(self):
        key = crypto.notes_key(self.env.home.root)
        folder = self.env.home.root / "drive-capture"
        folder.mkdir()
        (folder / "a.hln").write_bytes(crypto.encrypt_note(key, "pay phone bill"))
        (folder / "junk.hln").write_bytes(b"HLN1nope")
        store = CaptureStore(self.env.home.state_dir)
        found = store.scan_folder(key, folder)
        self.assertEqual(len(found), 1)
        self.assertTrue((folder / "imported" / "a.hln").exists())
        self.assertTrue((folder / "junk.hln").exists())
        self.assertEqual(store.scan_folder(key, folder), [])

    def test_sort_into_reminders(self):
        app = App(self.env.runner([]), self.env.agents, "k", self.env.settings, port=0)
        code, note = app.handle("POST", "/v1/capture", {"text": "call mum\nnice weather\nbook GP"})
        self.assertEqual(code, 201)
        code, res = app.handle("POST", f"/v1/capture/{note['id']}/sort", {"keep": [0, 2]})
        self.assertEqual([r["text"] for r in res["reminders"]], ["Call mum", "Book GP"])
        self.assertEqual(app.handle("GET", "/v1/capture", None)[1]["notes"], [])


class CalmTests(unittest.TestCase):
    def setUp(self):
        self.env = Env()
        self.state = self.env.home.state_dir
        self.rem, self.calm = Reminders(self.state), Calm(self.state)

    def tearDown(self):
        self.env.close()

    def test_missed_moves_quietly_to_tomorrow(self):
        now = dt.datetime(2026, 11, 5, 10, 0)
        r = self.rem.add("Ring the bank", due=dt.datetime(2026, 11, 3, 9, 0).timestamp())
        self.assertEqual(self.rem.roll_missed(now), 1)
        due = dt.datetime.fromtimestamp(self.rem.list()[0]["due"])
        self.assertEqual((due.day, due.hour), (6, 9))
        self.assertNotIn(r["id"], [x["id"] for x in self.rem.showing(now)])

    def test_snooze_and_at_pc(self):
        now = dt.datetime(2026, 11, 5, 10, 0)
        a = self.rem.add("A")
        b = self.rem.add("B")
        self.rem.snooze(a["id"], "1h", now)
        self.rem.snooze(b["id"], "at_pc", now)
        self.assertEqual(self.rem.showing(now), [])
        self.assertEqual([r["text"] for r in self.rem.showing(now, at_pc=True)], ["B"])
        self.assertEqual(len(self.rem.showing(now + dt.timedelta(hours=2))), 1)

    def test_too_much_shows_three(self):
        for i in range(6):
            self.rem.add(f"thing {i}")
        self.calm.set(too_much=True)
        view = needs_you(self.rem, self.calm, [], 0)
        self.assertEqual((len(view["items"]), view["held"]), (3, 3))
        self.assertEqual(one_thing(view)["text"], "thing 0")

    def test_quiet_hours(self):
        self.assertTrue(self.calm.quiet_now(dt.datetime(2026, 11, 5, 23, 30)))
        self.assertTrue(self.calm.quiet_now(dt.datetime(2026, 11, 5, 7, 0)))
        self.assertFalse(self.calm.quiet_now(dt.datetime(2026, 11, 5, 12, 0)))

    def test_quests_off_by_default(self):
        self.assertEqual(self.calm.add_xp(10), 0)
        self.calm.set(quests=True)
        self.assertEqual(self.calm.add_xp(10), 10)

    def test_today_api(self):
        app = App(self.env.runner([]), self.env.agents, "k", self.env.settings, port=0)
        app.handle("POST", "/v1/reminders", {"text": "Reply to landlord"})
        code, res = app.handle("GET", "/v1/today", None)
        self.assertEqual(res["one_thing"]["text"], "Reply to landlord")
        self.assertEqual(app.handle("POST", "/v1/calm", {"too_much": True})[1]["too_much"], True)
        self.assertEqual(app.handle("POST", "/v1/calm", {"bogus": 1})[0], 400)


if __name__ == "__main__":
    unittest.main()
