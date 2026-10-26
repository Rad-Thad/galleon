import { joinPath, shared } from '../savepaths.ts'
import type { EmulatorDescriptor, SandboxContext, SandboxRecipe } from '../types.ts'

/**
 * Dolphin started in its sandbox, on a user folder there.
 *
 * `-u` names the user folder Dolphin keeps everything in, and it outranks
 * every other way Dolphin picks one (a `portable.txt` beside the program,
 * `DOLPHIN_EMU_USERPATH`, the XDG roots): `UICommon::SetUserDirectory` takes
 * a given path before it looks at anything else. The folder sits where the
 * XDG layout would put it in the sandbox. Its settings file answers the
 * usage-statistics question, which Dolphin asks in a window of its own on a
 * first start even in batch mode (`DolphinQt/Main.cpp`).
 *
 * A flatpak is never started by the self-test, so only the program on PATH
 * gets here; `-u` leaves its layout nothing to decide.
 */
function sandboxRecipe(ctx: SandboxContext): SandboxRecipe | null {
  if (ctx.installKind !== 'binary') return null
  const user = joinPath(ctx.folders.data, 'dolphin-emu')
  const settings = ['[Analytics]', 'PermissionAsked = True', 'Enabled = False', ''].join('\n')
  return {
    args: ['-u', user],
    env: {},
    unset: [],
    needs: [],
    strays: [],
    bios: null,
    needsBios: false,
    files: [{ path: 'data/dolphin-emu/Config/Dolphin.ini', content: settings }]
  }
}

/** Slot A as a GCI folder; see `dolphin.settingsEdits`. */
const DOLPHIN_SLOT_A = {
  section: 'Core',
  key: 'SlotA',
  value: '8',
  whenAbsent: 'leave'
} as const

/**
 * Dolphin — the GameCube and Wii emulator, and what armadaOS's catalog
 * installs for both, from Flathub.
 *
 *  - The flatpak is tried first, as the catalog's route; a `dolphin-emu` on
 *    PATH is the user's own.
 *  - It covers **two systems** with one install.
 *  - It needs **no BIOS**: a GameCube IPL dump is optional, and Dolphin starts
 *    a game without one.
 *  - Its GameCube memory cards are **shared** by every game of a region and
 *    the Wii keeps one NAND for every title, so nothing in them can be
 *    attributed to one ROM; its states are named after the game's ID rather
 *    than the ROM. Neither is synced.
 *
 * It follows the XDG layout (`~/.local/share/dolphin-emu`), which the flatpak
 * build takes inside its own tree.
 *
 * Flags, the `-C` syntax and the fullscreen key are read from Dolphin at the
 * commit docs/research/armada_integration.md pins (e6f3ae17):
 * `UICommon/CommandLineParse.cpp` (`CreateParser` and
 * `CommandLineConfigLayerLoader`, which splits `<System>.<Section>.<Key>=<Value>`),
 * `Common/Config/Config.cpp` (`System::Main` is named `Dolphin`) and
 * `Core/Config/MainSettings.cpp` (`MAIN_FULLSCREEN` is `Display`/`Fullscreen`).
 */
export const dolphin: EmulatorDescriptor = {
  id: 'dolphin',
  name: 'Dolphin',
  dispatch: 'rommix',
  install: [
    { kind: 'flatpak', appId: 'org.DolphinEmu.dolphin-emu' },
    { kind: 'binary', names: ['dolphin-emu'] }
  ],
  findRule: 'DOLPHIN',
  homepage: 'https://dolphin-emu.org',
  systems: ['gc', 'wii'],
  variants: undefined,
  ownsLibrary: false,
  dirs: {
    // Dolphin's game list is the folders the user adds; RomMix's own folder is
    // the honest answer.
    roms: { base: 'rommix', path: 'roms' },
    saves: { base: 'data', path: 'dolphin-emu/GC' }
    // No `states`: a state is named after the game's ID, which nothing here
    // can pair with a ROM. No `bios`: Dolphin needs none.
  },
  // Fixed by the XDG layout.
  layout: undefined,
  // Games are booted by path, so a multi-file game keeps its own folder.
  flatLibrary: false,
  needsRomFolders: false,
  saves: (ctx) => ({
    saves: ctx.paths.saves ? shared(ctx.paths.saves) : null,
    states: null,
    unsyncableReason: 'saves.dolphinStandalone'
  }),
  bios: undefined,
  biosStagingNote: undefined,
  core: undefined,
  setupNotes: [],
  env: undefined,
  // `exec` alone opens Dolphin's game list.
  open: undefined,
  /**
   * `-b` so Dolphin shows no main window and exits when the game stops — the
   * process ending is how RomMix knows the game is over — and fullscreen set
   * for this start only, since `-C` values are never saved, so the render
   * window does not open over RomMix's. The ROM is the value of `-e`, so a
   * name beginning with a dash is still read as the file. Dolphin reads a
   * `.m3u` itself and changes discs from it (`Core/Boot/Boot.cpp`).
   */
  launch: ({ exec, romPath }) => [
    ...exec,
    '-b',
    '-C',
    'Dolphin.Display.Fullscreen=True',
    '-e',
    romPath
  ],
  sandbox: sandboxRecipe,
  launchFiles: undefined,
  /**
   * Slot A a GCI folder, so a GameCube save is one file per game, the shape
   * Argosy syncs (ADR 0005). Dolphin's default already is one
   * (`MAIN_SLOT_A` in `Core/Config/MainSettings.cpp`), so only a file that
   * names another device is changed. The value is
   * `ExpansionInterface::EXIDeviceType::MemoryCardFolder`, which Dolphin
   * writes as its number (`Core/HW/EXI/EXI_Device.h`).
   */
  settingsEdits: ({ system }) =>
    system === 'gc' ? [{ file: 'dolphin-emu/Dolphin.ini', ...DOLPHIN_SLOT_A }] : []
}
