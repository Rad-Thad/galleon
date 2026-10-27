import { constants } from 'node:fs'
import { access, mkdir } from 'node:fs/promises'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import { cardVolumes, chooseLibraryVolume } from '@shared/librarycard'
import type { InternalReason, Volume } from '@shared/librarycard'
import type { LibraryFolderChoice } from '@shared/types'
import { spaceOf } from './disk.ts'
import { log } from './log.ts'
import { readVolumes, resolveExisting } from './volumes.ts'

/**
 * Where a fresh installation's game library goes.
 *
 * The SD card when one qualifies (see `chooseLibraryVolume`), and the root's
 * own folder otherwise. Asked once, before anything has been downloaded, so
 * the answer moves nothing.
 */

/**
 * The library's folder on a card, below its mount point.
 *
 * A folder of Galleon's own rather than the card's top level, so the games sit
 * beside whatever else is on the card instead of among it, and the card holds
 * the same `galleon/roms` layout the root does.
 */
export const CARD_LIBRARY_PATH = ['galleon', 'roms'] as const

/** Why the library stays in the root's own folder. */
export type StayReason = InternalReason | 'not-writable'

export interface DefaultLibrary {
  /** The value for `Settings.libraryRoot`: '' for the root's own folder. */
  libraryRoot: string
  /** The card it went on, when it went on one. */
  volume: Volume | null
  /** Why it did not go on a card, when it did not. */
  reason: StayReason | null
}

export interface DefaultLibrarySources {
  volumes?: () => Promise<Volume[]>
  user?: string
  /** Make the folder and say whether it can be written to. */
  prepare?: (dir: string) => Promise<boolean>
}

/**
 * Make the library's folder on the card and see it can be written to.
 *
 * Made now rather than at the first download, for the reason `ensureRoot`
 * makes the root's: an emulator's game folder has to exist before the user
 * can point it there. A card that will not take a folder is not one to put the
 * library on, whatever its mount options say.
 */
export async function prepareFolder(dir: string): Promise<boolean> {
  try {
    await mkdir(dir, { recursive: true })
    await access(dir, constants.W_OK)
    return true
  } catch (cause) {
    log.warn('library', 'the card would not take the library folder', {
      dir,
      reason: (cause as Error).message
    })
    return false
  }
}

/**
 * The user the card would be mounted for. `userInfo` throws for a uid with no
 * passwd entry, as in some containers, and this runs before the window opens.
 */
function currentUser(): string {
  try {
    return userInfo().username
  } catch {
    return process.env.USER ?? ''
  }
}

/** The library a fresh installation starts with. Never throws. */
export async function chooseDefaultLibrary(
  sources: DefaultLibrarySources = {}
): Promise<DefaultLibrary> {
  const volumes = await (sources.volumes ?? readVolumes)()
  const choice = chooseLibraryVolume(volumes, sources.user ?? currentUser())
  if (choice.kind === 'internal') return { libraryRoot: '', volume: null, reason: choice.reason }

  const dir = join(choice.volume.mountPoint, ...CARD_LIBRARY_PATH)
  if (!(await (sources.prepare ?? prepareFolder)(dir))) {
    return { libraryRoot: '', volume: null, reason: 'not-writable' }
  }
  return { libraryRoot: dir, volume: choice.volume, reason: null }
}

/**
 * The folders Settings offers to move the library to.
 *
 * A list rather than a folder browser, since it is chosen with a gamepad: the
 * root's own folder, the same `CARD_LIBRARY_PATH` folder on each card that can
 * be written to, and the folder in use now when it is neither. Folders are
 * compared resolved, so a library set through a link to the card is that
 * card's folder.
 */
export async function libraryFolderChoices(
  libraryRoot: string,
  internal: string,
  sources: Pick<DefaultLibrarySources, 'volumes' | 'user'> = {}
): Promise<LibraryFolderChoice[]> {
  const current = resolveExisting(libraryRoot || internal)
  const room = async (dir: string): Promise<number | null> =>
    (await spaceOf(dir))?.freeBytes ?? null
  const choices: LibraryFolderChoice[] = [
    {
      libraryRoot: '',
      path: internal,
      label: null,
      freeBytes: await room(internal),
      current: false
    }
  ]
  const cards = cardVolumes(await (sources.volumes ?? readVolumes)(), sources.user ?? currentUser())
  for (const card of cards) {
    if (card.readOnly) continue
    const dir = join(card.mountPoint, ...CARD_LIBRARY_PATH)
    choices.push({
      libraryRoot: dir,
      path: dir,
      label: card.label,
      freeBytes: card.freeBytes,
      current: false
    })
  }
  for (const choice of choices) choice.current = resolveExisting(choice.path) === current
  if (!choices.some((choice) => choice.current)) {
    choices.push({
      libraryRoot,
      path: libraryRoot,
      label: null,
      freeBytes: await room(libraryRoot),
      current: true
    })
  }
  return choices
}
