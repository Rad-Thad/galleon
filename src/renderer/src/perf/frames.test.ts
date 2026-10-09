import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { FrameWindow, frameStats, JANK_FACTOR, jankyThresholdMs, percentile } from './frames.ts'

/**
 * The numbers the overlay, the `perf summary` line and Gate 1 are judged by.
 * The janky threshold is the one a person would notice: a frame that missed
 * the display's own deadline by more than half an interval, at 60 Hz on a desktop
 * and 120 Hz on the Nova.
 */

describe('frame statistics', () => {
  test('the janky threshold is one and a half display intervals', () => {
    assert.equal(JANK_FACTOR, 1.5)
    assert.equal(jankyThresholdMs(60), 25)
    assert.equal(jankyThresholdMs(120), 12.5)
  })

  test('a frame exactly on the threshold is not janky; one just over it is', () => {
    assert.equal(frameStats([25, 25, 25, 25], 60)?.jankyPct, 0)
    assert.equal(frameStats([16.7, 16.7, 16.7, 25.1], 60)?.jankyPct, 25)
    assert.equal(frameStats([8.3, 8.3, 12.5, 12.6], 120)?.jankyPct, 25)
  })

  test('the same frames are smooth at 60 Hz and janky at 120 Hz', () => {
    const frames = [16.7, 16.7, 16.7, 16.7]
    assert.equal(frameStats(frames, 60)?.jankyPct, 0)
    assert.equal(frameStats(frames, 120)?.jankyPct, 100)
  })

  test('percentiles are nearest-rank: always a frame that happened', () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1)
    assert.equal(percentile(sorted, 50), 50)
    assert.equal(percentile(sorted, 90), 90)
    assert.equal(percentile(sorted, 99), 99)
    assert.equal(percentile([4, 8], 50), 4)
    assert.equal(percentile([4, 8], 99), 8)
    assert.equal(percentile([7], 0), 7)
    assert.throws(() => percentile([], 50), RangeError)
  })

  test('order does not matter, and one long stall shows in p99 but not p50', () => {
    const smooth = Array.from({ length: 99 }, () => 8.3)
    const stats = frameStats([100, ...smooth], 120)
    assert.deepEqual(stats, { frames: 100, p50: 8.3, p90: 8.3, p99: 8.3, jankyPct: 1 })
    const stalls = frameStats([...smooth.slice(0, 97), 50, 60, 70], 120)
    assert.equal(stalls?.p50, 8.3)
    assert.equal(stalls?.p99, 60)
    assert.equal(stalls?.jankyPct, 3)
  })

  test('nothing measured is no statistics, and nonsense intervals are ignored', () => {
    assert.equal(frameStats([], 120), null)
    assert.equal(frameStats([0, -1, Number.NaN, Infinity], 120), null)
    assert.equal(frameStats([0, 10, Number.NaN], 120)?.frames, 1)
  })
})

describe('the rolling window', () => {
  test('intervals come from consecutive timestamps', () => {
    const window = new FrameWindow(10)
    assert.equal(window.stats(60), null, 'one timestamp is no interval yet')
    for (const t of [1000, 1016, 1033, 1050]) window.tick(t)
    assert.deepEqual(window.stats(60), { frames: 3, p50: 17, p90: 17, p99: 17, jankyPct: 0 })
  })

  test('only the most recent frames count', () => {
    const window = new FrameWindow(2)
    for (const t of [0, 100, 110, 120]) window.tick(t)
    assert.deepEqual(window.stats(60), { frames: 2, p50: 10, p90: 10, p99: 10, jankyPct: 0 })
  })

  test('a timestamp that does not move forward adds nothing', () => {
    const window = new FrameWindow(4)
    for (const t of [10, 10, 5, 15]) window.tick(t)
    assert.equal(window.stats(60)?.frames, 1)
    assert.equal(window.stats(60)?.p50, 10)
  })

  test('reset forgets the frames and the gap since the last one', () => {
    const window = new FrameWindow(4)
    window.tick(0)
    window.tick(16)
    window.reset()
    window.tick(5000)
    assert.equal(window.stats(60), null)
    window.tick(5008)
    assert.equal(window.stats(120)?.frames, 1)
  })

  test('a window must hold at least one frame', () => {
    assert.throws(() => new FrameWindow(0), RangeError)
  })
})
