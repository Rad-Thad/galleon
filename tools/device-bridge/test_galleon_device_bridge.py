"""Unit tests for the device bridge. Run: python3 -m unittest discover -s tools/device-bridge"""

from __future__ import annotations

import io
import json
import os
import struct
import tarfile
import tempfile
import time
import unittest
import zlib
from pathlib import Path

import galleon_device_bridge as bridge


def png(extra_chunks: list[tuple[bytes, bytes]]) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 0, 0, 0, 0)
    idat = zlib.compress(b"\x00\x00")
    parts = [b"\x89PNG\r\n\x1a\n", chunk(b"IHDR", ihdr)]
    parts += [chunk(kind, data) for kind, data in extra_chunks]
    parts += [chunk(b"IDAT", idat), chunk(b"IEND", b"")]
    return b"".join(parts)


class WindowTests(unittest.TestCase):
    def test_simple_window(self):
        window = bridge.parse_window("01:00-07:00")
        self.assertTrue(bridge.in_window(60, window))
        self.assertTrue(bridge.in_window(6 * 60 + 59, window))
        self.assertFalse(bridge.in_window(7 * 60, window))
        self.assertFalse(bridge.in_window(0, window))

    def test_window_across_midnight(self):
        window = bridge.parse_window("22:30-06:00")
        self.assertTrue(bridge.in_window(23 * 60, window))
        self.assertTrue(bridge.in_window(5 * 60, window))
        self.assertFalse(bridge.in_window(12 * 60, window))

    def test_bad_window(self):
        with self.assertRaises(bridge.BridgeError):
            bridge.parse_window("1am-7am")


