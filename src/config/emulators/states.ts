/**
 * Where a save state may travel between devices.
 *
 * A state is a snapshot of one core's memory, and RomM keeps it as a plain
 * per-ROM upload: no slot, no device records, no conflict to raise. It loads
 * only in the core that wrote it, so a state carried anywhere else is not
 * ignored on load but loaded, and the session crashes or corrupts. Syncing
 * one is worth it only where the other devices run the same core.
 *
 * So the rule is a short list rather than a test: the (system, tag) pairs
 * where this device runs the libretro core Argosy runs for that system, which
 * docs/save-sync/SPEC.md section 10 found to be the same core on both sides.
 * The tag is the one this device uploads under (`localTag`), which for
 * RetroArch is the core's own name. Everything absent keeps its states on the
 * device that made them, and the Saves tab says so. A standalone emulator is
 * absent on purpose: its snapshots are tied to the build that wrote them, and
 * the Android and Linux builds are released apart.
 *
 * Pulling still matches the state's own tag strictly (see `acceptsTag`), so a
 * pair listed here never lets another core's snapshot in.
 */
export interface StateSyncRule {
  /** ES-DE system id. */
  system: string
  /** The emulator tag a state is uploaded under, as `localTag` gives it. */
  tag: string
}

export const STATE_SYNC: readonly StateSyncRule[] = [
  { system: 'snes', tag: 'snes9x' },
  { system: 'snesna', tag: 'snes9x' },
  { system: 'sfc', tag: 'snes9x' },
  { system: 'gba', tag: 'mgba' },
  { system: 'psx', tag: 'pcsx_rearmed' },
  { system: 'psx', tag: 'swanstation' },
  { system: 'psx', tag: 'mednafen_psx' }
]

/** Do states for this system, made under this tag, sync with RomM? */
export function statesSync(system: string, tag: string): boolean {
  return STATE_SYNC.some((rule) => rule.system === system && rule.tag === tag)
}
