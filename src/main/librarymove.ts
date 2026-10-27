import { cp, mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { SHARED_LIBRARY } from '@shared/types'
import type { InstalledRom, LibraryMoveGame, LibraryMovePlan } from '@shared/types'
import { fits, nearest, spaceOf } from './disk.ts'
import { t } from './i18n.ts'
import { log } from './log.ts'
import { sizeOf } from './savefiles.ts'
import { resolveExisting } from './volumes.ts'

/**
 * What changing the library folder would carry with it.
 *
 * Changing the folder moves nothing on its own: the games already downloaded
 * are listed with what each one weighs, and the room where they would go, so
 * the player is asked with the cost in front of them. Only the shared library
 * moves; a game kept in an emulator's own folder stays where that emulator
 * looks for it.
 */

/** Whether `path` is `folder` or somewhere below it, both resolved. */
function within(path: string, folder: string): boolean {
  const rest = relative(folder, path)
  return rest === '' || (rest !== '..' && !rest.startsWith('../') && !isAbsolute(rest))
}

async function deviceOf(path: string): Promise<number | null> {
  const at = await nearest(path)
  if (!at) return null
  return (await stat(at).catch(() => null))?.dev ?? null
}

/**
 * What a game is on the disk: its folder, or a loose game's files beside its
 * path. A loose game's `files` are named relative to the system folder it is
 * in, as the download records them; a name that would reach outside it is not
 * the game's to carry.
 */
function partsOf(rom: InstalledRom, real: string): string[] {
  if (rom.isDirectory) return [real]
  const folder = dirname(real)
  const parts = [real]
  for (const name of rom.files) {
    const path = resolve(folder, name)
    if (dirname(path) === folder && !parts.includes(path)) parts.push(path)
  }
  return parts
}

async function present(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null)) !== null
}

/**
 * Plan moving the library from one folder to another.
 *
 * Paths are compared resolved, so a folder reached through a link (the card's
 * `/run/media/NovaSD`) is the folder it leads to. A new folder inside the
 * current one is refused: the move would carry the library into itself.
 */
export async function planLibraryMove(
  installed: readonly InstalledRom[],
  from: string,
  to: string
): Promise<LibraryMovePlan> {
  const fromReal = resolveExisting(from)
  const toReal = resolveExisting(to)
  const refused =
    fromReal === toReal ? 'same-folder' : within(toReal, fromReal) ? 'inside-library' : null

  const games: LibraryMoveGame[] = []
  const missing: number[] = []
  const taken: number[] = []
  if (!refused) {
    for (const rom of installed) {
      if (rom.emulatorId !== SHARED_LIBRARY) continue
      const real = resolveExisting(rom.path)
      if (!within(real, fromReal)) continue
      if (!(await present(real))) {
        missing.push(rom.romId)
        continue
      }
      const moved = (path: string): string => join(toReal, relative(fromReal, path))
      const parts = []
      for (const path of partsOf(rom, real)) {
        if (path === real || (await present(path))) parts.push({ from: path, to: moved(path) })
      }
      let sizeBytes = 0
      let occupied = false
      for (const part of parts) {
        sizeBytes += await sizeOf(part.from, rom.isDirectory)
        occupied ||= await present(part.to)
      }
      if (occupied) taken.push(rom.romId)
      games.push({
        romId: rom.romId,
        name: rom.name,
        system: rom.system,
        from: real,
        to: moved(real),
        parts,
        sizeBytes
      })
    }
  }

  const totalBytes = games.reduce((sum, game) => sum + game.sizeBytes, 0)
  const [fromDevice, toDevice] = [await deviceOf(fromReal), await deviceOf(toReal)]
  const sameDrive = fromDevice !== null && fromDevice === toDevice
  const freeBytes = (await spaceOf(toReal))?.freeBytes ?? null
  return {
    from: fromReal,
    to: toReal,
    refused,
    games,
    totalBytes,
    missing,
    taken,
    sameDrive,
    freeBytes,
    // Unmeasured room is not a refusal, as with a download (see `fits`): the
    // copy itself still fails cleanly on a full disk.
    fits: sameDrive || freeBytes === null || fits(totalBytes, freeBytes)
  }
}

/** The index as a move needs it. See `Store`. */
export interface MoveIndex {
  getInstalled(romId: number): InstalledRom | undefined
  addInstalled(entry: InstalledRom): void
}

/** What a library move did, game by game. */
export interface LibraryMoveResult {
  moved: number[]
  /** Left where they are: something already occupies their place. */
  skipped: number[]
  /** The game the move stopped at, and why, when it did not finish. */
  failed: { romId: number; reason: string } | null
  /** Originals of moved games that could not be removed, still taking room. */
  leftovers: string[]
}

/** How a part is copied to another drive. Replaceable so tests can break it. */
export type CopyPart = (from: string, to: string) => Promise<void>

