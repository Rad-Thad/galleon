import { constants } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { log } from '../log.ts'
import { type GalleonShortcut, steamRunning, upsertShortcut } from './addshortcut.ts'
import { type BinaryVdfField, readBinaryVdf, writeBinaryVdf } from './binaryvdf.ts'
import { STEAM_ROOT } from './library.ts'

/**
 * Galleon's Steam shortcut written into every Steam user's list, as
 * `install.sh --add-to-steam` and Settings ask for it.
 *
 * Each list is copied aside before it is replaced, and replaced by a rename,
 * so a run cut short leaves either the old list or the new one and never half
 * of either. A list that cannot be read exactly is left alone: rewriting what
 * was not understood could drop the owner's own shortcuts.
 */

export type UserChange = 'added' | 'updated' | 'unchanged' | 'unreadable'

export type AddToSteamResult =
  | { outcome: 'steam-running' }
  | { outcome: 'no-steam-user' }
  | {
      outcome: 'done'
      /** Per Steam user folder, in folder order. */
      users: { user: string; change: UserChange; backup?: string }[]
    }

export interface AddToSteamOptions {
  home?: string
  /**
   * Art for `config/grid/`, by the suffix after the appid (`p.png` is the
   * portrait cover). A file already there is the owner's choice and is kept.
   */
  art?: Record<string, Uint8Array>
  running?: () => Promise<boolean>
  now?: () => Date
}

const LIST = 'shortcuts.vdf'

export async function addToSteam(
  shortcut: GalleonShortcut,
  options: AddToSteamOptions = {}
): Promise<AddToSteamResult> {
  const home = options.home ?? homedir()
  const running = options.running ?? (() => steamRunning({ home }))
  const now = options.now ?? (() => new Date())
  if (await running()) return { outcome: 'steam-running' }

  const userdata = join(home, ...STEAM_ROOT, 'userdata')
  const folders = (await readdir(userdata).catch(() => [] as string[]))
    .filter((name) => /^\d+$/.test(name))
    .sort()
  if (folders.length === 0) return { outcome: 'no-steam-user' }

  const users: { user: string; change: UserChange; backup?: string }[] = []
  for (const user of folders) {
    const config = join(userdata, user, 'config')
    const path = join(config, LIST)
    let before: Uint8Array | null = null
    try {
      before = await readFile(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        users.push({ user, change: 'unreadable' })
        continue
      }
    }

    const fields: BinaryVdfField[] | null = before
      ? readBinaryVdf(before)
      : [{ type: 'map', name: 'shortcuts', fields: [] }]
    const result = fields && upsertShortcut(fields, shortcut)
    if (!result) {
      // Without the path: its folder is the owner's Steam account number.
      log.warn('steam', 'a shortcut list could not be read exactly; it was left as it was')
      users.push({ user, change: 'unreadable' })
      continue
    }

    const after = writeBinaryVdf(result.fields)
    let change: UserChange = result.change
    let backup: string | undefined
    if (before && Buffer.from(before).equals(after)) {
      change = 'unchanged'
    } else {
      await mkdir(config, { recursive: true })
      if (before) {
        backup = `${LIST}.galleon-backup-${stamp(now())}`
        // An earlier backup is never the one overwritten.
        await copyFile(path, join(config, backup), constants.COPYFILE_EXCL)
      }
      const partial = `${path}.galleon-partial`
      await writeFile(partial, after)
      await rename(partial, path)
    }
    await writeArt(join(config, 'grid'), result.appid, options.art ?? {})
    users.push({ user, change, ...(backup ? { backup } : {}) })
  }
  return { outcome: 'done', users }
}

/** A file-name-safe UTC time, to the millisecond, so backups sort by when. */
function stamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace('.', '')
}

async function writeArt(grid: string, appid: number, art: Record<string, Uint8Array>) {
  const entries = Object.entries(art)
  if (entries.length === 0) return
  await mkdir(grid, { recursive: true })
  for (const [suffix, bytes] of entries) {
    // 'wx' fails on a file already there, which is the owner's art.
    await writeFile(join(grid, `${appid}${suffix}`), bytes, { flag: 'wx' }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error
      }
    )
  }
}
