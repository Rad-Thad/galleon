import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REHEARSAL_DIR, UPDATE_CHECK, updateScenario, type UpdateDeps } from './selftestupdate.ts'
import type { CheckResult, SelfTestRequest } from './selftest.ts'
import type { Rehearsal } from './update.ts'

/**
 * `update.verify` on the device: the verdict comes from `Updater.rehearse`,
 * and the scenario adds what it cannot say about itself, that the installed
 * image was left alone and the test home emptied.
 */

const scratches: string[] = []

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'galleon-selftest-update-'))
  scratches.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const GOOD: Rehearsal = { failure: null, name: 'Galleon-aarch64.AppImage', bytes: 9 }

async function check(deps: Partial<UpdateDeps> = {}): Promise<CheckResult> {
  const answered = await updateScenario({
    rehearse: async () => GOOD,
    home: scratch(),
    installed: null,
    ...deps
  })({
    request: {} as SelfTestRequest,
    safety: {} as never,
    signal: new AbortController().signal
  })
  assert.ok(!Array.isArray(answered))
  return answered
}

describe('update.verify', () => {
  test('passes on a good rehearsal, inside the test home, which is emptied after', async () => {
    const home = scratch()
    let given = ''
    const result = await check({
      home,
      rehearse: async (dir) => {
        given = dir
        assert.ok(existsSync(dir))
        writeFileSync(join(dir, 'left-behind'), 'x')
        return GOOD
      }
    })
    assert.equal(result.id, UPDATE_CHECK)
    assert.equal(result.result, 'pass')
    assert.deepEqual(result.metrics, { image: GOOD.name, bytes: 9 })
    assert.equal(given, join(home, REHEARSAL_DIR))
    assert.equal(existsSync(given), false)
  })

  test("the rehearsal's failure is the check's reason", async () => {
    for (const failure of [
      'no-image',
      'no-checksums',
      'matching-refused',
      'corrupted-accepted'
    ] as const) {
      const result = await check({ rehearse: async () => ({ ...GOOD, failure }) })
      assert.equal(result.result, 'fail')
      assert.equal(result.reason, failure)
    }
  })

  test('a channel that cannot be read fails, and the folder is still removed', async () => {
    const home = scratch()
    const result = await check({
      home,
      rehearse: async () => {
        throw new Error('GitHub responded 503 at some-host.example')
      }
    })
    assert.equal(result.result, 'fail')
    assert.equal(result.reason, 'channel-unreadable')
    assert.equal(JSON.stringify(result).includes('some-host'), false)
    assert.equal(existsSync(join(home, REHEARSAL_DIR)), false)
  })

  test('an installed image that changed fails, whatever the rehearsal says', async () => {
    const installed = join(scratch(), 'Galleon-aarch64.AppImage')
    writeFileSync(installed, 'the installed version')
    const result = await check({
      installed,
      rehearse: async () => {
        writeFileSync(installed, 'something else entirely')
        return GOOD
      }
    })
    assert.equal(result.result, 'fail')
    assert.equal(result.reason, 'installed-image-changed')
  })

  test('an installed image left alone passes', async () => {
    const installed = join(scratch(), 'Galleon-aarch64.AppImage')
    writeFileSync(installed, 'the installed version')
    assert.equal((await check({ installed })).result, 'pass')
  })
})
