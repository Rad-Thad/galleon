"""argosy-shapes.py: read-only by construction, and a report with shapes only."""

import hashlib
import importlib.util
import io
import json
import os
import re
import shutil
import sys
import tempfile
import threading
import unittest
import urllib.parse
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import signin

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "tools", "device-bridge"))
import galleon_device_bridge as bridge  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "argosy-shapes.py")
_spec = importlib.util.spec_from_file_location("argosy_shapes", SCRIPT)
shapes = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(shapes)

TOKEN = "rmm_secret_token_value"
TITLE = "Chrono Trigger"
CHANNEL = "Zelda 100 run"
ACCOUNT = "owner-account-name"
PAIRED = "argosy-chosen-identifier"


def _zip(entries):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, data in entries:
            archive.writestr(name, data)
    return buffer.getvalue()


def _zip_hash(entries):
    lines = sorted(f"{name}:{hashlib.md5(data).hexdigest()}" for name, data in entries)
    return hashlib.md5("\n".join(lines).encode("utf-8")).hexdigest()


RAW = b"\x00\x01SRAM" * 100 + shapes.HARDCORE_MAGIC
PS2_ENTRIES = [("BASLUS-20312/icon.sys", b"i" * 64), (f"BASLUS-20312/{TITLE}.bin", b"s" * 128)]
PS2 = _zip(PS2_ENTRIES)
WII_ENTRIES = [("RMGE01/data/banner.bin", b"b" * 32), (f"RMGE01/data/{TITLE}.dat", b"d" * 48)]
WII = _zip(WII_ENTRIES)


class FakeRomm:
    """RomM 5.2.0's read endpoints the script uses, recording every request."""

    def __init__(self):
        self.requests = []
        self.redirect = False
        argosy, other = 7, 8
        self.devices = [
            {"id": argosy, "name": ACCOUNT, "client": "Argosy", "hostname": "argosy-phone",
             "client_device_identifier": PAIRED},
            {"id": other, "name": "desk", "client": "Galleon", "client_device_identifier": None},
        ]
        self.platforms = [{"id": 1, "slug": "snes", "name": "Super Nintendo"},
                          {"id": 2, "slug": "ps2", "name": "PlayStation 2"},
                          {"id": 3, "slug": "gba", "name": "Game Boy Advance"},
                          {"id": 4, "slug": "wii", "name": "Wii"}]
        row = lambda id, rom, name, data, origin, slot="autosave", emulator="snes9x", hashed=None: {
            "id": id, "rom_id": rom, "file_name": name, "file_extension": name.rsplit(".", 1)[-1],
            "file_size_bytes": len(data), "updated_at": "2026-10-01T10:00:00Z", "emulator": emulator,
            "slot": slot, "content_hash": hashed, "origin_device_id": origin,
            "full_path": f"/romm/assets/{ACCOUNT}/{TITLE}"}
        self.saves = {
            1: row(1, 11, f"{TITLE} [2026-10-01_10-00-00].srm", RAW, argosy,
                   hashed=hashlib.md5(RAW).hexdigest()),
            2: row(2, 11, "autosave.srm", RAW, argosy, hashed="0" * 32),
            3: row(3, 12, f"{TITLE}.srm", RAW, other),
            # Another device's save on a game that is looked at.
            8: row(8, 11, f"{TITLE}.srm", RAW, other),
            9: row(9, 11, f"{CHANNEL}.srm", RAW, argosy, slot=CHANNEL),
            4: row(4, 21, f"{TITLE} [2026-10-02_09-00-00].zip", PS2, argosy, slot="autosave",
                   emulator="nethersx2", hashed=_zip_hash(PS2_ENTRIES)),
            # Made before pairing, so named by the identifier Argosy chose.
            10: row(10, 21, "autosave.zip", PS2, PAIRED, slot="autosave", emulator="nethersx2"),
            # No device at all, which another device's empty identifier must not match.
            11: row(11, 21, "autosave.zip", PS2, None, slot="autosave", emulator="nethersx2"),
            12: row(12, 41, f"{TITLE}.zip", WII, argosy, slot="autosave", emulator="dolphin",
                    hashed=_zip_hash(WII_ENTRIES)),
        }
        # Three more SNES games, so one is past the per-system limit.
        for n, rom in enumerate((13, 14, 15), start=5):
            self.saves[n] = row(n, rom, "autosave.srm", RAW, argosy, slot=None)
        self.content = {1: RAW, 2: RAW, 3: RAW, 4: PS2, 10: PS2, 11: PS2, 5: RAW, 6: RAW, 7: RAW, 8: RAW, 9: RAW,
                        12: WII}
        self.platform_of = {11: 1, 12: 1, 13: 1, 14: 1, 15: 1, 21: 2, 41: 4}

    def answer(self, method, path, query):
        self.requests.append((method, path, query))
        if path == "/api/moved":
            return []
        if path == "/api/devices" and self.redirect:
            return ("redirect", "/api/moved")
        if path == "/api/devices":
            return self.devices
        if path == "/api/platforms":
            return self.platforms
        if path == "/api/saves" and "platform_id" in query:
            wanted = int(query["platform_id"][0])
            return [s for s in self.saves.values() if self.platform_of[s["rom_id"]] == wanted]
        if path == "/api/saves" and "rom_id" in query:
            return [s for s in self.saves.values() if s["rom_id"] == int(query["rom_id"][0])]
        match = re.fullmatch(r"/api/saves/(\d+)/content", path)
        if match:
            return self.content[int(match.group(1))]
        return None


