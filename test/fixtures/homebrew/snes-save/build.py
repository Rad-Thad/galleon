#!/usr/bin/env python3
"""Writes the SNES test payload, galleon-snes-save.sfc, beside this script.

A 128 KiB LoROM cartridge with 2 KiB of battery-backed SRAM. On reset it
copies MESSAGE into the start of SRAM, turns the backdrop green and shows it,
then waits forever, so an emulator that keeps cartridge saves writes one.
The program is assembled here by hand: it is a few dozen bytes, and no
toolchain means nothing to pin and nothing else's licence inside it.
"""
import pathlib
import struct

ROM_SIZE = 0x20000
MESSAGE = b"GALLEON SAVE TEST"
TITLE = b"GALLEON SAVE TEST"

# 65816, with the ROM's first byte at $00:8000 (LoROM). Each line is one
# instruction; the comments are the assembly it stands for.
def program(message_at: int) -> bytes:
    lo, hi = message_at & 0xFF, message_at >> 8
    code = [
        b"\x78",              # sei
        b"\x18",              # clc
        b"\xfb",              # xce            native mode, 8-bit A and X
        b"\xa9\x8f",          # lda #$8f
        b"\x8d\x00\x21",      # sta $2100      screen off while setting up
        b"\x9c\x21\x21",      # stz $2121      palette entry 0, the backdrop
        b"\xa9\xe0",          # lda #$e0
        b"\x8d\x22\x21",      # sta $2122
        b"\xa9\x03",          # lda #$03
        b"\x8d\x22\x21",      # sta $2122      green, $03e0
        b"\xa2\x00",          # ldx #$00
        # copy:
        bytes([0xBD, lo, hi]),          # lda message,x
        b"\x9f\x00\x00\x70",            # sta $700000,x  SRAM's first bank
        b"\xe8",                        # inx
        bytes([0xE0, len(MESSAGE)]),    # cpx #len
        b"\xd0\xf4",                    # bne copy
        b"\xa9\x0f",          # lda #$0f
        b"\x8d\x00\x21",      # sta $2100      screen on, full brightness
        b"\x80\xfe",          # forever: bra forever
    ]
    return b"".join(code)

def build() -> bytes:
    rom = bytearray(ROM_SIZE)
    first = program(0)
    message_at = 0x8000 + len(first)
    code = program(message_at)
    assert len(code) == len(first)
    rti_at = 0x8000 + len(code) + len(MESSAGE)
    rom[0 : len(code)] = code
    rom[len(code) : len(code) + len(MESSAGE)] = MESSAGE
    rom[rti_at - 0x8000] = 0x40  # rti, for every interrupt vector

    header = 0x7FC0
    rom[header : header + 21] = TITLE.ljust(21, b" ")
    rom[header + 0x15] = 0x20  # LoROM
    rom[header + 0x16] = 0x02  # ROM, RAM and battery
    rom[header + 0x17] = 0x07  # 128 KiB of ROM; snes9x reads a smaller size as a corrupt header
    rom[header + 0x18] = 0x01  # 2 KiB of SRAM
    rom[header + 0x19] = 0x01  # North America
    rom[header + 0x1A] = 0x00
    rom[header + 0x1B] = 0x00  # version
    for vector in range(0x7FE4, 0x8000, 2):
        struct.pack_into("<H", rom, vector, rti_at)
    struct.pack_into("<H", rom, 0x7FFC, 0x8000)  # reset, emulation mode

    struct.pack_into("<HH", rom, header + 0x1C, 0xFFFF, 0x0000)
    checksum = sum(rom) & 0xFFFF
    struct.pack_into("<HH", rom, header + 0x1C, checksum ^ 0xFFFF, checksum)
    return bytes(rom)

if __name__ == "__main__":
    out = pathlib.Path(__file__).resolve().parent / "galleon-snes-save.sfc"
    out.write_bytes(build())
