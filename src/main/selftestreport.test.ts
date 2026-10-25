import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
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

  test('a bundle that will not open fails and leaves nothing to publish', async () => {
    const home = await scratch()
    const { answered, results } = await run(async () => {
      await mkdir(join(home, 'reports'), { recursive: true })
      await writeFile(join(home, 'reports', 'broken.zip'), 'not a zip')
      return null
    }, home)
    assert.equal(answered.result, 'fail')
    assert.equal(answered.reason, 'bundle-unreadable')
    await assert.rejects(readdir(join(results, REPORT_DIR)))
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

  test('presses only what the focus engine has taken, so a page still registering is waited for', async () => {
    const page = fakePage({ registersAfterMs: 150 })
    assert.equal(await runInNewContext(reportProbe(2000), page.globals), null)
    assert.deepEqual(page.selected, ['system', 'report-problem'])
  })
})

/**
 * Enough of the app's page to run the probe against: an element is drawn at
 * once but known to the focus engine only a while later, as `useFocusable`
 * registers it from an effect after the render. Until then a hover over it is
 * dropped, as `applyFocus` drops an id it does not know, and Enter goes to
 * whatever had the highlight before. A move to where the pointer already is
 * is ignored, as the engine ignores one (see `pointer` in focus.tsx).
 */
function fakePage({ registersAfterMs }: { registersAfterMs: number }) {
  type Element = {
    name: string
    dataset: Record<string, string>
    toastText?: string
    getBoundingClientRect: () => { left: number; top: number; width: number; height: number }
    dispatchEvent: (event: { type: string; clientX: number; clientY: number }) => void
    click: () => void
  }
  const selected: string[] = []
  const registered = new Set<Element>()
  const pointer = { x: -1, y: -1 }
  let focused: Element | null = null
  let screen = 'home'
  let tab = 'general'
  const toasts: Element[] = []
  const element = (name: string, onSelect = () => {}): Element => {
    const self: Element = {
      name,
      dataset: {},
      getBoundingClientRect: () => ({ left: 10, top: 10, width: 100, height: 40 }),
      dispatchEvent: (event) => {
        const moved = event.clientX !== pointer.x || event.clientY !== pointer.y
        pointer.x = event.clientX
        pointer.y = event.clientY
        if (!moved || !registered.has(self)) return
        if (focused) focused.dataset.focused = 'false'
        focused = self
        self.dataset.focused = 'true'
      },
      click: onSelect
    }
    ;(self as unknown as { select: () => void }).select = () => {
      selected.push(name)
      onSelect()
    }
    return self
  }
  const drawn = (one: Element): Element => {
    setTimeout(() => registered.add(one), registersAfterMs)
    return one
  }
  let system: Element | null = null
  let report: Element | null = null
  const menu = element('menu', () => {
    screen = 'settings'
    system = drawn(
      element('system', () => {
        tab = 'system'
        report = drawn(
          element('report-problem', () => {
            const toast = element('toast')
            toast.toastText = 'Written to reports/galleon-report.zip'
            toasts.push(toast)
          })
        )
      })
    )
  })
  const document = {
    querySelector: (selector: string) => {
      if (selector.includes('topbar__nav')) return menu
      if (screen !== 'settings') return null
      if (selector.includes('data-tab="system"')) return system
      if (selector.includes('report-problem')) return tab === 'system' ? report : null
      return null
    },
    querySelectorAll: (selector: string) =>
      selector === '.toast' ? toasts.map((one) => ({ ...one, textContent: one.toastText })) : []
  }
  const window = {
    dispatchEvent: (event: { type: string; key: string }) => {
      if (event.type === 'keydown' && event.key === 'Enter' && focused)
        (focused as unknown as { select: () => void }).select()
    }
  }
  class MouseEvent {
    clientX: number
    clientY: number
    constructor(
      public type: string,
      init: { clientX: number; clientY: number }
    ) {
      this.clientX = init.clientX
      this.clientY = init.clientY
    }
  }
  class KeyboardEvent {
    key: string
    constructor(
      public type: string,
      init: { key: string }
    ) {
      this.key = init.key
    }
  }
  return {
    selected,
    globals: { document, window, MouseEvent, KeyboardEvent, setTimeout, Date, Set, Promise }
  }
}
