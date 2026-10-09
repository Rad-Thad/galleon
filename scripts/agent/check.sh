#!/usr/bin/env bash
#
# Everything a push has to pass, run on the VM before every push (CLAUDE.md,
# "Definition of done"): the upstream checks in upstream's order, then the unit
# tests under coverage, which runs them once and holds them to the floors in
# package.json, then the feature list guard, the device bridge's own tests and
# the licence guard.
#
# Stops at the first failure, so the last thing printed is what to fix.
set -euo pipefail

cd "$(dirname "$0")/../.."

# The Node the repository asks for, ahead of whatever the VM ships.
if /usr/local/bin/node --version 2>/dev/null | grep -q '^v24\.'; then
  PATH="/usr/local/bin:$PATH"
fi

step() { echo "==> $*"; }

step 'format:check'
npm run --silent format:check
step 'lint'
npm run --silent lint
step 'typecheck'
npm run --silent typecheck
step 'unit tests, with coverage'
npm run --silent test:coverage
step 'feature list'
if git rev-parse -q --verify origin/main >/dev/null; then
  node scripts/agent/features-check.mjs --base origin/main
else
  node scripts/agent/features-check.mjs
fi
step 'device bridge tests'
python3 -m unittest discover -s tools/device-bridge
step 'licence and dependency guard'
node scripts/agent/licence-guard.mjs >/dev/null

echo 'check.sh: all green'
