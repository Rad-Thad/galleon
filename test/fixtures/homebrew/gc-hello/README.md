# galleon-gc-hello

The GameCube payload of the device check `launch.dolphin` (M1-04): a `.dol`
that draws one line of text and waits.

- `main.c` and `build.sh` are this repository's, under its MIT licence.
- `./build.sh` rebuilds `galleon-gc-hello.dol` with Docker in the devkitPPC
  image it pins by digest; two builds give the same bytes. The committed
  `.dol` is the payload, and new bytes are a new payload (ADR 0008).
- Linked into the program: libogc (https://github.com/devkitPro/libogc, zlib
  licence, with parts under a BSD licence from RTEMS), newlib
  (https://sourceware.org/newlib/, BSD-style licences) and libgcc (GPL-3.0
  with the GCC Runtime Library Exception, which lets the program carry any
  licence). Nothing of it goes in the AppImage.

Why it lives here, and how the manifest pins it: ADR 0008.
