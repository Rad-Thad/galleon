import { realpath } from 'node:fs/promises'
import { basename, dirname, join, normalize, resolve, sep } from 'node:path'

/**
 * Keeping a name that came from somewhere else inside the folder it is meant
 * for.
 *
 * RomM supplies the names RomMix writes under — a ROM's `fs_name`, a firmware
 * file's `file_name` — and a zip supplies the paths inside it. None of those is
 * a stranger's input, since the server is the user's own, but none of them is
 * RomMix's either, and `join` will happily walk out of a directory when handed
 * something that asks to.
 */

/**
 * `join`, unless the result would land outside `root`.
 *
 * Returns null rather than a corrected path: a name that does not belong in
 * this folder is a name to refuse, and silently rewriting it would install a
 * file under something other than what it is called.
 *
 * `resolve` after `normalize` is what answers the first half — the string form
 * is not the question, since `a/../../b` and `../b` reach the same place and
 * only one of them looks like it does. It is not the whole question either: a
 * directory symlink is a path that stays inside the folder on paper and lands
 * outside it in fact, and the trees RomMix writes into are full of them —
 * EmuDeck builds its save folder out of links into wherever each emulator
 * really writes. So the links that are already there are resolved and
 * containment is asked a second time, of what the filesystem answers rather
 * than of the string.
 *
 * What is resolved is the folders the name walks through, and not the name
 * itself: a file that is a link is a file, and a ROM library kept on another
 * drive and linked into the emulator's folder is the usual way to share a
 * collection. A folder that is a link is the thing a name can be carried out
 * through, and that is what this refuses.
 *
 * The path handed back is the lexical one, links and all. It is the name the
 * caller asked about, and following the link is the point of it being there.
 */
export async function safeJoin(root: string, relative: string): Promise<string | null> {
  const target = resolve(root, normalize(relative))
  // Strictly inside: a name that resolves to the folder itself — `''`, `.` —
  // is not a file in it, and every caller here is asking for one.
  if (!target.startsWith(resolve(root) + sep)) return null

  // Both sides are asked the same question, because a root that is not there
  // yet still hangs off folders that are: `Emulation` is a link onto the SD
  // card and the system folder below it is made by the download that is being
  // planned, so resolving one and not the other compares a real path against a
  // lexical one and never matches.
  const real = await resolveExisting(root)
  const parent = await resolveExisting(dirname(target))
  return join(parent, basename(target)).startsWith(real + sep) ? target : null
}

/**
 * `dir` with the links resolved on however much of it exists.
 *
 * Only that much can be resolved: the usual call is about a file that is about
 * to be created, so the last folders name nothing yet and are carried across as
 * they stand. Walking up rather than down because the first ancestor that
 * resolves has already resolved every link above it.
 */
async function resolveExisting(dir: string): Promise<string> {
  const pending: string[] = []
  let here = dir
  for (;;) {
    const real = await realpath(here).catch(() => null)
    if (real !== null) return pending.length > 0 ? join(real, ...pending) : real
    const above = dirname(here)
    // The filesystem root, which exists — so this is the walk being stopped
    // rather than the answer, and only reachable if it somehow does not.
    if (above === here) return dir
    pending.unshift(basename(here))
    here = above
  }
}
