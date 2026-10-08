#!/usr/bin/env python3
"""romm-es: show a RomM library in ES-DE and download games on first launch.

  romm-es sync          create placeholder ROMs, gamelists and media for the whole library
  romm-es fetch PATH    download a placeholder's real content (run by ES-DE's game-start hook)
  romm-es free PATH     turn a downloaded game back into a placeholder to reclaim space
  romm-es status        summary of placeholders vs downloaded games
  romm-es bios          copy verified BIOS files from RomM into each emulator's BIOS folder
"""
import concurrent.futures
import contextlib
import datetime
import fcntl
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

HOME = os.path.expanduser("~")
CONFIG_PATH = os.path.join(HOME, ".config/romm-es/config.json")
DATA_DIR = os.path.join(HOME, ".local/share/romm-es")
STATE_PATH = os.path.join(DATA_DIR, "state.json")
LOCK_PATH = os.path.join(DATA_DIR, "state.lock")
LOG_PATH = os.path.join(DATA_DIR, "romm-es.log")

DEFAULTS = {
    "rom_root": "/run/media/armada/NovaSD/ROMs",
    "media_root": "/run/media/armada/NovaSD/ES-DE/downloaded_media",
    "gamelist_root": os.path.join(HOME, "ES-DE/gamelists"),
}

# RomM platform slug (or fs_slug) -> ES-DE system directory name.
SYSTEMS = {
    "ps": "psx", "psx": "psx", "ps1": "psx",
    "ps2": "ps2",
    "psp": "psp",
    "ngc": "gc", "gc": "gc",
    "wii": "wii",
    "wiiu": "wiiu", "wii-u": "wiiu",
    "dc": "dreamcast", "dreamcast": "dreamcast",
    "snes": "snes", "sfam": "snes",
    "gba": "gba", "gb": "gb", "gbc": "gbc",
    "nes": "nes", "famicom": "famicom",
    "n64": "n64", "nds": "nds", "3ds": "n3ds",
    "genesis-slash-megadrive": "megadrive", "genesis": "genesis", "md": "megadrive",
    "saturn": "saturn", "segacd": "segacd", "sms": "mastersystem", "gamegear": "gamegear",
    "psvita": "psvita",
}
# ES-DE systems whose emulators accept .m3u playlists for multi-disc games.
M3U_SYSTEMS = {"psx", "gc", "wii", "dreamcast", "saturn", "segacd"}
# Systems whose ES-DE config doesn't accept .cue: launch the .bin of a cue/bin set instead.
NO_CUE_SYSTEMS = {"ps2"}
# Default emulator per system (ES-DE's "alternative emulator"), applied only if the user hasn't
# picked one. Labels must match ES-DE's es_systems.xml; these are the standalone emulators
# available from the Armada Store, so no RetroArch cores are needed for these systems.
DEFAULT_EMULATORS = {
    "psx": "DuckStation (Standalone)",
    "gc": "Dolphin (Standalone)",
    "wii": "Dolphin (Standalone)",
    "psp": "PPSSPP (Standalone)",
    "dreamcast": "Flycast (Standalone)",
}
DISC_EXTS = {".chd", ".cue", ".iso", ".gdi", ".cdi", ".rvz", ".gcz", ".ciso", ".cso", ".ccd"}

# Multi-file games use ES-DE's "directories interpreted as files": a directory named
# like the file to launch (e.g. "Game.m3u/Game.m3u") shows up as a single game.


def log(msg):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(LOG_PATH, "a") as f:
        f.write(f"{datetime.datetime.now():%Y-%m-%d %H:%M:%S} {msg}\n")


def load_config():
    with open(CONFIG_PATH) as f:
        config = json.load(f)
    for key, value in DEFAULTS.items():
        config.setdefault(key, value)
    return config


