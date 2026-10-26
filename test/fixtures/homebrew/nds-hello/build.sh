#!/bin/sh
# Builds the Nintendo DS test payload, `galleon-nds-hello.nds`, in this folder
# from main.c with BlocksDS's own makefile. The toolchain image is pinned by
# digest and the build runs in a fixed folder with the source paths mapped
# away, so nothing of where or when it was built is in the program. Needs
# Docker.
set -eu
here=$(cd -- "$(dirname -- "$0")" && pwd)
image=skylyrac/blocksds@sha256:b87c4831d685e9909125289569765c74c6330b57ad7c77a8866fd8d5e1e1c752
docker run --rm -v "$here":/src:ro -v "$here":/out -w /tmp/build "$image" sh -euc '
  cp /src/main.c /src/Makefile /src/icon.bmp .
  make DEFINES=-ffile-prefix-map=/tmp/build=.
  cp galleon-nds-hello.nds /out/galleon-nds-hello.nds
'
