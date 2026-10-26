import { perRom } from '../savepaths.ts'
import type { EmulatorDescriptor } from '../types.ts'

/**
 * melonDS — the Nintendo DS emulator armadaOS's catalog installs.
 *
 *  - The catalog puts it in `~/Applications` as an AppImage built from
 *    virtudude's `drm-leasing` branch, and refuses it beside the flatpak, so
 *    the AppImage is the install that matters.
 *  - It covers **exactly one system**.
 *  - Its saves sit **beside the ROM**: Armada's template leaves `SaveFilePath`
 *    empty, and melonDS then names the save after the ROM in the ROM's own
 *    folder (`getAssetPath` in `src/frontend/qt_sdl/EmuInstance.cpp`). One
 *    `.sav` per game, so it syncs like any battery save.
 *  - Armada's template turns `ExternalBIOSEnable` off, so melonDS boots DS
 *    games on its own BIOS and firmware and has no folder for dumps.
 *
 * It keeps its settings in `~/.config/melonDS/melonDS.toml`, which nothing
 * here reads.
 *
 * Flags and their meanings are read from `src/frontend/qt_sdl/CLI.cpp` at the
 * `drm-leasing` commit the catalog's release is built from.
 */
export const melonds: EmulatorDescriptor = {
  id: 'melonds',
  name: 'melonDS',
  dispatch: 'rommix',
  install: [
    {
      kind: 'appimage',
      // The catalog installs it as `melonDS.AppImage`; its release names the
      // architecture after the project's name.
      patterns: ['melonds*.appimage'],
      release: {
        // The fork the catalog installs from: upstream melonDS publishes its
        // Linux builds as zips, which RomMix cannot run.
        api: 'https://api.github.com/repos/virtudude/melonDS/releases',
        asset: /^melonDS[\w.-]*\.AppImage$/i
      }
    },
    { kind: 'binary', names: ['melonDS', 'melonds'] }
  ],
  findRule: 'MELONDS',
  homepage: 'https://melonds.kuribo64.net',
  systems: ['nds'],
  variants: undefined,
  ownsLibrary: false,
  dirs: {
    // melonDS's game list is the folders the user opens; RomMix's own folder
    // is the honest answer.
    roms: { base: 'rommix', path: 'roms' }
    // No `saves`: a save is beside its ROM, wherever that is — see `saves`.
    // No `states`: they sit beside the ROM too, and stay on the device.
  },
  // Fixed by the install; nothing here reads melonDS's settings file.
  layout: undefined,
  // Games are booted by path, and each save follows its own ROM's folder.
  flatLibrary: false,
  needsRomFolders: false,
  saves: (ctx) => ({
    saves: perRom(ctx.romDir),
    states: null
  }),
  // No BIOS folder to put dumps in — see `dirs`.
  bios: undefined,
  biosStagingNote: undefined,
  core: undefined,
  setupNotes: [],
  env: undefined,
  // `exec` alone opens melonDS with nothing loaded.
  open: undefined,
  /**
   * `-f` so melonDS opens full screen rather than in a window over RomMix's,
   * and the ROM as its only positional argument, which melonDS boots at once.
   * The ROM path is absolute, so it never begins with a dash.
   */
  launch: ({ exec, romPath }) => [...exec, '-f', romPath],
  // No recipe yet, so the self-test never starts melonDS.
  sandbox: undefined
}