def _serve(fake):
    class Handler(BaseHTTPRequestHandler):
        def _any(self):
            parsed = urllib.parse.urlparse(self.path)
            body = fake.answer(self.command, parsed.path, urllib.parse.parse_qs(parsed.query))
            if isinstance(body, tuple):
                self.send_response(302)
                self.send_header("Location", body[1])
                self.end_headers()
                return
            if body is None or self.headers.get("Authorization") != f"Bearer {TOKEN}":
                self.send_response(404 if body is None else 401)
                self.end_headers()
                return
            data = body if isinstance(body, bytes) else json.dumps(body).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = do_HEAD = _any

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


class StaticTest(unittest.TestCase):
    """The file itself: nothing in it could send a write or a device id."""

    def setUp(self):
        with open(SCRIPT, encoding="utf-8") as handle:
            self.source = handle.read()

    def test_no_write_method_anywhere(self):
        for method in ("POST", "PUT", "PATCH", "DELETE"):
            self.assertNotRegex(self.source, rf"\b{method}\b", method)
            self.assertNotRegex(self.source, rf"(?i)method\s*=\s*['\"]{method}", method)

    def test_no_device_id_is_ever_sent(self):
        # `origin_device_id` and `client_device_identifier` are fields read
        # from rows, never sent; `device_id` alone is the parameter.
        self.assertIsNone(re.search(r"\bdevice_id\b", self.source))
        self.assertIsNotNone(re.search(r"\bdevice_id\b", "?device_id=1"))

    def test_one_request_and_it_is_a_get(self):
        self.assertNotRegex(self.source, r"\burlopen\(")
        self.assertEqual(len(re.findall(r"\b_OPENER\.open\(", self.source)), 1)
        self.assertEqual(re.findall(r"method=\"(\w+)\"", self.source), ["GET"])
        self.assertEqual(len(re.findall(r"urllib\.request\.Request\(", self.source)), 1)

    def test_ids_are_kept_and_words_are_not(self):
        self.assertEqual(shapes.entry_pattern("BASLUS-20312ZELDA"), "BASLUS-20312<suffix>")
        for kept in ("BASLUS-20312", "BESLES-5036601", "ULUS10041DATA00",
                     "0001000157414c45", "Mcd001", "card1", "title", "private"):
            self.assertEqual(shapes.entry_pattern(kept), kept, kept)
        for word in ("ZELDA", "MARIOS", "ZELDA2", "MARIO64", "Chrono Trigger", "facade", "cardigan",
                     "Pokemon.sav"):
            self.assertTrue(shapes.entry_pattern(word).startswith("<name>"), word)

    def test_a_disc_id_is_kept_only_as_a_gamecube_or_wii_root(self):
        for platform in ("ngc", "gc", "wii"):
            for kept in ("GALE01", "GZLE8P", "RMGE01", "SB4P01"):
                self.assertEqual(shapes.entry_pattern(f"{kept}/data/x.bin", platform),
                                 f"{kept}/data/<name>.bin", (platform, kept))
            for word in ("ZELDA2", "MARIOS", "GALEON", "SUPER1X"):
                self.assertTrue(shapes.entry_pattern(word, platform).startswith("<name>"), word)
        for platform in (None, "snes", "ps2", "psp"):
            self.assertEqual(shapes.entry_pattern("GALE01/x.bin", platform), "<name>/<name>.bin", platform)
        self.assertEqual(shapes.entry_pattern("title/GALE01", "wii"), "title/<name>")

    def test_a_name_without_a_real_extension_is_replaced_whole(self):
        channels = shapes.Channels()
        self.assertEqual(shapes.name_pattern({"file_name": "Dr. Mario"}, "autosave", channels), "<rom>")
        self.assertEqual(shapes.name_pattern({"file_name": "Dr. Mario.srm"}, "autosave", channels),
                         "<rom>.srm")

    def test_the_zip_hash_sorts_names_not_lines(self):
        # ':' sorts after '.', so sorting the joined lines would put these the other way round.
        entries = [("BASLUS-20312/BASLUS-20312", b"a"), ("BASLUS-20312/BASLUS-20312.bin", b"b"),
                   ("BASLUS-20312/", b"")]
        names = sorted(name for name, _ in entries if not name.endswith("/"))
        md5 = {name: hashlib.md5(data).hexdigest() for name, data in entries}
        expected = hashlib.md5("\n".join(f"{n}:{md5[n]}" for n in names).encode("utf-8")).hexdigest()
        self.assertEqual(shapes.romm_hash(_zip(entries)), expected)
        lines = sorted(f"{n}:{md5[n]}" for n in names)
        self.assertNotEqual(expected, hashlib.md5("\n".join(lines).encode("utf-8")).hexdigest())

    def test_a_query_key_outside_the_list_is_refused(self):
        with self.assertRaises(ValueError):
            shapes._get("http://127.0.0.1:9", TOKEN, "/api/saves", {"rom_id": 1, "slot": "x"})


class ReportTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="argosy-shapes-test-")
        self.fake = FakeRomm()
        self.server = _serve(self.fake)
        base = f"http://127.0.0.1:{self.server.server_address[1]}"
        self.home = os.path.join(self.dir, "home")
        signin.write_test_home(self.home, {"baseUrl": base, "authMode": "token"},
                               {"clientToken": TOKEN, "accessToken": None, "refreshToken": None,
                                "deviceId": None})
        self.out = os.path.join(self.dir, "argosy-shapes.json")

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        shutil.rmtree(self.dir)

    def run_report(self):
        code = shapes.main(["report", "--home", self.home, "--out", self.out])
        with open(self.out, encoding="utf-8") as handle:
            return code, handle.read()

    def test_only_gets_and_never_a_device_id(self):
        code, _ = self.run_report()
        self.assertEqual(code, 0)
        self.assertTrue(self.fake.requests)
        for method, path, query in self.fake.requests:
            self.assertEqual(method, "GET", path)
            self.assertNotIn("device_id", query, path)

    def test_the_report_layout(self):
        code, raw = self.run_report()
        report = json.loads(raw)
        self.assertEqual(code, 0)
        self.assertEqual(report["schema"], shapes.SCHEMA)
        self.assertEqual(report["argosyDevices"], 1)
        self.assertEqual([s["platform"] for s in report["systems"]], ["snes", "ps2", "wii"])
        snes, ps2, wii = report["systems"]
        # Four SNES games hold an Argosy save (one only another device's); three are looked at.
        self.assertEqual(snes["gamesWithArgosySaves"], 4)
        self.assertEqual(len(snes["games"]), shapes.GAMES_PER_SYSTEM)
        first = snes["games"][0]
        self.assertEqual(first["savesPerSlot"], {"autosave": 2, "<channel-1>": 1})
        tagged, fixed, channel = first["saves"]
        self.assertEqual(channel["slot"], "<channel-1>")
        self.assertEqual(channel["namePattern"], "<channel-1>.srm")
        self.assertEqual(tagged["namePattern"], "<rom> [<timestamp>].srm")
        self.assertEqual(fixed["namePattern"], "autosave.srm")
        self.assertIs(tagged["contentHashFollowsRomm"], True)
        self.assertIs(fixed["contentHashFollowsRomm"], False)
        self.assertIs(tagged["hardcoreTrailer"], True)
        self.assertIs(tagged["zipByRomm"], False)
        self.assertEqual(snes["games"][1]["savesPerSlot"], {"null": 1})
        self.assertIsNone(snes["games"][1]["saves"][0]["contentHashFollowsRomm"])
        save = ps2["games"][0]["saves"][0]
        self.assertEqual(save["emulator"], "nethersx2")
        self.assertIs(save["zipByRomm"], True)
        self.assertIs(save["zipByArgosy"], True)
        self.assertIs(save["contentHashFollowsRomm"], True)
        self.assertEqual([e["name"] for e in save["entries"]],
                         ["BASLUS-20312/<name>.sys", "BASLUS-20312/<name>.bin"])
        self.assertEqual([e["sizeBytes"] for e in save["entries"]], [64, 128])
        save = wii["games"][0]["saves"][0]
        self.assertEqual([e["name"] for e in save["entries"]],
                         ["RMGE01/data/<name>.bin", "RMGE01/data/<name>.dat"])
        self.assertIs(save["contentHashFollowsRomm"], True)

    def test_the_bridge_s_sanitiser_publishes_it_unchanged(self):
        # The bridge's own sanitiser, with this run's literals as the Nova's
        # would name them: nothing withheld, and nothing in it redacted.
        _, raw = self.run_report()
        results = os.path.join(self.dir, "results")
        published = os.path.join(self.dir, "published")
        os.makedirs(os.path.join(results, "logs"))
        shutil.copy(self.out, os.path.join(results, "logs", "argosy-shapes.json"))
        redactor = bridge.Redactor([ACCOUNT, "argosy-phone", "127.0.0.1", "owner-host.example", TITLE])
        outcome = bridge.sanitize_tree(bridge.Path(results), bridge.Path(published), redactor)
        self.assertEqual(outcome, {"published": ["logs/argosy-shapes.json"], "dropped": [], "withheld": []})
        with open(os.path.join(published, "logs", "argosy-shapes.json"), encoding="utf-8") as handle:
            self.assertEqual(handle.read(), raw)

    def test_another_device_s_saves_are_not_read(self):
        _, raw = self.run_report()
        read = [path for _, path, _ in self.fake.requests if path.endswith("/content")]
        self.assertNotIn("/api/saves/3/content", read)
        self.assertNotIn("/api/saves/8/content", read)
        first = json.loads(raw)["systems"][0]["games"][0]
        self.assertEqual(len(first["saves"]), 3)

    def test_a_save_named_by_the_paired_identifier_is_argosy_s(self):
        _, raw = self.run_report()
        read = [path for _, path, _ in self.fake.requests if path.endswith("/content")]
        self.assertIn("/api/saves/10/content", read)
        self.assertNotIn("/api/saves/11/content", read)
        ps2 = json.loads(raw)["systems"][1]
        self.assertEqual(len(ps2["games"][0]["saves"]), 2)

    def test_a_device_without_an_identifier_matches_no_unowned_save(self):
        self.fake.devices[0]["client_device_identifier"] = None
        self.run_report()
        read = [path for _, path, _ in self.fake.requests if path.endswith("/content")]
        self.assertNotIn("/api/saves/10/content", read)
        self.assertNotIn("/api/saves/11/content", read)

    def test_a_save_s_shape_holds_only_the_known_keys(self):
        _, raw = self.run_report()
        allowed = {"slot", "emulator", "namePattern", "extension", "sizeBytes", "updatedAt",
                   "hasContentHash", "read", "readBytes", "zipByRomm", "zipByArgosy",
                   "contentHashFollowsRomm", "hardcoreTrailer", "entries"}
        for system in json.loads(raw)["systems"]:
            for game in system["games"]:
                for save in game["saves"]:
                    self.assertLessEqual(set(save), allowed)
        for form in (RAW[:16].hex(), PS2[:16].hex(), "UEsDB"):
            self.assertNotIn(form, raw)

    def test_a_redirect_is_refused_and_not_followed(self):
        self.fake.redirect = True
        code, raw = self.run_report()
        self.assertEqual(code, 1)
        self.assertEqual(json.loads(raw)["error"], {"step": "devices", "status": 302})
        self.assertNotIn("/api/moved", [path for _, path, _ in self.fake.requests])

    def test_no_title_account_address_token_or_bytes(self):
        _, raw = self.run_report()
        base = f"127.0.0.1:{self.server.server_address[1]}"
        for secret in (TITLE, CHANNEL, ACCOUNT, "argosy-phone", base, TOKEN, "/romm/assets", "SRAM",
                       "Super Nintendo"):
            self.assertNotIn(secret, raw, secret)

    def test_a_server_that_refuses_is_reported_by_step_and_code(self):
        self.fake.devices = None
        code, raw = self.run_report()
        self.assertEqual(code, 1)
        self.assertEqual(json.loads(raw)["error"], {"step": "devices", "status": 404})

    def test_an_address_that_is_not_a_url_is_reported_without_it(self):
        signin.write_test_home(self.home, {"baseUrl": "owner-host.example", "authMode": "token"},
                               {"clientToken": TOKEN, "accessToken": None, "refreshToken": None,
                                "deviceId": None})
        code, raw = self.run_report()
        self.assertEqual(code, 1)
        self.assertEqual(json.loads(raw)["error"], {"step": "devices", "status": "bad-url"})
        self.assertNotIn("owner-host", raw)

    def test_without_a_sign_in_it_is_a_skip(self):
        os.remove(os.path.join(self.home, "config", "credentials.bin"))
        code = shapes.main(["report", "--home", self.home, "--out", self.out])
        self.assertEqual(code, shapes.EXIT_SKIPPED)
        self.assertFalse(os.path.exists(self.out))


if __name__ == "__main__":
    unittest.main()
