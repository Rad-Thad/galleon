#!/usr/bin/env bash
#
# The start of every session (CLAUDE.md, "Session ritual"): the right Node,
# dependencies as the lockfile names them, Electron's binary, Docker and the
# RomM test stack, a smoke test, and what the Nova last said.
#
# Idempotent and quick the second time: each step looks before it acts, so a
# session that runs it again pays only for the checks. Each failure says what
# is wrong and what fixes it, rather than ending on a stack trace.
#
# The functions are also read by scripts/agent/init.test.ts, which is why the
# work happens in `main` and only when this file is run rather than sourced.
set -euo pipefail

# Builtins only, up to `main`: scripts/agent/init.test.ts sources this with a
# PATH that holds nothing but the commands it is testing.
ROOT="$(cd "${BASH_SOURCE[0]%/*}/../.." && pwd)"

step() { echo "==> $*"; }
fail() {
  echo "init.sh: $*" >&2
  exit 1
}

# Node 24, which package.json asks for. The cloud VM installs it under
# /usr/local/bin beside an older system Node, so that goes first on PATH.
# `GALLEON_NODE_DIR` names another such place, which is how the test of a
# machine without one is a machine without one.
check_node() {
  local preferred="${GALLEON_NODE_DIR:-/usr/local/bin}"
  if [ -x "$preferred/node" ] && [[ "$("$preferred/node" --version 2>/dev/null)" == v24.* ]]; then
    PATH="$preferred:$PATH"
  fi
  local version
  version=$(node --version 2>/dev/null || true)
  case "$version" in
    v24.*) step "node $version" ;;
    '') fail "Node 24 is needed and there is no node on PATH. Install Node 24 (docs/cloud-environment-setup.sh does it on the cloud VM)." ;;
    *) fail "Node 24 is needed and this is Node $version. Put Node 24 first on PATH (export PATH=/usr/local/bin:\$PATH on the cloud VM)." ;;
  esac
}

# Docker, for the RomM test stack.
check_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    fail 'Docker is not installed, and the RomM test stack needs it. Install Docker, or run docs/cloud-environment-setup.sh on the cloud VM.'
  fi
  if ! docker info >/dev/null 2>&1; then
    fail 'Docker is installed but its daemon is not answering. Start it (dockerd, or systemctl start docker) and run this again.'
  fi
  step 'docker is answering'
}

# `npm ci` only when the lockfile has changed since the last one. The stamp
# lives inside node_modules, so deleting node_modules is also a reinstall.
install_dependencies() {
  local stamp="$ROOT/node_modules/.galleon-lockfile.sha256"
  local want
  want=$(sha256sum "$ROOT/package-lock.json" | cut -d' ' -f1)
  if [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$want" ]; then
    step 'dependencies match package-lock.json'
    return
  fi
  step 'npm ci (package-lock.json changed)'
  (cd "$ROOT" && npm ci)
  echo "$want" > "$stamp"
}

# Electron's binary, which `npm ci` does not fetch (see CONTRIBUTING.md).
install_electron() {
  if [ -f "$ROOT/node_modules/electron/path.txt" ] &&
    [ -x "$ROOT/node_modules/electron/dist/$(cat "$ROOT/node_modules/electron/path.txt")" ]; then
    step 'electron binary present'
    return
  fi
  step 'npx install-electron'
  (cd "$ROOT" && npx install-electron)
}

# Wait until RomM answers its heartbeat, or say that it never did. The deadline
# is generous: a first start migrates an empty database.
wait_for_romm() {
  local url=$1 deadline=$2
  local until=$((SECONDS + deadline))
  while [ "$SECONDS" -lt "$until" ]; do
    if curl -fsS --max-time 5 "$url/api/heartbeat" >/dev/null 2>&1; then
      step "RomM is answering at $url"
      return
    fi
    sleep 2
  done
  fail "RomM never reported healthy at $url within ${deadline}s. Look at: docker compose -f test/romm/compose.yml logs"
}

# The RomM test stack (test/romm/, M0-06): up, healthy and provisioned. Until
# that milestone lands there is nothing to start, and saying so is the step.
start_romm() {
  local compose="$ROOT/test/romm/compose.yml"
  if [ ! -f "$compose" ]; then
    step 'RomM test stack: not built yet (M0-06), skipped'
    return
  fi
  step 'RomM 5.2.0 up'
  docker compose -f "$compose" --profile v520 up -d
  wait_for_romm "${GALLEON_ROMM_URL:-http://127.0.0.1:3000}" "${GALLEON_ROMM_TIMEOUT:-240}"
  (cd "$ROOT" && node test/romm/provision.mjs --profile v520)
}

# The cheapest proof that the install is usable: the unit tests' resolver
# loads and Electron reports the version package.json pinned.
smoke_test() {
  local want got
  want=$(node -p "require('$ROOT/node_modules/electron/package.json').version")
  # --no-sandbox only for the version query: the VM runs as root, and Chromium
  # refuses root with its sandbox on. Nothing is drawn.
  got=$("$ROOT/node_modules/electron/dist/electron" --no-sandbox --version 2>/dev/null || true)
  [ "$got" = "v$want" ] || fail "Electron says '$got' where package.json pins $want. Run npx install-electron."
  step "smoke test: electron $got"
}

# What the Nova last said. Read before choosing work (CLAUDE.md, "Device
# results first"); before M0-23 there is no summary script, so the raw files.
device_results() {
  step 'device results'
  if ! (cd "$ROOT" && git fetch -q origin device-results 2>/dev/null); then
    echo 'no device results yet'
    return
  fi
  if [ -f "$ROOT/scripts/agent/device-results.mjs" ]; then
    (cd "$ROOT" && node scripts/agent/device-results.mjs --summary)
    return
  fi
  local file
  for file in results/latest.json bridge/status.json; do
    echo "--- origin/device-results:$file"
    (cd "$ROOT" && git show "origin/device-results:$file" 2>/dev/null) || echo '(not there yet)'
  done
}

main() {
  check_node
  check_docker
  install_dependencies
  install_electron
  start_romm
  smoke_test
  device_results
  echo "init.sh: ready (${SECONDS}s)"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
