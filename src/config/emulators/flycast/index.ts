import { shared } from '../savepaths.ts'
import type { EmulatorDescriptor, SandboxContext, SandboxRecipe } from '../types.ts'

/**
 * Flycast started in its sandbox.
 *
 * On Linux Flycast saves `emu.cfg`, VMUs, flash and states in `flycast`
 * under `XDG_CONFIG_HOME` and `XDG_DATA_HOME`, which the sandbox points
 * inside itself (`find_user_config_dir` and `find_user_data_dir` in
 * `core/linux-dist/main.cpp`). It also reads from folders beyond them:
 *
 *  - `emu.cfg` is read from the first config folder that has one, and the
 *    system ones (`/etc/flycast`, `/etc/xdg/flycast` or `XDG_CONFIG_DIRS`)
 *    come after the user's, so the sandbox writes its own, which then
 *    outranks any whose save or VMU paths lead out of the sandbox
 *    (`get_readonly_config_path` in `core/stdclass.cpp`). It sets the window
 *    fullscreen, which Flycast writes back only into that same file.
 *  - A VMU missing from the data folder is looked for in the data and config
 *    folders `XDG_DATA_DIRS` and `XDG_CONFIG_DIRS` name, and one found there
 *    is moved into the data folder and the original deleted (`getVmuPath` in
 *    `core/oslib/oslib.cpp`, `maple_sega_vmu` in `core/hw/maple/maple_devs.cpp`).
 *    Both are removed, so only the XDG defaults are left, which the owner
 *    cannot write to, and a session's own folders, such as flatpak's exports
 *    under `HOME`, are never searched.
 *  - `FLYCAST_BIOS_PATH` adds a BIOS folder, so it is removed too, and the
 *    sandbox's copies of the owner's files are found where Flycast looks
 *    first: its data folder.
 *
 * Without `dc_boot.bin` Flycast boots the game through its HLE BIOS, and a
 * first start opens no window before the game, since the config folder is
 * always set on Linux (`flycast_init` in `core/nullDC.cpp`).
 *
 * A flatpak is never started by the self-test, so only the program on PATH
 * gets here.
 */
function sandboxRecipe(ctx: SandboxContext): SandboxRecipe | null {
  if (ctx.installKind !== 'binary') return null
  return {
    args: [],
    env: {},
    unset: ['XDG_DATA_DIRS', 'XDG_CONFIG_DIRS', 'FLYCAST_BIOS_PATH'],
    needs: [],
    strays: [],
    bios: 'data/flycast',
    needsBios: false,
    files: [{ path: 'config/flycast/emu.cfg', content: '[window]\nfullscreen = yes\n' }]
  }
}

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
  sandbox: sandboxRecipe,
  launchFiles: undefined
}
