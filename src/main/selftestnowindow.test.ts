import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { RommRom } from '@shared/types'
import { SKIP, type CheckResult } from './selftest.ts'
import {
  NO_NEW_WINDOW_CHECK,
  NOTICE_MS,
  noNewWindowScenario,
  noticeProbe,
  ownWindowsOnDisplay,
  type NoNewWindowDeps,
  type ShownCycle
} from './selftestnowindow.ts'
import type { X11 } from './x11.ts'

const TITLE = 'Some Game'

function check(id: string, result: CheckResult['result'] = 'pass'): CheckResult {
  return { id, result, metrics: {}, thresholds: {}, reason: null, evidence: [] }
}

interface Page {
  /** Whether the page holds notices back while covered, as `NoticeGate` does. */
  holds: boolean
  /** Whether a notice is ever shown at all. */
  shows: boolean
}

interface Fake {
  deps: NoNewWindowDeps
  cycle: ShownCycle
  log: string[]
  /** Galleon's windows as each reading finds them, the last one repeated. */
  readings: (number[] | null)[]
  browser: { count: number }
}

/**
 * The page, the display and the download, with a clock that moves only when
 * slept on. `during` runs once the download has finished, before it settles.
 */
function fake(
  options: {
    shown?: readonly string[]
    page?: Page
    download?: CheckResult['result']
    during?: (f: Fake) => void
  } = {}
): Fake {
  const page = options.page ?? { holds: true, shows: true }
  const shown = new Set(options.shown ?? ['retroarch'])
  let clock = 0
  let covered = false
  let pending = false
  let notice = false
  const f: Fake = {
    log: [],
    readings: [[11, 12]],
    browser: { count: 1 },
    cycle: async (emulator, _signal, whileShown) => {
      f.log.push(`cycle ${emulator}`)
      if (!shown.has(emulator)) {
        return [check(`launch.${emulator}`, 'skip'), check(`exit.${emulator}`, 'skip')]
      }
      await whileShown(new AbortController().signal)
      f.log.push(`exit ${emulator}`)
      return [check(`launch.${emulator}`), check(`exit.${emulator}`)]
    },
    deps: {
      windows: () => {
        f.log.push('open')
        let at = 0
        return {
          read: async () => f.readings[Math.min(at++, f.readings.length - 1)],
          close: () => f.log.push('close')
        }
      },
      browserWindows: () => f.browser.count,
      cover: (emulator) => {
        f.log.push(`cover ${emulator}`)
        covered = emulator !== null
        if (!covered && pending && page.shows) notice = true
      },
      download: async (_context, picked) => {
        picked({ name: TITLE } as RommRom)
        clock += 1000
        if (page.shows && (!covered || !page.holds)) notice = true
        else pending = true
        options.during?.(f)
        const result = options.download ?? 'pass'
        return { ...check('download.small', result), reason: result === 'pass' ? null : 'too-big' }
      },
      noticeShown: async (title) => notice && title === TITLE,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms
      }
    }
  }
  return f
}

const context = { request: {} as never, safety: {} as never, signal: new AbortController().signal }

async function run(f: Fake, emulators: readonly string[] = ['retroarch']): Promise<CheckResult> {
  return (await noNewWindowScenario(emulators, f.cycle, f.deps)(context)) as CheckResult
}

