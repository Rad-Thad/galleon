#!/bin/sh
# Builds the PSP test payload, `galleon-psp-hello.pbp` (an EBOOT.PBP), in this folder from main.c with
# PSPSDK's own makefile. The toolchain image is pinned by digest and the build
# runs in a fixed folder with the source paths mapped away, so nothing of where
# or when it was built is in the program. Needs Docker.
set -eu
here=$(cd -- "$(dirname -- "$0")" && pwd)
image=pspdev/pspdev@sha256:54895e6f5afb71b8f4f6915ee6d5023e1e087ca7afdf2dcb1d7a694a5233e45f
docker run --rm -v "$here":/src:ro -v "$here":/out -w /tmp/build "$image" sh -euc '
  cp /src/main.c .
  cat > Makefile <<"MAKE"
TARGET = galleon
OBJS = main.o
CFLAGS = -O2 -Wall -ffile-prefix-map=/tmp/build=.
LIBS = -lpspdebug -lpspdisplay
EXTRA_TARGETS = EBOOT.PBP
PSP_EBOOT_TITLE = Galleon PSP test payload
PSPSDK = $(shell psp-config --pspsdk-path)
include $(PSPSDK)/lib/build.mak
MAKE
  make
  cp EBOOT.PBP /out/galleon-psp-hello.pbp
'
