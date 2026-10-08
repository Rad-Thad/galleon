#!/bin/sh
# Installs the Galleon device bridge for the current user on armadaOS.
#
#   sh install.sh --repo <owner>/<repo>   first install: files, config, deploy key, timer
#   sh install.sh                         reinstall the files, keep config and key
#   sh install.sh --update                used by the bridge itself: replace the files,
#                                         check the new copy starts, else restore the old
#   sh install.sh --uninstall [--purge]   stop the timer and remove the files
#                                         (--purge also removes config, key and state)
#
# Writes only under ~/.local and ~/.config: /usr is read-only on armadaOS and nothing
# here needs root.
set -eu

src=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
lib="$HOME/.local/lib/galleon-device-bridge"
bin="$HOME/.local/bin"
units="$HOME/.config/systemd/user"
conf="$HOME/.config/galleon-device-bridge"
state="$HOME/.local/state/galleon-device-bridge"
github_key='github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl'

mode=install
repo=
purge=
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) repo=${2:?--repo needs <owner>/<repo>}; shift 2 ;;
    --update) mode=update; shift ;;
    --uninstall) mode=uninstall; shift ;;
    --purge) purge=1; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

copy_files() {
  mkdir -p "$lib" "$bin" "$units"
  cp "$src/galleon_device_bridge.py" "$lib/galleon_device_bridge.py"
  [ -f "$src/VERSION.json" ] && cp "$src/VERSION.json" "$lib/VERSION.json"
  cp "$src/galleon-device-bridge" "$bin/galleon-device-bridge"
  chmod 755 "$bin/galleon-device-bridge"
  cp "$src/systemd/galleon-device-bridge.service" "$units/"
  cp "$src/systemd/galleon-device-bridge.timer" "$units/"
}

case "$mode" in
  uninstall)
    systemctl --user disable --now galleon-device-bridge.timer 2>/dev/null || true
    rm -f "$units/galleon-device-bridge.service" "$units/galleon-device-bridge.timer" \
      "$bin/galleon-device-bridge"
    rm -rf "$lib"
    systemctl --user daemon-reload || true
    if [ -n "$purge" ]; then rm -rf "$conf" "$state"; fi
    echo "Removed. Test folders in ~/galleon-device-tests were left; delete them by hand if wanted."
    exit 0
    ;;
  update)
    # The previous copy is kept until the new one has started once.
    rm -rf "$lib.previous"
    [ -d "$lib" ] && cp -R "$lib" "$lib.previous"
    copy_files
    if ! "$bin/galleon-device-bridge" status >/dev/null 2>&1; then
      echo "new bridge does not start; restoring the previous copy" >&2
      rm -rf "$lib"
      mv "$lib.previous" "$lib"
      exit 1
    fi
    systemctl --user daemon-reload || true
    exit 0
    ;;
esac

copy_files

mkdir -p "$conf"
chmod 700 "$conf"
if [ ! -f "$conf/config" ]; then
  [ -n "$repo" ] || { echo "first install needs --repo <owner>/<repo>" >&2; exit 2; }
  sed "s#^REPO=.*#REPO=$repo#" "$src/config.example" > "$conf/config"
fi
if [ ! -f "$conf/deploy_key" ]; then
  ssh-keygen -q -t ed25519 -N '' -C galleon-device-bridge -f "$conf/deploy_key"
fi
chmod 600 "$conf/deploy_key"
printf '%s\n' "$github_key" > "$conf/known_hosts"
[ -f "$conf/redact" ] || : > "$conf/redact"
chmod 600 "$conf/redact"

systemctl --user daemon-reload
systemctl --user enable --now galleon-device-bridge.timer

cat <<EOF
Installed. Register $conf/deploy_key.pub as a deploy key WITH WRITE ACCESS,
from a machine where gh is signed in as the repository owner:

  gh repo deploy-key add <copy of deploy_key.pub> --repo <owner>/<repo> --allow-write \
    --title "Galleon device bridge (Nova)"

Public key: $(cat "$conf/deploy_key.pub")

Then check everything with: galleon-device-bridge doctor
EOF
