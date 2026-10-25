/**
 * Where the time for each page of the library went, on this side of the
 * bridge.
 *
 * The self-test times a page from the renderer, request to covers drawn, and
 * that one number cannot say whether to make RomM's answer arrive sooner or
 * the reconciliation with the disk cheaper. The main process can: it waits on
 * one and then does the other. Held only while someone is reading, so a normal
 * session keeps nothing. See `selftestscroll.ts`.
 */
export interface PageTime {
  /** Waiting on RomM for the page. */
  serverMs: number
  /** Checking the page's games against the disk. See `Library.adopt`. */
  adoptMs: number
}

export class PageTimes {
  private held: PageTime[] | null = null

  /** Start keeping times, dropping any kept before. */
  start(): void {
    this.held = []
  }

  /** The times kept since `start`, and stop keeping them. */
  stop(): PageTime[] {
    const held = this.held ?? []
    this.held = null
    return held
  }

  record(time: PageTime): void {
    this.held?.push(time)
  }
}
