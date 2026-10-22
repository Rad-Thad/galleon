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

  steamcef.py ensure --test-root DIR [--saved-within SECONDS]
                                       prints {"appid", "gameid", "source"}
  steamcef.py run GAMEID               starts a shortcut through Steam
  steamcef.py library [--wait SECONDS] prints {"route", "library"}; exits 1
                                       unless Steam shows its library
  steamcef.py ready [--wait SECONDS]   prints {"pages"} once the debugger answers

All exit 10 with reason `steam-cef-unavailable`, and a detail, when the
debugger does not answer, so run.sh can skip the Steam route rather than
fail the run.

shortcuts.vdf is part of the owner state run.sh holds, and Steam saves it
when it chooses. With `--saved-within`, `ensure` waits that long for the
shortcut to be listed there and otherwise exits 10 with reason
`steam-shortcut-unsaved`, so the owner-state manifest is never taken while a
save of the run's own shortcut is still to come.
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
import time
import urllib.parse
import urllib.request

import shortcuts

CEF = "http://127.0.0.1:8080"
# The page that holds SteamClient; Steam has used both titles for it.
SHARED_CONTEXTS = ("SharedJSContext", "Steam Shared Context presented by Valve™")
# The Game Mode window, whose address carries the screen it shows under
# ROUTES; Steam has used both titles for it.
BIG_PICTURE = ("Steam Big Picture Mode", "SP")
ROUTES = "/routes"
UI_HOST = "steamloopback.host"
POLL_SECONDS = 0.5
# The least time a request for the page list is given, however little of a wait is left.
ANSWER_SECONDS = 2
ARMADA_LAUNCH = "/usr/libexec/armada/armada-game-launch"
RECORD = "shortcut.json"
TIMEOUT = 15
# A reply to either call is a few bytes; anything far larger is not one.
MESSAGE_LIMIT = 1 << 20

EXIT_SKIPPED = 10
CEF_UNAVAILABLE = "steam-cef-unavailable"
SHORTCUT_UNSAVED = "steam-shortcut-unsaved"


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


def pages(cef, timeout=TIMEOUT):
    """The debugger's page list: one entry for each of Steam's windows and contexts."""
    _check_loopback(cef)
    # The session's proxy settings, if any, must not route a loopback call.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(cef.rstrip("/") + "/json", timeout=timeout) as response:
            listed = json.loads(response.read(MESSAGE_LIMIT))
    except (OSError, ValueError) as error:
        raise CefUnavailable(f"no debugger: {error}") from None
    if not isinstance(listed, list):
        raise CefUnavailable("unexpected page list")
    return [page for page in listed if isinstance(page, dict)]


def shared_context(cef, timeout=TIMEOUT):
    """The WebSocket URL of Steam's shared JavaScript context."""
    listed = pages(cef, timeout)
    for title in SHARED_CONTEXTS:
        for page in listed:
            if page.get("title") == title:
                url = page.get("webSocketDebuggerUrl")
                if isinstance(url, str):
                    _check_loopback(url)
                    return url
    raise CefUnavailable("no shared context")


def screen(cef, timeout=TIMEOUT):
    """The route Steam's Game Mode window shows, such as /library/home.

    Read from the page list alone, so looking changes nothing in Steam.
    """
    listed = pages(cef, timeout)
    for title in BIG_PICTURE:
        for page in listed:
            route = _route(page)
            if page.get("title") == title and route is not None:
                return route
    # Steam has also named the window something else, so a window of Steam's
    # UI host under ROUTES counts as well, but only when every such window
    # shows the same route; side windows that disagree leave it unknown.
    routes = {_route(page) for page in listed if _ui_host(page)} - {None}
    if len(routes) == 1:
        return routes.pop()
    # What Steam's own windows showed instead, so the log tells the next run
    # what to look for. The results are public and the list also holds web
    # pages (a profile's address names the account), so only Steam's UI host
    # counts, by the start of its path, and no title.
    seen = sorted({_outline(urllib.parse.urlsplit(page["url"]).path) for page in listed if _ui_host(page)})
    raise CefUnavailable(f"no Game Mode window; Steam's windows show {seen}")


def _ui_host(page):
    url = page.get("url")
    return isinstance(url, str) and urllib.parse.urlsplit(url).hostname == UI_HOST


def _route(page):
    """The route a window of Steam's UI host shows under ROUTES, else None."""
    url = page.get("url")
    if not isinstance(url, str):
        return None
    path = urllib.parse.urlsplit(url).path
    if path == ROUTES or path.startswith(ROUTES + "/"):
        return path[len(ROUTES):] or "/"
    return None


def _outline(path, depth=2):
    return "/" + "/".join(path.strip("/").split("/")[:depth])


def shown(route):
    """The route as the log may carry it: whole in the library, else its first part."""
    if route == "/library" or route.startswith("/library/"):
        return route
    return _outline(route, 1)


def at_library(route):
    """True for the library's own screens; a game's page there is not one."""
    if route != "/library" and not route.startswith("/library/"):
        return False
    return not route.startswith("/library/app/")


