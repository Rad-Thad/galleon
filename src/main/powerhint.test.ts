import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import type { PowerState } from '@shared/types'
import { decidePowerHint } from './powerhint.ts'
import { UNKNOWN } from './powerstate.ts'

/**
 * When the power profile hint is due: on Armada, on a slow profile, once per
 * change of profile, and never once it has been dismissed for good.
 */

const ON_ARMADA: PowerState = {
  cpuGovernor: 'conservative',
  cpuCurKHz: 595_200,
  cpuMaxKHz: 2_092_800,
  gpuGovernor: 'simple_ondemand',
  gpuCurHz: 220_000_000,
  gpuMaxHz: 680_000_000,
  profile: 'Balanced',
  defaultProfile: 'balanced',
  perf: UNKNOWN
}
const on = (profile: string): PowerState => ({ ...ON_ARMADA, profile })

describe('the power profile hint', () => {
  test('shows on Balanced and on Eco, and keeps the profile as seen', () => {
    assert.deepEqual(decidePowerHint(on('Balanced'), '', false), {
      show: true,
      profile: 'Balanced',
      seen: 'Balanced'
    })
    assert.equal(decidePowerHint(on('Eco'), 'Performance', false).show, true)
    // armada-power status names profiles by their section, not their label.
    assert.equal(decidePowerHint(on('balanced'), '', false).show, true)
  })

  test('not on Performance, nor on a profile Armada has no slow name for', () => {
    assert.deepEqual(decidePowerHint(on('Performance'), 'Balanced', false), {
      show: false,
      profile: 'Performance',
      seen: 'Performance'
    })
    assert.equal(decidePowerHint(on('Relaxed'), '', false).show, false)
  })

  test('at most once per change of profile', () => {
    let seen = ''
    const shown: boolean[] = []
    for (const profile of ['Balanced', 'Balanced', 'Performance', 'Balanced', 'Balanced']) {
      const decision = decidePowerHint(on(profile), seen, false)
      shown.push(decision.show)
      seen = decision.seen
    }
    assert.deepEqual(shown, [true, false, false, true, false])
  })

  test('a profile that cannot be named is no change, so the next read is not one either', () => {
    const unread = decidePowerHint(on(UNKNOWN), 'Balanced', false)
    assert.deepEqual(unread, { show: false, profile: UNKNOWN, seen: 'Balanced' })
    assert.equal(decidePowerHint(on('Balanced'), unread.seen, false).show, false)
  })

  test('never once dismissed for good, though the profile is still followed', () => {
    assert.deepEqual(decidePowerHint(on('Balanced'), 'Performance', true), {
      show: false,
      profile: 'Balanced',
      seen: 'Balanced'
    })
  })

  test('never outside Armada, where there is no profile definition', () => {
    const desktop = { ...on('Balanced'), defaultProfile: UNKNOWN }
    assert.deepEqual(decidePowerHint(desktop, '', false), {
      show: false,
      profile: 'Balanced',
      seen: ''
    })
  })

  test('and never changes the profile itself: the module starts nothing and writes nothing', () => {
    const source = readFileSync(join(import.meta.dirname, 'powerhint.ts'), 'utf8')
    assert.doesNotMatch(source, /node:child_process|node:fs|armada-power|execFile|spawn/)
  })
})
