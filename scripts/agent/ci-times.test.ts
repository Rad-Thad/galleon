import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  LEGS,
  SAMPLE,
  TARGET_MINUTES,
  legTimes,
  median,
  render,
  renderOne,
  summarise
} from './ci-times.mjs'

/**
 * The CI time budget is only enforced by this report being right: a median
 * that counts a failed leg, or a sample that reaches past the last ten pull
 * requests, would say CI is fast when it is not.
 */

const [x64, arm64] = LEGS

function run(name: string, conclusion: string | null, seconds: number) {
  const start = Date.parse('2026-10-09T07:00:00Z')
  return {
    name,
    conclusion,
    started_at: new Date(start).toISOString(),
    completed_at: new Date(start + seconds * 1000).toISOString()
  }
}

describe('ci-times', () => {
  test('the median of an odd and an even count, and of nothing', () => {
    assert.equal(median([3, 1, 2]), 2)
    assert.equal(median([4, 1, 3, 2]), 2.5)
    assert.equal(median([]), null)
  })

  test('only successful runs of the two required legs are timed', () => {
    const times = legTimes([
      run(x64, 'success', 240),
      run(arm64, 'failure', 30),
      run('canary', 'success', 600),
      { name: arm64, conclusion: 'success', started_at: null, completed_at: null }
    ])
    assert.deepEqual(times, { [x64]: 4 })
  })

  test('the median is taken over the newest pull requests only', () => {
    const fast = Array.from({ length: SAMPLE }, () => ({ [x64]: 3, [arm64]: 2 }))
    const old = Array.from({ length: SAMPLE }, () => ({ [x64]: 30, [arm64]: 30 }))
    const summary = summarise([...fast, ...old])
    assert.deepEqual(
      summary.map((leg) => [leg.runs, leg.median, leg.over]),
      [
        [SAMPLE, 3, false],
        [SAMPLE, 2, false]
      ]
    )
  })

  test('a leg past the target is called out, and one with no runs says so', () => {
    const summary = summarise([{ [x64]: TARGET_MINUTES + 1.5 }])
    const text = render(summary)
    assert.match(text, new RegExp(`median ${TARGET_MINUTES + 1}:30 over 1 pull requests \\(over`))
    assert.match(text, /arm64\): no successful runs/)
  })

  test("one pull request's legs, and a leg that has not gone green", () => {
    assert.equal(
      renderOne(47, { [x64]: 3 + 58 / 60 }),
      `#47 ${x64}: 3:58\n#47 ${arm64}: not green yet`
    )
  })
})
