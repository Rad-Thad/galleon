"""Unit tests for shortcuts.py: python3 -m unittest discover -s test/device"""

import contextlib
import io
import json
import os
import struct
import tempfile
import unittest

import shortcuts


def vdf_map(name, fields):
    out = b"\x00" + name.encode() + b"\x00"
    for key, value in fields.items():
        if isinstance(value, dict):
            out += vdf_map(key, value)
        elif isinstance(value, str):
            out += b"\x01" + key.encode() + b"\x00" + value.encode() + b"\x00"
        elif isinstance(value, int):
            out += b"\x02" + key.encode() + b"\x00" + struct.pack("<i", value)
        elif isinstance(value, bytes):
            out += b"\x07" + key.encode() + b"\x00" + value
    return out + b"\x08"


def shortcuts_file(entries):
    return vdf_map("shortcuts", {str(i): entry for i, entry in enumerate(entries)}) + b"\x08"


GAME = {"appid": 123456, "AppName": "Some Game", "Exe": '"/games/a"', "tags": {"0": "favorite"}}
# An appid with the top bit set, as Steam makes most of them, stored negative.
TEST = {"appid": -1234567890, "AppName": "Galleon Device Test", "Exe": '"/tests/launch.sh"', "LastPlayTime": 0}


class ShortcutsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, user, data):
        path = os.path.join(self.home, ".local/share/Steam/userdata", user, "config", "shortcuts.vdf")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as handle:
            handle.write(data)
        return path

    def test_parses_strings_ints_nested_maps_and_uint64(self):
        data = shortcuts_file([dict(GAME, extra=b"\x01" * 8)])
        entry = shortcuts.parse(data)["shortcuts"]["0"]
        self.assertEqual(entry["AppName"], "Some Game")
        self.assertEqual(entry["appid"], 123456)
        self.assertEqual(entry["tags"], {"0": "favorite"})

    def test_finds_the_test_shortcut_with_its_appid_unsigned(self):
        path = self.write("1001", shortcuts_file([GAME, TEST]))
        appid, found = shortcuts.find(self.home, "Galleon Device Test")
        self.assertEqual(appid, (-1234567890) & 0xFFFFFFFF)
        self.assertEqual(found, path)

    def test_the_lowercase_key_older_steam_wrote(self):
        entry = {"appid": 77, "appname": "Galleon Device Test"}
        self.write("1001", shortcuts_file([entry]))
        self.assertEqual(shortcuts.find(self.home, "Galleon Device Test")[0], 77)

    def test_looks_through_every_user_and_passes_over_a_broken_file(self):
        self.write("1001", b"\x00shortcuts\x00\x01AppName\x00trunc")
        self.write("1002", shortcuts_file([GAME]))
        path = self.write("1003", shortcuts_file([TEST]))
        self.assertEqual(shortcuts.find(self.home, "Galleon Device Test")[1], path)

    def test_nothing_found(self):
        self.assertIsNone(shortcuts.find(self.home, "Galleon Device Test"))
        self.write("1001", shortcuts_file([GAME]))
        self.assertIsNone(shortcuts.find(self.home, "Galleon Device Test"))
        self.write("1001", shortcuts_file([{"AppName": "Galleon Device Test"}]))
        self.assertIsNone(shortcuts.find(self.home, "Galleon Device Test"))

    def test_malformed_data_is_refused_not_misread(self):
        for data in (b"", b"\x00shortcuts", b"\x00s\x00\x02appid\x00\x01\x02", b"\x00s\x00\x05w\x00ab\x08\x08"):
            with self.assertRaises(shortcuts.VdfError):
                shortcuts.parse(data)
        deep = b"".join(b"\x00m\x00" for _ in range(40))
        with self.assertRaises(shortcuts.VdfError):
            shortcuts.parse(deep)

    def test_play_time_spans_point_at_the_test_shortcuts_play_time_only(self):
        game = dict(GAME, LastPlayTime=111)
        data = shortcuts_file([game, dict(TEST, LastPlayTime=0x01020304)])
        spans = shortcuts.play_time_spans(data)
        self.assertEqual(len(spans), 1)
        offset, width = spans[0]
        self.assertEqual(data[offset : offset + width], struct.pack("<i", 0x01020304))
        self.assertEqual(shortcuts.play_time_spans(shortcuts_file([game])), [])
        self.assertEqual(shortcuts.play_time_spans(shortcuts_file([{"AppName": "Galleon Device Test"}])), [])
        # The target shortcut's too, and no other name that merely starts the same.
        both = shortcuts_file([game, dict(TEST, AppName="Galleon Device Test Target", LastPlayTime=9),
                               dict(TEST, AppName="Galleon Device Test 2", LastPlayTime=9)])
        self.assertEqual(len(shortcuts.play_time_spans(both)), 1)
        with self.assertRaises(shortcuts.VdfError):
            shortcuts.play_time_spans(data[:-6])

    def test_the_game_id_puts_the_unsigned_appid_high_and_the_non_steam_flag_low(self):
        self.assertEqual(shortcuts.gameid(1), (1 << 32) | 0x02000000)
        self.assertEqual(shortcuts.gameid(-1), (0xFFFFFFFF << 32) | 0x02000000)
        self.assertEqual(shortcuts.gameid(-1), shortcuts.gameid(0xFFFFFFFF))

    def test_find_never_changes_the_file(self):
        path = self.write("1001", shortcuts_file([TEST]))
        before = os.stat(path)
        with open(path, "rb") as handle:
            content = handle.read()
        shortcuts.find(self.home, "Galleon Device Test")
        with open(path, "rb") as handle:
            self.assertEqual(handle.read(), content)
        self.assertEqual(os.stat(path).st_mtime_ns, before.st_mtime_ns)

    def test_the_command_line(self):
        self.write("1001", shortcuts_file([TEST]))
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(shortcuts.main(["--home", self.home, "find"]), 0)
            self.assertEqual(shortcuts.main(["--home", self.home, "find", "Other"]), 1)
            self.assertEqual(shortcuts.main(["gameid", "1"]), 0)
        lines = out.getvalue().splitlines()
        found = json.loads(lines[0])
        self.assertEqual(found["gameid"], shortcuts.gameid(found["appid"]))
        self.assertEqual(lines[1], str((1 << 32) | 0x02000000))


if __name__ == "__main__":
    unittest.main()
