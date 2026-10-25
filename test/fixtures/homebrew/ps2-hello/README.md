# galleon-ps2-hello

The PS2 payload of the device check `launch.armsx2` (M1-03): a disc whose
`SYSTEM.CNF` boots `GALLEON.ELF`, which draws one line of text and waits.

- `main.c` and `Makefile` are this repository's, under its MIT licence.
- `./build.sh` rebuilds `galleon-ps2-hello.iso` with Docker in the ps2dev
  toolchain image it pins. The image's `make` and `xorriso` come from its
  package mirror unpinned, so a rebuild can give other bytes; the committed
  ISO is the payload, and new bytes are a new payload (ADR 0008).
- Linked into the program: ps2sdk (https://github.com/ps2dev/ps2sdk, Academic
  Free License v2.0), newlib (https://sourceware.org/newlib/, BSD-style
  licences) and libgcc (GPL-3.0 with the GCC Runtime Library Exception, which
  lets the program carry any licence). Nothing of it goes in the AppImage.

Why it lives here, and how the manifest pins it: ADR 0008.
