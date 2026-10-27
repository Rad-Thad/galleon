import { readdir, readFile, realpath, statfs } from 'node:fs/promises'
import { join } from 'node:path'
import type { Volume } from '@shared/librarycard'
import { log } from './log.ts'

/**
 * The mounted volumes `chooseLibraryVolume` picks the library's card from, as
 * the machine reports them.
 *
 * Everything is read from files any user may read: the kernel's mount table,
 * udev's label links and `statfs` on each mount point. Nothing needs root and
 * nothing is written. The parsers are pure and take the files' text, so they
 * are tested against fixtures; `readVolumes` only gathers that text.
 */

/** One line of the kernel's mount table. */
export interface MountEntry {
  device: string
  mountPoint: string
  fsType: string
  readOnly: boolean
}

const MOUNTS_FILE = '/proc/self/mounts'
const BY_LABEL_DIR = '/dev/disk/by-label'

/** Where removable media is mounted, the only place a card can be. */
const MEDIA_ROOT = '/run/media'

/**
 * A field of the mount table with the kernel's escapes undone.
 *
 * The kernel writes a space, tab, newline or backslash in a path as three
 * octal digits after a backslash, so a card labelled `My Card` is listed as
 * `/run/media/deck/My\040Card`.
 */
function unescapeMountField(field: string): string {
  return field.replace(/\\([0-7]{3})/g, (_, octal: string) =>
    String.fromCharCode(parseInt(octal, 8))
  )
}

/**
 * The kernel's mount table, one entry per mount point.
 *
 * A mount point listed twice was mounted over, and the later line is the one
 * in force, so it replaces the earlier. A line too short to be a mount is
 * skipped rather than guessed at.
 */
export function parseMounts(text: string): MountEntry[] {
  const byMountPoint = new Map<string, MountEntry>()
  for (const line of text.split('\n')) {
    const fields = line.trim().split(/\s+/)
    if (fields.length < 4) continue
    const [device, mountPoint, fsType, options] = fields
    const entry = {
      device: unescapeMountField(device),
      mountPoint: unescapeMountField(mountPoint),
      fsType,
      readOnly: options.split(',').includes('ro')
    }
    byMountPoint.delete(entry.mountPoint)
    byMountPoint.set(entry.mountPoint, entry)
  }
  return [...byMountPoint.values()]
}

/**
 * A label as udev names its link in `/dev/disk/by-label`.
 *
 * udev writes a character that cannot go in a file name, a space or a slash
 * among them, as `\x` and two hex digits.
 */
export function decodeLabelLink(name: string): string {
  return name.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16))
  )
}

/** Whether a mount point is on removable media. See `isCardMount` in librarycard. */
export function isMediaMount(mountPoint: string): boolean {
  return mountPoint.startsWith(`${MEDIA_ROOT}/`)
}

/** The device a path names once its links are followed, or the path itself. */
async function resolveDevice(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return path
  }
}

/**
 * Each labelled device's label, keyed by the device it links to.
 *
 * Read from udev's links rather than from the mount point's name: a card
 * whose label clashes with another mount is mounted under a different name,
 * and only the link still says what the card is called.
 */
async function labelsByDevice(byLabelDir: string): Promise<Map<string, string>> {
  const labels = new Map<string, string>()
  let names: string[]
  try {
    names = await readdir(byLabelDir)
  } catch {
    // No labelled device at all: udev makes the folder only for the first one.
    return labels
  }
  for (const name of names) {
    try {
      labels.set(await realpath(join(byLabelDir, name)), decodeLabelLink(name))
    } catch {
      // A link to a device that left between the listing and this read.
    }
  }
  return labels
}

/** Where `readVolumes` reads from, replaceable so tests read fixtures. */
export interface VolumeSources {
  mountsFile?: string
  byLabelDir?: string
  /** Which mount points are measured. Only removable media unless stated. */
  include?: (mountPoint: string) => boolean
}

/**
 * The mounted volumes on removable media, measured.
 *
 * Only removable media by default: `statfs` on every mount would ask network
 * shares and FUSE file systems that can take seconds to answer, for volumes a
 * library is never put on by default. A mount point that cannot be measured
 * is left out, since a card of unknown room is not one to choose.
 *
 * Never throws: without a mount table there is no card to choose, and the
 * library stays on internal storage.
 */
export async function readVolumes(sources: VolumeSources = {}): Promise<Volume[]> {
  const include = sources.include ?? isMediaMount
  let text: string
  try {
    text = await readFile(sources.mountsFile ?? MOUNTS_FILE, 'utf8')
  } catch (cause) {
    log.debug('volumes', 'mount table unreadable', { reason: (cause as Error).message })
    return []
  }
  const mounts = parseMounts(text).filter((mount) => include(mount.mountPoint))
  if (mounts.length === 0) return []

  const labels = await labelsByDevice(sources.byLabelDir ?? BY_LABEL_DIR)
  const volumes: Volume[] = []
  for (const mount of mounts) {
    try {
      const fs = await statfs(mount.mountPoint)
      volumes.push({
        mountPoint: mount.mountPoint,
        fsType: mount.fsType,
        label: labels.get(await resolveDevice(mount.device)) ?? null,
        readOnly: mount.readOnly,
        // See `spaceOf`: free to the user, not to root.
        freeBytes: fs.bavail * fs.bsize,
        totalBytes: fs.blocks * fs.bsize
      })
    } catch (cause) {
      log.debug('volumes', 'could not be measured', {
        mountPoint: mount.mountPoint,
        reason: (cause as Error).message
      })
    }
  }
  return volumes
}
