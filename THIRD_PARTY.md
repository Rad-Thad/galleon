# Third-party code

Code ported into Galleon from other projects, with the licence it came under.
RomMix itself, which Galleon is a fork of, is credited in README.md and LICENSE.

## Grout

- Project: https://github.com/rommapp/grout
- Licence: MIT. Copyright (c) 2025 Brandon T. Kowalski, Grout Contributors.
- Ported: `test/e2e/romm/provision.py` (at e2b31dbcf16d05a8254ddff382b75be59a8b9ea2) to
  `test/romm/provision.mjs`, rewritten in JavaScript with the socket.io scan spoken over
  HTTP polling; `test/e2e/compose.yml`'s disposable MariaDB-on-tmpfs layout informs
  `test/romm/compose.yml`.

Grout's licence:

```
MIT License

Copyright (c) 2025 Brandon T. Kowalski, Grout Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Fonts

Shipped inside the AppImage, from RomMix, under the SIL Open Font License 1.1.
Each licence text sits beside its font.

- Silkscreen (Copyright 2001, The Silkscreen Project Authors):
  `src/renderer/src/assets/fonts/silkscreen-latin.woff2`, licence in `OFL-silkscreen.txt`.
- VT323 (Copyright 2011, The VT323 Project Authors):
  `src/renderer/src/assets/fonts/vt323-latin.woff2`, licence in `OFL-vt323.txt`.

## ES-DE data

None ported yet. ES-DE's MIT data files (system and emulator tables) are listed
here, with the commit they came from and their licence text, by the change that
ports the first of them.

## ES-DE

- Project: https://gitlab.com/es-de/emulationstation-de
- Licence: MIT. Copyright (c) 2024-2026 Northwestern Software AB, (c) 2020-2024 Leon Styhre,
  (c) 2014 Alec Lofquist.
- Vendored unchanged: `resources/systems/linuxarm/es_find_rules.xml` and `es_systems.xml` at
  a8cf738d6805180e07abb82403511254c5433826, in `packaging/es-de/linuxarm/`. `src/main/findrules.ts`
  reads them; no ES-DE code is ported.

ES-DE's licence:

```
Copyright (c) 2024-2026 Northwestern Software AB
Copyright (c) 2020-2024 Leon Styhre
Copyright (c) 2014 Alec Lofquist

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

# Test payloads

Fetched by `scripts/agent/fetch-fixtures.mjs` from the pinned URLs in
`test/fixtures/roms/manifest.json`. Each entry there names its licence and
author. Other projects' homebrew is never committed; our own, built where no
redistributable homebrew exists, is committed beside its source and fetched
from this repository like the rest (ADR 0008). The device test bundle carries
them under `payloads/` with that manifest and this part of the file.

## gba-tests

- Project: https://github.com/jsmolka/gba-tests
- Licence: MIT. Copyright (c) 2019 Julian Smolka.
- Fetched: `ppu/hello.gba` and `save/sram.gba` at
  a7113b67e63f83a9b321696ddd7042ccfad6c881, unmodified.

gba-tests' licence:

```
MIT License

Copyright (c) 2019 Julian Smolka

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## ps2-hello

- Project: https://github.com/Rad-Thad/galleon, `test/fixtures/homebrew/ps2-hello/`
- Licence: MIT, this repository's (see LICENSE). Built here because no
  redistributable PS2 homebrew was found (ADR 0008).
- Fetched: `galleon-ps2-hello.iso` at
  585653d561cdb74b1c4e419d99b52ba0bed8a55e, as committed.
- Linked into its program:
  - ps2sdk, https://github.com/ps2dev/ps2sdk, Academic Free License v2.0.
  - newlib, https://sourceware.org/newlib/, the BSD-style licences listed in
    its `COPYING.NEWLIB`.
  - libgcc, https://gcc.gnu.org/, GPL-3.0 with the GCC Runtime Library
    Exception, which lets the program carry its own licence.
