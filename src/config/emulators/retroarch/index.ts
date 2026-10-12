import { coreForSystem, systemsWithCore } from '../../systems.ts'
import { libretroCore, libretroSavePaths, readLibretroConfig } from '../libretro.ts'
import { joinPath } from '../savepaths.ts'
import type {
  CoreContext,
  EmulatorDescriptor,
  RequiredCore,
  SandboxContext,
  SandboxRecipe
} from '../types.ts'

const RETROARCH_APP_ID = 'org.libretro.RetroArch'

/**
 * Where standalone RetroArch's config might be.
 *
 * `configDir` is whichever root the probe settled on for the install it found —
 * the flatpak's own tree, or the XDG one for a distro package — so it is the
 * first and usually only candidate. The bare XDG path follows it for the case
 * where RomMix found the flatpak but the user also has a native RetroArch whose
 * config is the populated one.
 */
function configCandidates(ctx: CoreContext): readonly string[] {
  return [
    joinPath(ctx.configDir, 'retroarch', 'retroarch.cfg'),
    joinPath(ctx.home, '.config', 'retroarch', 'retroarch.cfg')
  ].filter((path) => path !== '')
}

/**
 * The core this game needs, and the folder RetroArch will look for it in.
 *
 * From `libretro_directory` rather than the templated `dirs`, because that is
 * the directory RetroArch searches when `launch` names a core by file name —
 * install it anywhere else and the bare name resolves to nothing, which is
 * the fatal "path is not set" this exists to prevent.
 */
function requiredCore(ctx: CoreContext): RequiredCore | null {
  return libretroCore(
    readLibretroConfig(ctx.env, configCandidates(ctx), ctx.home),
    coreForSystem(ctx.system),
    joinPath(ctx.configDir, 'retroarch', 'cores') || null
  )
}

/** The appended config, which `sandbox` writes beside the sandbox's own folders. */
const SANDBOX_APPEND = 'retroarch-sandbox.cfg'

/**
 * Variables RetroArch reads after its config, each replacing a folder the
 * config named; read from `config_load_file` in its `configuration.c`.
 */
const FOLDER_OVERRIDES = [
  'LIBRETRO_DIRECTORY',
  'LIBRETRO_ASSETS_DIRECTORY',
  'LIBRETRO_AUTOCONFIG_DIRECTORY',
  'LIBRETRO_CHEATS_DIRECTORY',
  'LIBRETRO_DATABASE_DIRECTORY',
  'LIBRETRO_SYSTEM_DIRECTORY',
  'LIBRETRO_VIDEO_FILTER_DIRECTORY',
  'LIBRETRO_VIDEO_SHADER_DIRECTORY'
]

/**
 * The folder RetroArch's Unix start-up makes for its default cache folder
 * before any config is read; `frontend/drivers/platform_unix.c` names the
 * path outright, so neither `cache_directory` nor a variable moves it.
 */
const STARTUP_TEMP = '/tmp/retroarch-tmp'

/**
 * RetroArch started on a config of the sandbox's own, with the folders it
 * writes to named in an appended one.
 *
 * `--config` alone is not enough: RetroArch takes its save, state and system
 * folders from the config, and an empty one falls back to defaults that can
 * sit beside the game. The appended config names every folder it writes,
 * keeps saves and states out of the game's folder, and turns off saving the
 * config on exit so the sandbox's file stays what was written. Cores are the
 * owner's, read where RetroArch would load them from; without a core for the
 * system, or without its file, there is nothing to start. A folder variable inherited from the
 * session would win over the appended config, so none reaches it.
 */
function sandboxRecipe(ctx: SandboxContext): SandboxRecipe | null {
  const core = requiredCore({ system: ctx.system, ...ctx.owner })
  if (core === null) return null
  const { folders } = ctx
  const config = joinPath(folders.config, 'retroarch')
  const settings: Record<string, string> = {
    config_save_on_exit: 'false',
    libretro_directory: core.dir,
    savefile_directory: folders.saves,
    savestate_directory: folders.states,
    system_directory: folders.bios,
    savefiles_in_content_dir: 'false',
    savestates_in_content_dir: 'false',
    systemfiles_in_content_dir: 'false',
    screenshots_in_content_dir: 'false',
    core_options_path: joinPath(config, 'retroarch-core-options.cfg'),
    content_history_path: joinPath(config, 'content_history.lpl'),
    playlist_directory: joinPath(config, 'playlists'),
    screenshot_directory: joinPath(folders.data, 'screenshots'),
    cache_directory: joinPath(folders.data, 'cache'),
    log_dir: joinPath(folders.data, 'logs')
  }
  const append = Object.entries(settings)
    .map(([key, value]) => `${key} = "${value}"\n`)
    .join('')
  return {
    args: [
      '--config',
      joinPath(config, 'retroarch.cfg'),
      '--appendconfig',
      joinPath(folders.root, SANDBOX_APPEND)
    ],
    env: {},
    unset: FOLDER_OVERRIDES,
    needs: [joinPath(core.dir, core.fileName)],
    strays: [STARTUP_TEMP],
    bios: null,
    files: [
      { path: 'config/retroarch/retroarch.cfg', content: '' },
      { path: SANDBOX_APPEND, content: append }
    ]
  }
}

