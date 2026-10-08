#!/usr/bin/env python3
"""Pair this device with a RomM server using RomM's device-auth flow.

Prints the user code to approve in the RomM web UI, then polls until the
request is approved and stores the resulting client token in the config.
"""
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request

CONFIG_DIR = os.path.expanduser("~/.config/romm-es")
CONFIG_PATH = os.path.join(CONFIG_DIR, "config.json")
SCOPES = [
    "me.read",
    "platforms.read",
    "roms.read",
    "roms.user.read",
    "roms.user.write",
    "collections.read",
    "firmware.read",
    "assets.read",
    "assets.write",
    "devices.read",
    "devices.write",
]


def post(url, payload):
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.status, json.load(resp)


def device_identifier():
    with open("/etc/machine-id") as f:
        return hashlib.sha256(("romm-es:" + f.read().strip()).encode()).hexdigest()[:32]


def main():
    server = sys.argv[1].rstrip("/")
    _, init = post(f"{server}/api/auth/device/init", {
        "client_device_identifier": device_identifier(),
        "name": "Retroid Pocket Nova (Armada)",
        "client": "romm-es",
        "platform": "armada-linux-aarch64",
        "client_version": "0.1.0",
        "requested_scopes": SCOPES,
    })
    print(f"USER_CODE={init['user_code']}", flush=True)
    print(f"APPROVE_URL={server}{init['verification_path_complete']}", flush=True)

    deadline = time.time() + init["expires_in"]
    interval = max(init.get("interval", 5), 3)
    while time.time() < deadline:
        time.sleep(interval)
        try:
            _, token = post(f"{server}/api/auth/device/token", {"device_code": init["device_code"]})
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")
            if e.code == 429 or "slow_down" in body:
                interval += 5
                continue
            if any(word in body.lower() for word in ("denied", "expired", "invalid", "not found")):
                print(f"PAIR_FAILED http={e.code} body={body[:300]}", flush=True)
                return 1
            # Anything else (e.g. authorization_pending) means keep waiting.
            continue

        os.makedirs(CONFIG_DIR, mode=0o700, exist_ok=True)
        config = {}
        if os.path.exists(CONFIG_PATH):
            with open(CONFIG_PATH) as f:
                config = json.load(f)
        config.update({
            "server": server,
            "token": token["access_token"],
            "device_id": token["device_id"],
            "scopes": token["scopes"],
            "expires_at": token.get("expires_at"),
        })
        fd = os.open(CONFIG_PATH, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(config, f, indent=2)
        print(f"PAIRED device_id={token['device_id']} scopes={','.join(token['scopes'])} expires_at={token.get('expires_at')}", flush=True)
        return 0

    print("PAIR_EXPIRED", flush=True)
    return 1


if __name__ == "__main__":
    sys.exit(main())
