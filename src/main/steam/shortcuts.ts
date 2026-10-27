import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { log } from '../log.ts'
import { STEAM_ROOT } from './library.ts'

/**
 * Steam's non-Steam shortcuts, as each user's `config/shortcuts.vdf` keeps
 * them, and the cover art Steam has for a game or a shortcut. Read only:
 * Steam rewrites these files whenever it likes, and a writer is M1-29's.
 *
 * shortcuts.vdf is binary VDF: a map is a 0x00 byte, a NUL-terminated name
 * and its fields up to a 0x08 byte; a string field is 0x01, an int32 0x02.
 * The appid is stored signed, so it is read back unsigned, as Steam names a
 * shortcut's art and its `steam://rungameid/` id.
 */

export interface BinaryVdfObject {
  [key: string]: BinaryVdfValue
}

export type BinaryVdfValue = string | number | Uint8Array | BinaryVdfObject

const MAP = 0x00
const STRING = 0x01
const INT32 = 0x02
const END = 0x08
/**
 * The fixed-width field types, by width. A reader that meets any other type
 * cannot know where the next field starts, so the file is unreadable.
 */
const FIXED: Record<number, number> = { 0x03: 4, 0x04: 4, 0x06: 4, 0x07: 8 }
/** Deeper than any file Steam writes; a crafted file cannot exhaust the stack. */
const MAX_DEPTH = 16

const utf8 = new TextDecoder()

/** Caught by `parseBinaryVdf`; never leaves this file. */
class Malformed extends Error {}

/** The file's top-level map, or null when it is cut short or malformed. */
export function parseBinaryVdf(data: Uint8Array): BinaryVdfObject | null {
  try {
    return readMap(data, 0, 0)[0]
  } catch (cause) {
    if (cause instanceof Malformed) return null
    throw cause
  }
}

function readMap(data: Uint8Array, at: number, depth: number): [BinaryVdfObject, number] {
  if (depth > MAX_DEPTH) throw new Malformed()
  const fields: BinaryVdfObject = {}
  for (;;) {
    if (at >= data.length) throw new Malformed()
    const kind = data[at++]
    if (kind === END) return [fields, at]
    const [name, afterName] = readString(data, at)
    at = afterName
    if (kind === MAP) {
      ;[fields[name], at] = readMap(data, at, depth + 1)
    } else if (kind === STRING) {
      ;[fields[name], at] = readString(data, at)
    } else if (kind === INT32) {
      if (at + 4 > data.length) throw new Malformed()
      fields[name] = new DataView(data.buffer, data.byteOffset + at, 4).getInt32(0, true)
      at += 4
    } else if (kind in FIXED) {
      const width = FIXED[kind]
      if (at + width > data.length) throw new Malformed()
      fields[name] = data.slice(at, at + width)
      at += width
    } else {
      throw new Malformed()
    }
  }
}

function readString(data: Uint8Array, at: number): [string, number] {
  const end = data.indexOf(0, at)
  if (end < 0) throw new Malformed()
  return [utf8.decode(data.subarray(at, end)), end + 1]
}

export interface SteamShortcut {
  /** Unsigned, in decimal, as Steam names the shortcut's art. */
  appid: string
  name: string
  /** The Steam user folder whose list holds it. */
  user: string
}

export interface ShortcutList {
  shortcuts: SteamShortcut[]
  /** Lists that are there but could not be read as binary VDF. */
  unreadable: number
}

export interface ShortcutSources {
  home?: string
  readBytes?: (path: string) => Promise<Uint8Array>
  listDir?: (path: string) => Promise<string[]>
}

/**
 * Every user's non-Steam shortcuts. A user without a list has none; a list
 * that cannot be read costs only its own shortcuts and is counted, so a
 * reader that falls behind Steam's format shows up rather than reading as an
 * empty library.
 */
export async function nonSteamShortcuts(sources: ShortcutSources = {}): Promise<ShortcutList> {
  const home = sources.home ?? homedir()
  const readBytes = sources.readBytes ?? ((path: string) => readFile(path))
  const listDir = sources.listDir ?? ((path: string) => readdir(path))
  const userdata = join(home, ...STEAM_ROOT, 'userdata')

  const shortcuts: SteamShortcut[] = []
  let unreadable = 0
  for (const user of (await listDir(userdata).catch(() => [] as string[])).sort()) {
    if (!/^\d+$/.test(user)) continue
    const path = join(userdata, user, 'config', 'shortcuts.vdf')
    let data: Uint8Array
    try {
      data = await readBytes(path)
    } catch {
      continue
    }
    const list = parseBinaryVdf(data)
    const entries = list && field(list, 'shortcuts')
    if (!entries || typeof entries !== 'object' || entries instanceof Uint8Array) {
      log.warn('steam', 'a shortcut list could not be read', { path })
      unreadable++
      continue
    }
    for (const entry of Object.values(entries)) {
      if (typeof entry !== 'object' || entry instanceof Uint8Array) continue
      const appid = field(entry, 'appid')
      const name = field(entry, 'AppName')
      if (typeof appid !== 'number' || typeof name !== 'string') continue
      shortcuts.push({ appid: String(appid >>> 0), name, user })
    }
  }
  return { shortcuts, unreadable }
}

/** A field by name, without regard to case: Steam has written `AppName` and `appname`. */
function field(object: BinaryVdfObject, name: string): BinaryVdfValue | undefined {
  const lower = name.toLowerCase()
  const key = Object.keys(object).find((k) => k.toLowerCase() === lower)
  return key === undefined ? undefined : object[key]
}

/** Image types Steam and the art managers built on it write to `grid/`. */
const GRID_COVER = /^(\d+)p\.(png|jpe?g|webp)$/i
/** A Steam game's cover in the app cache, in the flat layout and the per-app one. */
const CACHE_COVER_FLAT = /^(\d+)_library_600x900\.jpg$/
const CACHE_COVER = /^library_600x900(_[a-z]+)?\.jpg$/

/**
 * The appids Steam has a portrait cover for: any user's custom cover in
 * `config/grid/`, and Steam's own in `appcache/librarycache/`. That cache has
 * been laid out two ways: flat, `<appid>_library_600x900.jpg`, and a folder
 * per app holding the file, sometimes a folder further down. Both are read,
 * since an upgraded Steam can keep the old files beside the new.
 */
export async function coverArt(
  sources: Pick<ShortcutSources, 'home' | 'listDir'> = {}
): Promise<Set<string>> {
  const home = sources.home ?? homedir()
  const listDir = sources.listDir ?? ((path: string) => readdir(path))
  const list = (path: string): Promise<string[]> => listDir(path).catch(() => [])
  const steam = join(home, ...STEAM_ROOT)
  const found = new Set<string>()

  const userdata = join(steam, 'userdata')
  for (const user of await list(userdata)) {
    for (const name of await list(join(userdata, user, 'config', 'grid'))) {
      const match = GRID_COVER.exec(name)
      if (match) found.add(match[1])
    }
  }

  const cache = join(steam, 'appcache', 'librarycache')
  for (const name of await list(cache)) {
    const flat = CACHE_COVER_FLAT.exec(name)
    if (flat) {
      found.add(flat[1])
      continue
    }
    if (!/^\d+$/.test(name) || found.has(name)) continue
    const inside = await list(join(cache, name))
    if (inside.some((file) => CACHE_COVER.test(file))) {
      found.add(name)
      continue
    }
    for (const sub of inside.filter((file) => !file.includes('.'))) {
      if ((await list(join(cache, name, sub))).some((file) => CACHE_COVER.test(file))) {
        found.add(name)
        break
      }
    }
  }
  return found
}
