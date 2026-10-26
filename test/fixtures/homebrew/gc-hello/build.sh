#!/bin/sh
# Builds the GameCube test payload, `galleon-gc-hello.dol`, in this folder from
# main.c. The toolchain image is pinned by digest and the build runs in a fixed
# folder with the source paths mapped away, so nothing of where or when it was
# built is in the program. Needs Docker.
set -eu
here=$(cd -- "$(dirname -- "$0")" && pwd)
image=devkitpro/devkitppc@sha256:d50f8a886f2ce1d3c22685a774afb0845379876b47d9b41a9b729f4f63a54813
docker run --rm -v "$here":/src:ro -v "$here":/out -w /tmp "$image" sh -euc '
  ogc=$DEVKITPRO/libogc
  cp /src/main.c .
  $DEVKITPPC/bin/powerpc-eabi-gcc -mogc -mcpu=750 -meabi -mhard-float -O2 \
    -ffile-prefix-map=/tmp=. -I"$ogc/include" main.c \
    -L"$ogc/lib/cube" -logc -lm -o galleon.elf
  $DEVKITPRO/tools/bin/elf2dol galleon.elf /out/galleon-gc-hello.dol
'
