import json
import threading
import unittest
import urllib.error
import urllib.request

from helper.server import App, serve
from tests.helpers import Env


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.env = Env()
        (cls.env.work / "a.txt").write_text("hi")
        cls.runner = cls.env.runner([])
        cls.app = App(cls.runner, cls.env.agents, "secret-key", cls.env.settings,
                      status_fn=lambda: {"ok": True, "message": "ready"}, port=0)
        cls.httpd = serve(cls.app, "127.0.0.1", 0)
        cls.port = cls.httpd.server_address[1]
        cls.app.port = cls.port
        # rebuild handler with the real port for the Host check
        from helper.server import make_handler
        cls.httpd.RequestHandlerClass = make_handler(cls.app)
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.env.close()

    def req(self, method, path, body=None, key="secret-key", host=None):
        data = json.dumps(body).encode() if body is not None else None
        r = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", data=data, method=method)
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

    def test_api_needs_key(self):
        self.assertEqual(self.req("GET", "/v1/status", key=None)[0], 401)
        self.assertEqual(self.req("GET", "/v1/status", key="wrong")[0], 401)
        self.assertEqual(self.req("GET", "/v1/status")[0], 200)

    def test_wrong_host_refused(self):
        self.assertEqual(self.req("GET", "/v1/status", host="evil.example")[0], 421)
        self.assertEqual(self.req("GET", "/", host="evil.example")[0], 421)

    def test_no_cors_and_security_headers(self):
        code, headers, _ = self.req("GET", "/")
        self.assertEqual(code, 200)
        self.assertNotIn("Access-Control-Allow-Origin", headers)
        self.assertIn("script-src 'self'", headers["Content-Security-Policy"])
        self.assertEqual(headers["X-Frame-Options"], "DENY")

    def test_options_and_put_refused(self):
        self.assertEqual(self.req("OPTIONS", "/v1/tasks")[0], 405)
        self.assertEqual(self.req("PUT", "/v1/tasks", body={})[0], 405)

    def test_approve_through_api(self):
        self.runner.model.script = [
            {"action": "delete_file", "args": {"path": "a.txt"}},
            {"action": "done", "args": {"answer": "deleted"}},
        ]
        code, _, body = self.req("POST", "/v1/tasks", body={"goal": "delete a.txt", "agent": "organizer"})
        self.assertEqual(code, 201)
        tid = json.loads(body)["id"]
        import time
        for _ in range(100):
            pend = json.loads(self.req("GET", "/v1/approvals")[2])["approvals"]
            if pend:
                break
            time.sleep(0.05)
        self.assertEqual(len(pend), 1)
        self.assertEqual(pend[0]["tool"], "delete_file")
        self.assertTrue((self.env.work / "a.txt").exists())
        self.assertEqual(self.req("POST", f"/v1/approvals/{pend[0]['id']}", body={"verdict": "approve"})[0], 200)
        for _ in range(100):
            t = json.loads(self.req("GET", f"/v1/tasks/{tid}")[2])
            if t["status"] == "done":
                break
            time.sleep(0.05)
        self.assertEqual(t["status"], "done")
        self.assertFalse((self.env.work / "a.txt").exists())

    def test_post_needs_json(self):
        r = urllib.request.Request(f"http://127.0.0.1:{self.port}/v1/stop", data=b"x", method="POST")
        r.add_header("Authorization", "Bearer secret-key")
        r.add_header("Content-Type", "text/plain")
        with self.assertRaises(urllib.error.HTTPError) as cm:
            urllib.request.urlopen(r, timeout=5)
        self.assertEqual(cm.exception.code, 415)


if __name__ == "__main__":
    unittest.main()
