#!/usr/bin/env python3
"""The test shortcut through Steam's own client (docs/PLAN.md section 5.3, steps 6 and 8).

While Steam runs, shortcuts.vdf belongs to it: a file written beside it is
overwritten, or worse. So the 'Galleon Device Test' shortcut is added the way
Armada Store adds one, by evaluating `SteamClient.Apps.AddShortcut` in
Steam's shared JavaScript context through its CEF debugger, which Armada's
`launch-steam` enables on the loopback address. The appid Steam returns is
kept in a record beside the tests, so later runs reuse the same shortcut;
when the record is gone the shortcut is looked up by name in shortcuts.vdf
before another is added, so the owner's library never collects copies.

The debugger speaks the Chrome DevTools protocol over a WebSocket. The client
here is the least of it the two calls need (text frames, one request at a
time) in the Python standard library, and it talks only to the loopback
address.

  steamcef.py ensure --test-root DIR   prints {"appid", "gameid", "source"}
  steamcef.py run GAMEID               starts a shortcut through Steam

Both exit 10 with reason `steam-cef-unavailable` when the debugger does not
answer, so run.sh can skip the Steam route rather than fail the run.
"""

import argparse
import base64
import glob
import ipaddress
import json
import os
import socket
import struct
import sys
import urllib.parse
import urllib.request

import shortcuts

CEF = "http://127.0.0.1:8080"
# The page that holds SteamClient; Steam has used both titles for it.
SHARED_CONTEXTS = ("SharedJSContext", "Steam Shared Context presented by Valve™")
ARMADA_LAUNCH = "/usr/libexec/armada/armada-game-launch"
RECORD = "shortcut.json"
TIMEOUT = 15
# A reply to either call is a few bytes; anything far larger is not one.
MESSAGE_LIMIT = 1 << 20

EXIT_SKIPPED = 10
CEF_UNAVAILABLE = "steam-cef-unavailable"


class CefUnavailable(Exception):
    """The debugger, or Steam's shared context behind it, did not answer."""


class CefError(Exception):
    """Steam answered, but the call threw or returned nothing usable."""


def _loopback(host):
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _check_loopback(url):
    host = urllib.parse.urlsplit(url).hostname or ""
    if not _loopback(host):
        raise CefUnavailable(f"not a loopback address: {host!r}")


def shared_context(cef, timeout=TIMEOUT):
    """The WebSocket URL of Steam's shared JavaScript context."""
    _check_loopback(cef)
    # The session's proxy settings, if any, must not route a loopback call.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(cef.rstrip("/") + "/json", timeout=timeout) as response:
            pages = json.loads(response.read(MESSAGE_LIMIT))
    except (OSError, ValueError) as error:
        raise CefUnavailable(f"no debugger: {error}") from None
    if not isinstance(pages, list):
        raise CefUnavailable("unexpected page list")
    for title in SHARED_CONTEXTS:
        for page in pages:
            if isinstance(page, dict) and page.get("title") == title:
                url = page.get("webSocketDebuggerUrl")
                if isinstance(url, str):
                    _check_loopback(url)
                    return url
    raise CefUnavailable("no shared context")


