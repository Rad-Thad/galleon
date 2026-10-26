#!/bin/sh
# Builds the Dreamcast test payload, `galleon-dc-hello.elf`, in this folder from
# main.c with KallistiOS's own compiler wrapper. The toolchain image is pinned
# by digest and the build runs in a fixed folder with the source paths mapped
# away, so nothing of where or when it was built is in the program. Needs
# Docker.
set -eu
here=$(cd -- "$(dirname -- "$0")" && pwd)
image=kazade/dreamcast-sdk@sha256:7202a5d5d007bcb7802c48f1bf30b22d03e337927543b5396130f8420c6f37ec
docker run --rm -v "$here":/src:ro -v "$here":/out -w /tmp/build "$image" bash -euc '
  set +u; . /opt/toolchains/dc/kos/environ.sh; set -u
  cp /src/main.c .
  kos-cc -O2 -Wall -ffile-prefix-map=/tmp/build=. -c main.c -o main.o
  kos-cc -o galleon.elf main.o
  $KOS_STRIP galleon.elf
  cp galleon.elf /out/galleon-dc-hello.elf
'
