# galleon-dc-hello

The Dreamcast payload of the device check `launch.flycast` (M1-06): an ELF
that draws one line of text in the BIOS font and waits.

- `main.c` and `build.sh` are this repository's, under its MIT licence.
- `./build.sh` rebuilds `galleon-dc-hello.elf` with Docker in the
  KallistiOS image it pins by digest (KallistiOS at 5e89c26a), with
  KallistiOS's own `kos-cc`; two builds give the same bytes. The committed
  `.elf` is the payload, and new bytes are a new payload (ADR 0008).
- Flycast starts an `.elf` itself, through its HLE BIOS, which also carries
  the font the program draws with (`core/emulator.cpp` and
  `core/reios/reios.cpp` at 0d9853df), so no disc image and no BIOS file is
  needed.
- Linked into the program, because `kos-cc` adds them to every program:
  KallistiOS (https://github.com/KallistiOS/KallistiOS, the KOS License, a
  BSD-3-Clause licence, with parts under other BSD-style licences and Doug
  Lea's public-domain malloc), newlib (https://sourceware.org/newlib/,
  BSD-style licences) and libgcc (GPL-3.0 with the GCC Runtime Library
  Exception, which lets the program carry any licence). Nothing of it goes in
  the AppImage.

KallistiOS's licence asks that its notice travel with the program in binary
form, so it is here:

```text
Copyright (C) 1997-2024 KallistiOS Contributors. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:
1. Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in the
   documentation and/or other materials provided with the distribution.
3. Neither the name of Cryptic Allusion nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE AUTHORS AND CONTRIBUTORS ``AS IS'' AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED.  IN NO EVENT SHALL THE AUTHORS OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS
OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY
OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
SUCH DAMAGE.
```

Why it lives here, and how the manifest pins it: ADR 0008.
