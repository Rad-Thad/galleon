// Relative, with the extension: this module is imported both by the bundler
// and by Node's TypeScript stripping in the tests, and the latter resolves no
// aliases. `shared/types/` reaches into config the same way.
import {
  CONTAINER_SYSTEMS,
  DESCRIPTOR_EXTENSIONS,
  DISC_IMAGE_EXTENSIONS,
  PLAYLIST_SYSTEMS,
  ROMSET_SYSTEMS,
  SIDECAR_EXTENSIONS
} from '../config/romfiles.ts'
import type { ContainerFormat } from '../config/romfiles.ts'
import type { RommRom, RommRomFile } from './types/romm.ts'

/**
 * The file at the end of a path.
 *
 * `basename` without `node:path`, which the renderer has no access to — and the
 * renderer is where every caller is, falling back to the file when RomM has no
 * name for a game. RomMix only ever runs on Linux, so a separator is a slash.
 */
export function fileNameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/**
 * The directory a path is in.
 *
 * `dirname` on the same terms as `fileNameOf` above, and for the same callers:
 * the screens that say where a game, a save or a downloaded copy lives on this
 * disk name the folder rather than the file, which is the part a user can go
 * and look in. A path with no directory in front of it is left as it is —
 * there is no folder to name, and inventing one would be a lie about where the
 * file is.
 */
export function folderOf(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut === -1 ? path : path.slice(0, cut)
}

/**
 * Deciding which file inside a multi-file game is the one to launch.
 *
 * Emulators take a file, never the directory holding it, so an extracted game
 * needs exactly one of its files nominated. The rule is kept here, separate
 * from the filesystem walk that feeds it, because it is a heuristic applied
 * across every system in `SYSTEMS` and is the part worth testing. Which extensions count
 * as what is data, and lives in `src/config/romfiles.ts`.
 */

/** A file inside an extracted game. */
export interface GameFile {
  name: string
  sizeBytes: number
}

const SIDECARS: ReadonlySet<string> = new Set(SIDECAR_EXTENSIONS)
const ROMSETS: ReadonlySet<string> = new Set(ROMSET_SYSTEMS)

/**
 * Does this system take an archive as the game itself?
 *
 * The question a downloaded archive has to be asked before it is opened. A zip
 * arriving from RomM is usually transport — RomM zips a lone ROM to serve it,
 * and builds one out of a game of several files — and unpacking it is what puts
 * the game where an emulator can find it. On the systems listed in
 * `ROMSET_SYSTEMS` it is the game, and unpacking it destroys it.
 *
 * Nothing in the bytes tells the two apart; both are a zip. The system is the
 * only thing that does, which is why this is asked of it rather than of the
 * file. Without one the answer is no, since every other system's archive is
 * transport.
 */
export function archiveIsTheRom(system?: string): boolean {
  return system !== undefined && ROMSETS.has(system)
}

/** Lowercase extension including the dot, or '' when there is none. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot).toLowerCase()
}

/**
 * The file to launch, or null when nothing in the list qualifies.
 *
 * Anything left after the sidecars are dropped and no descriptor is found
 * falls back to the largest file: the game itself is reliably bigger than the
 * manuals and artwork shipped beside it.
 *
 * `system` is the ES-DE system the game belongs to, and is what excuses a
 * handful of them from the descriptor rule — see `CONTAINER_SYSTEMS`. Omitting
 * it asks the question that has always been asked, which is the right one
 * everywhere else.
 */
export function chooseLaunchFile(files: readonly GameFile[], system?: string): string | null {
  const candidates = files.filter((file) => !SIDECARS.has(extensionOf(file.name)))
  if (candidates.length === 0) return null

  const format = system ? CONTAINER_SYSTEMS[system] : undefined
  if (format) {
    const container = chooseContainer(candidates, format)
    // No container at all means this is not the shape the system's rule
    // describes — a homebrew .nro, or a dump in some other format — so the
    // general rule answers instead of nothing being launchable.
    if (container) return container
  }

  for (const wanted of DESCRIPTOR_EXTENSIONS) {
    const hit = candidates.find((file) => extensionOf(file.name) === wanted)
    if (hit) return hit.name
  }

  return largest(candidates).name
}

/**
 * The base game among a container system's files, or null when there is none.
 *
 * Updates and DLC are dropped first, because size cannot separate them: a
 * patch is occasionally the larger download, and one that is not the game
 * boots to nothing whichever way round they came out. When *every* container
 * looks like an add-on the marks are not to be trusted — a filename carrying
 * something that reads like a title id, most likely — and the choice falls
 * back to size across all of them rather than to nothing.
 */
function chooseContainer(candidates: readonly GameFile[], format: ContainerFormat): string | null {
  const containers = candidates.filter((file) => format.extensions.includes(extensionOf(file.name)))
  if (containers.length === 0) return null

  const isAddOn = (name: string): boolean =>
    format.addOnPatterns.some((pattern) => pattern.test(name))
  const base = containers.filter((file) => !isAddOn(file.name))
  return largest(base.length > 0 ? base : containers).name
}

