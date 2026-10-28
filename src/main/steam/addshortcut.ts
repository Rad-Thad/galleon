import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { crc32 } from 'node:zlib'
import { type BinaryVdfField, findField } from './binaryvdf.ts'

/**
 * Galleon's own entry in a user's shortcuts.vdf: added when there is none,
 * updated in place when one already starts the same program, and every other
 * entry left as it was.
 *
 * Steam keeps the list in memory while it runs and writes it back on exit, so
 * a change made then is lost or, worse, half kept; `steamRunning` is asked
 * first and a running Steam means nothing is written.
 */

export interface GalleonShortcut {
  name: string
  /** The program, as Steam stores it: quoted. */
  exe: string
  startDir: string
  launchOptions: string
  icon: string
}

/**
 * The appid Steam gives a shortcut it adds itself, so the art Galleon puts in
 * `config/grid/` under it is the art Steam shows.
 */
export function shortcutAppid(exe: string, name: string): number {
  return (crc32(exe + name) | 0x80000000) >>> 0
}

/**
 * The list with Galleon's entry added or updated, and which. An entry whose
 * Exe matches is updated in place, keeping its appid (its art is filed under
 * it), its play time, its tags and any field Steam adds later. Returns null
 * when the list has no `shortcuts` map, which is not a list to change.
 */
export function upsertShortcut(
  fields: BinaryVdfField[],
  shortcut: GalleonShortcut
): { fields: BinaryVdfField[]; change: 'added' | 'updated' } | null {
  const list = findField(fields, 'shortcuts')
  if (list?.type !== 'map') return null
  const set: [string, string][] = [
    ['AppName', shortcut.name],
    ['StartDir', shortcut.startDir],
    ['icon', shortcut.icon],
    ['LaunchOptions', shortcut.launchOptions]
  ]

  const existing = list.fields.find(
    (entry): entry is Extract<BinaryVdfField, { type: 'map' }> =>
      entry.type === 'map' && textOf(findField(entry.fields, 'Exe')) === shortcut.exe
  )
  if (existing) {
    for (const [name, value] of set) {
      const field = findField(existing.fields, name)
      if (field?.type === 'string') field.value = value
      else if (!field) existing.fields.push({ type: 'string', name, value })
    }
    return { fields, change: 'updated' }
  }

  const index = list.fields.reduce((next, entry) => {
    const n = /^\d+$/.test(entry.name) ? Number(entry.name) + 1 : 0
    return Math.max(next, n)
  }, 0)
  const string = (name: string, value: string): BinaryVdfField => ({ type: 'string', name, value })
  const int = (name: string, value: number): BinaryVdfField => ({ type: 'int32', name, value })
  list.fields.push({
    type: 'map',
    name: String(index),
    fields: [
      int('appid', shortcutAppid(shortcut.exe, shortcut.name)),
      string('AppName', shortcut.name),
      string('Exe', shortcut.exe),
      string('StartDir', shortcut.startDir),
      string('icon', shortcut.icon),
      string('ShortcutPath', ''),
      string('LaunchOptions', shortcut.launchOptions),
      int('IsHidden', 0),
      int('AllowDesktopConfig', 1),
      int('AllowOverlay', 1),
      int('OpenVR', 0),
      int('Devkit', 0),
      string('DevkitGameID', ''),
      int('DevkitOverrideAppID', 0),
      int('LastPlayTime', 0),
      string('FlatpakAppID', ''),
      { type: 'map', name: 'tags', fields: [] }
    ]
  })
  return { fields, change: 'added' }
}

function textOf(field: BinaryVdfField | undefined): string | undefined {
  return field?.type === 'string' ? field.value : undefined
}

export interface ProcessSources {
  home?: string
  readText?: (path: string) => Promise<string>
  listDir?: (path: string) => Promise<string[]>
}

/**
 * Whether Steam's client is running: a process named `steam`, or the pid in
 * `~/.steam/steam.pid` still alive. Steam can leave the pid file behind after
 * a crash, so the pid is only believed while its process exists. Only process
 * names are read, never command lines, which carry other programs' arguments.
 */
export async function steamRunning(sources: ProcessSources = {}): Promise<boolean> {
  const home = sources.home ?? homedir()
  const readText = sources.readText ?? ((path: string) => readFile(path, 'utf8'))
  const listDir = sources.listDir ?? ((path: string) => readdir(path))
  const comm = (pid: string): Promise<string | null> =>
    readText(`/proc/${pid}/comm`).then(
      (name) => name.trim(),
      () => null
    )

  const recorded = await readText(join(home, '.steam', 'steam.pid')).then(
    (text) => text.trim(),
    () => ''
  )
  if (/^\d+$/.test(recorded) && (await comm(recorded)) !== null) return true

  const pids = (await listDir('/proc').catch(() => [] as string[])).filter((name) =>
    /^\d+$/.test(name)
  )
  for (const pid of pids) {
    if ((await comm(pid)) === 'steam') return true
  }
  return false
}
