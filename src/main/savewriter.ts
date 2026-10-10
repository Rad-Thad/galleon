import { copyFile, mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { partialPathOf } from './romm/index.ts'
import { stampMtime, walk } from './savefiles.ts'
import { extractZip } from './zip.ts'
import { t } from './i18n.ts'
import { log } from './log.ts'

/**
 * The one module that changes anything inside an emulator's save tree.
 *
 * Every other module decides; this one writes. Keeping the writes in one place
 * is what makes a guard on them finished rather than one path's worth of
 * finished: the Argosy fork lost a whole Dolphin memory-card folder to a file
 * write with overwrite semantics, and the fix that holds is the choke point,
 * not a check beside whichever caller happened to show the bug. `savewriter.
 * allowlist.test.ts` fails a save module that reaches for the filesystem's
 * writing calls itself.
 *
 * What every write here promises:
 *
 * - a folder is never replaced by a file, and the refusal is logged;
 * - what was there is copied aside first, see `keepBackup`;
 * - the new bytes land whole or not at all: they are staged beside the save,
 *   flushed to the disk, renamed over it, and the rename flushed too, because a
 *   handheld that loses power right after a pull is an ordinary event;
 * - two writes to one save never interleave, see `exclusive`.
 */

/** Thrown when a write would put a file where a save folder is. */
export class SaveFolderInTheWay extends Error {
  constructor(readonly path: string) {
    super(t('error.saveIsFolder', { name: basename(path) }))
    this.name = 'SaveFolderInTheWay'
  }
}

const queues = new Map<string, Promise<unknown>>()

/**
 * Run `work` once every earlier write to the same path has settled.
 *
 * Keyed by the resolved path, so two spellings of one save share a queue. A
 * write that fails does not hold up the next one: each waits on its
 * predecessor settling, not succeeding.
 */
export function exclusive<T>(path: string, work: () => Promise<T>): Promise<T> {
  const key = resolve(path)
  const before = queues.get(key) ?? Promise.resolve()
  const mine = before.then(work, work)
  const settled = mine.then(
    () => undefined,
    () => undefined
  )
  queues.set(key, settled)
  void settled.then(() => {
    // Only where nothing queued behind this one, or the map grows by a save
    // every time one is written.
    if (queues.get(key) === settled) queues.delete(key)
  })
  return mine
}

async function isFolder(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null))?.isDirectory() ?? false
}

function refuse(path: string, staged: string): never {
  log.error('saves', 'refused to write a file over a save folder', undefined, { path, staged })
  throw new SaveFolderInTheWay(path)
}

/**
 * Flush a file, or a folder's list of names, to the disk.
 *
 * Best effort for a folder: some filesystems refuse to open one for this, and
 * the rename it would have made durable has already happened either way.
 */
async function flush(path: string, isDirectory = false): Promise<void> {
  let handle
  try {
    handle = await open(path, 'r')
    await handle.sync()
  } catch (cause) {
    if (!isDirectory) throw cause
    log.debug('saves', 'could not flush a folder after a rename', {
      path,
      reason: (cause as Error).message
    })
  } finally {
    await handle?.close()
  }
}

/**
 * Put a staged file in place of the save at `destination`.
 *
 * `staged` must be on the same disk as the destination, which is why callers
 * stage beside it (`partialPathOf`): a rename is only atomic within one
 * filesystem. A destination that is a folder is refused before anything is
 * touched.
 */
export function replaceSave(
  destination: string,
  staged: string,
  backups: string,
  mtimeMs?: number
): Promise<void> {
  return exclusive(destination, async () => {
    if (await isFolder(destination)) refuse(destination, staged)
    await mkdir(dirname(destination), { recursive: true })
    if (await stat(destination).catch(() => null)) await keepBackup(destination, backups)
    await flush(staged)
    await rename(staged, destination)
    await flush(dirname(destination), true)
    if (mtimeMs !== undefined) await stampMtime(destination, mtimeMs)
  })
}

/**
 * Unpack a folder save's archive over the folder the emulator reads.
 *
 * Overwrites in place rather than replacing the folder: a Switch save is a
 * handful of small files and the archive may not carry every one of them. The
 * folder is copied aside first, the archive is unpacked into a staging folder
 * beside it, and only once every entry is out and no entry would land on a
 * folder is anything moved in. Returns the files it put in place.
 */
