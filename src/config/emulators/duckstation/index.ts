import { perRom } from '../savepaths.ts'
import type { EmulatorDescriptor } from '../types.ts'

/**
 * DuckStation — a PlayStation emulator, and what armadaOS's catalog installs
 * for PS1.
 *
 *  - The catalog puts it in `~/Applications` as an AppImage, so that route is
 *    tried first; the Flathub build is the second way to have it.
 *  - It covers **exactly one system**, which is what the per-system pin in
 *    `settings.systemEmulators` is for.
 *  - It needs a **BIOS dump**, which it looks for in its own `bios` folder.
 *  - Its memory cards are **per game** and named after the game —
 *    `Suikoden II_1.mcd` — which the stem matcher pairs with the ROM. The
 *    matcher strips region tags, which is what lets a multi-disc `.m3u` find
 *    the card written under the bare title.
 *
 * It follows the XDG layout (`~/.local/share/duckstation`), which the flatpak
 * build takes inside its own tree.
 *
 * Flags and their meanings are read from duckstation's `qthost.cpp` at the
 * commit docs/research/armada_integration.md pins.
 */
export const duckstation: EmulatorDescriptor = {
  id: 'duckstation',
  name: 'DuckStation',
  dispatch: 'rommix',
  install: [
    {
      kind: 'appimage',
      // The catalog's and the project's own builds are both
      // `DuckStation-<arch>.AppImage`; a copy renamed to drop the arch still
      // starts with the name.
      patterns: ['duckstation*.appimage'],
      release: {
        api: 'https://api.github.com/repos/stenzek/duckstation/releases',
        // Anchored, so the Windows and macOS archives on the same page are
        // never offered. The architecture is chosen from the name at download
        // time — see `builtForThisMachine`.
        asset: /^DuckStation-[\w-]+\.AppImage$/i
      }
    },
    { kind: 'flatpak', appId: 'org.duckstation.DuckStation' },
    { kind: 'binary', names: ['duckstation-qt'] }
  ],
  homepage: 'https://www.duckstation.org',
  systems: ['psx'],
  variants: undefined,
  ownsLibrary: false,
  dirs: {
    // DuckStation has no ROM folder of its own: its game list is the
    // directories the user adds. RomMix's own folder is the honest answer.
    roms: { base: 'rommix', path: 'roms' },
    saves: { base: 'data', path: 'duckstation/memcards' },
    bios: { base: 'data', path: 'duckstation/bios' }
    // No `states`: DuckStation names a state after the disc's serial rather
    // than the ROM, so nothing here could pair one with a game.
  },
  // Fixed by the XDG layout; nothing here reads DuckStation's settings file.
  layout: undefined,
  // One file per game, or an `.m3u` beside its discs: nothing needs a folder.
  flatLibrary: true,
  // Games launch by path; DuckStation's own list is not what RomMix uses.
  needsRomFolders: false,
  saves: (ctx) => ({
    saves: ctx.paths.saves ? perRom(ctx.paths.saves) : null,
    states: null
  }),
  // Every dump goes where DuckStation looks; it identifies them by content.
  bios: ({ paths }) => paths.bios,
  biosStagingNote: undefined,
  // DuckStation is one emulator, not a core loader.
  core: undefined,
  setupNotes: [],
  env: undefined,
  // `exec` alone opens DuckStation's game list.
  open: undefined,
  /**
   * `-batch` so DuckStation exits when the game is powered off, `-fullscreen`
   * so it does not open in a window over RomMix's, and `-nogui` so its main
   * window never shows and it exits on shutdown — the process ending is how
   * RomMix knows the game is over. `--` ends the options, so a ROM whose name
   * begins with a dash is still read as the file to boot.
   */
  launch: ({ exec, romPath }) => [...exec, '-batch', '-fullscreen', '-nogui', '--', romPath]
}
