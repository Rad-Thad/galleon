#!/usr/bin/env bash
#
# `npm run shots:nova`: every screen at the Nova's 1280x960, written to
# artifacts/shots/ with a contact sheet. See test/app/shots.ts.
set -euo pipefail

cd "$(dirname "$0")/.."

npm run build

# The screen at the panel's size, so nothing the window does is measured
# against a television the Nova does not have.
export ROMMIX_SCREEN=1280x960

exec ./scripts/headless.sh node \
  --import ./scripts/test-resolve.mjs \
  --experimental-transform-types \
  --disable-warning=ExperimentalWarning \
  --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
  test/app/shots.ts "$@"
