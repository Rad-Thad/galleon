/**
 * Speed and time left for a transfer, smoothed so a download row can be read
 * at a glance.
 *
 * Bytes arrive in bursts as the network hands them over, so the raw rate
 * between two progress events swings wildly. The rate is instead measured over
 * whole samples of `SAMPLE_MS` and folded into an exponential moving average,
 * and the units it is shown in only change with some margin, so a steady
 * transfer reads steadily. Kept free of timers, of the DOM and of the engine:
 * the caller says when, the arithmetic is the same in unit tests, the engine
 * and the device check.
 */

/** How long one rate sample spans. */
export const SAMPLE_MS = 500

/** The weight of the newest sample in the moving average. */
export const SMOOTHING = 0.5

/** How long without a byte before the transfer is called stalled. */
export const STALL_MS = 2000

/**
 * How far past a unit's top the time left must go before it is shown in the
 * bigger unit. Only on the way up: time left falls as a transfer runs, and
 * falling into the smaller unit is what it is supposed to do.
 */
export const TIME_UNIT_MARGIN = 1.1

/**
 * How far below one whole unit the speed may fall before it is shown in the
 * smaller one, so a rate hovering at the boundary does not swap between them.
 */
export const SPEED_UNIT_FLOOR = 0.9

/** B/s, KB/s, MB/s, GB/s: the powers of 1024 `formatRate` names. */
export const SPEED_UNITS = ['B', 'KB', 'MB', 'GB'] as const

/** Seconds, minutes, hours: how time left is written. */
export type TimeUnit = 0 | 1 | 2

export interface TransferRate {
  /** Smoothed bytes per second; null until a whole sample has been measured. */
  speed: number | null
  /** Seconds until done at that speed; null when there is no honest answer. */
  secondsLeft: number | null
  /** No byte for `STALL_MS`: the row says so rather than a time. */
  stalled: boolean
  /** The power of 1024 the speed is shown in, an index into `SPEED_UNITS`. */
  speedUnit: number
  /** The unit time left is shown in. */
  timeUnit: TimeUnit
  /** Bytes received when the current sample started, and when that was. */
  sampleBytes: number
  sampleAt: number
  /** The last byte count seen, and when it last grew. */
  lastBytes: number
  lastByteAt: number
}

/** A transfer just starting, or starting again from `received` bytes. */
export function startRate(received: number, now: number): TransferRate {
  return {
    speed: null,
    secondsLeft: null,
    stalled: false,
    speedUnit: 0,
    timeUnit: 0,
    sampleBytes: received,
    sampleAt: now,
    lastBytes: received,
    lastByteAt: now
  }
}

/**
 * The rate after another look at the transfer.
 *
 * Called on every progress event and on a timer as well, since a stalled
 * transfer sends no events. A sample with no bytes in it is not folded into
 * the average: it stays open until bytes arrive and then counts the whole
 * gap, so a pause slows the estimate by what it cost instead of driving it
 * towards zero and the time left towards days. A pause long enough is a stall.
 */
export function sampleRate(
  rate: TransferRate,
  received: number,
  total: number,
  now: number
): TransferRate {
  // Fewer bytes than before is a transfer started over (a broken resume, a
  // retry), whose old rate says nothing about the new one.
  if (received < rate.lastBytes) return sampleRate(startRate(received, now), received, total, now)

  const next = { ...rate }
  if (received > rate.lastBytes) {
    next.lastBytes = received
    next.lastByteAt = now
  }

  const elapsed = now - rate.sampleAt
  if (elapsed >= SAMPLE_MS && received > rate.sampleBytes) {
    const instant = ((received - rate.sampleBytes) * 1000) / elapsed
    next.speed = rate.speed === null ? instant : rate.speed + SMOOTHING * (instant - rate.speed)
    next.sampleBytes = received
    next.sampleAt = now
  }

  next.stalled = now - next.lastByteAt >= STALL_MS
  next.secondsLeft =
    next.stalled || !next.speed || total <= 0
      ? null
      : Math.max(0, Math.ceil((total - received) / next.speed))
  if (next.speed)
    next.speedUnit = speedUnit(next.speed, rate.speed === null ? null : rate.speedUnit)
  if (next.secondsLeft !== null) {
    next.timeUnit = timeUnit(next.secondsLeft, rate.secondsLeft === null ? null : rate.timeUnit)
  }
  return next
}

/**
 * The unit for a speed, given the one it was shown in last.
 *
 * Up as soon as the number reaches a whole bigger unit; down only once it is
 * below `SPEED_UNIT_FLOOR` of the current one.
 */
export function speedUnit(bytesPerSecond: number, previous: number | null): number {
  let natural = 0
  while (natural < SPEED_UNITS.length - 1 && bytesPerSecond >= 1024 ** (natural + 1)) natural++
  if (previous === null || natural >= previous) return natural
  return bytesPerSecond >= SPEED_UNIT_FLOOR * 1024 ** previous ? previous : natural
}

const TIME_TOPS = [60, 3600] as const

/**
 * The unit for a time left, given the one it was shown in last.
 *
 * Down as soon as it fits the smaller unit; up only once it is
 * `TIME_UNIT_MARGIN` past the top of the current one.
 */
export function timeUnit(seconds: number, previous: TimeUnit | null): TimeUnit {
  const natural: TimeUnit = seconds < TIME_TOPS[0] ? 0 : seconds < TIME_TOPS[1] ? 1 : 2
  if (previous === null || natural <= previous) return natural
  // `previous` is below `natural` here, so it is seconds or minutes.
  if (seconds < TIME_TOPS[previous as 0 | 1] * TIME_UNIT_MARGIN) return previous
  if (previous === 0 && natural === 2 && seconds < TIME_TOPS[1] * TIME_UNIT_MARGIN) return 1
  return natural
}
