#!/bin/sh
# Builds the PS2 test payload, `galleon-ps2-hello.iso`, in this folder: the
# program in main.c on a disc whose SYSTEM.CNF boots it, the shape a PS2 game
# has. The toolchain image is pinned by digest and the disc's dates come from
# SOURCE_DATE_EPOCH, so nothing of when it was built is on the disc. The
# image's packages are not pinned, so the committed ISO stays the payload
# (ADR 0008). Needs Docker and network access for those packages.
set -eu
here=$(cd -- "$(dirname -- "$0")" && pwd)
image=ghcr.io/ps2dev/ps2dev@sha256:5476fdfbf34d35eb644fde0a6f6533fb554a4a8171ce53dad7cd1df6077dfb05
epoch=1767225600
proxy=${https_proxy:-${HTTPS_PROXY:-}}
ca=
[ -f /root/.ccr/ca-bundle.crt ] && ca="-v /root/.ccr/ca-bundle.crt:/etc/ssl/certs/ca-certificates.crt:ro"
# shellcheck disable=SC2086
docker run --rm --network host ${proxy:+-e https_proxy=$proxy -e http_proxy=$proxy} $ca \
  -e SOURCE_DATE_EPOCH=$epoch -v "$here":/src:ro -v "$here":/out -w /tmp \
  "$image" sh -euc '
    apk add --no-cache make xorriso >/dev/null
    cp /src/main.c /src/Makefile .
    make >/dev/null
    mkdir disc
    cp GALLEON.ELF disc/
    printf "BOOT2 = cdrom0:\\\\GALLEON.ELF;1\r\nVER = 1.00\r\nVMODE = NTSC\r\n" >disc/SYSTEM.CNF
    touch -d "@$SOURCE_DATE_EPOCH" disc/* disc
    xorriso -as mkisofs -quiet -iso-level 1 -V GALLEON -sysid PLAYSTATION \
      -o /out/galleon-ps2-hello.iso disc
  '
