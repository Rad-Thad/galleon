import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, describe, test } from 'node:test'
import { POWER_HINT_NOTICE } from '@shared/types'
import { startApp, type App } from './driver.ts'
import { startFakeRomm } from './server.ts'

/**
 * M1-16: the power profile hint, against a folder of Armada's files standing
 * in for `/` (`GALLEON_POWER_ROOT`), since no test machine runs armadaOS. The
 * clocks are the Nova's on each profile, as docs/DEVICE-FACTS.md records them.
 */

const FIXTURES = join(import.meta.dirname, '..', '..', 'src', 'main', 'fixtures', 'armada')
const POLICY = 'sys/devices/system/cpu/cpufreq/policy7'
const roots: string[] = []
const stops: (() => Promise<void>)[] = []

after(async () => {
  for (const stop of stops) await stop()
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

function write(root: string, path: string, body: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), body)
}

/** A Nova's power files on one profile. */
function nova(profile: 'balanced' | 'performance'): string {
  const root = mkdtempSync(join(tmpdir(), 'galleon-power-root-'))
  roots.push(root)
  mkdirSync(join(root, 'usr/share/armada'), { recursive: true })
  cpSync(join(FIXTURES, 'power-profiles.conf'), join(root, 'usr/share/armada/power-profiles.conf'))
  setProfile(root, profile)
  return root
}

function setProfile(root: string, profile: 'balanced' | 'performance'): void {
  const balanced = profile === 'balanced'
  write(root, `${POLICY}/scaling_governor`, balanced ? 'conservative\n' : 'performance\n')
  write(root, `${POLICY}/scaling_cur_freq`, balanced ? '595200\n' : '2956800\n')
  write(root, `${POLICY}/scaling_max_freq`, balanced ? '2092800\n' : '2956800\n')
}

/**
 * Not `startScenario`: it waits for Home to take the focus, and on Balanced
 * the hint has it. Kept for `after` before anything is waited on, so a wait
 * that fails still shuts the app down.
 */
async function start(root: string | null): Promise<{ app: App }> {
  const server = await startFakeRomm()
  stops.push(() => server.close().catch(() => undefined))
  const app = await startApp({
    baseUrl: server.baseUrl,
    token: server.token,
    ...(root ? { env: { GALLEON_POWER_ROOT: root } } : {})
  })
  stops.push(() => app.stop())
  await app.waitFor(`document.querySelector('[data-screen="home"]')`, 'the home screen')
  return { app }
}

const HINT = `document.querySelector('[data-power-hint]')`

describe('the power profile hint', () => {
  test('shows on Balanced, once, and again only after the profile changes', async () => {
    const root = nova('balanced')
    const { app } = await start(root)
    await app.waitFor(HINT, 'the hint')
    assert.match(
      await app.read<string>(`document.querySelector('.overlay')?.textContent ?? ''`),
      /Armada is on Balanced.*Quick Access → Armada Control/
    )
    await app.choose('[data-action="power-hint-ok"]')
    await app.waitFor(`!${HINT}`, 'the hint to close')

    // The same profile read again is no change.
    assert.equal(
      (await app.read<{ show: boolean }>(`await window.rommix.system.powerHint()`)).show,
      false
    )
    // Performance is a change, but not a slow one; back to Balanced is due again.
    setProfile(root, 'performance')
    assert.equal(
      (await app.read<{ show: boolean }>(`await window.rommix.system.powerHint()`)).show,
      false
    )
    setProfile(root, 'balanced')
    assert.deepEqual(await app.read(`await window.rommix.system.powerHint()`), {
      show: true,
      profile: 'Balanced'
    })
  })

  test("not on Performance, and Don't show again is for good", async () => {
    const root = nova('performance')
    const { app } = await start(root)
    await app.waitFor(`document.querySelector('[data-screen]')`, 'a screen')
    assert.equal(await app.read<boolean>(`!!${HINT}`), false)

    setProfile(root, 'balanced')
    await app.read(`window.dispatchEvent(new Event('focus')), true`)
    await app.waitFor(HINT, 'the hint, once the window is back in front on Balanced')
    await app.choose('[data-action="power-hint-never"]')
    await app.waitFor(`!${HINT}`, 'the hint to close')
    await app.waitFor(
      `(await window.rommix.system.settings()).dismissedNotices.includes('${POWER_HINT_NOTICE}')`,
      'the dismissal to be kept'
    )
    setProfile(root, 'performance')
    await app.read(`await window.rommix.system.powerHint()`)
    setProfile(root, 'balanced')
    assert.equal(
      (await app.read<{ show: boolean }>(`await window.rommix.system.powerHint()`)).show,
      false
    )
    const settings = JSON.parse(readFileSync(join(app.home, 'config', 'settings.json'), 'utf8'))
    assert.ok(settings.settings.dismissedNotices.includes(POWER_HINT_NOTICE))
  })

  test('never outside Armada', async () => {
    const { app } = await start(null)
    await app.waitFor(`document.querySelector('[data-screen]')`, 'a screen')
    assert.deepEqual(await app.read(`await window.rommix.system.powerHint()`), {
      show: false,
      profile: 'unknown'
    })
    assert.equal(await app.read<boolean>(`!!${HINT}`), false)
  })
})
