import json
import threading
import time
import unittest
import urllib.error
import urllib.request

from helper.link import (PAIR_MAX_TRIES, PAIR_TTL_S, DeviceRegistry, LinkApp, check_bind_host,
                         make_link_handler, qr_payload, serve_link)
from helper.server import App
from tests.helpers import Env


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


class RegistryTests(unittest.TestCase):
    def setUp(self):
        self.env = Env()
        self.clock = Clock()
        self.path = self.env.home.state_dir / "link_devices.json"
        self.reg = DeviceRegistry(self.path, clock=self.clock)

    def tearDown(self):
        self.env.close()

    def test_pair_once_and_key_works(self):
        code = self.reg.start_pairing()["code"]
        res = self.reg.complete_pairing(code, "Galaxy S23 FE")
        self.assertTrue(res["key"].startswith("hl_"))
        self.assertEqual(self.reg.verify(res["key"])["name"], "Galaxy S23 FE")
        self.assertIsNone(self.reg.complete_pairing(code, "again"), "a code works once")
        self.assertIsNone(self.reg.verify("hl_wrong"))

    def test_key_not_stored_in_plain(self):
        res = self.reg.complete_pairing(self.reg.start_pairing()["code"], "Phone")
        self.assertNotIn(res["key"], self.path.read_text())
        again = DeviceRegistry(self.path, clock=self.clock)
        self.assertIsNotNone(again.verify(res["key"]), "devices survive a restart")

    def test_code_expires(self):
        code = self.reg.start_pairing()["code"]
        self.clock.t += PAIR_TTL_S + 1
        self.assertIsNone(self.reg.complete_pairing(code, "Phone"))

    def test_wrong_codes_cancel_pairing(self):
        code = self.reg.start_pairing()["code"]
        for _ in range(PAIR_MAX_TRIES):
            self.assertIsNone(self.reg.complete_pairing("WRONGWRO", "Phone"))
        self.assertIsNone(self.reg.complete_pairing(code, "Phone"))

    def test_code_forgiving_format(self):
        code = self.reg.start_pairing()["code"]
        spaced = code[:4].lower() + "-" + code[4:].lower()
        self.assertIsNotNone(self.reg.complete_pairing(spaced, "Phone"))

    def test_remove_device(self):
        res = self.reg.complete_pairing(self.reg.start_pairing()["code"], "Phone")
        self.assertTrue(self.reg.remove(res["id"]))
        self.assertIsNone(self.reg.verify(res["key"]))
        self.assertEqual(self.reg.public(), [])

    def test_public_has_no_secrets(self):
        self.reg.complete_pairing(self.reg.start_pairing()["code"], "Phone")
        pub = self.reg.public()[0]
        self.assertNotIn("key_hash", pub)
        self.assertEqual(len(pub["key_hint"]), 4)

    def test_never_listens_everywhere(self):
        for bad in ("", "0.0.0.0", "::"):
            with self.assertRaises(ValueError):
                check_bind_host(bad)

    def test_qr_payload(self):
        self.assertEqual(qr_payload("192.168.1.20", 8766, "ABCD2345"),
                         "helper-link:v1?host=192.168.1.20&port=8766&code=ABCD2345")


class LinkServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.env = Env()
        cls.runner = cls.env.runner([])
        cls.reg = DeviceRegistry(cls.env.home.state_dir / "link_devices.json")
        cls.app = LinkApp(cls.reg, cls.runner, cls.env.agents, cls.env.settings, "test")
        cls.httpd = serve_link(cls.app, "127.0.0.1", 0)
        cls.port = cls.httpd.server_address[1]
        cls.httpd.RequestHandlerClass = make_link_handler(cls.app, "127.0.0.1", cls.port)
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()
        code = cls.reg.start_pairing()["code"]
        _, _, body = cls.req("POST", "/v2/pair", {"code": code, "name": "Test phone"}, key=None)
        cls.key = json.loads(body)["key"]
        cls.pc = App(cls.runner, cls.env.agents, "pc-key", cls.env.settings, port=0, registry=cls.reg,
                     link_cfg={"enabled": True, "host": "192.168.1.20", "port": 8766})

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.env.close()

    @classmethod
    def req(cls, method, path, body=None, key="__default__", host=None):
        if key == "__default__":
            key = cls.key
        data = json.dumps(body).encode() if body is not None else None
        r = urllib.request.Request(f"http://127.0.0.1:{cls.port}{path}", data=data, method=method)
        if key:
            r.add_header("Authorization", f"Bearer {key}")
        if body is not None:
            r.add_header("Content-Type", "application/json")
        if host:
            r.add_header("Host", host)
        try:
            with urllib.request.urlopen(r, timeout=5) as resp:
                return resp.status, dict(resp.headers), resp.read()
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers), e.read()

    def test_health_needs_device_key(self):
        self.assertEqual(self.req("GET", "/v2/health", key=None)[0], 401)
        self.assertEqual(self.req("GET", "/v2/health", key="hl_nope")[0], 401)
        code, headers, body = self.req("GET", "/v2/health")
        self.assertEqual(code, 200)
        self.assertEqual(json.loads(body)["device"], "Test phone")
        self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_wrong_host_refused(self):
        self.assertEqual(self.req("GET", "/v2/health", host="evil.example")[0], 421)

    def test_bad_pair_code(self):
        self.assertEqual(self.req("POST", "/v2/pair", {"code": "NOPE", "name": "x"}, key=None)[0], 403)

    def test_phone_cannot_approve_stop_or_reach_pc_api(self):
        for path in ("/v2/approvals/abc", "/v2/stop", "/v2/start", "/v1/approvals/abc", "/v1/stop"):
            self.assertEqual(self.req("POST", path, {"verdict": "approve"})[0], 404, path)
        self.assertEqual(self.req("PUT", "/v2/jobs", {})[0], 405)

    def test_job_round_trip_and_ownership(self):
        self.runner.model.script = [{"action": "done", "args": {"answer": "hello from the PC"}}]
        code, _, body = self.req("POST", "/v2/jobs", {"goal": "say hello", "agent": "organizer"})
        self.assertEqual(code, 201)
        jid = json.loads(body)["id"]
        for _ in range(100):
            t = json.loads(self.req("GET", f"/v2/jobs/{jid}")[2])
            if t.get("status") == "done":
                break
            time.sleep(0.05)
        self.assertEqual(t["status"], "done")
        # another linked device can't read this job
        other = self.reg.complete_pairing(self.reg.start_pairing()["code"], "Tablet")["key"]
        self.assertEqual(self.req("GET", f"/v2/jobs/{jid}", key=other)[0], 404)
        self.assertEqual(json.loads(self.req("GET", "/v2/approvals")[2]), {"pending": 0})

    def test_pc_panel_routes(self):
        code, res = self.pc.handle("POST", "/v1/link/pair", {})
        self.assertEqual(code, 201)
        self.assertIn("host=192.168.1.20", res["qr"])
        code, info = self.pc.handle("GET", "/v1/link", None)
        self.assertEqual(info["pairing"]["code"], res["code"])
        self.assertTrue(any(d["name"] == "Test phone" for d in info["devices"]))
        self.pc.handle("POST", "/v1/link/pair/cancel", {})
        self.assertIsNone(self.pc.handle("GET", "/v1/link", None)[1]["pairing"])

    def test_pc_remove_device(self):
        k = self.reg.complete_pairing(self.reg.start_pairing()["code"], "Old phone")
        self.assertEqual(self.req("GET", "/v2/health", key=k["key"])[0], 200)
        self.assertEqual(self.pc.handle("POST", f"/v1/link/devices/{k['id']}/remove", {})[0], 200)
        self.assertEqual(self.req("GET", "/v2/health", key=k["key"])[0], 401)


if __name__ == "__main__":
    unittest.main()
