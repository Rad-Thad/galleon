import { spawn, type ChildProcess } from 'node:child_process'
import { log } from './log.ts'

/**
 * The environment an emulator starts with.
 *
 * Galleon runs as an AppImage inside Steam's game session, so its own
 * environment carries things meant for Galleon and wrong for anything it
 * starts: the AppImage runtime's variables and library path point into
 * Galleon's mounted image, and Steam's overlay preload is injected into a
 * process that did not ask for it. Each is taken out here, so every launch path
 * builds the child's environment the same way and none inherits it whole.
 */

/** Set by the AppImage runtime about Galleon's own image; meaningless to a child. */
const APPIMAGE_VARIABLES = ['APPDIR', 'APPIMAGE', 'ARGV0', 'OWD'] as const

/**
 * The system directories put first on a child's PATH, so a system tool wins
 * over a same-named one inside Galleon's image, as Armada's own game launcher
 * orders them.
 */
export const SYSTEM_PATH = ['/usr/bin', '/usr/local/bin', '/bin'] as const

/** Steam's overlay library, which Steam preloads into Galleon. */
const STEAM_OVERLAY = /(^|\/)gameoverlayrenderer\.so$/

type Env = Readonly<Record<string, string | undefined>>

/** Whether `entry` is inside the mounted image at `appdir`. */
function insideImage(entry: string, appdir: string | undefined): boolean {
  if (!appdir) return false
  const root = appdir.replace(/\/+$/, '')
  return entry === root || entry.startsWith(`${root}/`)
}

/** `value`'s colon-separated entries, without those `drop` rejects, or undefined when none are left. */
function filterList(
  value: string | undefined,
  drop: (entry: string) => boolean,
  separator = /:/
): string | undefined {
  if (value === undefined) return undefined
  const kept = value.split(separator).filter((entry) => entry !== '' && !drop(entry))
  return kept.length > 0 ? kept.join(':') : undefined
}

/**
 * The environment for an emulator started from a parent with `parentEnv`.
 *
 * Everything not named below is kept, which is what carries the display,
 * audio, session and Steam variables through. The descriptor's own variables
 * are applied last, so an emulator that needs one of the dropped variables can
 * still be given it deliberately.
 */
export function childEnvironment(
  parentEnv: Env,
  descriptorEnv: Readonly<Record<string, string>> = {}
): Record<string, string> {
  const appdir = parentEnv.APPDIR
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(parentEnv)) {
    if (value !== undefined) env[name] = value
  }

  for (const name of APPIMAGE_VARIABLES) delete env[name]

  // Only the entries the image added go: a library path the session set up
  // for itself is still the child's business.
  const libraryPath = filterList(env.LD_LIBRARY_PATH, (entry) => insideImage(entry, appdir))
  if (libraryPath === undefined) delete env.LD_LIBRARY_PATH
  else env.LD_LIBRARY_PATH = libraryPath

  // The loader accepts spaces as well as colons between preloads.
  const preload = filterList(env.LD_PRELOAD, (entry) => STEAM_OVERLAY.test(entry), /[:\s]+/)
  if (preload === undefined) delete env.LD_PRELOAD
  else env.LD_PRELOAD = preload

  const rest = (env.PATH ?? '')
    .split(':')
    .filter(
      (entry) =>
        entry !== '' &&
        !insideImage(entry, appdir) &&
        !(SYSTEM_PATH as readonly string[]).includes(entry)
    )
  env.PATH = [...SYSTEM_PATH, ...new Set(rest)].join(':')

  return { ...env, ...descriptorEnv }
}

/** What differs between two environments: the names gone, and every value set or changed. */
export function environmentChanges(
  before: Env,
  after: Readonly<Record<string, string>>
): { removed: string[]; set: Record<string, string> } {
  const removed = Object.keys(before)
    .filter((name) => before[name] !== undefined && !(name in after))
    .sort()
  const set: Record<string, string> = {}
  for (const name of Object.keys(after).sort()) {
    if (before[name] !== after[name]) set[name] = after[name]
  }
  return { removed, set }
}

/**
 * Start an emulator as Galleon's own child, in a new session of its own.
 *
 * It stays a descendant: no double fork, no `systemd-run`. Steam's game session
 * follows the process tree it started, and an emulator reparented to init or
 * moved into another unit would fall out of it. `detached` is `setsid`, which
 * gives the child its own process group to be asked to quit through (see
 * `askToQuit` in launcher.ts) without leaving the tree.
 *
 * The output is piped rather than ignored: the last lines an emulator writes
 * are what says why it died.
 */
export function spawnEmulator(
  argv: readonly string[],
  descriptorEnv: Readonly<Record<string, string>> = {},
  parentEnv: Env = process.env
): ChildProcess {
  const env = childEnvironment(parentEnv, descriptorEnv)
  log.debug('emulator', 'child environment', environmentChanges(parentEnv, env))
  const [cmd, ...args] = argv
  return spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true, env })
}