@contextlib.contextmanager
def locked_state():
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(LOCK_PATH, "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        state = {}
        if os.path.exists(STATE_PATH):
            with open(STATE_PATH) as f:
                state = json.load(f)
        yield state
        tmp = STATE_PATH + ".tmp"
        with open(tmp, "w") as f:
            json.dump(state, f)
        os.replace(tmp, STATE_PATH)


class RomM:
    def __init__(self, config):
        self.server = config["server"].rstrip("/")
        self.headers = {"Authorization": "Bearer " + config["token"]}

    def request(self, path, timeout=60):
        url = path if path.startswith("http") else self.server + path
        return urllib.request.urlopen(urllib.request.Request(url, headers=self.headers), timeout=timeout)

    def get(self, path):
        with self.request(path) as resp:
            return json.load(resp)

    def roms(self, platform_id):
        roms, offset = [], 0
        while True:
            page = self.get(f"/api/roms?platform_ids={platform_id}&limit=500&offset={offset}&with_files=true")
            roms += page["items"]
            offset += 500
            if offset >= page.get("total", 0):
                return roms

    def content_url(self, rom_id, file_name, file_id=None):
        url = f"/api/roms/{rom_id}/content/{urllib.parse.quote(file_name)}"
        return url + (f"?file_ids={file_id}" if file_id else "")


# RomM platform slug -> BIOS folders of the emulators Armada installs (paths from armadaos.dev).
BIOS_DIRS = {
    "psx": ["~/.local/share/duckstation/bios"],
    "ps2": ["~/.config/ARMSX2/bios"],
    "dc": ["~/.var/app/org.flycast.Flycast/data/flycast", "~/.var/app/org.flycast.Flycast/data/flycast/data"],
    "gba": ["~/.var/app/org.libretro.RetroArch/config/retroarch/system"],
}


# ---------------------------------------------------------------- planning

def system_for(platform):
    for key in (platform.get("slug"), (platform.get("fs_slug") or "").lower()):
        if key in SYSTEMS:
            return SYSTEMS[key]
    return None


def game_files(rom):
    files = [f for f in rom.get("files") or [] if f.get("category") in (None, "game")]
    top = [f for f in files if f.get("is_top_level")]
    return top or files


def download(rom_id, file_name, file_id, dest, size):
    return {"url": (rom_id, file_name, file_id), "dest": dest, "size": size or 0}


def plan_rom(rom, system, companions):
    """Return (relative ES-DE path, state entry) for one RomM ROM, or None to skip it.

    kind "file": a single file in the system directory (placeholder = empty file).
    kind "dir":  a directory-as-file holding several files; "launch" is the file ES-DE
                 runs, and "playlist" (if set) is written into it as an .m3u.
    """
    if rom.get("missing_from_fs"):
        return None
    if rom.get("has_multiple_files"):
        discs = sorted(f for f in (x["file_name"] for x in game_files(rom))
                       if os.path.splitext(f)[1].lower() in DISC_EXTS)
        if system in M3U_SYSTEMS and len(discs) > 1:
            rel = f"{system}/{rom['fs_name']}.m3u"
            downloads = [download(rom["id"], f["file_name"], f["id"], f"{rel}/{f['file_name']}", f["file_size_bytes"])
                         for f in game_files(rom)]
            return rel, {"kind": "dir", "id": rom["id"], "launch": f"{rel}/{rom['fs_name']}.m3u",
                         "playlist": discs, "downloads": downloads}
    if rom.get("has_multiple_files") or rom.get("has_nested_single_file"):
        candidates = [f for f in game_files(rom) if os.path.splitext(f["file_name"])[1]]
        if not candidates:
            return None
        main = max(candidates, key=lambda f: f["file_size_bytes"])
        rel = f"{system}/{main['file_name']}"
        return rel, {"kind": "file", "id": rom["id"],
                     "downloads": [download(rom["id"], main["file_name"], main["id"], rel, main["file_size_bytes"])]}
    comps = companions.get(rom["fs_name_no_ext"], []) if (rom.get("fs_extension") or "").lower() == "cue" else []
    if comps:
        # A .cue whose .bin tracks RomM lists as separate ROMs: keep them together in one entry.
        launch = rom if system not in NO_CUE_SYSTEMS else max(comps, key=lambda r: r.get("fs_size_bytes") or 0)
        rel = f"{system}/{launch['fs_name']}"
        downloads = [download(r["id"], r["fs_name"], None, f"{rel}/{r['fs_name']}", r.get("fs_size_bytes")) for r in [rom, *comps]]
        return rel, {"kind": "dir", "id": rom["id"], "launch": f"{rel}/{launch['fs_name']}", "downloads": downloads}
    if not rom.get("fs_extension"):
        return None  # extensionless entries can't be matched to an emulator by ES-DE
    rel = f"{system}/{rom['fs_name']}"
    return rel, {"kind": "file", "id": rom["id"],
                 "downloads": [download(rom["id"], rom["fs_name"], None, rel, rom.get("fs_size_bytes"))]}


def companion_index(roms):
    cue_stems = {r["fs_name_no_ext"] for r in roms if (r.get("fs_extension") or "").lower() == "cue"}
    index, hidden = {}, set()
    for r in roms:
        ext = (r.get("fs_extension") or "").lower()
        if ext in ("bin", "img", "sub") and not r.get("has_multiple_files"):
            for stem in cue_stems:
                if r["fs_name_no_ext"] == stem or r["fs_name_no_ext"].startswith(stem + " (Track"):
                    index.setdefault(stem, []).append(r)
                    hidden.add(r["id"])
                    break
    return index, hidden


def is_complete(root, d):
    path = os.path.join(root, d["dest"])
    return os.path.exists(path) and os.path.getsize(path) == d["size"] and d["size"] > 0


def is_downloaded(config, rel, entry):
    root = config["rom_root"]
    if not all(is_complete(root, d) for d in entry["downloads"]):
        return False
    if entry.get("playlist"):
        launch = os.path.join(root, entry["launch"])
        return os.path.exists(launch) and os.path.getsize(launch) > 0
    return True


def create_placeholder(root, rel, entry):
    """Create the empty file (or directory-as-file) ES-DE lists. Returns True if created."""
    path = os.path.join(root, rel)
    if entry["kind"] == "dir":
        launch = os.path.join(root, entry["launch"])
        if os.path.exists(launch):
            return False
        os.makedirs(path, exist_ok=True)
        open(launch, "w").close()
        return True
    if os.path.exists(path):
        return False
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "w").close()
    return True