class WebSocket:
    """A client WebSocket for one DevTools conversation (RFC 6455, text only)."""

    def __init__(self, url, timeout=TIMEOUT):
        parts = urllib.parse.urlsplit(url)
        if parts.scheme != "ws" or not _loopback(parts.hostname or ""):
            raise CefUnavailable("not a loopback ws:// address")
        path = parts.path or "/"
        if parts.query:
            path += "?" + parts.query
        try:
            self.sock = socket.create_connection((parts.hostname, parts.port or 80), timeout=timeout)
        except OSError as error:
            raise CefUnavailable(f"no connection: {error}") from None
        key = base64.b64encode(os.urandom(16)).decode()
        request = (
            f"GET {path} HTTP/1.1\r\nHost: {parts.netloc}\r\nUpgrade: websocket\r\n"
            f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        )
        try:
            self.sock.sendall(request.encode())
            head = b""
            while b"\r\n\r\n" not in head:
                chunk = self.sock.recv(4096)
                if not chunk or len(head) > 65536:
                    raise OSError("handshake cut short")
                head += chunk
        except OSError as error:
            self.close()
            raise CefUnavailable(f"handshake failed: {error}") from None
        head, self.buffer = head.split(b"\r\n\r\n", 1)
        if not head.startswith(b"HTTP/1.1 101"):
            self.close()
            raise CefUnavailable("upgrade refused")

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass

    def _read(self, count):
        while len(self.buffer) < count:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise CefUnavailable("connection closed")
            self.buffer += chunk
        data, self.buffer = self.buffer[:count], self.buffer[count:]
        return data

    def _send_frame(self, opcode, payload):
        mask = os.urandom(4)
        size = len(payload)
        if size < 126:
            header = struct.pack("!BB", 0x80 | opcode, 0x80 | size)
        elif size < 1 << 16:
            header = struct.pack("!BBH", 0x80 | opcode, 0x80 | 126, size)
        else:
            header = struct.pack("!BBQ", 0x80 | opcode, 0x80 | 127, size)
        masked = bytes(byte ^ mask[i % 4] for i, byte in enumerate(payload))
        self.sock.sendall(header + mask + masked)

    def send(self, text):
        try:
            self._send_frame(0x1, text.encode("utf-8"))
        except OSError as error:
            raise CefUnavailable(f"send failed: {error}") from None

    def receive(self):
        """The next whole text message."""
        message = b""
        try:
            while True:
                first, second = self._read(2)
                opcode, final = first & 0x0F, first & 0x80
                size = second & 0x7F
                if size == 126:
                    size = struct.unpack("!H", self._read(2))[0]
                elif size == 127:
                    size = struct.unpack("!Q", self._read(8))[0]
                if len(message) + size > MESSAGE_LIMIT:
                    raise CefError("reply too large")
                mask = self._read(4) if second & 0x80 else None
                payload = self._read(size)
                if mask:
                    payload = bytes(byte ^ mask[i % 4] for i, byte in enumerate(payload))
                if opcode == 0x8:
                    raise CefUnavailable("closed by Steam")
                if opcode == 0x9:
                    self._send_frame(0xA, payload)
                    continue
                if opcode in (0x0, 0x1, 0x2):
                    message += payload
                    if final:
                        return message.decode("utf-8", "replace")
        except OSError as error:
            raise CefUnavailable(f"receive failed: {error}") from None


def evaluate(cef, expression, timeout=TIMEOUT):
    """The value of a JavaScript expression in Steam's shared context, awaited."""
    ws = WebSocket(shared_context(cef, timeout), timeout)
    try:
        ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {
            "expression": expression, "awaitPromise": True, "returnByValue": True}}))
        while True:
            try:
                reply = json.loads(ws.receive())
            except ValueError:
                raise CefError("reply is not JSON") from None
            # Events can arrive before the reply; only id 1 answers this call.
            if isinstance(reply, dict) and reply.get("id") == 1:
                break
    finally:
        ws.close()
    if "error" in reply:
        raise CefError(f"protocol error: {reply['error']}")
    result = reply.get("result") or {}
    if "exceptionDetails" in result:
        raise CefError("the call threw in Steam")
    return (result.get("result") or {}).get("value")


def add_shortcut(cef, name, exe, start_dir, launch_options):
    """The unsigned appid of a new non-Steam shortcut."""
    args = ", ".join(json.dumps(value) for value in (name, exe, start_dir, launch_options))
    # Not every Steam build applies the name and launch options AddShortcut
    # is given (some name the shortcut after its executable), so both are set
    # again once the appid is known.
    expression = (
        "(async () => {"
        f" const appid = await SteamClient.Apps.AddShortcut({args});"
        " if (typeof appid !== 'number' || !appid) throw new Error('no appid');"
        f" if (SteamClient.Apps.SetShortcutName) SteamClient.Apps.SetShortcutName(appid, {json.dumps(name)});"
        " if (SteamClient.Apps.SetShortcutLaunchOptions)"
        f" SteamClient.Apps.SetShortcutLaunchOptions(appid, {json.dumps(launch_options)});"
        " return appid; })()"
    )
    appid = evaluate(cef, expression)
    if not isinstance(appid, int) or isinstance(appid, bool) or not appid:
        raise CefError("no appid returned")
    return appid & 0xFFFFFFFF