/**
 * Standalone RetroArch.
 *
 * Unlike RetroDECK it has no system resolution of its own, so RomMix maps the
 * ES-DE system to a libretro core explicitly — which makes the set of systems
 * it can run exactly the set that has a core mapping. Declaring `systems` from
 * the mapping rather than by hand keeps the two from drifting apart.
 *
 * RetroArch has no ROM root of its own either, so its games go in RomMix's
 * folder alongside the other emulators that have nowhere natural to put them,
 * and RetroArch's own history handles the rest.
 */
export const retroarch: EmulatorDescriptor = {
  id: 'retroarch',
  name: 'RetroArch',
  dispatch: 'rommix',
  install: [
    { kind: 'flatpak', appId: RETROARCH_APP_ID },
    { kind: 'binary', names: ['retroarch'] }
  ],
  findRule: 'RETROARCH',
  homepage: 'https://www.retroarch.com',
  systems: systemsWithCore(),
  // One core per system, named by `launch`, so there is nothing to choose.
  variants: undefined,
  ownsLibrary: false,
  dirs: {
    roms: { base: 'rommix', path: 'roms' },
    saves: { base: 'config', path: 'retroarch/saves' },
    states: { base: 'config', path: 'retroarch/states' },
    bios: { base: 'config', path: 'retroarch/system' }
  },
  // RetroArch's folders are fixed by its packaging, so there is no config file
  // to discover them from and no library root to relocate.
  layout: undefined,
  // It reads its ROM folders recursively, so a multi-file game may keep a
  // folder of its own.
  flatLibrary: false,
  // RetroArch loads a game from wherever it is pointed at, and it runs a
  // hundred systems: a folder made for each of them would be a hundred empty
  // directories against one game.
  needsRomFolders: false,
  /**
   * Straight from `retroarch.cfg`, because every part of the answer lives
   * there: the two roots, whether saves are sorted into a folder per core or
   * per content directory, and whether they go beside the ROM instead. The
   * declared `dirs` above are only the fallback for a RetroArch that has never
   * written a config.
   *
   * The core is the one RomMix names on the command line in `launch`, so the
   * save location and the process that writes it can never disagree.
   */
  saves: (ctx) =>
    libretroSavePaths(
      ctx,
      readLibretroConfig(ctx.env, configCandidates(ctx), ctx.home),
      coreForSystem(ctx.system),
      { saves: ctx.paths.saves, states: ctx.paths.states }
    ),
  // Its system folder takes any firmware file dropped in.
  bios: undefined,
  biosStagingNote: undefined,
  // See `requiredCore`.
  core: requiredCore,
  // Nothing: the one setup step RetroArch really needs — a core for the system
  // being played — RomMix now performs itself, from `core` above.
  setupNotes: [],
  env: undefined,
  // `exec` alone starts RetroArch with no content.
  open: undefined,
  /**
   * `-f` because RomMix is a front end for a television.
   *
   * RetroArch otherwise restores whatever window geometry its config remembers,
   * which on a first run is a small window opening on top of RomMix's own
   * fullscreen one — a game started from the couch lands in a corner. The flag
   * is documented as "start the program in fullscreen regardless of config
   * setting", takes no argument, and applies to that session only, so someone
   * who prefers windowed play still has it when they start RetroArch
   * themselves. The same reasoning as Eden's `-f`.
   */
  launch: ({ exec, system, romPath }) => {
    const core = coreForSystem(system)
    if (!core) return null
    return [...exec, '-f', '-L', `${core}_libretro.so`, romPath]
  },
  sandbox: sandboxRecipe
}