export function unpackSave(dir: string, archive: string, backups: string): Promise<string[]> {
  return exclusive(dir, async () => {
    const staging = partialPathOf(dir)
    try {
      await rm(staging, { recursive: true, force: true })
      const staged = await extractZip(archive, staging)
      const moves = staged.map((from) => ({ from, to: join(dir, relative(staging, from)) }))
      for (const { from, to } of moves) if (await isFolder(to)) refuse(to, from)

      await mkdir(dir, { recursive: true })
      await keepBackup(dir, backups, true)
      for (const { from, to } of moves) {
        await mkdir(dirname(to), { recursive: true })
        await flush(from)
        await rename(from, to)
      }
      for (const folder of new Set(moves.map(({ to }) => dirname(to)))) await flush(folder, true)
      return moves.map(({ to }) => to)
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined)
    }
  })
}

/**
 * Where to stage a file bound for `destination`: beside it, so the rename that
 * puts it in place stays on one disk. The folder is made if it is missing.
 */
export async function stageBeside(destination: string): Promise<string> {
  await mkdir(dirname(destination), { recursive: true })
  return partialPathOf(destination)
}

/**
 * Remove a staged file or archive once it has been used or abandoned.
 *
 * Only something that is plainly staging — a `partialPathOf` name, or a file
 * in the system's temporary folder — so this cannot become a way around the
 * guards above. Failure is swallowed: a leftover is retried by the next write
 * to the same save.
 */
export async function discardStaged(path: string): Promise<void> {
  const fromTemp = relative(tmpdir(), resolve(path))
  const inTemp = fromTemp !== '' && !fromTemp.startsWith('..') && !isAbsolute(fromTemp)
  if (!inTemp && !path.endsWith(partialPathOf(''))) {
    log.error('saves', 'refused to discard a file that is not staging', undefined, { path })
    return
  }
  await rm(path, { force: true, recursive: true }).catch(() => undefined)
}

/** Delete a save the player asked to delete here, a copy being kept first. */
export function removeSave(path: string, backups: string): Promise<void> {
  return exclusive(path, async () => {
    const found = await stat(path).catch(() => null)
    if (!found) return
    await keepBackup(path, backups, found.isDirectory())
    await rm(path, { force: true, recursive: true })
  })
}

/**
 * How many copies of a save displaced by a pull are kept.
 *
 * More than one because the copy that matters is rarely the last: a pull that
 * lands the wrong save is noticed after the next launch has already pulled
 * again, and with a single copy the good one is gone by then.
 */
export const BACKUP_COPIES = 5

/**
 * Where one kept copy lives, slot 1 being the one taken most recently.
 *
 * In a folder of RomMix's rather than beside the save. The emulator's save tree
 * is the emulator's: Eden reads its own by walking a directory of title ids,
 * and a stray sibling of one is a folder RomMix has no business asking it to
 * ignore. It also puts every copy in one place a person can be sent to.
 */
export function backupPath(into: string, path: string, slot: number): string {
  return join(into, `${basename(path)}.${slot}`)
}

/**
 * Put a copy of a save aside before a pull writes over it.
 *
 * Numbered rather than dated: the oldest slot is dropped, every other shifts
 * down one, and what is on disk now is copied into the first. A slot is
 * arithmetic, and every path it touches is derived from the save's own —
 * nothing is deleted for having a name that looked like a backup's. Dated names
 * would mean pruning by what a listing sorts to, and the clock is not something
 * to prune by: a handheld that boots before its time is set dates a backup
 * years out, and the copy dropped as oldest is then the one worth keeping.
 *
 * Each copy keeps the mtime of the save it was taken from, so the date beside
 * it in a file manager is the session it belongs to rather than the pull that
 * displaced it. The slot number is then only recency.
 *
 * Nothing ever reads these back — restoring one is the person's own job, with a
 * file manager — so a failure anywhere is swallowed. A save that could not be
 * copied aside is a worse pull, not a failed one. Swallowed, but said: whether
 * a copy was kept is the first thing somebody looking for a save that is not
 * there needs to know, and the log is the only place they can be told.
 */
export async function keepBackup(path: string, into: string, isDirectory = false): Promise<void> {
  await step('create the folder displaced saves are kept in', { into }, () =>
    mkdir(into, { recursive: true })
  )
  await absorbSingleBackup(path, into, isDirectory)
  await rotate(path, into)

  const copy = backupPath(into, path, 1)
  await copyAside(path, copy, isDirectory)
  // Asked rather than assumed. Every step above swallows its own failure, so
  // the only honest thing to report is whether the copy is actually there.
  if (await stat(copy).catch(() => null)) {
    log.info('saves', 'kept a copy of the save about to be overwritten', {
      path,
      copy,
      keeping: BACKUP_COPIES
    })
  } else {
    log.warn('saves', 'the save about to be overwritten could not be copied aside', { path, copy })
  }
}