def run_game(cef, game):
    """Ask Steam to start a shortcut by its game id."""
    evaluate(cef, f"SteamClient.Apps.RunGame({json.dumps(str(game))}, '', -1, 100)")


def launch_options(root=""):
    """Armada's game launcher wraps the shortcut when the device has it."""
    return f"{ARMADA_LAUNCH} %command%" if os.path.exists(root + ARMADA_LAUNCH) else ""


def read_record(path, name):
    try:
        with open(path, encoding="utf-8") as handle:
            record = json.load(handle)
    except (OSError, ValueError):
        return None
    if not isinstance(record, dict) or record.get("name") != name:
        return None
    appid = record.get("appid")
    if not isinstance(appid, int) or isinstance(appid, bool):
        return None
    if not 0 < appid <= 0xFFFFFFFF:
        return None
    return appid


def write_record(path, name, exe, appid):
    tmp = path + ".tmp"
    if os.path.lexists(tmp):
        os.unlink(tmp)
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump({"name": name, "exe": exe, "appid": appid}, handle)
    os.replace(tmp, path)


def record_is_stale(home, record_path, appid):
    """True when Steam has written shortcuts.vdf since the record and left it out.

    Right after AddShortcut, Steam may not have saved the file yet, so a
    missing entry alone proves nothing; a file newer than the record without
    the appid means the owner removed the shortcut.
    """
    files = sorted(glob.glob(os.path.join(glob.escape(home), shortcuts.SHORTCUTS_GLOB)))
    newest = 0.0
    for path in files:
        try:
            newest = max(newest, os.stat(path).st_mtime)
            with open(path, "rb") as handle:
                listed = handle.read()
            entries = shortcuts.parse(listed).get("shortcuts")
        except (OSError, shortcuts.VdfError):
            # A file mid-write cannot show the shortcut is gone.
            return False
        if isinstance(entries, dict):
            for entry in entries.values():
                if isinstance(entry, dict) and isinstance(entry.get("appid"), int):
                    if entry["appid"] & 0xFFFFFFFF == appid:
                        return False
    try:
        recorded = os.stat(record_path).st_mtime
    except OSError:
        return True
    return bool(files) and newest > recorded


def ensure(test_root, home, cef=CEF, name=shortcuts.TEST_SHORTCUT, exe=None,
           record=RECORD, root=""):
    """(appid, source) of the shortcut, adding it through Steam only when it is nowhere."""
    exe = exe or os.path.join(test_root, "launch.sh")
    record_path = os.path.join(test_root, record)
    appid = read_record(record_path, name)
    if appid and not record_is_stale(home, record_path, appid):
        return appid, "record"
    found = shortcuts.find(home, name)
    if found:
        appid, source = found[0], "shortcuts.vdf"
    else:
        appid = add_shortcut(cef, name, exe, os.path.dirname(exe), launch_options(root))
        source = "added"
    write_record(record_path, name, exe, appid)
    return appid, source


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--home", default=os.path.expanduser("~"))
    parser.add_argument("--cef", default=CEF)
    commands = parser.add_subparsers(dest="command", required=True)
    add = commands.add_parser("ensure")
    add.add_argument("--test-root", required=True)
    add.add_argument("--name", default=shortcuts.TEST_SHORTCUT)
    add.add_argument("--exe")
    add.add_argument("--record", default=RECORD)
    # Tests point this at a fake device root; on the Nova it is the real one.
    add.add_argument("--root", default="")
    commands.add_parser("run").add_argument("gameid", type=int)
    args = parser.parse_args(argv)

    try:
        if args.command == "run":
            run_game(args.cef, args.gameid)
            print(json.dumps({"gameid": args.gameid, "reason": None}))
            return 0
        test_root = os.path.abspath(args.test_root)
        appid, source = ensure(test_root, os.path.abspath(args.home), args.cef, args.name,
                               args.exe, args.record, args.root)
    except CefUnavailable:
        print(json.dumps({"reason": CEF_UNAVAILABLE}))
        return EXIT_SKIPPED
    except CefError as error:
        print(json.dumps({"reason": "steam-cef-error", "detail": str(error)}))
        return 1
    print(json.dumps({"appid": appid, "gameid": shortcuts.gameid(appid), "source": source,
                      "reason": None}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
