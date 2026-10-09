import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DiagnosticsReport } from '@shared/types'
import { startScenario, type Scenario } from './harness.ts'

/**
 * M1-09: the pre-flight check names the ES-DE rule that found an emulator.
 *
 * A home of its own holding the file armadaOS's catalog installs, so the
 * bundled `linuxarm` rules have something to find: the probe is the real one,
 * reading the copy a checkout carries in `packaging/`.
 */
let scenario: Scenario
const home = mkdtempSync(join(tmpdir(), 'galleon-findrules-home-'))

before(async () => {
  mkdirSync(join(home, 'Applications'))
  writeFileSync(join(home, 'Applications', 'DuckStation-arm64.AppImage'), '')
  scenario = await startScenario({ env: { HOME: home } })
})

after(async () => {
  await scenario?.stop()
  rmSync(home, { recursive: true, force: true })
})

describe('the pre-flight check', () => {
  test('names the rule and entry that found an emulator', async () => {
    const { app } = scenario
    const report = await app.read<DiagnosticsReport>(`await window.rommix.system.diagnostics()`)
    const found = report.emulators.find((emulator) => emulator.install?.foundBy)
    assert.deepEqual(found?.install, {
      kind: 'appimage',
      ref: join(home, 'Applications', 'DuckStation-arm64.AppImage'),
      foundBy: {
        rule: 'DUCKSTATION',
        type: 'staticpath',
        entry: '~/Applications/DuckStation*.AppImage',
        source: 'bundled'
      }
    })

    await app.goTo('settings')
    await app.waitFor(`document.querySelector('[data-tab="system"]')`, 'the settings tabs')
    await app.choose('[data-tab="system"]')
    await app.waitFor(
      `[...document.querySelectorAll('dt')].find((dt) => dt.textContent === 'Found by')` +
        `?.nextElementSibling?.textContent.includes("DuckStation: ES-DE's DUCKSTATION rule, ~/Applications/DuckStation*.AppImage")`,
      'the rule named in Settings -> System'
    )
  })
})