def is_placeholder(root, rel):
    path = os.path.join(root, rel)
    if os.path.isdir(path):
        return all(os.path.getsize(os.path.join(dp, f)) == 0 for dp, _, fs in os.walk(path) for f in fs)
    return os.path.exists(path) and os.path.getsize(path) == 0


# ---------------------------------------------------------------- gamelists & media

def release_date(ms):
    if not ms:
        return None
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).strftime("%Y%m%dT%H%M%S")


def game_fields(rom):
    meta = rom.get("metadatum") or {}
    companies = list(dict.fromkeys(meta.get("companies") or []))
    genres = meta.get("genres") or []
    rating = meta.get("average_rating")
    return {
        "name": rom.get("name") or rom.get("fs_name_no_ext"),
        "desc": rom.get("summary"),
        "rating": f"{min(rating, 100) / 100:.2f}" if rating else None,
        "releasedate": release_date(meta.get("first_release_date")),
        "developer": companies[0] if companies else None,
        "publisher": companies[1] if len(companies) > 1 else (companies[0] if companies else None),
        "genre": " / ".join(genres[:2]) if genres else None,
        "players": meta.get("player_count"),
    }


ALT_EMU_RE = re.compile(r"<alternativeEmulator>.*?</alternativeEmulator>", re.S)