/**
 * One best-effort step of the backup chain, with what went wrong written down.
 *
 * Each of these swallows its failure — see `keepBackup` — and without a line
 * apiece a chain that half happened leaves exactly what a chain that went
 * through leaves: nothing.
 *
 * A missing file is not worth a line. Rotation renames slots nothing has
 * written yet on every save backed up fewer times than there are slots, and a
 * warning apiece would bury the one that means something.
 */
async function step(
  what: string,
  detail: Record<string, unknown>,
  run: () => Promise<unknown>
): Promise<void> {
  try {
    await run()
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return
    log.warn('saves', `could not ${what}`, { ...detail, reason: (cause as Error).message })
  }
}

/** Drop the oldest copy and move every other one slot further back. */
async function rotate(path: string, into: string): Promise<void> {
  const oldest = backupPath(into, path, BACKUP_COPIES)
  // Named before it goes, since a deletion nothing recorded is indistinguishable
  // afterwards from a copy that was never taken.
  if (await stat(oldest).catch(() => null)) {
    log.info('saves', 'dropping the oldest kept copy of a save', { copy: oldest })
  }
  await step('drop the oldest kept copy of a save', { copy: oldest }, () =>
    rm(oldest, { recursive: true, force: true })
  )
  for (let slot = BACKUP_COPIES - 1; slot >= 1; slot -= 1) {
    await step('move a kept copy one slot back', { path, slot }, () =>
      rename(backupPath(into, path, slot), backupPath(into, path, slot + 1))
    )
  }
}

/** Copy a save, file or folder, dating what lands as what it was taken from. */
async function copyAside(from: string, to: string, isDirectory: boolean): Promise<void> {
  if (isDirectory) {
    await cpDirectory(from, to)
    for (const file of await walk(to)) {
      await stampAsSource(file, join(from, file.slice(to.length + 1)))
    }
  } else {
    await step('copy a save aside', { from, to }, () => copyFile(from, to))
  }
  await stampAsSource(to, from)
}

/** Date a copy as the file it was taken from, `copyFile` having dated it now. */
async function stampAsSource(copy: string, source: string): Promise<void> {
  const when = (await stat(source).catch(() => null))?.mtimeMs
  if (when !== undefined) await stampMtime(copy, when)
}

/**
 * MIGRATION(0.11): take in the copy left beside the save by a version that
 * kept one there.
 *
 * It goes onto the chain first, so the pull that follows pushes it back a slot
 * like any other: it is the most recent copy that existed before this one. Then
 * it is gone from the emulator's tree, which is the point — nothing writes that
 * name any more, and a file no rotation can reach would sit there for good.
 *
 * Copied rather than renamed. The RomMix folder and an emulator's saves are
 * routinely on different disks — a handheld keeps one on the card — and a
 * rename across them fails.
 */
async function absorbSingleBackup(path: string, into: string, isDirectory: boolean): Promise<void> {
  const single = `${path}.rommix-bak`
  if (!(await stat(single).catch(() => null))) return
  log.info('saves', 'taking in the copy an older RomMix kept beside the save', {
    copy: single,
    into
  })
  await rotate(path, into)
  await copyAside(single, backupPath(into, path, 1), isDirectory)
  await step('remove the copy an older RomMix kept beside the save', { copy: single }, () =>
    rm(single, { recursive: true, force: true })
  )
}

/** Recursive copy, for the backup taken before a directory save is overwritten. */
export async function cpDirectory(from: string, to: string): Promise<void> {
  let entries
  try {
    entries = await readdir(from, { withFileTypes: true })
  } catch (cause) {
    log.debug('saves', 'nothing to copy aside: the folder could not be read', {
      from,
      reason: (cause as Error).message
    })
    return
  }
  await mkdir(to, { recursive: true })
  for (const entry of entries) {
    const source = join(from, entry.name)
    const target = join(to, entry.name)
    if (entry.isDirectory()) await cpDirectory(source, target)
    else
      await step('copy a file of a save folder aside', { source, target }, () =>
        copyFile(source, target)
      )
  }
}
