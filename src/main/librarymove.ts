import { stat } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { SHARED_LIBRARY } from '@shared/types'
import type { InstalledRom, LibraryMoveGame, LibraryMovePlan } from '@shared/types'
import { fits, nearest, spaceOf } from './disk.ts'
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
      const target = join(toReal, relative(fromReal, real))
      if (await present(target)) taken.push(rom.romId)
      games.push({
        romId: rom.romId,
        name: rom.name,
        system: rom.system,
        from: real,
        to: target,
        sizeBytes: await sizeOf(real, rom.isDirectory)
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
