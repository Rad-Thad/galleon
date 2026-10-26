# galleon-snes-save

The SNES payload of the device check `launch.retroarch` (M1-08): a 128 KiB
LoROM cartridge with 2 KiB of battery-backed SRAM. On reset it copies the text
`GALLEON SAVE TEST` into the start of its SRAM, shows a green screen and
waits, so RetroArch leaves an `.srm` holding that text when the game is
closed.

- `build.py` and the program it writes are this repository's, under its MIT
  licence. Nothing else is linked in: the program is a few dozen bytes of
  65816 assembled by hand in `build.py`, each instruction beside the assembly
  it stands for, so there is no toolchain to pin.
- `python3 -I build.py` rewrites `galleon-snes-save.sfc` beside it, with the
  header's checksum filled in; two builds give the same bytes. The committed
  `.sfc` is the payload, and new bytes are a new payload (ADR 0008).
- The header asks for ROM, RAM and battery (cartridge type `$02`) with 2 KiB
  of SRAM (`$01`), which is what makes a libretro core expose save memory and
  RetroArch write it to `<name>.srm` in its save folder. The ROM is 128 KiB,
  most of it zeros, because snes9x reads a smaller size in the header as a
  corrupt one.

Why it lives here, and how the manifest pins it: ADR 0008.
