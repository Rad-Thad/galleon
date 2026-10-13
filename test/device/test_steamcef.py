"""Unit tests for steamcef.py: python3 -m unittest discover -s test/device"""

import contextlib
import io
import json
import os
import socketserver
import struct
import tempfile
import threading
import time
import unittest

import shortcuts
import steamcef
from test_shortcuts import shortcuts_file


class FakeCef(socketserver.ThreadingTCPServer):
    """Steam's CEF debugger: the page list over HTTP, Runtime.evaluate over a WebSocket."""

    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, answer, title="SharedJSContext"):
        super().__init__(("127.0.0.1", 0), FakeCefHandler)
        self.answer = answer
        self.title = title
        # The Game Mode window's route; None leaves its address out.
        self.route = "/library/home"
        self.big_picture = "Steam Big Picture Mode"
        self.expressions = []
        self.url = f"http://127.0.0.1:{self.server_address[1]}"
        threading.Thread(target=self.serve_forever, args=(0.05,), daemon=True).start()


def frame(opcode, payload, final=True):
    size = len(payload)
    first = (0x80 if final else 0) | opcode
    if size < 126:
        return struct.pack("!BB", first, size) + payload
    if size < 1 << 16:
        return struct.pack("!BBH", first, 126, size) + payload
    return struct.pack("!BBQ", first, 127, size) + payload