const copyPart: CopyPart = (from, to) =>
  // Links are copied as they are: resolved, a link inside a game folder would
  // point back at the original, which is about to go.
  cp(from, to, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true })

/** The suffix a copy is made under until it is whole. */
const COPYING = '.galleon-moving'

/**
 * Carry out a plan, one game at a time.
 *
 * On one drive each part is renamed. On another, each is copied under a
 * temporary name, its size checked against the original, and only then given
 * its name. A game is recorded in the index once every part of it is in its
 * new place, and only then are the originals removed, so a copy interrupted
 * at any point leaves every game findable: at worst a moved game's original is
 * left behind as well. An index that cannot be written throws, with the game
 * put back where the index still says it is. A game that fails is put back as
 * it was and stops the move, since a full disk would fail every game after it. Something found at a game's new
 * place, even one the plan did not see, leaves that game where it is rather
 * than replacing it, as does a game the index no longer has where the plan
 * found it.
 */
export async function moveLibrary(
  plan: LibraryMovePlan,
  index: MoveIndex,
  copy: CopyPart = copyPart
): Promise<LibraryMoveResult> {
  const result: LibraryMoveResult = { moved: [], skipped: [], failed: null, leftovers: [] }
  if (plan.refused) return result

  for (const game of plan.games) {
    const entry = index.getInstalled(game.romId)
    if (!entry || resolveExisting(entry.path) !== game.from) continue
    if (await anyPresent(game.parts.map((part) => part.to))) {
      result.skipped.push(game.romId)
      continue
    }
    let undo: () => Promise<void>
    try {
      undo = await place(game, plan.sameDrive, entry.isDirectory, copy)
    } catch (cause) {
      result.failed = { romId: game.romId, reason: (cause as Error).message }
      log.warn('library', 'the library move stopped', {
        romId: game.romId,
        reason: (cause as Error).message
      })
      break
    }
    const moved = (path: string): string => {
      const real = resolveExisting(path)
      return within(real, game.from) ? join(game.to, relative(game.from, real)) : path
    }
    try {
      index.addInstalled({ ...entry, path: game.to, launchPath: moved(entry.launchPath) })
    } catch (cause) {
      await undo()
      throw cause
    }
    result.moved.push(game.romId)
    if (!plan.sameDrive) {
      for (const part of game.parts) {
        await rm(part.from, { recursive: true, force: true }).catch((cause: Error) => {
          log.warn('library', 'a moved game left its original behind', {
            path: part.from,
            reason: cause.message
          })
          result.leftovers.push(part.from)
        })
      }
    }
  }

  log.info('library', 'the library move finished', {
    from: plan.from,
    to: plan.to,
    moved: result.moved.length,
    skipped: result.skipped.length,
    failed: result.failed !== null,
    leftovers: result.leftovers.length
  })
  return result
}

async function anyPresent(paths: readonly string[]): Promise<boolean> {
  for (const path of paths) if (await present(path)) return true
  return false
}

/**
 * Put every part of a game in its new place, or none of them.
 *
 * Originals are left for the caller to remove once the index says where the
 * game is. A failure part-way undoes what was done: renamed parts are renamed
 * back, copies are removed. The same undoing is handed back, for an index that
 * will not take the game's new place.
 */
async function place(
  game: LibraryMoveGame,
  sameDrive: boolean,
  isDirectory: boolean,
  copy: CopyPart
): Promise<() => Promise<void>> {
  if (sameDrive) {
    const renamed: LibraryMoveGame['parts'] = []
    const renameBack = async (): Promise<void> => {
      for (const part of renamed.toReversed()) await rename(part.to, part.from)
    }
    try {
      for (const part of game.parts) {
        await mkdir(dirname(part.to), { recursive: true })
        await rename(part.from, part.to)
        renamed.push(part)
      }
    } catch (cause) {
      await renameBack()
      throw cause
    }
    return renameBack
  }

  const made: string[] = []
  const removeCopies = async (): Promise<void> => {
    for (const path of made) await rm(path, { recursive: true, force: true })
  }
  try {
    for (const part of game.parts) {
      await mkdir(dirname(part.to), { recursive: true })
      const copying = `${part.to}${COPYING}`
      made.push(copying)
      await copy(part.from, copying)
      const [want, got] = [await sizeOf(part.from, isDirectory), await sizeOf(copying, isDirectory)]
      if (want !== got) throw new Error(t('error.libraryMoveIncomplete', { name: game.name }))
    }
    for (const part of game.parts) {
      await rename(`${part.to}${COPYING}`, part.to)
      made.push(part.to)
    }
  } catch (cause) {
    // Nothing of the original has been touched, so taking the copies away
    // leaves the game as it was.
    await removeCopies()
    throw cause
  }
  return removeCopies
}
