import { constants } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { SKIP, type CheckResult, type Scenario } from './selftest.ts'
import { type GalleonShortcut, upsertShortcut } from './steam/addshortcut.ts'
import { type BinaryVdfField, findField, readBinaryVdf, writeBinaryVdf } from './steam/binaryvdf.ts'
import { STEAM_ROOT } from './steam/library.ts'

/**
 * `steam.shortcut-roundtrip`: Galleon's binary VDF writer tried on the
 * owner's own shortcut lists, which no fixture can stand in for, without
 * ever writing to them.
 *
 * Each list is copied into the test home and only the copy is changed: read
 * and written back, then given a Galleon entry, then that entry updated. Each
 * step must leave every other entry's bytes as they were, which is what
 * `addToSteam` relies on when it writes the real list. The copies go when
 * the check ends; they hold the owner's shortcuts.
 *
 * Only counts are published. A list's folder is the owner's Steam account
 * number, so copies are named by their place in the folder order instead.
 */

export const SHORTCUT_ROUNDTRIP_CHECK = 'steam.shortcut-roundtrip'

/** Where the copies go, inside the test home. */
export const ROUNDTRIP_DIR = 'shortcut-roundtrip'

/**
 * The entry added to each copy. Its program is in the test home, so it can
 * match no entry the owner has, and the check always adds before it updates.
 */
export function roundtripShortcut(work: string): GalleonShortcut {
  return {
    name: 'Galleon Round Trip',
    exe: `"${join(work, 'galleon-steam.sh')}"`,
    startDir: `"${work}/"`,
    launchOptions: '',
    icon: ''
  }
}

/** What the update changes, so it can be seen to have happened. */
const UPDATED_OPTIONS = '%command% --round-trip'

export interface ShortcutRoundtripSources {
  /** The owner's home, where Steam keeps the lists. */
  home?: string
  /** The test home; the copies are made under it. */
  work: string
  /** The code under test; a test swaps in a faulty one to see the check fail. */
  upsert?: typeof upsertShortcut
  write?: typeof writeBinaryVdf
}

export function shortcutRoundtripScenario(sources: ShortcutRoundtripSources): Scenario {
  const home = sources.home ?? homedir()
  const dir = join(sources.work, ROUNDTRIP_DIR)
  const upsert = sources.upsert ?? upsertShortcut
  const write = sources.write ?? writeBinaryVdf
  return async ({ signal }) => {
    const started = performance.now()
    const answer = (
      result: CheckResult['result'],
      reason: string | null,
      metrics: CheckResult['metrics'] = {}
    ): CheckResult => ({
      id: SHORTCUT_ROUNDTRIP_CHECK,
      result,
      metrics,
      thresholds: result === 'skip' ? {} : { notExact: 0, notByteForByte: 0, othersChanged: 0 },
      reason,
      evidence: []
    })

    const userdata = join(home, ...STEAM_ROOT, 'userdata')
    const folders = (await readdir(userdata).catch(() => [] as string[]))
      .filter((name) => /^\d+$/.test(name))
      .sort()
    const counts = {
      lists: 0,
      entries: 0,
      notExact: 0,
      notByteForByte: 0,
      othersChanged: 0,
      addFailed: 0,
      duplicated: 0,
      notUpdated: 0
    }
    const failures: string[] = []
    const fail = (reason: string, count: keyof typeof counts) => {
      counts[count]++
      failures.push(reason)
    }

    await rm(dir, { recursive: true, force: true })
    await mkdir(dir, { recursive: true })
    try {
      for (const user of folders) {
        if (signal.aborted) return answer('skip', SKIP.aborted)
        const copy = join(dir, `${counts.lists}.vdf`)
        try {
          // EXCL: a copy is only ever a new file in the test home.
          await copyFile(
            join(userdata, user, 'config', 'shortcuts.vdf'),
            copy,
            constants.COPYFILE_EXCL
          )
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
          throw error
        }
        counts.lists++
        const original = new Uint8Array(await readFile(copy))

        const fields = readBinaryVdf(original)
        if (!fields) {
          fail('not-exact', 'notExact')
          continue
        }
        counts.entries += entriesOf(fields)?.length ?? 0
        if (!sameBytes(write(fields), original)) {
          fail('not-byte-for-byte', 'notByteForByte')
          continue
        }

        const shortcut = roundtripShortcut(sources.work)
        const added = upsert(readBinaryVdf(original)!, shortcut)
        if (added?.change !== 'added') {
          fail('add-failed', 'addFailed')
          continue
        }
        const afterAdd = await rewrite(copy, write(added.fields))
        if (!afterAdd || !othersKept(original, afterAdd, 1)) {
          fail('others-changed', 'othersChanged')
          continue
        }

        const updated = upsert(afterAdd, { ...shortcut, launchOptions: UPDATED_OPTIONS })
        if (updated?.change !== 'updated') {
          fail('duplicated', 'duplicated')
          continue
        }
        const afterUpdate = await rewrite(copy, write(updated.fields))
        if (!afterUpdate || !othersKept(original, afterUpdate, 1)) {
          fail('others-changed', 'othersChanged')
          continue
        }
        const entry = entriesOf(afterUpdate)?.at(-1)
        const options = entry?.type === 'map' ? findField(entry.fields, 'LaunchOptions') : undefined
        const appid = entry?.type === 'map' ? findField(entry.fields, 'appid') : undefined
        if (
          options?.type !== 'string' ||
          options.value !== UPDATED_OPTIONS ||
          appid?.type !== 'int32' ||
          appid.value >>> 0 !== added.appid
        ) {
          fail('not-updated', 'notUpdated')
        }
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }

    const metrics = { ...counts, roundtripMs: Math.round(performance.now() - started) }
    if (counts.lists === 0) return answer('skip', 'no-shortcut-list', metrics)
    return failures.length > 0
      ? answer('fail', failures[0], metrics)
      : answer('pass', null, metrics)
  }
}

/** Written to the copy and read back from it, as `addToSteam` would leave it. */
async function rewrite(path: string, bytes: Uint8Array): Promise<BinaryVdfField[] | null> {
  await writeFile(path, bytes)
  return readBinaryVdf(await readFile(path))
}

function entriesOf(fields: BinaryVdfField[]): BinaryVdfField[] | undefined {
  const list = findField(fields, 'shortcuts')
  return list?.type === 'map' ? list.fields : undefined
}

/**
 * Whether the changed list holds the original's fields byte for byte, every
 * entry of the original in its place, with only `extra` entries after them.
 */
function othersKept(original: Uint8Array, after: BinaryVdfField[], extra: number): boolean {
  const before = readBinaryVdf(original)!
  if (before.length !== after.length) return false
  for (const [i, field] of before.entries()) {
    const other = after[i]
    if (field.name === 'shortcuts' && field.type === 'map' && other.type === 'map') {
      if (other.name !== field.name || other.fields.length !== field.fields.length + extra) {
        return false
      }
      const kept: BinaryVdfField = { ...other, fields: other.fields.slice(0, field.fields.length) }
      if (!sameBytes(writeBinaryVdf([kept]), writeBinaryVdf([field]))) return false
    } else if (!sameBytes(writeBinaryVdf([other]), writeBinaryVdf([field]))) {
      return false
    }
  }
  return true
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return Buffer.from(a).equals(b)
}
