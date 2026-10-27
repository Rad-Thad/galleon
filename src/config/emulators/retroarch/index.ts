import { coreForSystem, systemsWithCore } from '../../systems.ts'
import { libretroCore, libretroSavePaths, readLibretroConfig } from '../libretro.ts'
import { joinPath } from '../savepaths.ts'
import type {
  CoreContext,
  EmulatorDescriptor,
  LaunchVariant,
  RequiredCore,
  SandboxContext,
  SandboxRecipe
} from '../types.ts'

const RETROARCH_APP_ID = 'org.libretro.RetroArch'

/**
 * The cores the player may pick between for a system, each the core Argosy
 * runs for it on Android or one its saves are compared against (M2-08), so a
 * system can be played in the same core on both devices. The first is the one
 * `coreForSystem` maps, so a launch with no choice recorded runs it.
 *
 * Every core here is one the buildbot publishes for Linux on aarch64, which
 * `registry.test.ts` checks against a copy of its index.
 */
const CORE_CHOICES: Readonly<Record<string, readonly LaunchVariant[]>> = (() => {
  const snes9x = [{ id: 'snes9x', label: 'Snes9x' }]
  const mgba = [{ id: 'mgba', label: 'mGBA' }]
  const psx = [
    { id: 'swanstation', label: 'SwanStation' },
    { id: 'pcsx_rearmed', label: 'PCSX ReARMed' },
    { id: 'mednafen_psx_hw', label: 'Beetle PSX HW' }
  ]
  const ppsspp = [{ id: 'ppsspp', label: 'PPSSPP' }]
  const dolphin = [{ id: 'dolphin', label: 'Dolphin' }]
  const flycast = [{ id: 'flycast', label: 'Flycast' }]
  return {
    snes: snes9x,
    snesna: snes9x,
    sfc: snes9x,
    satellaview: snes9x,
    sufami: snes9x,
    gba: mgba,
    psx,
    psp: ppsspp,
    gc: dolphin,
    wii: dolphin,
    dreamcast: flycast,
    naomi: flycast,
    atomiswave: flycast
  }
})()

/**
 * The core a launch runs: the chosen variant, else the system's mapped core.
 *
 * A recorded choice that is not among the system's cores is no core at all,
 * not the default: running a game in a core other than the one asked for puts
 * its save where the chosen one would never look.
 */
function chosenCore(system: string, variant: string | undefined): string | null {
  if (variant === undefined) return coreForSystem(system)
  return (CORE_CHOICES[system] ?? []).some((choice) => choice.id === variant) ? variant : null
}

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
    chosenCore(ctx.system, ctx.variant),
    joinPath(ctx.configDir, 'retroarch', 'cores') || null
  )
}

/** The config every launch appends to the player's own; see `LAUNCH_SETTINGS`. */
const LAUNCH_APPEND = 'retroarch-append.cfg'

/**
 * What every launch needs from RetroArch that its own config may not say.
 *
 * `quit_on_close_content` "2" quits when the player closes the game, but only
 * for a RetroArch started with content on the command line, so the player is
 * back in RomMix rather than in RetroArch's menu, and RetroArch started on its
 * own still keeps its menu. Saving the config on exit writes every setting in
 * force, the appended ones too, into `retroarch.cfg` (`config_save_file` in
 * its `configuration.c`), so it is off for these sessions: the player's file
 * is never edited by a launch.
 */
const LAUNCH_SETTINGS = 'quit_on_close_content = "2"\nconfig_save_on_exit = "false"\n'

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
 * sit beside the game. The appended config is the one `launch` names, which
 * the self-test reads from the sandbox's root: it carries every launch's
 * `LAUNCH_SETTINGS`, then names every folder RetroArch writes and keeps saves
 * and states out of the game's folder. Cores are the
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
  const append =
    LAUNCH_SETTINGS +
    Object.entries(settings)
      .map(([key, value]) => `${key} = "${value}"\n`)
      .join('')
  return {
    args: ['--config', joinPath(config, 'retroarch.cfg')],
    env: {},
    unset: FOLDER_OVERRIDES,
    needs: [joinPath(core.dir, core.fileName)],
    strays: [STARTUP_TEMP],
    bios: null,
    needsBios: false,
    files: [
      { path: 'config/retroarch/retroarch.cfg', content: '' },
      { path: LAUNCH_APPEND, content: append }
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
  // See `CORE_CHOICES`.
  variants: (system) => CORE_CHOICES[system] ?? [],
  ownsLibrary: false,
  dirs: {
    roms: { base: 'library', path: '' },
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
      chosenCore(ctx.system, ctx.variant),
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
  launch: ({ exec, system, romPath, variant, launcherDir }) => {
    const core = chosenCore(system, variant)
    if (!core) return null
    return [
      ...exec,
      '-f',
      '-L',
      `${core}_libretro.so`,
      '--appendconfig',
      joinPath(launcherDir, LAUNCH_APPEND),
      romPath
    ]
  },
  sandbox: sandboxRecipe,
  launchFiles: () => [{ name: LAUNCH_APPEND, content: LAUNCH_SETTINGS }],
  settingsEdits: undefined
}
