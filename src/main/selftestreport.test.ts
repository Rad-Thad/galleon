import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, test } from 'node:test'
import { parseRequest } from './selftest.ts'
import {
  REPORT_CHECK,
  REPORT_DIR,
  credentialFiles,
  pressReport,
  reportProbe,
  reportScenario
} from './selftestreport.ts'
import { zipDirectory } from './zip.ts'

/**
 * `report.bundle` on the device: Report a problem, pressed in the page, puts
 * one bundle in the test home, and its files reach the results folder only
 * when none of them holds a credential.
 */

const made: string[] = []
afterEach(async () => {
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'selftestreport-'))
  made.push(dir)
  return dir
}

/** A press that writes a bundle holding `files` into the home, as the app does. */
function writes(home: string, files: Record<string, string>) {
  return async (): Promise<null> => {
    const staging = await scratch()
    for (const [name, text] of Object.entries(files)) {
      await mkdir(join(staging, name, '..'), { recursive: true })
      await writeFile(join(staging, name), text)
    }
    await mkdir(join(home, 'reports'), { recursive: true })
    await zipDirectory(staging, join(home, 'reports', '2026-10-25T16-00-00Z.zip'))
    return null
  }
}

async function run(press: (signal: AbortSignal) => Promise<string | null>, home: string) {
  const results = await scratch()
  const taken = parseRequest({
    schema: 1,
    sha: 'c'.repeat(40),
    budgetSeconds: 60,
    resultsDir: results,
    checks: [REPORT_CHECK],
    readOnlyServer: true,
    privacy: true
  })
  assert.equal(taken.kind, 'request')
  const stop = new AbortController()
  const answered = await reportScenario({ home, press: (signal) => press(signal) })({
    request: taken.request,
    safety: {} as never,
    signal: stop.signal
  })
  assert.ok(!Array.isArray(answered))
  return { answered, results }
}

describe('report.bundle', () => {
  test('a bundle with no credentials passes, and its files reach the results folder', async () => {
    const home = await scratch()
    await mkdir(join(home, 'reports'), { recursive: true })
    await writeFile(join(home, 'reports', 'older.zip'), 'an earlier report')
    const { answered, results } = await run(
      writes(home, {
        'logs/app.log': 'GET https://<server>/api/roms 200\n',
        'settings.json': '{ "password": "<redacted>" }\n',
        'versions.json': '{}\n'
      }),
      home
    )
    assert.equal(answered.result, 'pass', answered.reason ?? '')
    assert.equal(answered.metrics.files, 3)
    assert.equal(answered.metrics.bundle, 'reports/2026-10-25T16-00-00Z.zip')
    assert.deepEqual(answered.evidence, [
      `${REPORT_DIR}/logs/app.log`,
      `${REPORT_DIR}/settings.json`,
      `${REPORT_DIR}/versions.json`
    ])
    assert.deepEqual((await readdir(join(results, REPORT_DIR))).sort(), [
      'logs',
      'settings.json',
      'versions.json'
    ])
  })

  test('a bundle holding a credential fails, names the file and leaves nothing to publish', async () => {
    const home = await scratch()
    const { answered, results } = await run(
      writes(home, {
        'logs/app.log': 'Authorization: Bearer abcdefghijklmnop\n',
        'versions.json': '{}\n'
      }),
      home
    )
    assert.equal(answered.result, 'fail')
    assert.equal(answered.reason, 'credentials:logs/app.log')
    assert.deepEqual(answered.evidence, [])
    await assert.rejects(readdir(join(results, REPORT_DIR)))
  })

  test('a button that cannot be reached fails with where the page stopped', async () => {
    const home = await scratch()
    const { answered } = await run(async () => 'no-report-button', home)
    assert.equal(answered.result, 'fail')
    assert.equal(answered.reason, 'not-opened:no-report-button')
  })

  test('a press that writes no bundle fails', async () => {
    const home = await scratch()
    const { answered } = await run(async () => null, home)
    assert.equal(answered.result, 'fail')
    assert.equal(answered.reason, 'no-bundle')
  })

  test('a bundle that will not open fails', async () => {
    const home = await scratch()
    const { answered } = await run(async () => {
      await mkdir(join(home, 'reports'), { recursive: true })
      await writeFile(join(home, 'reports', 'broken.zip'), 'not a zip')
      return null
    }, home)
    assert.equal(answered.result, 'fail')
    assert.equal(answered.reason, 'bundle-unreadable')
  })

  test('a run stopped by the player is a skip', async () => {
    const home = await scratch()
    const stop = new AbortController()
    const taken = parseRequest({
      schema: 1,
      sha: 'c'.repeat(40),
      budgetSeconds: 60,
      resultsDir: await scratch(),
      checks: [REPORT_CHECK],
      readOnlyServer: true,
      privacy: true
    })
    assert.equal(taken.kind, 'request')
    const answered = await reportScenario({
      home,
      press: async () => {
        stop.abort()
        return 'no-toast'
      }
    })({ request: taken.request, safety: {} as never, signal: stop.signal })
    assert.ok(!Array.isArray(answered))
    assert.equal(answered.result, 'skip')
    assert.equal(answered.reason, 'aborted-by-user')
  })
})

describe('what counts as a credential', () => {
  test('by name: the settings folder and anything named for a secret', async () => {
    const dir = await scratch()
    const names = ['config/settings.json', 'token.txt', 'id.key', 'credentials']
    for (const name of names) {
      await mkdir(join(dir, name, '..'), { recursive: true })
      await writeFile(join(dir, name), '')
    }
    assert.deepEqual(await credentialFiles(dir, names), names)
  })

  test('by content: a RomM token, an auth header or a secret not yet replaced', async () => {
    const dir = await scratch()
    const files: Record<string, string> = {
      'a.log': 'token rmm_abcdef123456',
      'b.log': 'Basic dXNlcjpwYXNzd29yZA==',
      'c.json': '{"refresh_token": "abc"}',
      'd.json': '{"password": "<redacted>", "token": "<token>"}',
      'e.log': 'a token was refreshed'
    }
    for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text)
    assert.deepEqual(await credentialFiles(dir, Object.keys(files)), ['a.log', 'b.log', 'c.json'])
  })
})

describe('the press in the page', () => {
  test('answers null once written, the page’s reason otherwise, and a broken probe as one', async () => {
    const page = (answer: () => Promise<unknown>) => ({ executeJavaScript: answer })
    assert.equal(await pressReport(page(async () => null) as never), null)
    assert.equal(await pressReport(page(async () => 'no-toast') as never), 'no-toast')
    assert.equal(
      await pressReport(page(async () => Promise.reject(new Error('gone'))) as never),
      'probe-failed'
    )
  })

  test('the probe is a script that parses, with its timeout written in', () => {
    const script = reportProbe(1234)
    assert.doesNotThrow(() => new Function(`return ${script}`))
    assert.match(script, /Date\.now\(\) \+ 1234/)
    assert.match(script, /data-action="report-problem"/)
  })
})
