/**
 * Notices raised while something else has the screen, held until it is gone.
 *
 * A toast drawn behind a game is a toast nobody sees: it comes and goes under
 * the emulator, and the download that finished or the save that failed is never
 * mentioned. So while anything covers RomMix, what would have been shown waits
 * here, in the order it was raised, and is shown when RomMix has the screen
 * back, each for its full time.
 *
 * Kept free of React so the rule is tested as a rule.
 */
export class NoticeGate<T> {
  private covered = false
  private held: T[] = []

  constructor(private readonly show: (notice: T) => void) {}

  /** Show it now, or hold it until nothing covers RomMix. */
  offer(notice: T): void {
    if (this.covered) this.held.push(notice)
    else this.show(notice)
  }

  /** Whether something has the screen; when nothing does, everything held is shown. */
  setCovered(covered: boolean): void {
    this.covered = covered
    if (covered) return
    for (const notice of this.held.splice(0)) this.show(notice)
  }

  /** How many are waiting. */
  get waiting(): number {
    return this.held.length
  }
}
