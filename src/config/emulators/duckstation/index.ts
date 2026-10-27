import { dirName, joinPath, perRom } from '../savepaths.ts'
import type { EmulatorDescriptor, SandboxContext, SandboxRecipe } from '../types.ts'

/**
 * Files that switch DuckStation to a portable layout, rooted beside the
 * program instead of in the XDG folders.
 */
const PORTABLE_MARKERS = ['portable.txt', 'settings.ini']

/**
 * DuckStation started in its sandbox, on a settings file written there.
 *
 * With `XDG_CONFIG_HOME` set, DuckStation keeps everything under
 * `$XDG_CONFIG_HOME/duckstation`, which the self-test points into the sandbox.
 * The settings file then names the BIOS, memory card and save state folders
 * the sandbox holds, and answers the two first-run questions DuckStation would
 * otherwise ask in a window of its own: the setup wizard and the launcher
 * shortcut.
 *
 * A portable marker beside the AppImage would root DuckStation there, in the
 * owner's folder, whatever the environment says, so its presence declines the
 * sandbox. DuckStation looks for the marker beside the AppImage file a link
 * leads to; a marker beside the link declines too, so the sandbox never rests
 * on which of the two a build reads. Only the AppImage is started: a binary
 * install is a distro's or a build's, whose layout the recipe has not been
 * checked against.
 */
function sandboxRecipe(ctx: SandboxContext): SandboxRecipe | null {
  if (ctx.installKind !== 'appimage') return null
  const beside = [dirName(ctx.installRef), dirName(ctx.installTarget)]
  const marked = beside.some((dir) =>
    PORTABLE_MARKERS.some((name) => ctx.owner.env.exists(joinPath(dir, name)))
  )
  if (marked) return null
  const { folders } = ctx
  const settings = [
    '[Main]',
    'SetupWizardIncomplete = false',
    'NoDesktopFile = true',
    '',
    '[BIOS]',
    `SearchDirectory = ${folders.bios}`,
    '',
    '[MemoryCards]',
    `Directory = ${folders.saves}`,
    '',
    '[Folders]',
    `SaveStates = ${folders.states}`,
    ''
  ].join('\n')
  return {
    args: [],
    env: {},
    unset: [],
    needs: [],
    strays: [],
    bios: null,
    needsBios: true,
    files: [{ path: 'config/duckstation/settings.ini', content: settings }]
  }
}

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
  findRule: 'DUCKSTATION',
  homepage: 'https://www.duckstation.org',
  systems: ['psx'],
  variants: undefined,
  ownsLibrary: false,
  dirs: {
    // DuckStation has no ROM folder of its own: its game list is the
    // directories the user adds. RomMix's own folder is the honest answer.
    roms: { base: 'library', path: '' },
    saves: { base: 'data', path: 'duckstation/memcards' },
    bios: { base: 'data', path: 'duckstation/bios' }
    // No `states`: DuckStation names a state after the disc's serial rather
    // than the ROM, so nothing here could pair one with a game.
  },
  // Fixed by the XDG layout; nothing here reads DuckStation's settings file.
  layout: undefined,
  // Games are booted by path, so a multi-file game keeps the folder of its
  // own that holds a disc set together.
  flatLibrary: false,
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
  launch: ({ exec, romPath }) => [...exec, '-batch', '-fullscreen', '-nogui', '--', romPath],
  sandbox: sandboxRecipe,
  launchFiles: undefined,
  settingsEdits: undefined
}
