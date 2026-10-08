#!/usr/bin/env bash
# Galleon cloud environment setup. Runs as root on Ubuntu 24.04 x86_64 before Claude starts.
# Always exits 0. Fast enough (a few minutes) to be cached between sessions.
# Pasted once into the claude.ai/code environment's "Setup script" field (HANDOFF.md);
# this copy is the source of truth, so change it here and paste it again.
set -uo pipefail
log() { echo "[setup] $*"; }
has_node24() { /usr/local/bin/node --version 2>/dev/null | grep -q '^v24\.'; }
start_docker() {
  docker info >/dev/null 2>&1 && return 0
  (dockerd >/var/log/dockerd.log 2>&1 &)
  for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && return 0; sleep 1; done
  return 1
}

# 1. Node 24: the VM ships Node 20-22 and the repository needs 24.
if ! has_node24; then
  base=https://nodejs.org/dist/latest-v24.x
  if curl -fsSL --max-time 30 "$base/SHASUMS256.txt" -o /tmp/node-sums.txt; then
    tarball=$(grep -oE 'node-v24\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz' /tmp/node-sums.txt | head -n1)
    curl -fsSL --max-time 180 "$base/$tarball" -o "/tmp/$tarball" &&
      (cd /tmp && grep " $tarball\$" node-sums.txt | sha256sum -c -) &&
      tar -xJf "/tmp/$tarball" -C /usr/local --strip-components=1 &&
      log "installed $(/usr/local/bin/node --version) from nodejs.org"
  fi
fi
if ! has_node24 && start_docker; then
  log "nodejs.org not reachable; copying Node 24 out of the node:24 image"
  cid=$(docker create node:24-bookworm-slim) &&
    docker cp "$cid:/usr/local/bin/node" /usr/local/bin/node &&
    mkdir -p /usr/local/lib/node_modules && rm -rf /usr/local/lib/node_modules/npm &&
    docker cp "$cid:/usr/local/lib/node_modules/npm" /usr/local/lib/node_modules/ &&
    ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm &&
    ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
  [ -n "${cid-}" ] && docker rm "$cid" >/dev/null 2>&1
fi
echo 'export PATH=/usr/local/bin:$PATH' > /etc/profile.d/00-node24.sh
has_node24 && log "node $(/usr/local/bin/node --version)" || log "WARNING: Node 24 not installed"

# 2. What headless Electron, the app tests and the install-script tests need.
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq && apt-get install -y -qq --no-install-recommends \
  xvfb xauth libgtk-3-0t64 libnss3 libasound2t64 libgbm1 libxss1 libxtst6 \
  libatk-bridge2.0-0t64 libdrm2 libxkbcommon0 libsecret-1-0 \
  imagemagick desktop-file-utils shellcheck >/dev/null || log "some packages failed to install"

# 3. The RomM test stack, pre-pulled so sessions start fast (5.3.1 is pulled on first use).
if start_docker; then
  for image in mariadb:11 rommapp/romm:5.2.0; do
    timeout 150 docker pull -q "$image" >/dev/null && log "pulled $image" || log "could not pull $image"
  done
fi
exit 0