class PowerTests(unittest.TestCase):
    def make(self, root: Path, name: str, **files: str) -> None:
        (root / name).mkdir(parents=True)
        for key, value in files.items():
            (root / name / key).write_text(value + "\n")

    def test_reads_battery_and_charger(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.make(root, "battery", type="Battery", capacity="72", status="Charging")
            self.make(root, "usb", type="USB", online="1")
            power = bridge.read_power(root)
        self.assertEqual(power, {"acOnline": True, "batteryPct": 72, "batteryStatus": "Charging"})
        self.assertTrue(bridge.power_ok(power, True, 40)[0])

    def test_needs_charger_and_level(self):
        on_battery = {"acOnline": False, "batteryPct": 90, "batteryStatus": "Discharging"}
        self.assertFalse(bridge.power_ok(on_battery, True, 40)[0])
        low = {"acOnline": True, "batteryPct": 30, "batteryStatus": "Charging"}
        self.assertFalse(bridge.power_ok(low, True, 40)[0])
        self.assertTrue(bridge.power_ok(on_battery, False, 40)[0])


class ProcessTests(unittest.TestCase):
    def fake_proc(self, root: Path, pid: int, comm: str, cmdline: list[str] | None = None) -> None:
        (root / str(pid)).mkdir()
        (root / str(pid) / "comm").write_text(comm + "\n")
        if cmdline is not None:
            (root / str(pid) / "cmdline").write_bytes(b"\0".join(a.encode() for a in cmdline))

    def test_exact_names_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.fake_proc(root, 100, "retroarch")
            self.fake_proc(root, 101, "retroarch-helper")
            procs = bridge.running_processes(root)
        self.assertEqual(bridge.busy_names(["retroarch", "ppsspp"], procs), ["retroarch"])
        self.assertEqual(bridge.busy_names(["retro"], procs), [])

    def test_idle_galleon_is_not_busy(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.fake_proc(root, 200, "galleon")
            self.fake_proc(root, 201, "reaper", ["reaper", "SteamLaunch", "AppId=123", "--", "x"])
            procs = bridge.running_processes(root)
            idle = {"idle": True, "steamAppId": "123"}
            self.assertEqual(bridge.busy_names(["galleon", "reaper"], procs, idle, root), [])
            self.assertEqual(bridge.busy_names(["galleon", "reaper"], procs, None, root), ["galleon", "reaper"])
            self.fake_proc(root, 202, "reaper", ["reaper", "SteamLaunch", "AppId=999"])
            procs = bridge.running_processes(root)
            self.assertEqual(bridge.busy_names(["galleon", "reaper"], procs, idle, root), ["reaper"])

    def test_idle_state_must_be_fresh(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "galleon").mkdir()
            state = Path(tmp) / "galleon" / "state.json"
            state.write_text(json.dumps({"idle": True, "steamAppId": "5"}))
            self.assertIsNotNone(bridge.galleon_idle_state(tmp))
            old = time.time() - 600
            os.utime(state, (old, old))
            self.assertIsNone(bridge.galleon_idle_state(tmp))


class RedactorTests(unittest.TestCase):
    def setUp(self):
        self.redactor = bridge.Redactor(["romm.myhouse.example", "playerone", "armada"])

    def test_removes_secrets_and_addresses(self):
        text = "\n".join(
            [
                "GET http://192.0.2.50:8080/api/heartbeat ok",
                "Authorization: Bearer abcdefghijklmnop",
                '{"clientToken": "rmm_FAKEFAKEFAKE0000", "username": "playerone"}',
                "pair at http://romm.myhouse.example/pair/device?user_code=FAKE-0000",
                "user_code=FAKE-1111 device_code: zzzzzzzz",
                "mail someone@example.com, host nova-box.local, mac aa:bb:cc:dd:ee:ff",
                "fe80::1c2d:3e4f:5a6b:7c8d and 2001:db8:0:0:1:0:0:1",
                "path /var/home/somebody/galleon and userdata/12345678/config",
            ]
        )
        out = self.redactor.redact(text)
        for secret in (
            "192.0.2.50",
            "abcdefghijklmnop",
            "rmm_FAKEFAKEFAKE0000",
            "playerone",
            "romm.myhouse.example",
            "FAKE-0000",
            "FAKE-1111",
            "zzzzzzzz",
            "someone@example.com",
            "nova-box.local",
            "aa:bb:cc:dd:ee:ff",
            "fe80::1c2d",
            "2001:db8",
            "somebody",
            "12345678",
        ):
            self.assertNotIn(secret, out, secret)
        self.assertEqual(self.redactor.leaks(out), [])

    def test_keeps_ordinary_text(self):
        text = "12:30:45 frame p95 16.7 ms on /run/armada/perf-state.json, Mesa 26.2.3, https://github.com/x/y"
        self.assertEqual(self.redactor.redact(text), text)

    def test_leak_detection(self):
        self.assertIn("token", self.redactor.leaks("rmm_FAKEFAKE2222"))
        self.assertIn("ipv4", self.redactor.leaks("198.51.100.2"))
        self.assertEqual(self.redactor.leaks("127.0.0.1"), [])


class PngTests(unittest.TestCase):
    def test_strips_text_chunks(self):
        data = png([(b"tEXt", b"Comment\x00server at 198.51.100.2"), (b"eXIf", b"x" * 10)])
        clean = bridge.strip_png(data)
        self.assertIsNotNone(clean)
        self.assertNotIn(b"tEXt", clean)
        self.assertNotIn(b"eXIf", clean)
        self.assertIn(b"IDAT", clean)

    def test_rejects_non_png(self):
        self.assertIsNone(bridge.strip_png(b"GIF89a"))


class SanitizeTreeTests(unittest.TestCase):
    def test_publishes_only_safe_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            src, dst = Path(tmp) / "src", Path(tmp) / "dst"
            (src / "logs").mkdir(parents=True)
            (src / "shots").mkdir()
            (src / "summary.json").write_text('{"status": "complete", "server": "http://203.0.113.3"}')
            (src / "logs" / "app.log").write_text("token rmm_FAKEFAKE1111 ok\n")
            (src / "shots" / "home.png").write_bytes(png([]))
            (src / "core.dump").write_bytes(b"\x7fELF")
            os.symlink("/etc/passwd", src / "link.txt")
            report = bridge.sanitize_tree(src, dst, bridge.Redactor([]))
            self.assertIn("summary.json", report["published"])
            self.assertIn("logs/app.log", report["published"])
            self.assertIn("shots/home.png", report["published"])
            self.assertIn("core.dump", report["dropped"])
            self.assertIn("link.txt", report["dropped"])
            self.assertNotIn("203.0.113.3", (dst / "summary.json").read_text())
            self.assertNotIn("rmm_", (dst / "logs" / "app.log").read_text())


class ArchiveTests(unittest.TestCase):
    def test_refuses_path_escape(self):
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / "b.tar.gz"
            with tarfile.open(archive, "w:gz") as tar:
                info = tarfile.TarInfo("../evil.sh")
                info.size = 2
                tar.addfile(info, io.BytesIO(b"hi"))
            with self.assertRaises(bridge.BridgeError):
                bridge.safe_extract(archive, Path(tmp) / "out")

    def test_sums(self):
        sums = bridge.parse_sums("a" * 64 + "  Galleon-arm64.AppImage\n" + "b" * 64 + " *x.tar.gz\nnoise\n")
        self.assertEqual(sums, {"Galleon-arm64.AppImage": "a" * 64, "x.tar.gz": "b" * 64})


class ResultsBranchTests(unittest.TestCase):
    def test_index_and_pruning(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo, staged = Path(tmp) / "repo", Path(tmp) / "staged"
            staged.mkdir()
            (staged / "summary.json").write_text("{}")
            shas = [f"{i:040x}" for i in range(1, 5)]
            for sha in shas:
                bridge.stage_results(repo, staged, sha, {"sha": sha, "status": "complete"}, keep=2)
            kept = sorted(p.name for p in (repo / "results").iterdir() if p.is_dir())
            self.assertEqual(kept, sorted(shas[-2:]))
            index = json.loads((repo / "results" / "index.json").read_text())
            self.assertEqual(index[0]["sha"], shas[-1])
            latest = json.loads((repo / "results" / "latest.json").read_text())
            self.assertEqual(latest["sha"], shas[-1])

    def test_prune_runs_keeps_newest(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for i in range(5):
                path = root / f"{i:040x}"
                path.mkdir()
                os.utime(path, (1000 + i, 1000 + i))
            (root / "launch.sh").write_text("")
            removed = bridge.prune_runs(root, 3)
            self.assertEqual(len(removed), 2)
            self.assertTrue((root / "launch.sh").exists())


class ConfigTests(unittest.TestCase):
    def test_reads_values_and_expands_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config"
            path.write_text("# comment\nREPO=owner/repo\nWINDOW=02:00-05:00\nTEST_ROOT=~/t\n")
            cfg = bridge.load_config(path)
        self.assertEqual(bridge.require_repo(cfg), "owner/repo")
        self.assertEqual(cfg["WINDOW"], "02:00-05:00")
        self.assertFalse(cfg["TEST_ROOT"].startswith("~"))

    def test_version_file_matches_code(self):
        version = json.loads((Path(__file__).parent / "VERSION.json").read_text())["version"]
        self.assertEqual(version, bridge.BRIDGE_VERSION)


if __name__ == "__main__":
    unittest.main()
