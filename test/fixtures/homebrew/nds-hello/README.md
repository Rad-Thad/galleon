# galleon-nds-hello

The Nintendo DS payload of the device check `launch.melonds` (M1-07): a ROM
that prints one line of text on the bottom screen and waits.

- `main.c`, `Makefile`, `build.sh` and `icon.bmp` (the banner's icon, a
  plain frame) are this repository's, under its MIT licence.
- `./build.sh` rebuilds `galleon-nds-hello.nds` with Docker in the BlocksDS
  image it pins by digest (BlocksDS 1.13.1, its core at 245a25c3), with
  BlocksDS's own ARM9 ROM makefile; two builds give the same bytes. The
  committed `.nds` is the payload, and new bytes are a new payload (ADR 0008).
- melonDS boots a `.nds` on its own BIOS and firmware, so no BIOS file is
  needed.
- Linked into the program, as the link map shows:
  - libnds (https://github.com/blocksds/libnds, zlib licence), for the ARM9
    side, and BlocksDS's smallest ARM7 program, `arm7_minimal.elf`, which is
    libnds alone, with no Wi-Fi or sound library;
  - BlocksDS's start-up code and linker scripts (https://github.com/blocksds/sdk,
    `sys/crts`, under the zlib licence and the MPL-2.0, whose source form is
    at that address);
  - picolibc (https://github.com/picolibc/picolibc, BSD-style licences) and
    libgcc (GPL-3.0 with the GCC Runtime Library Exception, which lets the
    program carry any licence).
- Nothing of it goes in the AppImage.

Why it lives here, and how the manifest pins it: ADR 0008.