class FakeCefHandler(socketserver.StreamRequestHandler):
    def handle(self):
        request = self.rfile.readline().decode()
        while self.rfile.readline() not in (b"\r\n", b""):
            pass
        port = self.server.server_address[1]
        if request.startswith("GET /json "):
            big_picture = {"title": self.server.big_picture,
                           "webSocketDebuggerUrl": f"ws://127.0.0.1:{port}/devtools/page/BPM"}
            if self.server.route is not None:
                big_picture["url"] = f"https://steamloopback.host/routes{self.server.route}?x=1"
            pages = [
                {"title": "QuickAccess", "url": "https://steamloopback.host/routes/quickaccess"},
                {"title": "Owner Persona", "url": "https://steamcommunity.com/profiles/76561198000000001/"},
                big_picture,
                {"title": self.server.title, "webSocketDebuggerUrl": f"ws://127.0.0.1:{port}/devtools/page/SHARED"},
            ]
            body = json.dumps(pages).encode()
            self.wfile.write(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: "
                             + str(len(body)).encode() + b"\r\n\r\n" + body)
            return
        if not request.startswith("GET /devtools/page/SHARED "):
            self.wfile.write(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n")
            return
        self.wfile.write(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n")
        first, second = self.rfile.read(2)
        assert second & 0x80, "client frames must be masked"
        size = second & 0x7F
        if size == 126:
            size = struct.unpack("!H", self.rfile.read(2))[0]
        elif size == 127:
            size = struct.unpack("!Q", self.rfile.read(8))[0]
        mask = self.rfile.read(4)
        payload = bytes(b ^ mask[i % 4] for i, b in enumerate(self.rfile.read(size)))
        message = json.loads(payload)
        expression = message["params"]["expression"]
        self.server.expressions.append(expression)
        assert message["params"]["awaitPromise"] and message["params"]["returnByValue"]
        result = self.server.answer(expression)
        # An event and a ping before the reply, and the reply in two fragments,
        # as a real debugger may send them.
        self.wfile.write(frame(0x1, json.dumps({"method": "Runtime.consoleAPICalled"}).encode()))
        self.wfile.write(frame(0x9, b"ping"))
        reply = json.dumps({"id": message["id"], "result": result}).encode()
        self.wfile.write(frame(0x1, reply[:5], final=False) + frame(0x0, reply[5:]))


def value(v):
    return {"result": {"type": "number", "value": v}}


THREW = {"result": {"type": "object"}, "exceptionDetails": {"text": "Uncaught"}}


class SteamCefTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = os.path.join(self.tmp.name, "owner")
        self.test_root = os.path.join(self.tmp.name, "galleon-device-tests")
        self.device = os.path.join(self.tmp.name, "device")
        os.makedirs(self.home)
        os.makedirs(self.test_root)
        self.servers = []

    def tearDown(self):
        for server in self.servers:
            server.shutdown()
            server.server_close()
        self.tmp.cleanup()

    def cef(self, answer, **kwargs):
        server = FakeCef(answer, **kwargs)
        self.servers.append(server)
        return server

    def write_vdf(self, entries, user="1001"):
        path = os.path.join(self.home, ".local/share/Steam/userdata", user, "config", "shortcuts.vdf")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as handle:
            handle.write(shortcuts_file(entries))
        return path

    def record(self):
        with open(os.path.join(self.test_root, "shortcut.json"), encoding="utf-8") as handle:
            return json.load(handle)

    def ensure(self, cef):
        return steamcef.ensure(self.test_root, self.home, cef, root=self.device)

    def test_adds_the_shortcut_through_steam_and_keeps_its_appid(self):
        server = self.cef(lambda expression: value(3000000001))
        self.assertEqual(self.ensure(server.url), (3000000001, "added"))
        exe = os.path.join(self.test_root, "launch.sh")
        self.assertEqual(self.record(), {"name": "Galleon Device Test", "exe": exe, "appid": 3000000001})
        expression = server.expressions[0]
        args = f'"Galleon Device Test", {json.dumps(exe)}, {json.dumps(self.test_root)}, ""'
        self.assertIn(f"SteamClient.Apps.AddShortcut({args})", expression)
        self.assertIn('SetShortcutName(appid, "Galleon Device Test")', expression)

    def test_wraps_the_shortcut_in_armadas_launcher_when_the_device_has_it(self):
        launcher = self.device + steamcef.ARMADA_LAUNCH
        os.makedirs(os.path.dirname(launcher))
        open(launcher, "w").close()
        server = self.cef(lambda expression: value(77))
        self.ensure(server.url)
        self.assertIn(json.dumps(f"{steamcef.ARMADA_LAUNCH} %command%") + ")", server.expressions[0])
        self.assertIn(f'SetShortcutLaunchOptions(appid, "{steamcef.ARMADA_LAUNCH} %command%")',
                      server.expressions[0])

    def test_a_name_with_quotes_reaches_steam_as_one_string(self):
        server = self.cef(lambda expression: value(5))
        steamcef.add_shortcut(server.url, 'a"); alert(1); ("', "/x/launch.sh", "/x", "")
        self.assertIn(json.dumps('a"); alert(1); ("'), server.expressions[0])
        self.assertNotIn('a"); alert', server.expressions[0])

    def test_the_record_is_reused_without_asking_steam(self):
        steamcef.write_record(os.path.join(self.test_root, "shortcut.json"), "Galleon Device Test", "/x", 42)
        self.assertEqual(self.ensure("http://127.0.0.1:1"), (42, "record"))

    def test_without_a_record_the_shortcut_is_found_in_shortcuts_vdf(self):
        self.write_vdf([{"appid": -1234567890, "AppName": "Galleon Device Test"}])
        server = self.cef(lambda expression: value(1))
        self.assertEqual(self.ensure(server.url), (3060399406, "shortcuts.vdf"))
        self.assertEqual(server.expressions, [])
        self.assertEqual(self.record()["appid"], 3060399406)

    def test_a_record_steam_has_since_dropped_is_replaced(self):
        record = os.path.join(self.test_root, "shortcut.json")
        steamcef.write_record(record, "Galleon Device Test", "/x", 42)
        past = time.time() - 60
        os.utime(record, (past, past))
        self.write_vdf([{"appid": 7, "AppName": "Some Game"}])
        server = self.cef(lambda expression: value(99))
        self.assertEqual(self.ensure(server.url), (99, "added"))
        self.assertEqual(self.record()["appid"], 99)

    def test_a_record_newer_than_shortcuts_vdf_is_trusted(self):
        # Steam saves the file some time after AddShortcut returns.
        path = self.write_vdf([{"appid": 7, "AppName": "Some Game"}])
        past = time.time() - 60
        os.utime(path, (past, past))
        steamcef.write_record(os.path.join(self.test_root, "shortcut.json"), "Galleon Device Test", "/x", 42)
        self.assertEqual(self.ensure("http://127.0.0.1:1"), (42, "record"))

    def test_a_record_listed_in_shortcuts_vdf_is_trusted_however_old(self):
        record = os.path.join(self.test_root, "shortcut.json")
        steamcef.write_record(record, "Galleon Device Test", "/x", 3060399406)
        past = time.time() - 60
        os.utime(record, (past, past))
        self.write_vdf([{"appid": -1234567890, "AppName": "Galleon Device Test"}])
        self.assertEqual(self.ensure("http://127.0.0.1:1"), (3060399406, "record"))

    def test_a_broken_or_foreign_record_is_ignored(self):
        record = os.path.join(self.test_root, "shortcut.json")
        server = self.cef(lambda expression: value(8))
        for content in ("{", "[]", '{"name": "Other", "appid": 5}', '{"name": "Galleon Device Test", "appid": true}',
                        '{"name": "Galleon Device Test", "appid": 0}'):
            with open(record, "w", encoding="utf-8") as handle:
                handle.write(content)
            self.assertEqual(self.ensure(server.url), (8, "added"))

    def test_the_record_is_not_written_through_a_link(self):
        target = os.path.join(self.tmp.name, "elsewhere.json")
        with open(target, "w", encoding="utf-8") as handle:
            handle.write("owner")
        os.symlink(target, os.path.join(self.test_root, "shortcut.json.tmp"))
        server = self.cef(lambda expression: value(8))
        self.ensure(server.url)
        with open(target, encoding="utf-8") as handle:
            self.assertEqual(handle.read(), "owner")
        self.assertEqual(self.record()["appid"], 8)

    def test_shortcuts_vdf_is_never_written(self):
        path = self.write_vdf([{"appid": 7, "AppName": "Some Game"}])
        with open(path, "rb") as handle:
            before = handle.read()
        stat = os.stat(path)
        server = self.cef(lambda expression: value(8))
        self.ensure(server.url)
        with open(path, "rb") as handle:
            self.assertEqual(handle.read(), before)
        self.assertEqual(os.stat(path).st_mtime_ns, stat.st_mtime_ns)

    def test_steam_shared_context_under_its_newer_title(self):
        server = self.cef(lambda expression: value(6), title=steamcef.SHARED_CONTEXTS[1])
        self.assertEqual(steamcef.add_shortcut(server.url, "n", "/e", "/", ""), 6)

    def test_no_debugger_is_unavailable(self):
        with self.assertRaises(steamcef.CefUnavailable):
            self.ensure("http://127.0.0.1:1")

    def test_no_shared_context_is_unavailable(self):
        server = self.cef(lambda expression: value(6), title="Something Else")
        with self.assertRaises(steamcef.CefUnavailable):
            steamcef.run_game(server.url, 1)

    def test_only_loopback_addresses_are_used(self):
        for url in ("http://192.0.2.1:8080", "http://steam.example:8080"):
            with self.assertRaises(steamcef.CefUnavailable):
                steamcef.shared_context(url)
        with self.assertRaises(steamcef.CefUnavailable):
            steamcef.WebSocket("ws://192.0.2.1:8080/devtools/page/X")

    def test_a_call_that_throws_or_returns_no_appid_is_an_error(self):
        for answer in (THREW, value(0), {"result": {"type": "undefined"}}, value(True)):
            server = self.cef(lambda expression, answer=answer: answer)
            with self.assertRaises(steamcef.CefError):
                steamcef.add_shortcut(server.url, "n", "/e", "/", "")
        self.assertFalse(os.path.exists(os.path.join(self.test_root, "shortcut.json")))

    def test_run_game_passes_the_game_id_as_a_string(self):
        server = self.cef(lambda expression: {"result": {"type": "undefined"}})
        steamcef.run_game(server.url, shortcuts.gameid(3060399406))
        self.assertEqual(server.expressions, [
            f'SteamClient.Apps.RunGame("{shortcuts.gameid(3060399406)}", \'\', -1, 100)'])

    def test_cli_ensure_run_and_the_skip(self):
        server = self.cef(lambda expression: value(3060399406))
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = steamcef.main(["--home", self.home, "--cef", server.url, "ensure",
                                  "--test-root", self.test_root, "--root", self.device])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out.getvalue()), {
            "appid": 3060399406, "gameid": shortcuts.gameid(3060399406), "source": "added", "reason": None})

        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = steamcef.main(["--cef", server.url, "run", str(shortcuts.gameid(3060399406))])
        self.assertEqual(code, 0)

        os.unlink(os.path.join(self.test_root, "shortcut.json"))
        for argv in (["ensure", "--test-root", self.test_root], ["run", "1"]):
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = steamcef.main(["--home", self.home, "--cef", "http://127.0.0.1:1"] + argv)
            self.assertEqual(code, steamcef.EXIT_SKIPPED)
            self.assertEqual(json.loads(out.getvalue()), {"reason": "steam-cef-unavailable"})

    def test_the_screen_is_read_from_the_game_mode_windows_address(self):
        server = self.cef(lambda expression: value(1))
        self.assertEqual(steamcef.screen(server.url), "/library/home")
        server.route = "/library/app/3060399406"
        self.assertEqual(steamcef.screen(server.url), "/library/app/3060399406")
        server.big_picture = "SP"
        server.route = ""
        self.assertEqual(steamcef.screen(server.url), "/")
        self.assertEqual(server.expressions, [], "looking evaluates nothing in Steam")

    def test_no_game_mode_window_is_unavailable_and_says_what_there_was(self):
        server = self.cef(lambda expression: value(1))
        server.route = None
        with self.assertRaises(steamcef.CefUnavailable) as raised:
            steamcef.screen(server.url)
        self.assertIn("'/routes/quickaccess'", str(raised.exception))
        for private in ("Owner Persona", "76561198000000001", "steamcommunity", "QuickAccess"):
            self.assertNotIn(private, str(raised.exception))
        server.route = "/library"
        server.big_picture = "Steam"
        with self.assertRaises(steamcef.CefUnavailable):
            steamcef.screen(server.url)
        with self.assertRaises(steamcef.CefUnavailable):
            steamcef.screen("http://127.0.0.1:1")

    def test_the_library_is_its_own_screens_not_a_games_page(self):
        for route in ("/library", "/library/home", "/library/collections"):
            self.assertTrue(steamcef.at_library(route), route)
        for route in ("/", "/library/app/3060399406", "/libraryx", "/store", "/routes/library"):
            self.assertFalse(steamcef.at_library(route), route)

    def test_waits_for_steam_to_show_its_library(self):
        server = self.cef(lambda expression: value(1))
        server.route = "/library/app/1"
        now = [0.0]

        def sleep(seconds):
            now[0] += seconds
            if now[0] >= 2:
                server.route = "/library/home"

        self.assertEqual(steamcef.wait_library(server.url, 5, lambda: now[0], sleep), "/library/home")
        self.assertEqual(now[0], 2)
        server.route = "/library/app/1"
        now[0] = 0.0
        self.assertEqual(steamcef.wait_library(server.url, 1, lambda: now[0], lambda s: now.__setitem__(0, now[0] + s)),
                         "/library/app/1")

    def test_a_window_list_that_comes_back_in_time_is_waited_for(self):
        server = self.cef(lambda expression: value(1))
        route, server.route = server.route, None
        now = [0.0]

        def sleep(seconds):
            now[0] += seconds
            server.route = route

        self.assertEqual(steamcef.wait_library(server.url, 5, lambda: now[0], sleep), "/library/home")
        server.route = None
        now[0] = 0.0
        with self.assertRaises(steamcef.CefUnavailable):
            steamcef.wait_library(server.url, 1, lambda: now[0], lambda s: now.__setitem__(0, now[0] + s))

    def test_cli_library(self):
        server = self.cef(lambda expression: value(1))
        for route, code, library in (("/library/home", 0, True), ("/library/app/7", 1, False)):
            server.route = route
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                self.assertEqual(steamcef.main(["--cef", server.url, "library"]), code)
            self.assertEqual(json.loads(out.getvalue()), {"route": route, "library": library})
        server.route = "/profile/76561198000000001"
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(steamcef.main(["--cef", server.url, "library"]), 1)
        self.assertEqual(json.loads(out.getvalue()), {"route": "/profile", "library": False})
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(steamcef.main(["--cef", "http://127.0.0.1:1", "library"]), steamcef.EXIT_SKIPPED)
        self.assertEqual(json.loads(out.getvalue())["reason"], "steam-cef-unavailable")

    def test_waits_for_steam_to_list_the_shortcut(self):
        now = [0.0]
        naps = []

        def sleep(seconds):
            naps.append(seconds)
            now[0] += seconds
            if len(naps) == 3:
                self.write_vdf([{"appid": -1234567890, "AppName": "Galleon Device Test"}])

        self.assertTrue(steamcef.wait_listed(self.home, 3060399406, 30, clock=lambda: now[0], sleep=sleep))
        self.assertEqual(len(naps), 3)
        self.assertFalse(steamcef.wait_listed(self.home, 3000000001, 5, clock=lambda: now[0], sleep=sleep))
        self.assertLessEqual(now[0], 3 + 5 + 1)

    def test_an_entry_saved_before_its_rename_or_launch_options_is_not_yet_the_save(self):
        self.write_vdf([{"appid": -1234567890, "AppName": "launch.sh", "LaunchOptions": ""}])
        self.assertTrue(steamcef.listed(self.home, 3060399406))
        self.assertFalse(steamcef.listed(self.home, 3060399406, "Galleon Device Test"))
        self.write_vdf([{"appid": -1234567890, "AppName": "Galleon Device Test", "LaunchOptions": ""}])
        self.assertTrue(steamcef.listed(self.home, 3060399406, "Galleon Device Test", ""))
        self.assertFalse(steamcef.listed(self.home, 3060399406, "Galleon Device Test",
                                         f"{steamcef.ARMADA_LAUNCH} %command%"))

    def test_a_listing_that_cannot_be_read_is_not_a_save(self):
        path = self.write_vdf([{"appid": -1234567890, "AppName": "Galleon Device Test"}])
        with open(path, "r+b") as handle:
            handle.truncate(12)
        self.assertFalse(steamcef.listed(self.home, 3060399406))

    def test_cli_skips_until_steam_has_saved_the_shortcut(self):
        server = self.cef(lambda expression: value(3060399406))
        argv = ["--home", self.home, "--cef", server.url, "ensure", "--test-root", self.test_root,
                "--saved-within", "0"]
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = steamcef.main(argv)
        self.assertEqual(code, steamcef.EXIT_SKIPPED)
        self.assertEqual(json.loads(out.getvalue()), {
            "appid": 3060399406, "gameid": shortcuts.gameid(3060399406), "source": "added",
            "reason": "steam-shortcut-unsaved"})

        self.write_vdf([{"appid": -1234567890, "AppName": "Galleon Device Test"}])
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = steamcef.main(argv)
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out.getvalue())["reason"], None)
        self.assertEqual(len(server.expressions), 1)

    def test_cli_reports_a_failed_call(self):
        server = self.cef(lambda expression: THREW)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = steamcef.main(["--home", self.home, "--cef", server.url, "ensure",
                                  "--test-root", self.test_root])
        self.assertEqual(code, 1)
        self.assertEqual(json.loads(out.getvalue())["reason"], "steam-cef-error")


if __name__ == "__main__":
    unittest.main()
