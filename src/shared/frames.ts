/**
 * Frame-time statistics for the performance overlay and the per-screen
 * `perf summary` log line.
 *
 * The lag that matters on the Nova is the kind a person feels while scrolling
 * a grid, so the numbers are the time between consecutive animation frames as
 * `requestAnimationFrame` sees them, not anything the GPU reports. Kept free of
 * the DOM and of React so the same arithmetic runs in unit tests, in the
 * overlay and in the self-test on the device, and they all agree.
 */

/** A frame is janky when it took more than this many display intervals. */
export const JANK_FACTOR = 1.5

/** The longest a frame may take on a display of `hz` before it counts as janky. */
export function jankyThresholdMs(hz: number): number {
  return (JANK_FACTOR * 1000) / hz
}

/**
 * The nearest-rank percentile of values already sorted ascending: always one
 * of the measured frame times, never an interpolation between two, so a p99
 * names a frame that really happened.
 */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) throw new RangeError('no values')
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]
}

export interface FrameStats {
  frames: number
  p50: number
  p90: number
  p99: number
  /** The share of frames over the janky threshold, as a percentage. */
  jankyPct: number
}

/** Statistics over frame intervals in milliseconds, or null when there are none. */
export function frameStats(intervals: readonly number[], hz: number): FrameStats | null {
  const valid = intervals.filter((ms) => Number.isFinite(ms) && ms > 0)
  if (valid.length === 0) return null
  const sorted = valid.toSorted((a, b) => a - b)
  const threshold = jankyThresholdMs(hz)
  const janky = sorted.filter((ms) => ms > threshold).length
  return {
    frames: sorted.length,
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p99: percentile(sorted, 99),
    jankyPct: (janky / sorted.length) * 100
  }
}

/**
 * The intervals between `requestAnimationFrame` timestamps, the most recent
 * `capacity` of them, so the overlay shows how the screen feels now rather
 * than averaged over everything since it was opened.
 */
export class FrameWindow {
  private readonly intervals: number[] = []
  private last: number | null = null

  constructor(private readonly capacity: number) {
    if (!(capacity > 0)) throw new RangeError('capacity must be positive')
  }

  /** Record a frame drawn at `timestamp` (milliseconds, as rAF passes it). */
  tick(timestamp: number): void {
    if (this.last !== null && timestamp > this.last) {
      this.intervals.push(timestamp - this.last)
      if (this.intervals.length > this.capacity) this.intervals.shift()
    }
    this.last = timestamp
  }

  /**
   * Forget everything. A screen change starts a new summary, and the pause a
   * hidden window spends without frames is not a frame anybody waited for.
   */
  reset(): void {
    this.intervals.length = 0
    this.last = null
  }

  stats(hz: number): FrameStats | null {
    return frameStats(this.intervals, hz)
  }
}