def write_gamelist(config, system, entries):
    """Merge our fields into ES-DE's gamelist, keeping ES-DE's own tags (favorite, playcount, ...).

    ES-DE stores the per-system emulator choice in an <alternativeEmulator> element *beside*
    <gameList>, so the file isn't a single-rooted XML document; handle that block separately.
    """
    path = os.path.join(config["gamelist_root"], system, "gamelist.xml")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    existing = {}
    root = ET.Element("gameList")
    alt_emu = None
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            text = f.read()
        match = ALT_EMU_RE.search(text)
        alt_emu = match.group(0) if match else None
        body = ALT_EMU_RE.sub("", text)
        body = re.sub(r"<\?xml[^>]*\?>", "", body).strip()
        try:
            if body:
                root = ET.fromstring(body)
                existing = {g.findtext("path"): g for g in root.findall("game")}
        except ET.ParseError as e:
            log(f"gamelist {path} unreadable ({e}); leaving it untouched")
            return
    if alt_emu is None and system in DEFAULT_EMULATORS:
        alt_emu = f"<alternativeEmulator>\n\t<label>{DEFAULT_EMULATORS[system]}</label>\n</alternativeEmulator>"
    wanted = {f"./{os.path.basename(rel)}": fields for rel, fields in entries.items()}
    for game_path, element in existing.items():
        if element.get("source") == "romm-es" and game_path not in wanted:
            root.remove(element)
    for game_path, fields in sorted(wanted.items()):
        element = existing.get(game_path)
        if element is None:
            element = ET.SubElement(root, "game")
            ET.SubElement(element, "path").text = game_path
        element.set("source", "romm-es")
        for tag, value in fields.items():
            child = element.find(tag)
            if value is None:
                continue
            if child is None:
                child = ET.SubElement(element, tag)
            child.text = str(value)
    ET.indent(root)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0"?>\n')
        if alt_emu:
            f.write(alt_emu + "\n")
        f.write(ET.tostring(root, encoding="unicode") + "\n")
    os.replace(tmp, path)


def media_jobs(config, system, rel, rom):
    stem = os.path.splitext(os.path.basename(rel))[0]
    base = os.path.join(config["media_root"], system)
    jobs = []
    if rom.get("path_cover_large"):
        ext = os.path.splitext(rom["path_cover_large"].split("?")[0])[1] or ".png"
        jobs.append((rom["path_cover_large"].split("?")[0], os.path.join(base, "covers", stem + ext)))
    shots = rom.get("merged_screenshots") or []
    if shots:
        ext = os.path.splitext(shots[0])[1] or ".jpg"
        jobs.append((shots[0], os.path.join(base, "screenshots", stem + ext)))
    return [j for j in jobs if not os.path.exists(j[1])]


def fetch_media(api, jobs):
    def one(job):
        url, dest = job
        try:
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with api.request(urllib.parse.quote(url, safe="/:"), timeout=60) as resp, open(dest + ".part", "wb") as out:
                shutil.copyfileobj(resp, out)
            os.replace(dest + ".part", dest)
            return True
        except Exception as e:  # media is best-effort
            log(f"media failed {url}: {e}")
            return False
    with concurrent.futures.ThreadPoolExecutor(8) as pool:
        return sum(pool.map(one, jobs))


# ---------------------------------------------------------------- commands

def cmd_sync(config):
    api = RomM(config)
    root = config["rom_root"]
    if not os.path.isdir(os.path.dirname(root)):
        sys.exit(f"ROM storage not mounted: {os.path.dirname(root)}")
    started = time.time()
    plans, gamelists, media = {}, {}, []
    for platform in api.get("/api/platforms"):
        system = system_for(platform)
        if not system or not platform.get("rom_count"):
            continue
        roms = api.roms(platform["id"])
        companions, hidden = companion_index(roms)
        for rom in roms:
            if rom["id"] in hidden:
                continue
            planned = plan_rom(rom, system, companions)
            if not planned:
                continue
            rel, entry = planned
            plans[rel] = entry
            gamelists.setdefault(system, {})[rel] = game_fields(rom)
            media += media_jobs(config, system, rel, rom)

    with locked_state() as state:
        created = removed = 0
        for rel, entry in plans.items():
            created += create_placeholder(root, rel, entry)
            state[rel] = entry
        for rel in [r for r in state if r not in plans]:
            # Only remove placeholders; never delete a game that was downloaded.
            if is_placeholder(root, rel):
                path = os.path.join(root, rel)
                shutil.rmtree(path) if os.path.isdir(path) else os.remove(path)
                removed += 1
            del state[rel]

    for system, entries in gamelists.items():
        write_gamelist(config, system, entries)
    fetched = fetch_media(api, media)
    msg = (f"sync: {len(plans)} games across {len(gamelists)} systems, {created} new placeholders, "
           f"{removed} removed, {fetched}/{len(media)} media files, {time.time() - started:.0f}s")
    log(msg)
    print(msg)


