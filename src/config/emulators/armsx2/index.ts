import { shared } from '../savepaths.ts'
import type { EmulatorDescriptor, SandboxContext, SandboxRecipe } from '../types.ts'

/**
 * The track a disc's descriptor names, for a `.cue`.
 *
 * Armada's ps2 system for ES-DE does not accept `.cue` at all, so on the Nova
 * a cue/bin pair is played from its `.bin`, and the owner's server lists the
 * two as separate games. The `.bin` beside a `.cue` shares its stem; the
 * extension keeps the case the `.cue` was written in, since a folder of
 * `GAME.CUE` holds `GAME.BIN`.
 */
function trackOf(romPath: string): string {
  const match = /\.cue$/i.exec(romPath)
  if (!match) return romPath
  return romPath.slice(0, match.index) + (match[0] === '.CUE' ? '.BIN' : '.bin')
}

/**
 * The settings version ARMSX2 accepts a `PCSX2.ini` at (`SETTINGS_VERSION` in
 * its `pcsx2/VMManager.cpp`).
 */
const SETTINGS_VERSION = 1

/**
 * ARMSX2 started in its sandbox, on a settings file written there.
 *
 * `-datapath` roots everything ARMSX2 keeps (`<path>/ARMSX2`) in the sandbox
 * config, the same folder `XDG_CONFIG_HOME` leads it to, so the sandbox holds
 * whether or not the AppImage's own start script changes the environment. The
 * settings file names the BIOS, memory card and save state folders the sandbox
 * holds. It carries the settings version ARMSX2 expects, because a file
 * without it is reset to defaults and the setup wizard opens in a window of
 * its own; it also says the wizard is done.
 *
 * Portable mode outranks `-datapath`, and ARMSX2 looks for its marker beside
 * the program inside the mounted AppImage, where nothing of the owner's can
 * be. Only the AppImage is started: a binary install would read a marker
 * beside itself, and its layout has not been checked against the recipe.
 */
function sandboxRecipe(ctx: SandboxContext): SandboxRecipe | null {
  if (ctx.installKind !== 'appimage') return null
  const { folders } = ctx
  const settings = [
    '[UI]',
    `SettingsVersion = ${SETTINGS_VERSION}`,
    'SetupWizardIncomplete = false',
    '',
    '[Folders]',
    `Bios = ${folders.bios}`,
    `MemoryCards = ${folders.saves}`,
    `Savestates = ${folders.states}`,
    ''
  ].join('\n')
  return {
    args: ['-datapath', folders.config],
    env: {},
    unset: [],
    needs: [],
    strays: [],
    bios: null,
    needsBios: true,
    files: [{ path: 'config/ARMSX2/inis/PCSX2.ini', content: settings }]
  }
}

/**
 * ARMSX2 — the ARM build of PCSX2, and what armadaOS's catalog installs for
 * PS2.
 *
 *  - The catalog puts it in `~/Applications` as an AppImage, which is the one
 *    way to have it: it is not on Flathub.
 *  - It covers **exactly one system**.
 *  - It needs a **BIOS dump**, which it looks for in its own `bios` folder.
 *  - Its memory cards are **shared** by every game (`Mcd001.ps2`), so nothing
 *    in them can be attributed to one ROM, and its states are named after the
 *    disc's serial and checksum rather than the ROM. Neither is synced.
 *
 * It keeps everything under `~/.config/ARMSX2`, settings in
 * `inis/PCSX2.ini`, whatever the install.
 *
 * Flags and their meanings are read from ARMSX2's `pcsx2-qt/QtHost.cpp` at the
 * commit docs/research/armada_integration.md pins.
 */
export const armsx2: EmulatorDescriptor = {
  id: 'armsx2',
  name: 'ARMSX2',
  dispatch: 'rommix',
  install: [
    {
      kind: 'appimage',
      // The catalog installs it as `ARMSX2.AppImage`; a release keeps the
      // project's name in front of its version and architecture.
      patterns: ['armsx2*.appimage'],
      release: {
        api: 'https://api.github.com/repos/ARMSX2/ARMSX2/releases',
        // Anchored to the Linux AppImages, so the Android and macOS builds on
        // the same page are never offered. The architecture is chosen from
        // the name at download time — see `builtForThisMachine`.
        asset: /^[\w.-]*linux[\w.-]*\.AppImage$/i
      }
    },
    { kind: 'binary', names: ['armsx2-qt', 'armsx2'] }
  ],
  findRule: 'ARMSX2',
  homepage: 'https://github.com/ARMSX2/ARMSX2',
  systems: ['ps2'],
  variants: undefined,
  ownsLibrary: false,
  dirs: {
    // ARMSX2's game list is the folders the user adds; RomMix's own folder is
    // the honest answer.
    roms: { base: 'rommix', path: 'roms' },
    saves: { base: 'config', path: 'ARMSX2/memcards' },
    bios: { base: 'config', path: 'ARMSX2/bios' }
    // No `states`: a state is named after the disc's serial, which nothing
    // here can pair with a game.
  },
  // Fixed by the install; nothing here reads ARMSX2's settings file.
  layout: undefined,
  // Games are booted by path, so a multi-file game keeps its own folder.
  flatLibrary: false,
  needsRomFolders: false,
  saves: (ctx) => ({
    saves: ctx.paths.saves ? shared(ctx.paths.saves) : null,
    states: null,
    unsyncableReason: 'saves.armsx2'
  }),
  // Every dump goes where ARMSX2 looks; it identifies them by content.
  bios: ({ paths }) => paths.bios,
  biosStagingNote: undefined,
  core: undefined,
  setupNotes: [],
  env: undefined,
  // `exec` alone opens ARMSX2's game list.
  open: undefined,
  /**
   * `-batch` so ARMSX2 exits when the game shuts down, `-fullscreen` so it does
   * not open in a window over RomMix's, and `-nogui` so its main window never
   * shows while the game runs. `--` ends the options, so a ROM whose name
   * begins with a dash is still read as the file to boot. A `.cue` is booted
   * from its track — see `trackOf`.
   */
  launch: ({ exec, romPath }) => [
    ...exec,
    '-batch',
    '-fullscreen',
    '-nogui',
    '--',
    trackOf(romPath)
  ],
  sandbox: sandboxRecipe
}
