import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { log } from '../log.ts'
import { block, parseVdf, text } from './vdf.ts'
import type { VdfObject } from './vdf.ts'

/**
 * The Steam games installed on this machine, read from Steam's own files.
 *
 * Steam lists its libraries in `libraryfolders.vdf` and describes each game in
 * a library's `steamapps/appmanifest_<appid>.acf`. Nothing here asks Steam
 * itself, so the list is there whether or not Steam is running, and reading it
 * never wakes Steam up.
 */

/** Steam's own folder below the home directory, where the client installs. */
export const STEAM_ROOT = ['.local', 'share', 'Steam'] as const

/**
 * The `StateFlags` bit Steam sets once every byte of a game is on disk. A game
 * still downloading, or one whose first install was interrupted, lacks it; one
 * merely waiting on an update keeps it, and still plays.
 */
export const FULLY_INSTALLED = 4

export interface SteamGame {
  appid: string
  name: string
  /** The library folder that holds it: Steam's own, or one on a card. */
  library: string
  installdir: string
  stateFlags: number
  sizeOnDisk: number
}

export interface SteamSources {
  home?: string
  readText?: (path: string) => Promise<string>
  listDir?: (path: string) => Promise<string[]>
}

/**
 * Every library folder `libraryfolders.vdf` names.
 *
 * Current Steam writes a block per library with its `path`; older builds wrote
 * the path itself as the value, beside counters such as `ContentStatsID`. Only
 * numbered keys are libraries in either shape.
 */
export function libraryPaths(file: VdfObject): string[] {
  const root = block(file, 'libraryfolders')
  if (!root) return []
  const paths: string[] = []
  for (const [key, value] of Object.entries(root)) {
    if (!/^\d+$/.test(key)) continue
    const path = typeof value === 'string' ? value : text(value, 'path')
    if (path) paths.push(path)
  }
  return paths
}

/**
 * The game a manifest describes, or null when it lacks what a launch and the
 * list need: an appid of digits and a name.
 */
export function readManifest(file: VdfObject, library: string): SteamGame | null {
  const state = block(file, 'AppState')
  if (!state) return null
  const appid = text(state, 'appid')
  const name = text(state, 'name')
  if (!appid || !/^\d+$/.test(appid) || !name) return null
  return {
    appid,
    name,
    library,
    installdir: text(state, 'installdir') ?? '',
    stateFlags: Number.parseInt(text(state, 'StateFlags') ?? '0', 10) || 0,
    sizeOnDisk: Number.parseInt(text(state, 'SizeOnDisk') ?? '0', 10) || 0
  }
}

export function isInstalled(game: SteamGame): boolean {
  return (game.stateFlags & FULLY_INSTALLED) !== 0
}

/**
 * Every installed game across every library, by name.
 *
 * Both copies of `libraryfolders.vdf` are read, the one under `steamapps` and
 * the one under `config`, since Steam has kept the list in each and an upgrade
 * can leave either the more complete. Steam's own folder is always a library,
 * even when neither file names it. A game found in two libraries, as after a
 * move Steam did not finish, is listed once, from the first.
 *
 * A file that cannot be read or parsed costs only what it describes: a card
 * that is out loses its games, not everyone else's.
 */
export async function installedSteamGames(sources: SteamSources = {}): Promise<SteamGame[]> {
  return (await scanSteamGames(sources)).games
}

export interface SteamScan {
  games: SteamGame[]
  /**
   * Files that are there but could not be read as what they should be. A
   * reader that falls behind Steam's format shows up here, rather than as a
   * library that merely looks small.
   */
  malformed: number
}

/** `installedSteamGames`, with a count of the files it had to pass over. */
export async function scanSteamGames(sources: SteamSources = {}): Promise<SteamScan> {
  const home = sources.home ?? homedir()
  const readText = sources.readText ?? ((path: string) => readFile(path, 'utf8'))
  const listDir = sources.listDir ?? ((path: string) => readdir(path))
  const steam = join(home, ...STEAM_ROOT)
  let malformed = 0
  const readVdf = async (path: string): Promise<VdfObject | null> => {
    const parsed = await readVdfFile(path, readText)
    if (parsed === MALFORMED) malformed++
    return parsed === MALFORMED ? null : parsed
  }

  const libraries = [steam]
  for (const listing of [
    join(steam, 'steamapps', 'libraryfolders.vdf'),
    join(steam, 'config', 'libraryfolders.vdf')
  ]) {
    const parsed = await readVdf(listing)
    if (!parsed) continue
    for (const path of libraryPaths(parsed)) {
      if (!libraries.includes(path)) libraries.push(path)
    }
  }

  const games = new Map<string, SteamGame>()
  for (const library of libraries) {
    const steamapps = join(library, 'steamapps')
    let entries: string[]
    try {
      entries = await listDir(steamapps)
    } catch {
      continue
    }
    for (const entry of entries.filter((name) => /^appmanifest_\d+\.acf$/.test(name)).sort()) {
      const parsed = await readVdf(join(steamapps, entry))
      if (!parsed) continue
      const game = readManifest(parsed, library)
      if (!game) malformed++
      if (!game || !isInstalled(game) || games.has(game.appid)) continue
      games.set(game.appid, game)
    }
  }
  return {
    games: [...games.values()].sort(
      (a, b) => a.name.localeCompare(b.name) || a.appid.localeCompare(b.appid)
    ),
    malformed
  }
}

const MALFORMED = Symbol('malformed')

/** A file parsed; null when it is absent or unreadable, `MALFORMED` when it is there but not VDF. */
async function readVdfFile(
  path: string,
  readText: (path: string) => Promise<string>
): Promise<VdfObject | null | typeof MALFORMED> {
  let contents: string
  try {
    contents = await readText(path)
  } catch {
    return null
  }
  const parsed = parseVdf(contents)
  if (parsed) return parsed
  log.warn('steam', 'a Steam file could not be parsed', { path })
  return MALFORMED
}

/**
 * Steam's own tools, which it installs as apps beside the games.
 *
 * Proton, the Linux runtimes and the shared redistributables carry a manifest
 * and the installed flag like any game, and nothing in the manifest says
 * otherwise: Steam keeps an app's type in its binary app cache. Running one
 * does nothing a player would want, so they are recognised by the names and
 * appids Valve gives them.
 */
const TOOL_APPIDS = new Set([
  // Steamworks Common Redistributables
  '228980'
])
const TOOL_NAMES = [
  /^Proton\b/i,
  /^Steam Linux Runtime\b/i,
  /^Steamworks Common Redistributables$/i
]

export function isSteamTool(game: Pick<SteamGame, 'appid' | 'name'>): boolean {
  return TOOL_APPIDS.has(game.appid) || TOOL_NAMES.some((pattern) => pattern.test(game.name))
}