class Progress:
    """zenity progress dialog; degrades to no UI if zenity can't start."""

    def __init__(self, title):
        self.proc = None
        try:
            self.proc = subprocess.Popen(
                ["zenity", "--progress", "--title=RomM", f"--text={title}", "--percentage=0", "--auto-close", "--width=480"],
                stdin=subprocess.PIPE, text=True)
        except OSError:
            pass

    def update(self, pct, text):
        if not self.proc:
            return True
        if self.proc.poll() is not None:
            return False  # dialog closed or cancelled
        try:
            self.proc.stdin.write(f"{int(pct)}\n# {text}\n")
            self.proc.stdin.flush()
        except BrokenPipeError:
            return False
        return True

    def close(self):
        if self.proc and self.proc.poll() is None:
            with contextlib.suppress(BrokenPipeError):
                self.proc.stdin.write("100\n")
                self.proc.stdin.close()
            self.proc.wait(timeout=5)


def error_dialog(text):
    log(f"error: {text}")
    with contextlib.suppress(OSError):
        subprocess.run(["zenity", "--error", "--title=RomM", f"--text={text}", "--width=420"], timeout=120)


def unescape_es_path(arg):
    # ES-DE passes ROM paths with shell-style backslash escapes (e.g. "Legend\ of\ Zelda").
    return re.sub(r"\\(.)", r"\1", arg)


def lookup(config, arg):
    """Map an ES-DE ROM path (the entry itself, or the file launched inside a directory-as-file)."""
    path = os.path.realpath(unescape_es_path(arg))
    root = os.path.realpath(config["rom_root"])
    if not path.startswith(root + os.sep):
        return None, None
    rel = os.path.relpath(path, root)
    with locked_state() as state:
        if rel in state:
            return rel, state[rel]
        parent = os.path.dirname(rel)
        if parent in state:
            return parent, state[parent]
    return None, None


def cmd_fetch(config, arg, name=None):
    rel, entry = lookup(config, arg)
    if not entry or is_downloaded(config, rel, entry):
        return 0
    root = config["rom_root"]
    title = unescape_es_path(name) if name else os.path.splitext(os.path.basename(rel))[0]
    todo = [d for d in entry["downloads"] if not is_complete(root, d)]
    total = sum(d["size"] for d in todo) or 1
    free = shutil.disk_usage(root).free
    if free < total + 512 * 1024**2:
        error_dialog(f"Not enough space on the SD card for {title}: needs {total / 1e9:.1f} GB, {free / 1e9:.1f} GB free.\n"
                     f"Free space with: romm-es free <game>")
        return 1

    api = RomM(load_config())
    ui = Progress(f"Downloading {title}")
    done, started, last = 0, time.time(), 0
    try:
        for d in todo:
            dest = os.path.join(root, d["dest"])
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            rom_id, file_name, file_id = d["url"]
            with api.request(api.content_url(rom_id, file_name, file_id), timeout=120) as resp, open(dest + ".part", "wb") as out:
                while chunk := resp.read(1024 * 1024):
                    out.write(chunk)
                    done += len(chunk)
                    now = time.time()
                    if now - last > 0.5:
                        last = now
                        rate = done / max(now - started, 0.1)
                        eta = (total - done) / rate if rate else 0
                        text = f"{title}\n{done / 1e9:.2f} / {total / 1e9:.2f} GB  ·  {rate / 1e6:.1f} MB/s  ·  {eta / 60:.0f} min left"
                        if not ui.update(done * 100 / total, text):
                            raise KeyboardInterrupt
            os.replace(dest + ".part", dest)
        if entry.get("playlist"):
            launch = os.path.join(root, entry["launch"])
            with open(launch + ".part", "w") as f:
                f.write("\n".join(entry["playlist"]) + "\n")
            os.replace(launch + ".part", launch)
        log(f"fetched {rel} ({total / 1e9:.2f} GB in {time.time() - started:.0f}s)")
        return 0
    except KeyboardInterrupt:
        log(f"cancelled {rel}")
        return 1
    except (urllib.error.URLError, OSError) as e:
        error_dialog(f"Download of {title} failed:\n{e}")
        return 1
    finally:
        ui.close()
        for d in todo:
            with contextlib.suppress(FileNotFoundError):
                os.remove(os.path.join(root, d["dest"]) + ".part")