def wait_library(cef, seconds, clock=time.monotonic, sleep=time.sleep, timeout=TIMEOUT):
    """The route once Steam shows its library, or the last one seen when it does not in time.

    Steam's debugger can leave a request unanswered for longer than the whole
    wait (docs/DEVICE-FACTS.md), so no request is let run past the wait's end
    (beyond ANSWER_SECONDS, the least a request is given) and one that goes
    unanswered is asked again on a new connection while time is left.
    """
    start = clock()
    end = start + seconds
    tries = 0
    while True:
        tries += 1
        try:
            route = screen(cef, min(timeout, max(end - clock(), ANSWER_SECONDS)))
        except CefUnavailable as error:
            if clock() >= end:
                raise CefUnavailable(f"{error}; {tries} tries over {clock() - start:.0f} s") from None
            route = None
        if route is not None and (at_library(route) or clock() >= end):
            return route
        sleep(POLL_SECONDS)


def wait_pages(cef, seconds, clock=time.monotonic, sleep=time.sleep, timeout=TIMEOUT):
    """The page list once Steam's debugger answers, asked again on a new connection while the wait lasts.

    A reused shortcut record is the only part of a run that needs nothing
    from Steam, so this is how run.sh learns, before it starts anything, that
    the client the start goes through is answering at all.
    """
    start = clock()
    end = start + seconds
    tries = 0
    while True:
        tries += 1
        try:
            return pages(cef, min(timeout, max(end - clock(), ANSWER_SECONDS)))
        except CefUnavailable as error:
            if clock() >= end:
                raise CefUnavailable(f"{error}; {tries} tries over {clock() - start:.0f} s") from None
        sleep(POLL_SECONDS)


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


def _matches(entry, appid, name, options):
    if not isinstance(entry, dict) or not isinstance(entry.get("appid"), int):
        return False
    if entry["appid"] & 0xFFFFFFFF != appid:
        return False
    if name is not None and entry.get("AppName", entry.get("appname")) != name:
        return False
    return options is None or entry.get("LaunchOptions", entry.get("launchoptions", "")) == options


def listed(home, appid, name=None, options=None):
    """True when a shortcuts.vdf that can be read lists `appid`.

    With `name` or `options`, only an entry that already carries them counts:
    Steam may save the added shortcut before the rename and launch options
    that follow it, and the save after those must not land inside the run.
    """
    for path in glob.glob(os.path.join(glob.escape(home), shortcuts.SHORTCUTS_GLOB)):
        try:
            with open(path, "rb") as handle:
                entries = shortcuts.parse(handle.read()).get("shortcuts")
        except (OSError, shortcuts.VdfError):
            continue
        if isinstance(entries, dict):
            if any(_matches(entry, appid, name, options) for entry in entries.values()):
                return True
    return False


def wait_listed(home, appid, seconds, name=None, options=None, clock=time.monotonic,
                sleep=time.sleep):
    """True once shortcuts.vdf lists `appid` (see `listed`), False when `seconds` pass first."""
    deadline = clock() + seconds
    while not listed(home, appid, name, options):
        if clock() >= deadline:
            return False
        sleep(1)
    return True


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
    add.add_argument("--saved-within", type=float)
    commands.add_parser("run").add_argument("gameid", type=int)
    commands.add_parser("library").add_argument("--wait", type=float, default=0.0)
    commands.add_parser("ready").add_argument("--wait", type=float, default=0.0)
    args = parser.parse_args(argv)

    try:
        if args.command == "ready":
            print(json.dumps({"pages": len(wait_pages(args.cef, args.wait))}))
            return 0
        if args.command == "library":
            route = wait_library(args.cef, args.wait)
            print(json.dumps({"route": shown(route), "library": at_library(route)}))
            return 0 if at_library(route) else 1
        if args.command == "run":
            run_game(args.cef, args.gameid)
            print(json.dumps({"gameid": args.gameid, "reason": None}))
            return 0
        test_root = os.path.abspath(args.test_root)
        appid, source = ensure(test_root, os.path.abspath(args.home), args.cef, args.name,
                               args.exe, args.record, args.root)
    except CefUnavailable as error:
        # run.sh logs this; the detail tells a stalled debugger from one that
        # is gone, and is how a new Steam build shows itself.
        print(json.dumps({"reason": CEF_UNAVAILABLE, "detail": str(error)}))
        return EXIT_SKIPPED
    except CefError as error:
        print(json.dumps({"reason": "steam-cef-error", "detail": str(error)}))
        return 1
    reason = None
    home = os.path.abspath(args.home)
    # Launch options are waited for only on a shortcut this run added: one the
    # owner already has is left as they set it.
    options = launch_options(args.root) if source == "added" else None
    if args.saved_within is not None and not wait_listed(home, appid, args.saved_within,
                                                         args.name, options):
        reason = SHORTCUT_UNSAVED
    print(json.dumps({"appid": appid, "gameid": shortcuts.gameid(appid), "source": source,
                      "reason": reason}))
    return EXIT_SKIPPED if reason else 0


if __name__ == "__main__":
    sys.exit(main())
