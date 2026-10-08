#!/usr/bin/env python3
"""Galleon device bridge: test the newest nightly on this device and publish the results.

Runs on the Retroid Pocket Nova (armadaOS) as the desktop user, started by a systemd
user timer. Python 3 standard library only, because /usr is read-only on armadaOS and
nothing may be installed system-wide.

The contract this file implements is written down in docs/PLAN.md ("The device
bridge") and docs/TESTING.md. In short: when the device is idle, charging and in Game
Mode inside the allowed window, fetch the newest nightly pre-release, run its
`run.sh` under a hard time limit, sanitise what it wrote, and push it to the
`device-results` branch with a write-enabled deploy key.

Never use `pgrep -f` or anything else that matches command lines here: a pattern that
also matches the caller's own command line once killed an SSH session during setup.
Processes are found by their exact `comm` name in /proc.
"""

from __future__ import annotations

import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
import re
import shutil
import signal
import socket
import struct
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

BRIDGE_VERSION = 1
USER_AGENT = f"galleon-device-bridge/{BRIDGE_VERSION}"
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
REPO_RE = re.compile(r"^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$")

# Pinned so a first connection can never be answered by someone else. Published at
# docs.github.com, "GitHub's SSH key fingerprints" (SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU).
GITHUB_KNOWN_HOST = (
    "github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl"
)

CONFIG_PATH = Path(
    os.environ.get("GALLEON_BRIDGE_CONFIG", "~/.config/galleon-device-bridge/config")
).expanduser()

DEFAULTS = {
    "REPO": "",
    "RELEASE_TAG": "nightly",
    "ASSET_APPIMAGE": "Galleon-arm64.AppImage",
    "ASSET_BUNDLE": "galleon-device-tests.tar.gz",
    "ASSET_BUILD_INFO": "build-info.json",
    "ASSET_SUMS": "SHA256SUMS",
    "WINDOW": "01:00-07:00",
    "REQUIRE_AC": "1",
    "MIN_BATTERY": "40",
    "SESSION_UNIT": "gamescope-session-plus@steam.service",
    "SESSION_PROCESSES": "gamescope-wl gamescope",
    "BUSY_PROCESSES": (
        "reaper galleon rommix es-de retroarch duckstation-qt DuckStation armsx2 ARMSX2 "
        "pcsx2-qt dolphin-emu ppsspp PPSSPPSDL PPSSPPQt flycast melonDS"
    ),
    "BUDGET_SECONDS": "1800",
    "GRACE_SECONDS": "300",
    "MIN_FREE_MB": "3072",
    "KEEP_RUNS": "3",
    "KEEP_PUBLISHED": "60",
    "TEST_ROOT": "~/galleon-device-tests",
    "STATE_DIR": "~/.local/state/galleon-device-bridge",
    "RESULTS_BRANCH": "device-results",
    "DEPLOY_KEY": "~/.config/galleon-device-bridge/deploy_key",
    "KNOWN_HOSTS": "~/.config/galleon-device-bridge/known_hosts",
    "REDACT_FILE": "~/.config/galleon-device-bridge/redact",
    "READONLY_TOKEN_FILE": "~/.config/galleon-device-bridge/romm-readonly.json",
    "PUBLISH": "1",
    "COLLECT_REPORTS": "1",
    "SELF_UPDATE": "1",
    "HEARTBEAT_HOURS": "20",
    "MAX_APPIMAGE_MB": "700",
    "MAX_BUNDLE_MB": "400",
}

PATH_KEYS = {
    "TEST_ROOT",
    "STATE_DIR",
    "DEPLOY_KEY",
    "KNOWN_HOSTS",
    "REDACT_FILE",
    "READONLY_TOKEN_FILE",
}

# run.sh exit codes that mean "nothing was tested": the build is retried later.
EXIT_SKIPPED = 10
EXIT_ABORTED_BY_USER = 20


class BridgeError(Exception):
    """A failure with a message meant for the log, not a stack trace."""


# --------------------------------------------------------------------------- config


def load_config(path: Path = CONFIG_PATH) -> dict:
    cfg = dict(DEFAULTS)
    if path.exists():
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            value = value.strip().strip('"').strip("'")
            cfg[key.strip()] = value
    for key in PATH_KEYS:
        cfg[key] = str(Path(os.path.expandvars(cfg[key])).expanduser())
    return cfg


def require_repo(cfg: dict) -> str:
    repo = cfg.get("REPO", "")
    if not REPO_RE.match(repo):
        raise BridgeError(f"REPO is not set to <owner>/<repo> in {CONFIG_PATH}")
    return repo


def as_int(cfg: dict, key: str) -> int:
    try:
        return int(cfg[key])
    except (KeyError, ValueError) as cause:
        raise BridgeError(f"{key} must be a whole number") from cause


def as_bool(cfg: dict, key: str) -> bool:
    return str(cfg.get(key, "0")).strip().lower() in ("1", "yes", "true", "on")


# ------------------------------------------------------------------- logging, state


class Log:
    """Appends to the state directory and to stdout (which journald keeps)."""

    def __init__(self, state_dir: Path):
        self.path = state_dir / "bridge.log"
        state_dir.mkdir(parents=True, exist_ok=True)
        if self.path.exists() and self.path.stat().st_size > 1_000_000:
            self.path.replace(self.path.with_suffix(".log.1"))

    def __call__(self, message: str) -> None:
        line = f"{utc_now()} {message}"
        print(line, flush=True)
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    tmp.replace(path)


