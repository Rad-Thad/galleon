import { shared } from '../savepaths.ts'
import type { EmulatorDescriptor, SandboxContext, SandboxRecipe } from '../types.ts'

/**
 * PPSSPP started in its sandbox.
 *
 * On Linux PPSSPP keeps its whole memory stick, settings, saves, states and
 * caches included, in `ppsspp` under `XDG_CONFIG_HOME`, which the sandbox
 * already points inside itself; nothing beside the program or under `HOME`
 * outranks it (`NativeInit` in `UI/NativeApp.cpp`). A first start opens no
 * window of its own before the game, so no settings file is written either.
 *
 * A flatpak is never started by the self-test, so only the program on PATH
 * gets here.
 */
function sandboxRecipe(ctx: SandboxContext): SandboxRecipe | null {
  if (ctx.installKind !== 'binary') return null
  return {
    args: [],
    env: {},
    unset: [],
    needs: [],
    strays: [],
    bios: null,
    needsBios: false,
    files: []
  }
}

/**
 * PPSSPP — the PlayStation Portable emulator, and what armadaOS's catalog
 * installs for it, from Flathub.
 *
 *  - The flatpak is tried first, as the catalog's route; a `PPSSPPSDL` or
 *    `ppsspp` on PATH is the user's own.
 *  - It needs **no BIOS**: PPSSPP emulates the PSP's firmware itself.
 *  - Its saves are one folder per game under `PSP/SAVEDATA`, and its states
 *    sit in `PSP/PPSSPP_STATE`, both named after the game id inside the disc
 *    image rather than the ROM, so nothing in them can be paired with a ROM
 *    from outside the emulator. Neither is synced.
 *
 * It keeps everything in its config folder (`~/.config/ppsspp`), which the
 * flatpak build takes inside its own tree.
 *
 * Flags are read from PPSSPP at the commit docs/research/armada_integration.md
 * pins (13c1773b): `Core/CmdLine.cpp` lists `--fullscreen` and
 * `--pause-menu-exit`, and takes the first argument not beginning with a dash
 * as the file to boot (`CommandLineOptions::Parse`); `UI/NativeApp.cpp` boots
 * it straight into the game (`NativeInit`).
 */
export const ppsspp: EmulatorDescriptor = {
  id: 'ppsspp',
  name: 'PPSSPP',
  dispatch: 'rommix',
  install: [
    { kind: 'flatpak', appId: 'org.ppsspp.PPSSPP' },
    { kind: 'binary', names: ['PPSSPPSDL', 'ppsspp'] }
  ],
  findRule: 'PPSSPP',
  homepage: 'https://www.ppsspp.org',
  systems: ['psp'],
  variants: undefined,
  ownsLibrary: false,
  dirs: {
    // PPSSPP's game list is the folder the user browses to; RomMix's own
    // folder is the honest answer.
    roms: { base: 'library', path: '' },
    saves: { base: 'config', path: 'ppsspp/PSP/SAVEDATA' }
    // No `states`: a state is named after the game id, which nothing here can
    // pair with a ROM. No `bios`: PPSSPP needs none.
  },
  // Fixed by PPSSPP's config folder; nothing here reads its settings file.
  layout: undefined,
  // Games are booted by path, so a game in a folder of its own keeps it.
  flatLibrary: false,
  needsRomFolders: false,
  saves: (ctx) => ({
    saves: ctx.paths.saves ? shared(ctx.paths.saves) : null,
    states: null,
    unsyncableReason: 'saves.ppsspp'
  }),
  bios: undefined,
  biosStagingNote: undefined,
  core: undefined,
  setupNotes: [],
  env: undefined,
  // `exec` alone opens PPSSPP's game browser.
  open: undefined,
  /**
   * Fullscreen for this start only (PPSSPP keeps both flags out of its saved
   * settings), so its window does not open over RomMix's, and the
   * pause menu's "Exit to menu" made "Exit", so leaving the game ends the
   * process — which is how RomMix knows the game is over — instead of
   * stopping in PPSSPP's own browser. PPSSPP has no `--` to end its options;
   * the ROM path is absolute, so it never begins with a dash.
   */
  launch: ({ exec, romPath }) => [...exec, '--fullscreen', '--pause-menu-exit', romPath],
  sandbox: sandboxRecipe,
  launchFiles: undefined,
  settingsEdits: undefined
}
