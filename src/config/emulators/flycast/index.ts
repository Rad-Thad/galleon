import { shared } from '../savepaths.ts'
import type { EmulatorDescriptor } from '../types.ts'

/**
 * Flycast — the Dreamcast emulator, and what armadaOS's catalog installs for
 * it, from Flathub.
 *
 *  - The flatpak is tried first, as the catalog's route; a `flycast` on PATH
 *    is the user's own.
 *  - It runs with or without a **BIOS**: `dc_boot.bin` is looked for in its
 *    data folder, and without it Flycast boots games through its own HLE
 *    BIOS. It reads and writes the flash there as `dc_nvmem.bin`, so a
 *    `dc_flash.bin` (the libretro core's name) placed beside it is kept but
 *    not read.
 *  - Its VMU memory cards are **shared** by every game unless the user turns
 *    on per-game VMUs, so nothing in them can be attributed to one ROM, and
 *    they are not synced. Its states stay on the device.
 *
 * It follows the XDG layout (`~/.local/share/flycast` for data,
 * `~/.config/flycast` for `emu.cfg`), which the flatpak build takes inside
 * its own tree.
 *
 * The command line is read from Flycast at the commit
 * docs/research/armada_integration.md pins (0d9853df): `core/cfg/cl.cpp`
 * (`parseCommandLine` takes the first argument not beginning with a dash as
 * the content, `.chd`, `.cdi`, `.gdi` and `.cue` alike), `core/ui/gui.cpp`
 * (content given on the command line starts at once, and the pause menu's
 * button then reads "Exit" and ends the process) and `core/oslib/oslib.cpp`
 * (`findFlash` falls back to the data folder for the BIOS files) and
 * `core/hw/flashrom/nvmem.cpp` (the `dc_` prefix and the file names).
 */
export const flycast: EmulatorDescriptor = {
  id: 'flycast',
  name: 'Flycast',
  dispatch: 'rommix',
  install: [
    { kind: 'flatpak', appId: 'org.flycast.Flycast' },
    { kind: 'binary', names: ['flycast'] }
  ],
  findRule: 'FLYCAST',
  homepage: 'https://github.com/flyinghead/flycast',
  systems: ['dreamcast'],
  variants: undefined,
  ownsLibrary: false,
  dirs: {
    // Flycast's game list is the folders the user adds; RomMix's own folder is
    // the honest answer.
    roms: { base: 'rommix', path: 'roms' },
    saves: { base: 'data', path: 'flycast' },
    bios: { base: 'data', path: 'flycast' }
    // No `states`: Flycast keeps them loose in its data folder beside the
    // VMUs and the BIOS, and they stay on the device.
  },
  // Fixed by the XDG layout; nothing here reads Flycast's `emu.cfg`.
  layout: undefined,
  // Games are booted by path, so a `.gdi` keeps the folder holding its tracks.
  flatLibrary: false,
  needsRomFolders: false,
  saves: (ctx) => ({
    saves: ctx.paths.saves ? shared(ctx.paths.saves) : null,
    states: null,
    unsyncableReason: 'saves.flycastStandalone'
  }),
  // Both dumps go where Flycast looks once its own BIOS paths come up empty.
  bios: ({ paths }) => paths.bios,
  biosStagingNote: undefined,
  core: undefined,
  setupNotes: [],
  env: undefined,
  // `exec` alone opens Flycast's game list.
  open: undefined,
  /**
   * The content alone. Started that way Flycast's pause menu exits rather
   * than returning to its game list, so the process ending is how RomMix
   * knows the game is over. No fullscreen setting is passed: Flycast writes
   * its window's state back into `emu.cfg` when the window closes
   * (`sdl_window_destroy` in `core/sdl/sdl.cpp`), so even a transient
   * `-config window:fullscreen` would change the user's own setting, and in
   * Game Mode gamescope shows the window full screen anyway. Flycast has no
   * `--` to end its options; the ROM path is absolute, so it never begins
   * with a dash.
   */
  launch: ({ exec, romPath }) => [...exec, romPath],
  sandbox: undefined
}
