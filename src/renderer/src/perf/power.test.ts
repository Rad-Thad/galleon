import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { createI18n } from '@shared/i18n'
import type { PowerState } from '@shared/types'
import { powerLines } from './power.ts'

const { t } = createI18n('en')

/** The Nova on Balanced, as device result e6bb3bd's clocks read. */
const BALANCED: PowerState = {
  cpuGovernor: 'conservative',
  cpuCurKHz: 595_200,
  cpuMaxKHz: 2_092_800,
  gpuGovernor: 'simple_ondemand',
  gpuCurHz: 220_000_000,
  gpuMaxHz: 680_000_000,
  profile: 'Balanced',
  profileId: 'balanced',
  defaultProfile: 'balanced',
  perf: 'global.gamescopeNice=-20'
}

describe('the power state as text', () => {
  test('names the profile, the governors and the clocks in MHz', () => {
    assert.deepEqual(powerLines(t, BALANCED), {
      cpu: 'CPU conservative 595/2093 MHz',
      gpu: 'GPU simple_ondemand 220/680 MHz',
      profile: 'Armada profile: Balanced (starts in balanced)'
    })
  })

  test('a value the machine would not give reads as unknown, in the language shown', () => {
    const unknown: PowerState = {
      ...BALANCED,
      cpuGovernor: 'unknown',
      cpuCurKHz: null,
      gpuMaxHz: null,
      profile: 'unknown'
    }
    assert.deepEqual(powerLines(t, unknown), {
      cpu: 'CPU unknown unknown/2093 MHz',
      gpu: 'GPU simple_ondemand 220/unknown MHz',
      profile: 'Armada profile: unknown (starts in balanced)'
    })
    assert.equal(
      powerLines(createI18n('fr').t, unknown).profile,
      'Profil Armada : inconnu (démarre en balanced)'
    )
  })
})
