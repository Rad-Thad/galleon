#!/usr/bin/env bash
#
# `npm run smoke:app`: the packaged AppImage for this machine's architecture
# starts under Xvfb against the fake RomM, reaches Home and quits — see
# test/app/smoke.ts. Run after `npm run package`; it packages nothing itself,
# so what it proves is the file CI uploads.
#
# `GALLEON_APPIMAGE` names another image to run instead, or the `AppRun` of one
# already extracted, which is how CI runs it (see release.yml).
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -z "${GALLEON_APPIMAGE-}" ]; then
  # electron-builder's spelling of the architecture in `artifactName`.
  case $(uname -m) in
    x86_64) arch=x86_64 ;;
    aarch64) arch=arm64 ;;
    *)
      echo "smoke-app.sh: no AppImage is built for $(uname -m)." >&2
      exit 1
      ;;
  esac
  GALLEON_APPIMAGE="$PWD/dist/Galleon-$arch.AppImage"
fi

if [ ! -x "$GALLEON_APPIMAGE" ]; then
  echo "smoke-app.sh: $GALLEON_APPIMAGE is missing or not executable. Run 'npm run appimage' first." >&2
  exit 1
fi
export GALLEON_APPIMAGE

# The same wrapper and warnings as scripts/test-app.sh, for the same reasons.
exec ./scripts/headless.sh node \
  --import ./scripts/test-resolve.mjs \
  --experimental-transform-types \
  --disable-warning=ExperimentalWarning \
  --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
  --test \
  test/app/smoke.ts