class Lock:
    """One bridge at a time: a timer firing during a long run must not start another."""

    def __init__(self, state_dir: Path):
        state_dir.mkdir(parents=True, exist_ok=True)
        self.handle = (state_dir / "lock").open("w")

    def acquire(self) -> bool:
        try:
            fcntl.flock(self.handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except OSError:
            return False


# ------------------------------------------------------------------- preconditions


def parse_window(text: str) -> tuple[int, int]:
    match = re.match(r"^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$", text)
    if not match:
        raise BridgeError(f"WINDOW must look like 01:00-07:00, not {text!r}")
    h1, m1, h2, m2 = (int(part) for part in match.groups())
    if h1 > 23 or h2 > 24 or m1 > 59 or m2 > 59:
        raise BridgeError(f"WINDOW has an impossible time: {text!r}")
    return h1 * 60 + m1, h2 * 60 + m2


def in_window(minutes: int, window: tuple[int, int]) -> bool:
    start, end = window
    if start == end:
        return True
    if start < end:
        return start <= minutes < end
    # Crosses midnight, e.g. 22:00-06:00.
    return minutes >= start or minutes < end


def read_power(root: Path = Path("/sys/class/power_supply")) -> dict:
    power = {"acOnline": False, "batteryPct": None, "batteryStatus": None}
    if not root.is_dir():
        return power
    for supply in sorted(root.iterdir()):
        kind = _read(supply / "type")
        if kind == "Battery":
            capacity = _read(supply / "capacity")
            if capacity.isdigit() and power["batteryPct"] is None:
                power["batteryPct"] = int(capacity)
                power["batteryStatus"] = _read(supply / "status") or None
        elif _read(supply / "online") == "1":
            power["acOnline"] = True
    return power


def power_ok(power: dict, require_ac: bool, min_battery: int) -> tuple[bool, str]:
    charging = power["acOnline"] or power["batteryStatus"] in ("Charging", "Full")
    if require_ac and not charging:
        return False, "not on the charger"
    pct = power["batteryPct"]
    if pct is None:
        return (not require_ac) or charging, "no battery reading"
    if pct < min_battery:
        return False, f"battery {pct}% is below {min_battery}%"
    return True, f"battery {pct}%, charger {'on' if charging else 'off'}"


def running_processes(proc: Path = Path("/proc")) -> dict[str, list[int]]:
    """Exact process names (`comm`) to pids, without this process or its parents."""
    own = {os.getpid(), os.getppid()}
    found: dict[str, list[int]] = {}
    for entry in proc.iterdir() if proc.is_dir() else []:
        if not entry.name.isdigit() or int(entry.name) in own:
            continue
        name = _read(entry / "comm")
        if name:
            found.setdefault(name, []).append(int(entry.name))
    return found


def busy_names(
    names: list[str],
    processes: dict[str, list[int]],
    idle: dict | None = None,
    proc: Path = Path("/proc"),
) -> list[str]:
    """Names that mean someone is playing. An idle Galleon is not busy.

    Once the owner uses Galleon as their front end it is open whenever Game Mode is,
    and so is Steam's `reaper` for it. Both count as busy unless Galleon's own state
    file says it is idle, and the only Steam title running is that Galleon.
    """
    busy = []
    for name in names:
        pids = processes.get(name)
        if not pids:
            continue
        if idle and name == "galleon":
            continue
        if idle and name == "reaper":
            ids = {_reaper_app_id(proc / str(pid)) for pid in pids}
            if ids == {str(idle.get("steamAppId"))}:
                continue
        busy.append(name)
    return sorted(busy)


def _reaper_app_id(pid_dir: Path) -> str | None:
    # cmdline of an exact-name match only; never a pattern search over every process.
    try:
        args = (pid_dir / "cmdline").read_bytes().split(b"\0")
    except OSError:
        return None
    for arg in args:
        if arg.startswith(b"AppId="):
            return arg[6:].decode("ascii", "replace")
    return None


def galleon_idle_state(runtime_dir: str | None = None, max_age: int = 120) -> dict | None:
    """Galleon's own word that nothing is playing, downloading or waiting to upload."""
    base = Path(runtime_dir or os.environ.get("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}"))
    path = base / "galleon" / "state.json"
    try:
        age = time.time() - path.stat().st_mtime
    except OSError:
        return None
    state = read_json(path, {})
    if age > max_age or state.get("idle") is not True or not state.get("steamAppId"):
        return None
    return state


def session_active(unit: str, session_names: list[str], processes: dict) -> tuple[bool, str]:
    result = run_quiet(["systemctl", "--user", "is-active", unit], timeout=10)
    if result is not None and result.stdout.strip() == "active":
        return True, unit
    if result is None and any(name in processes for name in session_names):
        # No systemctl answer at all (unusual); fall back to the compositor itself.
        return True, "gamescope process"
    return False, f"{unit} is not active (Game Mode is not running)"


def free_mb(path: Path) -> int:
    path.mkdir(parents=True, exist_ok=True)
    usage = shutil.disk_usage(path)
    return usage.free // (1024 * 1024)


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace").strip()
    except OSError:
        return ""


def run_quiet(argv: list[str], timeout: int, **kwargs):
    try:
        return subprocess.run(
            argv, capture_output=True, text=True, timeout=timeout, check=False, **kwargs
        )
    except (OSError, subprocess.TimeoutExpired):
        return None


# -------------------------------------------------------------------------- network


def http_get(url: str, timeout: int = 30) -> bytes:
    request = urllib.request.Request(
        url, headers={"User-Agent": USER_AGENT, "Accept": "application/vnd.github+json"}
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def http_download(url: str, dest: Path, max_bytes: int, timeout: int = 60) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    part = dest.with_name(dest.name + ".part")
    total = 0
    with urllib.request.urlopen(request, timeout=timeout) as response, part.open("wb") as out:
        while True:
            chunk = response.read(1 << 20)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise BridgeError(f"{dest.name} is larger than {max_bytes // (1 << 20)} MB")
            out.write(chunk)
    part.replace(dest)


def latest_build(cfg: dict) -> dict:
    """The newest nightly: its commit and the download URL of every asset."""
    repo = require_repo(cfg)
    url = f"https://api.github.com/repos/{repo}/releases/tags/{cfg['RELEASE_TAG']}"
    try:
        release = json.loads(http_get(url))
    except urllib.error.HTTPError as cause:
        if cause.code == 404:
            raise BridgeError(f"no '{cfg['RELEASE_TAG']}' release published yet") from cause
        raise BridgeError(f"GitHub answered {cause.code} for the release") from cause
    except (urllib.error.URLError, OSError, ValueError) as cause:
        raise BridgeError(f"network unavailable ({cause.__class__.__name__})") from cause
    assets = {a["name"]: a["browser_download_url"] for a in release.get("assets", [])}
    needed = [cfg["ASSET_BUILD_INFO"], cfg["ASSET_APPIMAGE"], cfg["ASSET_BUNDLE"], cfg["ASSET_SUMS"]]
    missing = [name for name in needed if name not in assets]
    if missing:
        raise BridgeError(f"nightly is missing {', '.join(missing)}")
    info = json.loads(http_get(assets[cfg["ASSET_BUILD_INFO"]]))
    sha = str(info.get("sha", ""))
    if not SHA_RE.match(sha):
        raise BridgeError("build-info.json has no 40-character commit sha")
    return {"sha": sha, "assets": assets, "info": info}


def parse_sums(text: str) -> dict[str, str]:
    sums = {}
    for line in text.splitlines():
        parts = line.strip().split()
        if len(parts) == 2 and re.fullmatch(r"[0-9a-f]{64}", parts[0]):
            sums[parts[1].lstrip("*")] = parts[0]
    return sums


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_extract(archive: Path, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    root = dest.resolve()
    with tarfile.open(archive, "r:gz") as tar:
        members = tar.getmembers()
        for member in members:
            target = (dest / member.name).resolve()
            if root != target and root not in target.parents:
                raise BridgeError(f"bundle entry escapes its folder: {member.name}")
            if member.issym() or member.islnk() or member.isdev():
                raise BridgeError(f"bundle entry is a link or device: {member.name}")
        if hasattr(tarfile, "data_filter"):
            tar.extractall(dest, members=members, filter="data")
        else:
            tar.extractall(dest, members=members)


# ------------------------------------------------------------------------ sanitizer

ALLOWED_HOSTS = {
    "github.com",
    "api.github.com",
    "raw.githubusercontent.com",
    "objects.githubusercontent.com",
    "codeload.github.com",
    "localhost",
    "127.0.0.1",
    "buildbot.libretro.com",
    "flathub.org",
    "dl.flathub.org",
}
# Generic host names that are defaults, not identities: redacting them would shred
# every log line that mentions /run/armada or the distribution.
LITERAL_STOPLIST = {"localhost", "armada", "steamdeck", "fedora", "linux", "nova", "deck"}

TEXT_EXT = {".json", ".log", ".txt", ".csv", ".tsv", ".md"}
PNG_EXT = {".png"}
MAX_TEXT_BYTES = 1_000_000
MAX_PNG_BYTES = 2_500_000
MAX_FILES = 80
MAX_TOTAL_BYTES = 25_000_000
PNG_KEEP = {b"IHDR", b"PLTE", b"IDAT", b"IEND", b"tRNS", b"gAMA", b"cHRM", b"sRGB", b"pHYs", b"sBIT"}

IPV4 = r"(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?![\d.])"
IPV6 = r"(?<![0-9A-Fa-f:])(?:[0-9A-Fa-f]{1,4}:){4,7}[0-9A-Fa-f]{1,4}(?![0-9A-Fa-f:])|(?<![0-9A-Fa-f:])(?:[0-9A-Fa-f]{1,4}:){1,6}:(?:[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{1,4}){0,5})?(?![0-9A-Fa-f:])"
MAC = r"(?<![0-9A-Fa-f:])(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}(?![0-9A-Fa-f:])"
EMAIL = r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}"
LAN_HOST = r"\b[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?:local|lan|home|internal|localdomain|home\.arpa)\b"
SECRET_KEYS = r"access_?token|refresh_?token|client_?token|token|password|passwd|secret|cookie|device_code|user_code|authorization|api_?key"


class Redactor:
    """Removes what must never reach a public branch: tokens, addresses, names."""

    def __init__(self, literals: list[str]):
        clean = []
        for literal in literals:
            literal = literal.strip()
            if len(literal) >= 3 and literal.lower() not in LITERAL_STOPLIST:
                clean.append(literal)
        clean.sort(key=len, reverse=True)
        self.literals = clean
        self.literal_re = (
            re.compile("|".join(re.escape(l) for l in clean), re.IGNORECASE) if clean else None
        )

    def redact(self, text: str) -> str:
        if self.literal_re:
            text = self.literal_re.sub("<redacted>", text)
        text = re.sub(r"rmm_[A-Za-z0-9_\-]{6,}", "<token>", text)
        text = re.sub(r"(?i)\b(bearer|basic)\s+[A-Za-z0-9._~+/=\-]{8,}", r"\1 <token>", text)
        text = re.sub(
            rf'(?i)"({SECRET_KEYS})"\s*:\s*"[^"]*"', lambda m: f'"{m.group(1)}": "<redacted>"', text
        )
        text = re.sub(rf"(?i)([?&](?:{SECRET_KEYS}|code)=)[^&\s\"'<>]+", r"\1<redacted>", text)
        text = re.sub(
            rf"(?i)\b({SECRET_KEYS})(\s*[=:]\s*)(?![\"<{{\[])[^\s,;}}&]+", r"\1\2<redacted>", text
        )
        text = re.sub(r"(https?://)[^/\s\"'<>@]*@", r"\1", text)
        text = re.sub(r"(?i)(https?://)(\[[0-9a-f:]+\]|[^/\s:\"'<>]+)", self._url_host, text)
        text = re.sub(EMAIL, "<email>", text)
        text = re.sub(MAC, "<mac>", text)
        text = re.sub(IPV4, self._ipv4, text)
        text = re.sub(IPV6, self._ipv6, text)
        text = re.sub(LAN_HOST, "<host>", text, flags=re.IGNORECASE)
        text = re.sub(r"(?i)\b(ssid)(\s*[=:]\s*)\S+", r"\1\2<redacted>", text)
        text = re.sub(r"userdata/\d+", "userdata/<id>", text)
        text = re.sub(r"/(?:var/)?home/[^/\s\"']+", "~", text)
        return text

    def leaks(self, text: str) -> list[str]:
        found = []
        if self.literal_re and self.literal_re.search(text):
            found.append("literal")
        if re.search(r"rmm_[A-Za-z0-9_\-]{6,}", text):
            found.append("token")
        if any(self._is_public_ipv4(m.group(0)) for m in re.finditer(IPV4, text)):
            found.append("ipv4")
        if re.search(EMAIL, text):
            found.append("email")
        return found

    @staticmethod
    def _url_host(match: re.Match) -> str:
        host = match.group(2).lower()
        return match.group(0) if host in ALLOWED_HOSTS else f"{match.group(1)}<server>"

    @staticmethod
    def _is_public_ipv4(addr: str) -> bool:
        return addr not in ("127.0.0.1", "0.0.0.0")

    def _ipv4(self, match: re.Match) -> str:
        return match.group(0) if not self._is_public_ipv4(match.group(0)) else "<ip>"

    @staticmethod
    def _ipv6(match: re.Match) -> str:
        return match.group(0) if match.group(0) in ("::1",) else "<ip6>"


def strip_png(data: bytes) -> bytes | None:
    """Keep only the chunks that draw the picture; text and EXIF chunks can carry anything."""
    signature = b"\x89PNG\r\n\x1a\n"
    if not data.startswith(signature):
        return None
    out = [signature]
    pos = len(signature)
    while pos + 8 <= len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        kind = data[pos + 4 : pos + 8]
        end = pos + 12 + length
        if end > len(data):
            return None
        if kind in PNG_KEEP:
            out.append(data[pos:end])
        pos = end
        if kind == b"IEND":
            return b"".join(out)
    return None


def sanitize_tree(src: Path, dst: Path, redactor: Redactor) -> dict:
    """Copy what may be published from src to dst. Anything unsure is left out."""
    report = {"published": [], "dropped": [], "withheld": []}
    total = 0
    if not src.is_dir():
        return report
    dst.mkdir(parents=True, exist_ok=True)
    for path in sorted(src.rglob("*")):
        rel = path.relative_to(src).as_posix()
        if path.is_symlink() or not path.is_file():
            if path.is_symlink():
                report["dropped"].append(rel)
            continue
        if len(report["published"]) >= MAX_FILES:
            report["dropped"].append(rel)
            continue
        suffix = path.suffix.lower()
        if suffix in TEXT_EXT:
            raw = path.read_bytes()
            if len(raw) > MAX_TEXT_BYTES:
                raw = b"[... earlier output trimmed by the device bridge ...]\n" + raw[-MAX_TEXT_BYTES:]
            text = redactor.redact(raw.decode("utf-8", errors="replace"))
            if redactor.leaks(text):
                report["withheld"].append(rel)
                continue
            data = text.encode("utf-8")
        elif suffix in PNG_EXT:
            data = strip_png(path.read_bytes())
            if data is None or len(data) > MAX_PNG_BYTES:
                report["dropped"].append(rel)
                continue
        else:
            report["dropped"].append(rel)
            continue
        if total + len(data) > MAX_TOTAL_BYTES:
            report["dropped"].append(rel)
            continue
        total += len(data)
        out = dst / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(data)
        report["published"].append(rel)
    return report


def discover_literals(cfg: dict) -> list[str]:
    """Words to redact that only this device knows: its name, the RomM host and account."""
    literals = [socket.gethostname(), socket.gethostname().split(".")[0]]
    for settings in _settings_files():
        data = read_json(settings, {})
        server = data.get("server") if isinstance(data.get("server"), dict) else data
        for key in ("baseUrl", "username"):
            value = server.get(key) if isinstance(server, dict) else None
            if isinstance(value, str) and value:
                literals.append(_host_of(value) if key == "baseUrl" else value)
    token_file = Path(cfg["READONLY_TOKEN_FILE"])
    base = read_json(token_file, {}).get("baseUrl")
    if isinstance(base, str):
        literals.append(_host_of(base))
    extra = Path(cfg["REDACT_FILE"])
    if extra.exists():
        literals += [l for l in extra.read_text(encoding="utf-8").splitlines() if l.strip()]
    return [l for l in literals if l]


def _settings_files() -> list[Path]:
    home = Path.home()
    roots = []
    for app in ("galleon", "rommix"):
        pointer = home / ".config" / app / "root"
        root = Path(_read(pointer)) if _read(pointer) else home / app
        roots.append(root / "config" / "settings.json")
    return [p for p in roots if p.exists()]


def _host_of(url: str) -> str:
    match = re.match(r"^(?:[a-z]+://)?([^/:]+)", url.strip(), re.IGNORECASE)
    return match.group(1) if match else ""


# ------------------------------------------------------------------------ publisher


class Publisher:
    """Pushes to the results branch with the deploy key. Never force-pushes anything."""

    def __init__(self, cfg: dict, log: Log):
        self.cfg = cfg
        self.log = log
        self.repo_dir = Path(cfg["STATE_DIR"]) / "results-repo"
        self.branch = cfg["RESULTS_BRANCH"]
        self.remote = f"git@github.com:{require_repo(cfg)}.git"

    def ssh_command(self) -> str:
        return (
            f"ssh -i {self.cfg['DEPLOY_KEY']} -o IdentitiesOnly=yes -o BatchMode=yes "
            f"-o UserKnownHostsFile={self.cfg['KNOWN_HOSTS']} -o StrictHostKeyChecking=yes "
            "-o ConnectTimeout=20"
        )

    def git(self, *args: str, check: bool = True, timeout: int = 180):
        env = dict(os.environ, GIT_TERMINAL_PROMPT="0")
        result = subprocess.run(
            ["git", "-C", str(self.repo_dir), *args],
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env,
            check=False,
        )
        if check and result.returncode != 0:
            raise BridgeError(f"git {args[0]} failed: {result.stderr.strip()[-300:]}")
        return result

    def prepare(self) -> None:
        if not (self.repo_dir / ".git").is_dir():
            self.repo_dir.mkdir(parents=True, exist_ok=True)
            self.git("init", "-q")
            self.git("remote", "add", "origin", self.remote)
        self.git("config", "core.sshCommand", self.ssh_command())
        self.git("config", "user.name", "Galleon device bridge")
        self.git("config", "user.email", "device-bridge@galleon.invalid")
        fetched = self.git("fetch", "-q", "--depth=1", "origin", self.branch, check=False)
        if fetched.returncode == 0:
            self.git("checkout", "-q", "-B", self.branch, "FETCH_HEAD")
            self.git("reset", "-q", "--hard", "FETCH_HEAD")
            self.git("clean", "-q", "-fdx")
        elif "couldn't find remote ref" in fetched.stderr:
            self.git("checkout", "-q", "--orphan", self.branch)
            self.git("rm", "-rq", "--ignore-unmatch", ".", check=False)
            (self.repo_dir / "README.md").write_text(BRANCH_README, encoding="utf-8")
        else:
            raise BridgeError(f"cannot reach the results branch: {fetched.stderr.strip()[-300:]}")

    def publish(self, apply, message: str) -> None:
        """`apply(repo_dir)` writes the change; it is re-applied if the push races."""
        for attempt in range(3):
            self.prepare()
            apply(self.repo_dir)
            self.git("add", "-A")
            if self.git("diff", "--cached", "--quiet", check=False).returncode == 0:
                self.log("publish: nothing changed")
                return
            self.git("commit", "-q", "-m", message)
            pushed = self.git("push", "-q", "origin", f"HEAD:refs/heads/{self.branch}", check=False)
            if pushed.returncode == 0:
                self.log(f"published: {message}")
                return
            self.log(f"push rejected (attempt {attempt + 1}): {pushed.stderr.strip()[-200:]}")
            time.sleep(5 * (attempt + 1))
        raise BridgeError("could not push to the results branch after 3 attempts")


BRANCH_README = """# device-results

Written by the Galleon device bridge running on the test device, and read by the
cloud agent at the start of every session. Nothing here is code; treat it as data.

- `results/<sha>/summary.json`: what the nightly built from `<sha>` did on the device
- `results/index.json`, `results/latest.json`: newest first
- `reports/<time>/`: problem reports saved in Galleon on the device
- `bridge/status.json`: when the bridge last ran and why it last skipped
- `acceptance/<date>/`: the owner's final acceptance session

The format is specified in docs/TESTING.md on `main`.
"""


def stage_results(repo_dir: Path, staged: Path, sha: str, entry: dict, keep: int) -> None:
    results = repo_dir / "results"
    target = results / sha
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(staged, target)
    index = read_json(results / "index.json", [])
    index = [e for e in index if isinstance(e, dict) and e.get("sha") != sha]
    index.insert(0, entry)
    write_json(results / "index.json", index[:200])
    write_json(results / "latest.json", entry)
    kept = {e.get("sha") for e in index[:keep]}
    for child in results.iterdir():
        if child.is_dir() and SHA_RE.match(child.name) and child.name not in kept:
            shutil.rmtree(child)


# --------------------------------------------------------------------------- runner


def run_bundle(cfg: dict, test_dir: Path, appimage: Path, results: Path, log: Log) -> dict:
    budget = as_int(cfg, "BUDGET_SECONDS")
    hard_limit = budget + as_int(cfg, "GRACE_SECONDS")
    run_sh = test_dir / "bundle" / "run.sh"
    env = dict(
        os.environ,
        GALLEON_APPIMAGE=str(appimage),
        RESULTS_DIR=str(results),
        DEVICE_TEST_BUDGET_SECONDS=str(budget),
        GALLEON_SHA=test_dir.name,
        GALLEON_TEST_DIR=str(test_dir),
        GALLEON_TEST_ROOT=cfg["TEST_ROOT"],
        GALLEON_BRIDGE_VERSION=str(BRIDGE_VERSION),
        GALLEON_READONLY_TOKEN_FILE=cfg["READONLY_TOKEN_FILE"],
    )
    started = time.monotonic()
    outcome = {"exitCode": None, "timedOut": False, "seconds": 0}
    with (results / "logs" / "run-sh.log").open("w", encoding="utf-8") as out:
        child = subprocess.Popen(
            ["/bin/sh", str(run_sh)],
            cwd=test_dir,
            env=env,
            stdout=out,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        try:
            outcome["exitCode"] = child.wait(timeout=hard_limit)
        except subprocess.TimeoutExpired:
            outcome["timedOut"] = True
            log(f"run.sh passed its hard limit of {hard_limit}s; stopping it")
            _stop_group(child)
            cleanup = run_quiet(["/bin/sh", str(run_sh), "--cleanup"], timeout=300, cwd=test_dir, env=env)
            log(f"run.sh --cleanup exited {cleanup.returncode if cleanup else 'abnormally'}")
    outcome["seconds"] = int(time.monotonic() - started)
    return outcome


def _stop_group(child: subprocess.Popen) -> None:
    # Only the group this bridge started: Galleon itself runs under Steam and is
    # stopped by run.sh --cleanup, which knows its pid.
    for sig, wait in ((signal.SIGTERM, 30), (signal.SIGKILL, 10)):
        try:
            os.killpg(child.pid, sig)
        except ProcessLookupError:
            return
        try:
            child.wait(timeout=wait)
            return
        except subprocess.TimeoutExpired:
            continue


def fallback_summary(sha: str, status: str, reason: str) -> dict:
    return {
        "schema": 1,
        "sha": sha,
        "status": status,
        "reason": reason,
        "checks": [],
        "writtenBy": "bridge",
    }


def summarize(summary: dict, sha: str, bridge: dict) -> dict:
    counts = {"pass": 0, "fail": 0, "skip": 0, "error": 0}
    for check in summary.get("checks", []):
        result = check.get("result")
        if result in counts:
            counts[result] += 1
    return {
        "sha": sha,
        "status": summary.get("status", "error"),
        "finishedAt": utc_now(),
        "counts": counts,
        "path": f"results/{sha}/summary.json",
        "bridgeVersion": BRIDGE_VERSION,
        "runSeconds": bridge.get("run", {}).get("seconds"),
    }


def prune_runs(test_root: Path, keep: int, current: str | None = None) -> list[str]:
    if not test_root.is_dir():
        return []
    runs = [p for p in test_root.iterdir() if p.is_dir() and SHA_RE.match(p.name)]
    runs.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    removed = []
    for old in runs[keep:]:
        if old.name == current:
            continue
        shutil.rmtree(old, ignore_errors=True)
        removed.append(old.name)
    return removed


# ------------------------------------------------------------------------ commands


def check_preconditions(cfg: dict, now_flag: bool) -> tuple[bool, str, dict]:
    facts: dict = {}
    if not now_flag:
        window = parse_window(cfg["WINDOW"])
        local = dt.datetime.now()
        if not in_window(local.hour * 60 + local.minute, window):
            return False, f"outside the window {cfg['WINDOW']}", facts
    processes = running_processes()
    ok, why = session_active(cfg["SESSION_UNIT"], cfg["SESSION_PROCESSES"].split(), processes)
    if not ok:
        return False, why, facts
    power = read_power()
    facts["power"] = power
    ok, why = power_ok(power, as_bool(cfg, "REQUIRE_AC"), as_int(cfg, "MIN_BATTERY"))
    if not ok:
        return False, why, facts
    busy = busy_names(cfg["BUSY_PROCESSES"].split(), processes, galleon_idle_state())
    if busy:
        return False, f"busy: {', '.join(busy)} running", facts
    free = free_mb(Path(cfg["TEST_ROOT"]))
    facts["freeMb"] = free
    if free < as_int(cfg, "MIN_FREE_MB"):
        return False, f"only {free} MB free", facts
    return True, "ready", facts


def cmd_run(args, cfg: dict, log: Log) -> int:
    state = Path(cfg["STATE_DIR"])
    if not Lock(state).acquire():
        log("skip: another bridge run is active")
        return 0
    try:
        ok, why, facts = check_preconditions(cfg, args.now)
        if not ok:
            log(f"skip: {why}")
            maybe_heartbeat(cfg, log, why)
            return 0
        try:
            build = latest_build(cfg)
        except BridgeError as error:
            log(f"skip: {error}")
            maybe_heartbeat(cfg, log, str(error))
            return 0
        sha = build["sha"]
        last = _read(state / "last-tested")
        if sha == last and not args.force:
            log(f"skip: {sha[:12]} already tested")
            maybe_collect_reports(cfg, log)
            maybe_heartbeat(cfg, log, "no new nightly")
            return 0
        return test_build(args, cfg, log, build, facts)
    except BridgeError as error:
        log(f"error: {error}")
        return 1


def test_build(args, cfg: dict, log: Log, build: dict, facts: dict) -> int:
    sha = build["sha"]
    state = Path(cfg["STATE_DIR"])
    test_root = Path(cfg["TEST_ROOT"])
    test_dir = test_root / sha
    results = test_dir / "results"
    if results.exists():
        shutil.rmtree(results)
    (results / "logs").mkdir(parents=True)
    log(f"testing {sha[:12]}")

    appimage = test_dir / cfg["ASSET_APPIMAGE"]
    bundle = test_dir / cfg["ASSET_BUNDLE"]
    try:
        sums = parse_sums(http_get(build["assets"][cfg["ASSET_SUMS"]]).decode("utf-8", "replace"))
        limits = {appimage: as_int(cfg, "MAX_APPIMAGE_MB"), bundle: as_int(cfg, "MAX_BUNDLE_MB")}
        for path, limit_mb in limits.items():
            expected = sums.get(path.name)
            if not expected:
                raise BridgeError(f"SHA256SUMS does not list {path.name}")
            if not path.exists() or sha256_file(path) != expected:
                http_download(build["assets"][path.name], path, limit_mb << 20)
            if sha256_file(path) != expected:
                raise BridgeError(f"{path.name} does not match SHA256SUMS")
    except (urllib.error.URLError, OSError, ValueError) as cause:
        # Usually a nightly replaced mid-download; the next hour starts again.
        raise BridgeError(f"download failed ({cause.__class__.__name__})") from cause
    appimage.chmod(0o755)
    if (test_dir / "bundle").exists():
        shutil.rmtree(test_dir / "bundle")
    safe_extract(bundle, test_dir / "bundle")
    manifest = read_json(test_dir / "bundle" / "bundle.json", {})
    if int(manifest.get("minBridge", 1)) > BRIDGE_VERSION:
        return publish_outcome(
            cfg, log, sha, results,
            fallback_summary(sha, "error", f"bundle needs bridge {manifest.get('minBridge')}"),
            {"preconditions": facts}, mark_tested=False,
        )
    if not (test_dir / "bundle" / "run.sh").is_file():
        raise BridgeError("bundle has no run.sh")

    # Someone may have picked the device up while the download ran.
    busy = busy_names(cfg["BUSY_PROCESSES"].split(), running_processes(), galleon_idle_state())
    if busy:
        log(f"skip: busy: {', '.join(busy)} running")
        return 0

    started = utc_now()
    outcome = run_bundle(cfg, test_dir, appimage, results, log)
    bridge = {
        "bridgeVersion": BRIDGE_VERSION,
        "startedAt": started,
        "finishedAt": utc_now(),
        "run": outcome,
        "preconditions": facts,
        "budgetSeconds": as_int(cfg, "BUDGET_SECONDS"),
    }
    summary = read_json(results / "summary.json", None)
    if outcome["timedOut"]:
        summary = summary or fallback_summary(sha, "error", "run.sh passed the hard time limit")
        if summary.get("status") == "complete":
            summary["status"] = "partial"
        summary.setdefault("notes", []).append("run.sh passed the bridge's hard time limit")
    elif outcome["exitCode"] == EXIT_ABORTED_BY_USER:
        log("aborted: someone used the device during the test; retrying later")
        return 0
    elif outcome["exitCode"] == EXIT_SKIPPED:
        reason = (summary or {}).get("reason", "run.sh skipped")
        skips = read_json(state / "published-skips.json", {})
        if skips.get(sha) == reason:
            log(f"skip (already reported): {reason}")
            return 0
        skips[sha] = reason
        write_json(state / "published-skips.json", skips)
        summary = summary or fallback_summary(sha, "skipped", reason)
        return publish_outcome(cfg, log, sha, results, summary, bridge, mark_tested=False)
    elif summary is None:
        summary = fallback_summary(sha, "error", f"run.sh exited {outcome['exitCode']} without a summary")
    code = publish_outcome(cfg, log, sha, results, summary, bridge, mark_tested=True)
    maybe_self_update(cfg, log, test_dir, summary)
    prune_runs(test_root, as_int(cfg, "KEEP_RUNS"), current=sha)
    return code


def publish_outcome(cfg, log, sha, results, summary, bridge, mark_tested: bool) -> int:
    state = Path(cfg["STATE_DIR"])
    write_json(results / "summary.json", summary)
    redactor = Redactor(discover_literals(cfg))
    staged = state / "staging" / sha
    if staged.exists():
        shutil.rmtree(staged)
    report = sanitize_tree(results, staged, redactor)
    if "summary.json" not in report["published"]:
        # The one file the agent must be able to read: fall back to a plain one.
        write_json(staged / "summary.json", fallback_summary(sha, "withheld", "summary failed the privacy check"))
    bridge["sanitizer"] = {k: v for k, v in report.items() if k != "published"}
    write_json(staged / "bridge.json", bridge)
    entry = summarize(read_json(staged / "summary.json", {}), sha, bridge)
    if not as_bool(cfg, "PUBLISH"):
        log(f"dry run: staged in {staged}, not published")
        return 0
    keep = as_int(cfg, "KEEP_PUBLISHED")
    Publisher(cfg, log).publish(
        lambda repo: stage_results(repo, staged, sha, entry, keep),
        f"device-results: {sha[:12]} {entry['status']}",
    )
    if mark_tested:
        (state / "last-tested").write_text(sha + "\n", encoding="utf-8")
    maybe_collect_reports(cfg, log)
    return 0


def maybe_heartbeat(cfg: dict, log: Log, reason: str) -> None:
    """Once a day at most, say the bridge is alive and why it is not testing."""
    state = Path(cfg["STATE_DIR"])
    status_file = state / "status.json"
    status = read_json(status_file, {})
    reasons = status.get("skipReasons", {})
    reasons[reason] = reasons.get(reason, 0) + 1
    status["skipReasons"] = reasons
    status["lastSkip"] = reason
    status["lastSeen"] = utc_now()
    status["bridgeVersion"] = BRIDGE_VERSION
    status["lastTested"] = _read(state / "last-tested") or None
    write_json(status_file, status)
    if not as_bool(cfg, "PUBLISH"):
        return
    last = status.get("lastPublished")
    hours = as_int(cfg, "HEARTBEAT_HOURS")
    if last:
        then = dt.datetime.strptime(last, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)
        if dt.datetime.now(dt.timezone.utc) - then < dt.timedelta(hours=hours):
            return
    redactor = Redactor(discover_literals(cfg))
    public = json.loads(redactor.redact(json.dumps(status)))
    try:
        Publisher(cfg, log).publish(
            lambda repo: write_json(repo / "bridge" / "status.json", public),
            "device-results: bridge status",
        )
    except (BridgeError, OSError, subprocess.TimeoutExpired) as error:
        log(f"heartbeat not published: {error}")
        return
    status["lastPublished"] = utc_now()
    status["skipReasons"] = {}
    write_json(status_file, status)


def maybe_collect_reports(cfg: dict, log: Log) -> None:
    """Problem reports saved in the owner's own Galleon reach the agent without GitHub."""
    if not as_bool(cfg, "COLLECT_REPORTS") or not as_bool(cfg, "PUBLISH"):
        return
    home = Path.home()
    pointer = _read(home / ".config" / "galleon" / "root")
    reports_dir = (Path(pointer) if pointer else home / "galleon") / "reports"
    if not reports_dir.is_dir():
        return
    state = Path(cfg["STATE_DIR"])
    seen = set(read_json(state / "reports-collected.json", []))
    fresh = [z for z in sorted(reports_dir.glob("*.zip")) if z.name not in seen][:5]
    if not fresh:
        return
    redactor = Redactor(discover_literals(cfg))
    staged = state / "staging" / "reports"
    if staged.exists():
        shutil.rmtree(staged)
    for archive in fresh:
        raw = staged / "raw" / archive.stem
        try:
            with zipfile.ZipFile(archive) as zf:
                for member in zf.infolist():
                    name = Path(member.filename)
                    if member.is_dir() or name.is_absolute() or ".." in name.parts:
                        continue
                    if member.file_size > MAX_TEXT_BYTES * 4:
                        continue
                    out = raw / name
                    out.parent.mkdir(parents=True, exist_ok=True)
                    out.write_bytes(zf.read(member))
        except (zipfile.BadZipFile, OSError) as error:
            log(f"report {archive.name} unreadable: {error}")
            continue
        sanitize_tree(raw, staged / "clean" / archive.stem, redactor)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    clean = staged / "clean"

    def apply(repo: Path) -> None:
        if clean.is_dir():
            shutil.copytree(clean, repo / "reports" / stamp, dirs_exist_ok=True)

    try:
        Publisher(cfg, log).publish(apply, f"device-results: {len(fresh)} problem report(s)")
    except BridgeError as error:
        log(f"reports not published: {error}")
        return
    write_json(state / "reports-collected.json", sorted(seen | {z.name for z in fresh}))


def maybe_self_update(cfg: dict, log: Log, test_dir: Path, summary: dict) -> None:
    """Take a newer bridge from a bundle whose harness passed; roll back if it cannot start.

    run.sh from the same bundle already runs as this user, so this adds no trust the
    bundle did not already have; it only saves the owner a manual update.
    """
    if not as_bool(cfg, "SELF_UPDATE"):
        return
    source = test_dir / "bundle" / "bridge"
    offered = read_json(source / "VERSION.json", {}).get("version")
    if not isinstance(offered, int) or offered <= BRIDGE_VERSION:
        return
    harness = {c.get("id"): c.get("result") for c in summary.get("checks", [])}
    if harness.get("harness.run") != "pass" or harness.get("safety.owner-state") != "pass":
        log(f"bridge {offered} offered but the run was not clean; not updating")
        return
    installer = source / "install.sh"
    result = run_quiet(["/bin/sh", str(installer), "--update"], timeout=120)
    if result is None or result.returncode != 0:
        log(f"bridge update to {offered} failed; the installer restored the previous copy")
        return
    log(f"bridge updated to {offered}")


def cmd_doctor(args, cfg: dict, log: Log) -> int:
    failures = 0

    def report(level: str, what: str) -> None:
        nonlocal failures
        failures += level == "FAIL"
        print(f"{level:4} {what}")

    report("OK" if sys.version_info >= (3, 9) else "FAIL", f"python {sys.version.split()[0]}")
    report("OK" if CONFIG_PATH.exists() else "FAIL", f"config {CONFIG_PATH}")
    try:
        repo = require_repo(cfg)
        report("OK", f"repo {repo}")
    except BridgeError as error:
        report("FAIL", str(error))
        repo = None
    for tool in ("git", "ssh", "ssh-keygen", "systemctl"):
        report("OK" if shutil.which(tool) else "FAIL", f"tool {tool}")
    key = Path(cfg["DEPLOY_KEY"])
    if key.exists():
        mode = key.stat().st_mode & 0o777
        report("OK" if mode == 0o600 else "FAIL", f"deploy key mode {oct(mode)}")
    else:
        report("FAIL", "deploy key missing (run install.sh)")
    known = Path(cfg["KNOWN_HOSTS"])
    pinned = known.exists() and GITHUB_KNOWN_HOST in known.read_text(encoding="utf-8")
    report("OK" if pinned else "FAIL", "github.com host key pinned")
    if repo and key.exists() and pinned:
        probe = run_quiet(
            ["git", "ls-remote", f"git@github.com:{repo}.git", f"refs/heads/{cfg['RESULTS_BRANCH']}"],
            timeout=40,
            env=dict(os.environ, GIT_SSH_COMMAND=Publisher(cfg, log).ssh_command(), GIT_TERMINAL_PROMPT="0"),
        )
        if probe is None or probe.returncode != 0:
            report("FAIL", "deploy key cannot read the repository (is it added with write access?)")
        else:
            report("OK" if probe.stdout.strip() else "WARN",
                   "results branch exists" if probe.stdout.strip() else "results branch not created yet (first run creates it)")
    if repo:
        try:
            build = latest_build(cfg)
            report("OK", f"nightly {build['sha'][:12]} has every asset")
        except BridgeError as error:
            report("WARN", f"nightly: {error}")
    processes = running_processes()
    ok, why = session_active(cfg["SESSION_UNIT"], cfg["SESSION_PROCESSES"].split(), processes)
    report("OK" if ok else "WARN", f"game mode: {why}")
    power = read_power()
    ok, why = power_ok(power, as_bool(cfg, "REQUIRE_AC"), as_int(cfg, "MIN_BATTERY"))
    report("OK" if power["batteryPct"] is not None else "WARN", f"power: {why}")
    busy = busy_names(cfg["BUSY_PROCESSES"].split(), processes, galleon_idle_state())
    report("INFO", f"busy now: {', '.join(busy) or 'nothing'}")
    profile = run_quiet(["armada-power", "profile"], timeout=10)
    report("OK" if profile and profile.returncode == 0 else "WARN",
           f"armada-power profile: {profile.stdout.strip() if profile and profile.returncode == 0 else 'unavailable'}")
    try:
        cef = json.loads(http_local("http://127.0.0.1:8080/json"))
        report("OK", f"steam CEF debugger answers ({len(cef)} targets)")
    except (OSError, ValueError):
        report("WARN", "steam CEF debugger not reachable (needed to add the test shortcut)")
    report("INFO", f"gamescopectl {'present' if shutil.which('gamescopectl') else 'absent'}")
    shortcuts = list(Path.home().glob(".local/share/Steam/userdata/*/config/shortcuts.vdf"))
    report("OK" if shortcuts else "WARN", f"steam shortcuts files: {len(shortcuts)}")
    report("INFO", f"sign-in for device tests: {signin_source(cfg)}")
    report("OK", f"free space at {cfg['TEST_ROOT']}: {free_mb(Path(cfg['TEST_ROOT']))} MB")
    timer = run_quiet(["systemctl", "--user", "is-enabled", "galleon-device-bridge.timer"], timeout=10)
    report("OK" if timer and timer.stdout.strip() == "enabled" else "WARN", "timer enabled")
    return 1 if failures else 0


def http_local(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=3) as response:
        return response.read()


def signin_source(cfg: dict) -> str:
    """Where run.sh will find a sign-in, by kind only. Never prints a value."""
    if Path(cfg["READONLY_TOKEN_FILE"]).exists():
        return "read-only device token (paired for tests)"
    home = Path.home()
    for app in ("galleon", "rommix"):
        pointer = _read(home / ".config" / app / "root")
        root = Path(pointer) if pointer else home / app
        creds = root / "config" / "credentials.bin"
        if creds.exists():
            magic = creds.read_bytes()[:4]
            if magic == b"RAW1":
                return f"importable from {app} (plain-text store)"
            return f"{app} credentials are keyring-encrypted; run 'pair-readonly' once"
    return "none: run 'pair-readonly' once"


def cmd_status(args, cfg: dict, log: Log) -> int:
    state = Path(cfg["STATE_DIR"])
    status = read_json(state / "status.json", {})
    print(f"last tested: {_read(state / 'last-tested') or 'nothing yet'}")
    print(f"last seen:   {status.get('lastSeen', 'never')}")
    print(f"last skip:   {status.get('lastSkip', '-')}")
    timers = run_quiet(["systemctl", "--user", "list-timers", "galleon-device-bridge.timer"], timeout=10)
    if timers:
        print(timers.stdout.strip())
    return 0


def cmd_pair_readonly(args, cfg: dict, log: Log) -> int:
    """Pair a separate, read-only RomM device for the tests (needs the owner's approval once)."""
    base = args.server or _first_server()
    if not base:
        raise BridgeError("no server address known; pass --server http://host:port")
    base = base.rstrip("/")
    scopes = ["me.read", "platforms.read", "roms.read", "roms.user.read", "assets.read", "firmware.read", "collections.read"]
    init = _post_json(f"{base}/api/auth/device/init", {
        "client_device_identifier": f"galleon-device-tests-{socket.gethostname()}",
        "name": "Galleon device tests (read-only)",
        "client": "galleon-device-bridge",
        "platform": "linux",
        "client_version": str(BRIDGE_VERSION),
        "requested_scopes": scopes,
    })
    print(f"Approve this code in a browser signed in to RomM: {init.get('user_code')}")
    print(f"Open: {base}{init.get('verification_path', '/pair/device')}?user_code={init.get('user_code')}")
    interval = int(init.get("interval", 5))
    deadline = time.monotonic() + int(init.get("expires_in", 600))
    while time.monotonic() < deadline:
        time.sleep(interval)
        try:
            token = _post_json(f"{base}/api/auth/device/token", {"device_code": init["device_code"]})
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", "replace")
            if "slow_down" in body:
                interval += 5
            if "pending" in body or "slow_down" in body:
                continue
            raise BridgeError(f"pairing stopped: {error.code}") from error
        if token.get("access_token"):
            path = Path(cfg["READONLY_TOKEN_FILE"])
            path.parent.mkdir(parents=True, exist_ok=True)
            write_json(path, {"baseUrl": base, "token": token["access_token"], "scopes": scopes})
            path.chmod(0o600)
            print("Paired. The token is stored for the device tests only.")
            return 0
    raise BridgeError("the code expired before it was approved")


def _first_server() -> str | None:
    for settings in _settings_files():
        data = read_json(settings, {})
        server = data.get("server") if isinstance(data.get("server"), dict) else data
        if isinstance(server, dict) and isinstance(server.get("baseUrl"), str):
            return server["baseUrl"]
    return None


def _post_json(url: str, body: dict) -> dict:
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": USER_AGENT},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.loads(response.read() or b"{}")


def cmd_prune(args, cfg: dict, log: Log) -> int:
    removed = prune_runs(Path(cfg["TEST_ROOT"]), as_int(cfg, "KEEP_RUNS"))
    log(f"pruned {len(removed)} old test folder(s)")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="galleon-device-bridge", description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run", help="test the newest nightly if the device is ready")
    run.add_argument("--now", action="store_true", help="ignore the time window (safety checks still apply)")
    run.add_argument("--force", action="store_true", help="test even if this nightly was already tested")
    sub.add_parser("doctor", help="check this device is set up for the bridge")
    sub.add_parser("status", help="when the bridge last ran and why it last skipped")
    sub.add_parser("prune", help="keep only the newest test folders")
    pair = sub.add_parser("pair-readonly", help="pair a read-only RomM device for the tests")
    pair.add_argument("--server", help="RomM address, if no Galleon or RomMix sign-in is found")
    args = parser.parse_args(argv)

    cfg = load_config()
    log = Log(Path(cfg["STATE_DIR"]))
    commands = {
        "run": cmd_run,
        "doctor": cmd_doctor,
        "status": cmd_status,
        "prune": cmd_prune,
        "pair-readonly": cmd_pair_readonly,
    }
    try:
        return commands[args.command](args, cfg, log)
    except BridgeError as error:
        log(f"error: {error}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