/**
 * Is this a file the system's emulators can be handed at all?
 *
 * Only ever answers no where RomMix knows the whole set of things a game can
 * be — the container systems — since anywhere else the answer would have to be
 * a list of every ROM extension in existence, and a game with an unexpected one
 * would be declared unplayable for no better reason than that.
 */
export function isLaunchable(name: string, system?: string): boolean {
  const format = system ? CONTAINER_SYSTEMS[system] : undefined
  return !format || format.extensions.includes(extensionOf(name))
}

/** The biggest of a non-empty list. */
function largest(files: readonly GameFile[]): GameFile {
  let best = files[0]
  for (const file of files) {
    if (file.sizeBytes > best.sizeBytes) best = file
  }
  return best
}

/**
 * Where one of a multi-file game's files sits inside the game's own folder.
 *
 * RomM names each file by its leaf alone, and a disc set laid out as a folder
 * per disc repeats those leaves: every Dreamcast disc has its own
 * `track01.bin`. Written by leaf they land on one another, and the second disc
 * replaces the first's tracks. The folder RomM found the file in is
 * `file_path`, which is the ROM's `fs_path`, then the game's folder, then
 * whatever lies below it; what lies below is kept. Where the two do not line
 * up the leaf is all there is to go on.
 */
export function pathInGame(
  rom: Pick<RommRom, 'fs_path' | 'fs_name'>,
  file: Pick<RommRomFile, 'file_name' | 'file_path'>
): string {
  const segments = (path: string): string[] =>
    path.split('/').filter((segment) => segment !== '' && segment !== '.')
  let dir = segments(file.file_path ?? '')
  const base = segments(rom.fs_path ?? '')
  if (base.length > 0 && base.every((segment, at) => dir[at] === segment)) {
    dir = dir.slice(base.length)
  } else {
    const at = dir.indexOf(rom.fs_name)
    if (at === -1) return file.file_name
    dir = dir.slice(at)
  }
  if (dir[0] === rom.fs_name) dir = dir.slice(1)
  return [...dir, file.file_name].join('/')
}

/**
 * Is this a playlist the server keeps for a game?
 *
 * Never fetched or launched: it lists discs by whatever paths its author's
 * layout had, which is not the layout this download makes, and Galleon writes
 * its own from the discs that actually arrived. See `discsOf`.
 */
export function isServerPlaylist(name: string): boolean {
  return extensionOf(name) === '.m3u'
}

const DISC_IMAGES: ReadonlySet<string> = new Set(DISC_IMAGE_EXTENSIONS)
const PLAYLISTS: ReadonlySet<string> = new Set(PLAYLIST_SYSTEMS)
const TRACK_DESCRIPTORS: ReadonlySet<string> = new Set(
  DESCRIPTOR_EXTENSIONS.filter((extension) => extension !== '.m3u')
)

/**
 * The discs of a game, in play order, as paths relative to its folder.
 *
 * Read from the files the game is made of rather than from what sits beside
 * them on disk, so nothing that happens to share the folder becomes a disc.
 * Each folder answers for itself: its descriptors where it has any, since a
 * `.cue` or `.gdi` is the disc and the tracks it names are not, and otherwise
 * its whole disc images. Ordered by number as well as by letter, so a tenth
 * disc follows the ninth.
 */
export function discsOf(paths: readonly string[]): string[] {
  const byFolder = new Map<string, string[]>()
  for (const path of paths) {
    const folder = path.includes('/') ? folderOf(path) : ''
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), path])
  }
  const discs: string[] = []
  for (const inFolder of byFolder.values()) {
    const descriptors = inFolder.filter((path) => TRACK_DESCRIPTORS.has(extensionOf(path)))
    discs.push(
      ...(descriptors.length > 0
        ? descriptors
        : inFolder.filter((path) => DISC_IMAGES.has(extensionOf(path))))
    )
  }
  return discs.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
}

/**
 * The playlist Galleon writes for a game, or null where it writes none.
 *
 * One only for a game of more than one disc on a system that changes discs
 * through a playlist. The lines are relative to the playlist, which sits at the
 * top of the game's folder.
 */
export function playlistFor(paths: readonly string[], system: string): string | null {
  if (!PLAYLISTS.has(system)) return null
  const discs = discsOf(paths)
  return discs.length > 1 ? discs.map((disc) => `${disc}\n`).join('') : null
}

/**
 * The name of a multi-file game's folder on this disk.
 *
 * An emulator can read any path with `.m3u` in it as a playlist, folders
 * included, and a folder RomM holds a disc set in is often named that way. So
 * the folder Galleon makes for a game never carries it, and nor does the path
 * of the playlist written into it.
 */
export function gameFolderName(name: string): string {
  const cleaned = name.replace(/\.m3u/gi, '').trim()
  return cleaned === '' ? 'game' : cleaned
}
