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

# Test payloads

Fetched by `scripts/agent/fetch-fixtures.mjs` from the pinned URLs in
`test/fixtures/roms/manifest.json` and never committed. Each entry there names
its licence and author.

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
