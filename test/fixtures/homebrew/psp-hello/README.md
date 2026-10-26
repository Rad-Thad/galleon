# galleon-psp-hello

The PSP payload of the device check `launch.ppsspp` (M1-05): an EBOOT.PBP
that draws one line of text and waits.

- `main.c` and `build.sh` are this repository's, under its MIT licence.
- `./build.sh` rebuilds `galleon-psp-hello.pbp` with Docker in the pspdev
  image it pins by digest, with PSPSDK's own makefile; two builds give the
  same bytes. The committed `.pbp` is the payload, and new bytes are a new
  payload (ADR 0008).
- Linked into the program, because the toolchain's compiler adds them to
  every program: PSPSDK (https://github.com/pspdev/pspsdk, BSD licence),
  newlib (https://sourceware.org/newlib/, BSD-style licences),
  pthread-embedded (https://github.com/pspdev/pthread-embedded, LGPL-2.1,
  with its PSP port under the MIT licence) and libgcc (GPL-3.0 with the GCC
  Runtime Library Exception, which lets the program carry any licence).
  Nothing of it goes in the AppImage.
- pthread-embedded is linked statically, so the LGPL asks that anyone can
  relink the program with a changed copy of it: `main.c`, `build.sh` and the
  image it pins are everything needed to do that.

Why it lives here, and how the manifest pins it: ADR 0008.
