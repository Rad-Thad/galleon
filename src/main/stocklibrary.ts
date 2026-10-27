import { existsSync, readFileSync } from 'node:fs'
import { basename, isAbsolute, join, relative } from 'node:path'
import { SHARED_LIBRARY } from '@shared/types'
import type { InstalledRom, LibraryMovePlan, LibraryMoveResult } from '@shared/types'
import { t } from './i18n.ts'
import { log } from './log.ts'
import {
  moveLibrary,
  planLibraryMove,
  refuseUnmovable,
  type FolderChangeSources
} from './librarymove.ts'
import { RommError } from './romm/index.ts'
import { homeFromEnvironment } from './root.ts'
import { resolveExisting } from './volumes.ts'
import { realHome, xdgConfigHome } from './xdg.ts'

/**
 * The games stock RomMix downloaded before Galleon was installed.
 *
 * Galleon keeps its own home and never shares stock RomMix's (see `root.ts`),
 * so a game stock RomMix put in its own folder is invisible to Galleon until
 * the player asks for it. They can adopt such games where they are, which
 * records them in Galleon's index, or move them into Galleon's library, which
 * adopts them and then carries them with `moveLibrary`. Stock RomMix's own
 * files are only read here: its index and settings are left as they are.
 */

/**
 * Stock RomMix's home: its pointer file when there is one, `~/rommix`
 * otherwise. Its environment variable is not read, since Galleon is not
 * started from stock RomMix's environment.
 */
export function stockRomMixRoot(): string {
  try {
    const pointer = readFileSync(join(xdgConfigHome(), 'rommix', 'root'), 'utf8').trim()
    if (pointer) return pointer
  } catch {
    // No pointer: stock RomMix kept its default home, or was never installed.
  }
  return join(realHome(), 'rommix')
}

/** Stock RomMix's games that Galleon's index does not have yet. */
export interface StockLibrary {
  /** Stock RomMix's game folder, resolved. */
  folder: string
  games: InstalledRom[]
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function within(path: string, folder: string): boolean {
  const rest = relative(folder, path)
  return rest === '' || (rest !== '..' && !rest.startsWith('../') && !isAbsolute(rest))
}

/** A server address as two installations would both write it. */
function sameServer(a: string, b: string): boolean {
  const plain = (url: string): string => url.trim().replace(/\/+$/, '').toLowerCase()
  return plain(a) === plain(b)
}

/**
 * One entry of stock RomMix's index, as Galleon's index would hold it, or
 * nothing when it is not a shared-library game inside `folder` that is still
 * on the disk. Read as untrusted: a path outside the folder would be adopted
 * and later removed by an uninstall.
 */
function acceptEntry(value: unknown, folder: string): InstalledRom | null {
  if (typeof value !== 'object' || value === null) return null
  const entry = value as Record<string, unknown>
  const text = (key: string): string | null =>
    typeof entry[key] === 'string' ? (entry[key] as string) : null
  const path = text('path')
  const launchPath = text('launchPath') ?? path
  const system = text('system')
  if (typeof entry.romId !== 'number' || !Number.isInteger(entry.romId)) return null
  if (entry.emulatorId !== SHARED_LIBRARY || !path || !launchPath || !system) return null
  if (!isAbsolute(path) || !isAbsolute(launchPath)) return null
  const real = resolveExisting(path)
  if (real === folder || !within(real, folder) || !within(resolveExisting(launchPath), folder)) {
    return null
  }
  if (!existsSync(real)) return null
  const files = Array.isArray(entry.files)
    ? entry.files.filter((file): file is string => typeof file === 'string')
    : []
  return {
    romId: entry.romId,
    path,
    launchPath,
    name: text('name') ?? basename(path),
    coverPath: text('coverPath'),
    files,
    system,
    platformName: text('platformName') ?? system,
    sizeBytes: typeof entry.sizeBytes === 'number' ? entry.sizeBytes : 0,
    installedAt: text('installedAt') ?? new Date(0).toISOString(),
    isDirectory: entry.isDirectory === true,
    emulatorId: SHARED_LIBRARY
  }
}

/**
 * Stock RomMix's games under its home `root`, for the server Galleon is
 * signed in to.
 *
 * Nothing when Galleon has no server yet or stock RomMix's is another: a game
 * is known by its id on one server, and the same id on another is another
 * game. Nothing under `GALLEON_HOME` either, the device self-test's home,
 * which must leave the owner's own files alone.
 */
export function readStockLibrary(
  root: string,
  server: string | null,
  known: (romId: number) => boolean
): StockLibrary | null {
  if (homeFromEnvironment() || !server) return null
  const settings = readJson(join(root, 'config', 'settings.json'))
  const stockServer = (settings?.server as Record<string, unknown> | undefined)?.baseUrl
  if (typeof stockServer !== 'string' || !sameServer(stockServer, server)) return null

  const folder = resolveExisting(join(root, 'roms'))
  const roms = readJson(join(root, 'config', 'downloaded_roms.json'))?.roms
  const games: InstalledRom[] = []
  for (const value of Array.isArray(roms) ? roms : []) {
    const entry = acceptEntry(value, folder)
    if (entry && !known(entry.romId) && !games.some((game) => game.romId === entry.romId)) {
      games.push(entry)
    }
  }
  return { folder, games }
}

/** What adopting or moving stock RomMix's games reads and writes. */
export interface StockSources extends FolderChangeSources {
  index: FolderChangeSources['index'] & {
    addInstalledMany(entries: readonly InstalledRom[]): void
  }
}

/** Record stock RomMix's games in Galleon's index where they are. */
export function adoptStockLibrary(sources: StockSources, stock: StockLibrary): number {
  sources.index.addInstalledMany(stock.games)
  log.info('library', "adopted stock RomMix's games", { count: stock.games.length })
  return stock.games.length
}

/**
 * What moving stock RomMix's games into the library would carry: those not
 * adopted yet, and those adopted earlier and still in its folder.
 */
export function planStockMove(
  sources: FolderChangeSources,
  stock: StockLibrary
): Promise<LibraryMovePlan> {
  return planLibraryMove(
    [...sources.installed(), ...stock.games],
    stock.folder,
    sources.folderOf(sources.libraryRoot())
  )
}

/**
 * Adopt stock RomMix's games, then carry them into the library.
 *
 * Refused, with nothing adopted, for the reasons a library move is (see
 * `refuseUnmovable`). Adopted first, so a move that stops part-way leaves
 * every game it did not reach playable where it is, and asking again carries
 * on with them.
 */
export async function moveStockLibrary(
  sources: StockSources,
  stock: StockLibrary,
  move: typeof moveLibrary = moveLibrary
): Promise<LibraryMoveResult> {
  if (sources.downloading()) throw new RommError(t('error.libraryMoveBusy'))
  const plan = await planStockMove(sources, stock)
  await refuseUnmovable(sources, plan)
  adoptStockLibrary(sources, stock)
  return move(plan, sources.index)
}