def cmd_free(config, arg):
    rel, entry = lookup(config, arg)
    if not entry:
        sys.exit(f"not a RomM-managed game: {arg}")
    root = config["rom_root"]
    keep = entry.get("launch", rel)  # the file ES-DE lists stays behind as an empty placeholder
    freed = 0
    for d in entry["downloads"]:
        path = os.path.join(root, d["dest"])
        if os.path.exists(path):
            freed += os.path.getsize(path)
            os.remove(path)
    if entry["kind"] == "dir":
        open(os.path.join(root, keep), "w").close()
    else:
        create_placeholder(root, rel, entry)
    print(f"freed {freed / 1e9:.2f} GB: {rel}")


def cmd_status(config):
    with locked_state() as state:
        items = dict(state)
    downloaded = [rel for rel, e in items.items() if is_downloaded(config, rel, e)]
    size = sum(d["size"] for rel in downloaded for d in items[rel]["downloads"])
    usage = shutil.disk_usage(config["rom_root"])
    print(f"{len(items)} games available, {len(downloaded)} downloaded ({size / 1e9:.1f} GB); "
          f"SD card {usage.free / 1e9:.0f} GB free of {usage.total / 1e9:.0f} GB")
    for rel in sorted(downloaded):
        print("  " + rel)


def cmd_bios(config):
    api = RomM(config)
    copied = skipped = 0
    for platform in api.get("/api/platforms"):
        dirs = BIOS_DIRS.get(platform.get("slug"))
        if not dirs:
            continue
        for fw in platform.get("firmware") or []:
            if not fw.get("is_verified"):
                skipped += 1
                continue
            data = None
            for d in dirs:
                dest = os.path.join(os.path.expanduser(d), fw["file_name"])
                if os.path.exists(dest) and os.path.getsize(dest) == fw["file_size_bytes"]:
                    continue
                if data is None:
                    url = f"/api/firmware/{fw['id']}/content/{urllib.parse.quote(fw['file_name'])}"
                    with api.request(url) as resp:
                        data = resp.read()
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                with open(dest, "wb") as f:
                    f.write(data)
                copied += 1
                print(f"{platform['slug']}: {dest}")
    print(f"bios: {copied} files copied, {skipped} unverified skipped")


def main(argv):
    if len(argv) < 2 or argv[1] not in ("sync", "fetch", "free", "status", "bios"):
        sys.exit(__doc__)
    config = load_config()
    if argv[1] == "sync":
        return cmd_sync(config)
    if argv[1] == "status":
        return cmd_status(config)
    if argv[1] == "bios":
        return cmd_bios(config)
    if len(argv) < 3:
        sys.exit(__doc__)
    if argv[1] == "fetch":
        return cmd_fetch(config, argv[2], argv[3] if len(argv) > 3 else None)
    return cmd_free(config, argv[2])


if __name__ == "__main__":
    sys.exit(main(sys.argv) or 0)
