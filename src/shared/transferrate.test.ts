import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  SAMPLE_MS,
  STALL_MS,
  sampleRate,
  speedUnit,
  startRate,
  timeUnit,
  type TransferRate
} from './transferrate.ts'

const MB = 1024 * 1024

/**
 * A transfer seen the way the engine sees it: a progress event per chunk, at
 * `everyMs`, carrying `chunk(i)` bytes, plus whatever the caller does at the
 * end of each step. Returns the rate after every event.
 */
function run(
  steps: number,
  everyMs: number,
  chunk: (i: number) => number,
  total: number,
  from: { rate: TransferRate; received: number; now: number } = {
    rate: startRate(0, 0),
    received: 0,
    now: 0
  }
): { rate: TransferRate; received: number; now: number; seen: TransferRate[] } {
  let { rate, received, now } = from
  const seen: TransferRate[] = []
  for (let i = 0; i < steps; i++) {
    now += everyMs
    received += chunk(i)
    rate = sampleRate(rate, received, total, now)
    seen.push(rate)
  }
  return { rate, received, now, seen }
}

describe('transfer rate', () => {
  test('a constant rate in uneven chunks converges within 3 s', () => {
    // 10 MB/s, a chunk every 20 ms, big and small and none in turn.
    const sizes = [0.3 * MB, 0.1 * MB, 0, 0.4 * MB, 0.2 * MB]
    const { seen } = run(150, 20, (i) => sizes[i % sizes.length], 4000 * MB)
    // From 3 s on, and for as long as it keeps up.
    for (const rate of seen.slice(3000 / 20 - 1)) {
      const speed = rate.speed ?? 0
      assert.ok(Math.abs(speed - 10 * MB) / (10 * MB) < 0.05, `${speed / MB} MB/s`)
    }
  })

  test('a change of rate is followed within 3 s', () => {
    const slow = run(20, 100, () => 0.1 * MB, 4000 * MB)
    const fast = run(30, 100, () => 1 * MB, 4000 * MB, slow)
    const speed = fast.rate.speed ?? 0
    assert.ok(Math.abs(speed - 10 * MB) / (10 * MB) < 0.05, `${speed / MB} MB/s`)
    // Time left follows from it.
    const left = (4000 * MB - fast.received) / speed
    assert.equal(fast.rate.secondsLeft, Math.ceil(left))
  })

  test('nothing is claimed before a whole sample', () => {
    const { rate } = run(SAMPLE_MS / 100 - 1, 100, () => MB, 100 * MB)
    assert.equal(rate.speed, null)
    assert.equal(rate.secondsLeft, null)
    assert.equal(rate.stalled, false)
  })

  test('a stall reads as stalled, never as a huge time left', () => {
    const moving = run(30, 100, () => MB, 4000 * MB)
    const before = moving.rate.secondsLeft ?? 0
    const stopped = run(STALL_MS / 100 + 10, 100, () => 0, 4000 * MB, moving)
    for (const seen of stopped.seen) {
      if (seen.stalled) assert.equal(seen.secondsLeft, null)
      else assert.ok((seen.secondsLeft ?? 0) <= before, `${seen.secondsLeft}s after ${before}s`)
    }
    assert.ok(stopped.seen.at(-1)?.stalled)
    // The first stalled look comes once no byte has arrived for STALL_MS.
    const first = stopped.seen.findIndex((r) => r.stalled)
    assert.equal((first + 1) * 100, STALL_MS)

    const again = run(1, 100, () => MB, 4000 * MB, stopped)
    assert.equal(again.rate.stalled, false)
    assert.ok(again.rate.secondsLeft !== null)
  })

  test('the pause a stall cost slows the estimate when bytes come back', () => {
    const moving = run(30, 100, () => MB, 4000 * MB)
    const paused = run(10, 100, () => 0, 4000 * MB, moving)
    const back = run(1, 100, () => MB, 4000 * MB, paused)
    assert.ok((back.rate.speed ?? 0) < (moving.rate.speed ?? 0))
  })

  test('fewer bytes than before is a transfer started over', () => {
    const moving = run(30, 100, () => MB, 4000 * MB)
    const restarted = sampleRate(moving.rate, 0, 4000 * MB, moving.now + 100)
    assert.equal(restarted.speed, null)
    assert.equal(restarted.lastBytes, 0)
  })

  test('no time left without a size', () => {
    const { rate } = run(30, 100, () => MB, 0)
    assert.ok(rate.speed)
    assert.equal(rate.secondsLeft, null)
  })

  test('a steady rate at a unit boundary keeps its unit', () => {
    // Jitter either side of 1 MB/s and of 0.9 MB/s, where the units meet.
    for (const centre of [1 * MB, 0.9 * MB]) {
      const { seen } = run(200, 100, (i) => (centre / 10) * (i % 2 ? 1.03 : 0.97), 40000 * MB)
      // Settling into a unit once is fine; going back is the flicker.
      const units = seen.filter((r) => r.speed !== null).map((r) => r.speedUnit)
      const changes = units.filter((unit, i) => i > 0 && unit !== units[i - 1]).length
      assert.ok(changes <= 1, `${centre / MB} MB/s changed unit ${changes} times`)
    }
  })

  test('time left falling past a minute changes unit once, even with jitter', () => {
    // About 70 s of a 10 MB/s transfer, the rate wobbling a little.
    const { seen } = run(800, 100, (i) => MB * (i % 2 ? 1.04 : 0.96), 700 * MB)
    const units = seen.filter((r) => r.secondsLeft !== null).map((r) => r.timeUnit)
    const changes = units.filter((unit, i) => i > 0 && unit !== units[i - 1]).length
    assert.equal(units[0], 1)
    assert.equal(units.at(-1), 0)
    assert.equal(changes, 1)
  })
})

describe('units', () => {
  test('a speed moves up a unit at a whole unit, and down only below the floor', () => {
    assert.equal(speedUnit(1023, null), 0)
    assert.equal(speedUnit(1024, null), 1)
    assert.equal(speedUnit(41.4 * MB, null), 2)
    assert.equal(speedUnit(0.95 * MB, 2), 2)
    assert.equal(speedUnit(0.89 * MB, 2), 1)
    assert.equal(speedUnit(1.0 * MB, 1), 2)
    assert.equal(speedUnit(0.5 * 1024, 2), 0)
  })

  test('a time left moves down a unit at once, and up only past the margin', () => {
    assert.equal(timeUnit(59, null), 0)
    assert.equal(timeUnit(60, null), 1)
    assert.equal(timeUnit(3600, null), 2)
    assert.equal(timeUnit(59, 1), 0)
    assert.equal(timeUnit(62, 0), 0)
    assert.equal(timeUnit(70, 0), 1)
    assert.equal(timeUnit(3700, 1), 1)
    assert.equal(timeUnit(4000, 1), 2)
    assert.equal(timeUnit(3700, 0), 1)
    assert.equal(timeUnit(5000, 0), 2)
  })
})