describe('focus.no-new-window', () => {
  test('passes when the windows stay as they were and the notice waits for the exit', async () => {
    const f = fake()
    const result = await run(f)
    assert.equal(result.id, NO_NEW_WINDOW_CHECK)
    assert.equal(result.result, 'pass', String(result.reason))
    assert.deepEqual(f.log, [
      'open',
      'cycle retroarch',
      'cover retroarch',
      'exit retroarch',
      'cover null',
      'close'
    ])
    assert.equal(result.metrics.emulator, 'retroarch')
    assert.equal(result.metrics.windowsBefore, 2)
    assert.equal(result.metrics.windowsMost, 2)
    assert.equal(result.metrics.noticeDuring, 0)
    assert.equal(result.metrics.noticeMs, 0)
    assert.equal(result.thresholds.noticeMs, NOTICE_MS)
  })

  test('a window mapped and taken away again during the download fails', async () => {
    const f = fake()
    f.readings = [
      [11, 12],
      [11, 12, 40],
      [11, 12]
    ]
    const result = await run(f)
    assert.equal(result.result, 'fail')
    assert.equal(result.reason, 'new-window')
    assert.equal(result.metrics.windowsMost, 3)
    assert.equal(result.metrics.windowsAfter, 2)
  })

  test('a window that replaces one of the same count still fails', async () => {
    const f = fake()
    f.readings = [
      [11, 12],
      [11, 13]
    ]
    assert.equal((await run(f)).reason, 'new-window')
  })

  test('a window left after the exit fails, though none was seen during the download', async () => {
    const f = fake()
    f.readings = [
      [11, 12],
      [11, 12],
      [11, 12],
      [11, 12, 40]
    ]
    const result = await run(f)
    assert.equal(result.reason, 'new-window')
    assert.equal(result.metrics.windowsAfter, 3)
  })

  test('a BrowserWindow added while the game is shown fails, mapped or not', async () => {
    const f = fake({ during: (g) => (g.browser.count = 2) })
    const result = await run(f)
    assert.equal(result.reason, 'new-window')
    assert.equal(result.metrics.browserWindowsBefore, 1)
    assert.equal(result.metrics.browserWindowsMost, 2)
  })

  test('a notice shown while the game has the screen fails', async () => {
    const result = await run(fake({ page: { holds: false, shows: true } }))
    assert.equal(result.result, 'fail')
    assert.equal(result.reason, 'notice-not-held')
    assert.equal(result.metrics.noticeDuring, 1)
  })

  test('a notice never shown after the exit fails once the wait is over', async () => {
    const result = await run(fake({ page: { holds: true, shows: false } }))
    assert.equal(result.result, 'fail')
    assert.equal(result.reason, 'notice-not-shown')
    assert.equal(result.metrics.noticeMs, null)
  })

  test('a reading the display cannot give counts neither way', async () => {
    const f = fake()
    f.readings = [[11, 12], null, [11, 12]]
    assert.equal((await run(f)).result, 'pass')
  })

  test('without a first reading it skips, and nothing is started', async () => {
    const f = fake()
    f.readings = [null]
    const result = await run(f)
    assert.equal(result.result, 'skip')
    assert.equal(result.reason, 'windows-unknown')
    assert.deepEqual(f.log, ['open', 'close'])
  })

  test('an emulator that is not shown is passed over for the next', async () => {
    const f = fake({ shown: ['dolphin'] })
    const result = await run(f, ['retroarch', 'dolphin'])
    assert.equal(result.result, 'pass')
    assert.equal(result.metrics.emulator, 'dolphin')
    assert.deepEqual(f.log, [
      'open',
      'cycle retroarch',
      'cycle dolphin',
      'cover dolphin',
      'exit dolphin',
      'cover null',
      'close'
    ])
  })

  test('with no emulator shown it skips, and the page is never covered', async () => {
    const f = fake({ shown: [] })
    const result = await run(f, ['retroarch'])
    assert.equal(result.result, 'skip')
    assert.equal(result.reason, 'no-game-shown')
    assert.equal(f.log.filter((line) => line.startsWith('cover')).length, 0)
    assert.equal((await run(fake(), [])).reason, 'no-game-shown')
  })

  test('a download that did not finish skips with its reason', async () => {
    const result = await run(fake({ download: 'skip' }))
    assert.equal(result.result, 'skip')
    assert.equal(result.reason, 'download-too-big')
  })

  test('a new window fails even when the download did not finish', async () => {
    const f = fake({ download: 'fail' })
    f.readings = [[11], [11, 12]]
    assert.equal((await run(f)).reason, 'new-window')
  })

  test('work the cycle stopped waiting on is told to stop and awaited before anything is read', async () => {
    const f = fake()
    const order: string[] = []
    f.deps.download = async (given) => {
      await new Promise<void>((resolve) => given.signal.addEventListener('abort', () => resolve()))
      order.push('download stopped')
      return { ...check('download.small', 'fail'), reason: 'download-cancelled' }
    }
    f.cycle = async (_emulator, _signal, whileShown) => {
      const stop = new AbortController()
      void whileShown(stop.signal)
      stop.abort()
      order.push('cycle over')
      return [check('launch.retroarch'), check('exit.retroarch')]
    }
    const result = await run(f)
    assert.equal(result.result, 'skip')
    assert.equal(result.reason, 'download-download-cancelled')
    assert.equal(result.metrics.emulator, 'retroarch')
    assert.deepEqual(order, ['cycle over', 'download stopped'])
  })

  test('the page is uncovered and the display closed when the cycle throws', async () => {
    const f = fake()
    f.cycle = async (_emulator, _signal, whileShown) => {
      await whileShown(new AbortController().signal)
      throw new Error('boom')
    }
    await assert.rejects(run(f))
    assert.deepEqual(f.log.slice(-2), ['cover null', 'close'])
  })

  test('an aborted run skips', async () => {
    const stop = new AbortController()
    stop.abort()
    const f = fake()
    const result = (await noNewWindowScenario(
      ['retroarch'],
      f.cycle,
      f.deps
    )({
      ...context,
      signal: stop.signal
    })) as CheckResult
    assert.equal(result.result, 'skip')
    assert.equal(result.reason, SKIP.aborted)
  })
})

describe('Galleon windows on the display', () => {
  test('no display, or no group, is no reading; the display is opened once', async () => {
    let opened = 0
    const none = ownWindowsOnDisplay({}, async () => {
      opened += 1
      return null
    })()
    assert.equal(await none.read(), null)
    assert.equal(await none.read(), null)
    assert.equal(opened, 1)
    none.close()

    let closed = 0
    const x11 = { close: () => (closed += 1) } as unknown as X11
    const noGroup = ownWindowsOnDisplay(
      {},
      async () => x11,
      1,
      () => null
    )()
    assert.equal(await noGroup.read(), null)
    noGroup.close()
    await new Promise((r) => setImmediate(r))
    assert.equal(closed, 1)
  })
})

describe('the notice in the page', () => {
  test('asks for a good-news toast naming the game, and only a yes counts', async () => {
    const scripts: string[] = []
    const answers: unknown[] = [true, 'yes', Promise.reject(new Error('gone'))]
    const probe = noticeProbe({
      executeJavaScript: (script: string) => {
        scripts.push(script)
        return Promise.resolve(answers.shift())
      }
    } as never)
    assert.equal(await probe('A "quoted" game'), true)
    assert.equal(await probe('x'), false)
    assert.equal(await probe('x'), false)
    assert.ok(scripts[0].includes('.toast.notice--ok'))
    assert.ok(scripts[0].includes(JSON.stringify('A "quoted" game')))
  })
})
