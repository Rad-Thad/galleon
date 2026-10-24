import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { Window } from 'happy-dom'
import type { PowerState, RommPlatform } from '@shared/types'
import type { CheckResult, Safety, SelfTestRequest } from './selftest.ts'
import {
  GRID_CHECK,
  GRID_END,
  MIN_GAMES,
  PROFILE_SET,
  THRESHOLDS,
  WANT_PROFILE,
  askForProfile,
  frameStats,
  largestPlatform,
  powerMetrics,
  runScroll,
  scrollProbe,
  scrollScenario,
  type ProfileAnswer,
  type ScrollRun,
  type ScrollScenarioDeps
} from './selftestscroll.ts'

/**
 * `grid.scroll@<profile>`: the platform it scrolls, the profile handshake with
 * run.sh, and the verdict from the frame times. The scroll in the page is
 * driven by test:app against a 1,300-game fake platform.
 */

const dirs: string[] = []
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

function platform(id: number, slug: string, count: number): RommPlatform {
  return {
    id,
    slug,
    fs_slug: slug,
    name: slug,
    display_name: slug,
    custom_name: null,
    rom_count: count,
    fs_size_bytes: 0,
    url_logo: null,
    missing_from_fs: false
  }
}

function power(profile: string, extra: Partial<PowerState> = {}): PowerState {
  return {
    cpuGovernor: 'schedutil',
    cpuCurKHz: null,
    cpuMaxKHz: 2_956_800,
    gpuGovernor: 'unknown',
    gpuCurHz: 680_000_000,
    gpuMaxHz: null,
    profile,
    defaultProfile: 'Balanced',
    perf: 'unknown',
    ...extra
  }
}

/** A scroll at 120 Hz with `slow` frames of 20 ms among `frames`. */
function scrolled(frames: number, slow = 0, visited = 50): ScrollRun {
  const intervals = Array.from({ length: frames }, (_, i) => (i < slow ? 20 : 8.3))
  return {
    intervals,
    idle: [8.3, 8.4],
    visited,
    moves: visited,
    turns: 0,
    waitedMs: 0,
    cards: 60,
    pageMs: [],
    gapMs: [],
    failed: null
  }
}

/** A run that never got going, for the answers that are not a scroll. */
function stalled(failed: string | null, intervals: number[] = [], visited = 0): ScrollRun {
  return {
    intervals,
    idle: [],
    visited,
    moves: 0,
    turns: 0,
    waitedMs: 0,
    cards: 0,
    pageMs: [],
    gapMs: [],
    failed
  }
}

function context(profiles: string[], signal = new AbortController().signal) {
  return {
    request: { profiles } as SelfTestRequest,
    safety: {} as Safety,
    signal
  }
}

interface Fake {
  deps: ScrollScenarioDeps
  asked: string[]
  scrolls: number[]
}

function fake(options: {
  platforms?: RommPlatform[]
  run?: ScrollRun | null
  profile?: string
  /** What the harness does when asked: switch, or leave the profile be. */
  switches?: boolean
}): Fake {
  let profile = options.profile ?? 'Balanced'
  const asked: string[] = []
  const scrolls: number[] = []
  const deps: ScrollScenarioDeps = {
    client: { platforms: async () => options.platforms ?? [platform(5, 'nes', 1300)] },
    scroll: async (platformId) => {
      scrolls.push(platformId)
      return options.run === undefined ? scrolled(1000) : options.run
    },
    power: async () => power(profile),
    askForProfile: async (wanted): Promise<ProfileAnswer> => {
      asked.push(wanted)
      if (options.switches === false) return 'unchanged'
      profile = wanted[0].toUpperCase() + wanted.slice(1)
      return 'set'
    },
    displayHz: () => 120,
    sampleMs: 1
  }
  return { deps, asked, scrolls }
}

async function run(f: Fake, profiles: string[], signal?: AbortSignal): Promise<CheckResult[]> {
  return (await scrollScenario(f.deps)(context(profiles, signal))) as CheckResult[]
}

describe('largestPlatform', () => {
  test('the platform with the most games', () => {
    const big = platform(2, 'snes', 1500)
    assert.equal(largestPlatform([platform(1, 'nes', 1300), big, platform(3, 'gba', 20)]), big)
  })

  test(`none when no platform reaches ${MIN_GAMES} games`, () => {
    assert.equal(largestPlatform([platform(1, 'nes', MIN_GAMES - 1)]), null)
    assert.equal(largestPlatform([]), null)
  })
})

describe('scrollProbe', () => {
  test('is a script the page can parse, naming the platform and the times', () => {
    const script = scrollProbe(42, 1234, 90, 5678, 1500, 2345)
    assert.doesNotThrow(() => new Function(`return ${script}`))
    assert.match(script, /\[data-platform="42"\]/)
    assert.match(script, /1234/)
    assert.match(script, /5678/)
    assert.match(script, /2345/)
  })
})

/**
 * A library screen with just what the probe reaches for: the menu, the chip,
 * a column of cards the arrow keys walk, and a page that lands `pageMs` after
 * the highlight first reaches the bottom (never, for null), with the end
 * marker drawn beneath it. The spinner is up while that page is out.
 */
function library(firstPage: number, nextPage: number, pageMs: number | null) {
  const window = new Window({ url: 'http://localhost/' })
  const { document } = window
  document.body.innerHTML = `
    <nav class="topbar__nav"><button data-route="library"></button></nav>
    <div data-screen="library">
      <button data-platform="42" data-active="true"></button>
      <div class="grid"></div>
    </div>`
  const grid = document.querySelector('.grid')!
  const add = (count: number): void => {
    const from = grid.children.length
    for (let i = 0; i < count; i++) {
      const card = document.createElement('div')
      card.dataset.rom = String(from + i)
      card.addEventListener('mousemove', () => focus(from + i))
      grid.appendChild(card)
    }
  }
  let at = -1
  const focus = (index: number): void => {
    grid.children[at]?.removeAttribute('data-focused')
    at = index
    grid.children[at].setAttribute('data-focused', 'true')
  }
  const keys: { key: string; cards: number }[] = []
  let asked = false
  window.addEventListener('keydown', (event) => {
    const { key } = event as unknown as { key: string }
    keys.push({ key, cards: grid.children.length })
    const next = key === 'ArrowDown' ? at + 1 : at - 1
    if (next >= 0 && next < grid.children.length) focus(next)
    if (at === grid.children.length - 1 && !asked && pageMs !== null) {
      asked = true
      const spinner = document.createElement('div')
      spinner.className = 'spinner'
      grid.parentElement!.appendChild(spinner)
      setTimeout(() => {
        spinner.remove()
        add(nextPage)
        const end = document.createElement('div')
        end.setAttribute(GRID_END.slice(1, -1), '')
        grid.parentElement!.appendChild(end)
      }, pageMs)
    }
  })
  add(firstPage)
  const probe = (script: string): Promise<ScrollRun> =>
    new Function(
      'window',
      'document',
      'requestAnimationFrame',
      'KeyboardEvent',
      'MouseEvent',
      'MutationObserver',
      `return ${script}`
    )(
      window,
      document,
      window.requestAnimationFrame.bind(window),
      window.KeyboardEvent,
      window.MouseEvent,
      window.MutationObserver
    )
  return { probe, keys, close: () => window.happyDOM.close() }
}

describe('scrollProbe in a page', () => {
  test('holds Down through a page slower than TURN_MS, and turns at the end the grid draws', async () => {
    const page = library(10, 10, 300)
    try {
      const scroll = await page.probe(scrollProbe(42, 1500, 10, 2000, 100, 20))
      assert.equal(scroll.failed, null)
      assert.equal(scroll.cards, 20)
      assert.equal(scroll.visited, 20)
      assert.ok(scroll.turns >= 1, JSON.stringify(scroll))
      // Waiting at the loading edge is reported, not turned from.
      assert.ok(scroll.waitedMs >= 200, JSON.stringify(scroll))
      // The one page asked for, timed from its spinner to its covers.
      assert.equal(scroll.pageMs.length, 1)
      assert.ok(scroll.pageMs[0] >= 250 && scroll.pageMs[0] < 1000, JSON.stringify(scroll))
      assert.deepEqual(scroll.gapMs, [])
      const firstUp = page.keys.findIndex((k) => k.key === 'ArrowUp')
      assert.ok(firstUp > 0)
      assert.equal(page.keys[firstUp].cards, 20)
    } finally {
      await page.close()
    }
  })

  test('a page that never comes is turned from once the grid has had its time', async () => {
    const page = library(10, 0, null)
    try {
      const scroll = await page.probe(scrollProbe(42, 800, 10, 300, 50, 20))
      assert.equal(scroll.failed, null)
      assert.equal(scroll.cards, 10)
      assert.ok(scroll.turns >= 1, JSON.stringify(scroll))
      assert.ok(scroll.waitedMs >= 250, JSON.stringify(scroll))
      assert.deepEqual(scroll.pageMs, [])
    } finally {
      await page.close()
    }
  })
})

describe('frameStats', () => {
  test('percentiles and the share over one and a half refreshes, at 60 Hz and 120 Hz', () => {
    const intervals = [...Array(90).fill(8.3), ...Array(10).fill(16.7)]
    assert.deepEqual(frameStats(intervals, 120), {
      frames: 100,
      p50Ms: 8.3,
      p95Ms: 16.7,
      p99Ms: 16.7,
      droppedPct: 10
    })
    assert.equal(frameStats(intervals, 60)?.droppedPct, 0)
  })

  test('nothing measurable is null', () => {
    assert.equal(frameStats([], 120), null)
    assert.equal(frameStats([0, -1, Number.NaN, Infinity], 120), null)
  })
})

describe('runScroll', () => {
  const live = new AbortController().signal

  test("the page's answer", async () => {
    const answer = scrolled(10)
    const contents = { executeJavaScript: async () => answer }
    assert.deepEqual(await runScroll(contents, 5, live, 10), answer)
  })

  test('null for an answer that is not a scroll, or a page that threw', async () => {
    assert.equal(await runScroll({ executeJavaScript: async () => 'nope' }, 5, live, 10), null)
    const { idle: _idle, ...unpaced } = scrolled(10)
    assert.equal(await runScroll({ executeJavaScript: async () => unpaced }, 5, live, 10), null)
    const threw = { executeJavaScript: async () => Promise.reject(new Error('gone')) }
    assert.equal(await runScroll(threw, 5, live, 10), null)
  })

  test('null as soon as the run is stopped, without waiting for the page', async () => {
    const stop = new AbortController()
    const pending = runScroll({ executeJavaScript: () => new Promise(() => {}) }, 5, stop.signal)
    stop.abort()
    assert.equal(await pending, null)
  })
})

describe('askForProfile', () => {
  const live = new AbortController().signal
  const folder = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'galleon-handshake-'))
    dirs.push(dir)
    return dir
  }

  test('no handshake folder, no switch', async () => {
    assert.equal(await askForProfile(null, 'performance', live), 'no-handshake')
  })

  test('writes the wish, reads the answer, and clears both', async () => {
    const dir = folder()
    // A stale answer from an earlier ask must not be read as this one's.
    writeFileSync(join(dir, PROFILE_SET), 'balanced\n')
    const answering = setInterval(() => {
      if (existsSync(join(dir, WANT_PROFILE))) {
        const wanted = readFileSync(join(dir, WANT_PROFILE), 'utf8').trim()
        writeFileSync(join(dir, PROFILE_SET), `${wanted}\n`)
        clearInterval(answering)
      }
    }, 5)
    assert.equal(await askForProfile(dir, 'performance', live, 2_000, 5), 'set')
    assert.equal(existsSync(join(dir, WANT_PROFILE)), false)
    assert.equal(existsSync(join(dir, PROFILE_SET)), false)
  })

  test("another answer is 'unchanged'", async () => {
    const dir = folder()
    const answering = setInterval(() => {
      if (existsSync(join(dir, WANT_PROFILE))) {
        writeFileSync(join(dir, PROFILE_SET), 'unchanged:balanced\n')
        clearInterval(answering)
      }
    }, 5)
    assert.equal(await askForProfile(dir, 'performance', live, 2_000, 5), 'unchanged')
  })

  test("no answer in time is 'no-answer', and the wish is taken back", async () => {
    const dir = folder()
    assert.equal(await askForProfile(dir, 'performance', live, 30, 5), 'no-answer')
    assert.equal(existsSync(join(dir, WANT_PROFILE)), false)
  })

  test('a stopped run stops waiting', async () => {
    const stop = new AbortController()
    stop.abort()
    assert.equal(await askForProfile(folder(), 'performance', stop.signal), 'no-answer')
  })
})

describe('powerMetrics', () => {
  test('one profile and governor, the highest clocks seen', () => {
    const metrics = powerMetrics([
      power('Performance', { gpuCurHz: 500_000_000 }),
      power('performance', { cpuMaxKHz: 1_000_000 })
    ])
    assert.deepEqual(metrics, {
      profileObserved: 'performance',
      governor: 'schedutil',
      policy7MaxKHz: 2_956_800,
      gpuMHz: 680,
      samples: 2
    })
  })

  test('a profile that changed mid-scroll is mixed; nothing read is unknown', () => {
    const changed = powerMetrics([power('Performance'), power('Balanced', { cpuGovernor: 'x' })])
    assert.equal(changed.profileObserved, 'mixed')
    assert.equal(changed.governor, 'mixed')
    // A sample that could not tell is not a second profile.
    assert.equal(
      powerMetrics([power('Performance'), power('unknown')]).profileObserved,
      'performance'
    )
    const none = powerMetrics([])
    assert.equal(none.profileObserved, 'unknown')
    assert.equal(none.policy7MaxKHz, null)
    assert.equal(none.gpuMHz, null)
  })
})

describe('scrollScenario', () => {
  test('once per requested profile, switching to each, on the largest platform', async () => {
    const f = fake({
      platforms: [platform(1, 'gba', 40), platform(7, 'psx', 1400)],
      profile: 'Performance'
    })
    const results = await run(f, ['performance', 'balanced'])
    assert.deepEqual(
      results.map((r) => [r.id, r.result]),
      [
        [`${GRID_CHECK}@performance`, 'pass'],
        [`${GRID_CHECK}@balanced`, 'pass']
      ]
    )
    // Already on Performance: only Balanced needed asking for.
    assert.deepEqual(f.asked, ['balanced'])
    assert.deepEqual(f.scrolls, [7, 7])
    const [first] = results
    assert.equal(first.metrics.platform, 'psx')
    assert.equal(first.metrics.games, 1400)
    assert.equal(first.metrics.frames, 1000)
    assert.equal(first.metrics.p95Ms, 8.3)
    assert.equal(first.metrics.droppedPct, 0)
    assert.equal(first.metrics.profileObserved, 'performance')
    assert.equal(first.metrics.displayHz, 120)
    assert.deepEqual(first.thresholds, THRESHOLDS.performance)
    assert.deepEqual(results[1].thresholds, THRESHOLDS.balanced)
  })

  test('no profile requested: one check on the profile in force, held to the strictest', async () => {
    const f = fake({})
    const [only] = await run(f, [])
    assert.equal(only.id, GRID_CHECK)
    assert.deepEqual(only.thresholds, THRESHOLDS.performance)
    assert.deepEqual(f.asked, [])
  })

  test("dropped frames over a profile's threshold fail it", async () => {
    // 4% of frames over 12.5 ms: within Balanced's allowance, over Performance's.
    const f = fake({ run: scrolled(1000, 40), profile: 'Performance' })
    const [perf, bal] = await run(f, ['performance', 'balanced'])
    assert.equal(perf.result, 'fail')
    assert.equal(perf.reason, 'over-threshold')
    assert.equal(perf.metrics.droppedPct, 4)
    assert.equal(bal.result, 'pass')
  })

  test('the page at rest is reported beside the scroll, and never judged', async () => {
    // Every other refresh at rest: the pacing, not the moves, holds it back.
    const paced: ScrollRun = { ...scrolled(1000, 0, 40), idle: Array(240).fill(16.7), turns: 2 }
    const [result] = await run(fake({ run: paced }), [])
    assert.equal(result.result, 'pass')
    assert.equal(result.metrics.idleFrames, 240)
    assert.equal(result.metrics.idleP50Ms, 16.7)
    assert.equal(result.metrics.idleDroppedPct, 100)
    assert.equal(result.metrics.moves, 40)
    assert.equal(result.metrics.turns, 2)
    assert.equal(result.metrics.cards, 60)
  })

  test('the pages asked for during the scroll are counted and timed, never judged', async () => {
    const paged: ScrollRun = { ...scrolled(100), pageMs: [700.4, 90, 1200], gapMs: [400, 600.6] }
    const [result] = await run(fake({ run: paged }), [])
    assert.equal(result.result, 'pass')
    assert.equal(result.metrics.pages, 3)
    assert.equal(result.metrics.pageP50Ms, 700)
    assert.equal(result.metrics.pageMaxMs, 1200)
    assert.equal(result.metrics.gapP50Ms, 400)
    const [none] = await run(fake({ run: scrolled(100) }), [])
    assert.equal(none.metrics.pages, 0)
    assert.equal(none.metrics.pageP50Ms, null)
    assert.equal(none.metrics.pageMaxMs, null)
    assert.equal(none.metrics.gapP50Ms, null)
  })

  test('no frames at rest: the idle numbers are unknown', async () => {
    const [result] = await run(fake({ run: { ...scrolled(100), idle: [] } }), [])
    assert.equal(result.result, 'pass')
    assert.equal(result.metrics.idleFrames, 0)
    assert.equal(result.metrics.idleP95Ms, null)
  })

  test('a slow p95 fails', async () => {
    const [result] = await run(fake({ run: scrolled(100, 10) }), [])
    assert.equal(result.metrics.p95Ms, 20)
    assert.equal(result.result, 'fail')
  })

  test('during the scroll the clocks come from `sample`; the profile is named by `power` first', async () => {
    const f = fake({ profile: 'Performance' })
    let sampled = 0
    let scrolling = false
    f.deps.scroll = async () => {
      scrolling = true
      await new Promise((resolve) => setTimeout(resolve, 20))
      scrolling = false
      return scrolled(1000)
    }
    const powered: boolean[] = []
    const named = f.deps.power
    f.deps.power = async () => {
      powered.push(scrolling)
      return named()
    }
    // A file-only read that cannot tell the profile.
    f.deps.sample = async () => {
      sampled += 1
      return power('unknown')
    }
    const [result] = await run(f, ['performance'])
    assert.ok(sampled > 0, 'sampled while scrolling')
    assert.ok(!powered.includes(true), '`power` was never read mid-scroll')
    assert.equal(result.metrics.profileObserved, 'performance')
  })

  test('a profile that could not be set is skipped, not measured under its name', async () => {
    const f = fake({ switches: false })
    const [result] = await run(f, ['performance'])
    assert.equal(result.result, 'skip')
    assert.equal(result.reason, 'profile-not-set')
    assert.equal(result.metrics.profileObserved, 'balanced')
    assert.equal(result.metrics.profileAnswer, 'unchanged')
    assert.deepEqual(f.scrolls, [])
  })

  test('no platform large enough: every requested check is skipped', async () => {
    const results = await run(fake({ platforms: [platform(1, 'gba', 12)] }), ['performance', 'eco'])
    assert.deepEqual(
      results.map((r) => [r.id, r.result, r.reason]),
      [
        [`${GRID_CHECK}@performance`, 'skip', 'no-large-platform'],
        [`${GRID_CHECK}@eco`, 'skip', 'no-large-platform']
      ]
    )
  })

  test('no platform large enough: the synthetic one is scrolled when offered', async () => {
    const f = fake({ platforms: [platform(1, 'gba', 12)] })
    let offered = 0
    f.deps.synthetic = () => {
      offered += 1
      return platform(-1, 'galleon-synthetic', 1300)
    }
    const results = await run(f, [])
    assert.equal(offered, 1)
    assert.deepEqual(f.scrolls, [-1])
    assert.equal(results[0].result, 'pass')
    assert.equal(results[0].metrics.platform, 'galleon-synthetic')
    assert.equal(results[0].metrics.games, 1300)
  })

  test('a real platform large enough is scrolled, never the synthetic one', async () => {
    const f = fake({})
    let offered = 0
    f.deps.synthetic = () => {
      offered += 1
      return platform(-1, 'galleon-synthetic', 1300)
    }
    await run(f, [])
    assert.equal(offered, 0)
    assert.deepEqual(f.scrolls, [5])
  })

  test('a server that does not list platforms: the synthetic one, else the failure', async () => {
    const f = fake({})
    f.deps.client = { platforms: () => Promise.reject(new Error('ECONNREFUSED')) }
    await assert.rejects(() => run(f, []), /ECONNREFUSED/)
    f.deps.synthetic = () => platform(-1, 'galleon-synthetic', 1300)
    await run(f, [])
    assert.deepEqual(f.scrolls, [-1])
  })

  test('a scroll that could not start, finish or move is an error', async () => {
    const failed = await run(fake({ run: stalled('no-platform-chip') }), [])
    assert.equal(failed[0].result, 'error')
    assert.equal(failed[0].reason, 'no-platform-chip')
    const unfinished = await run(fake({ run: null }), [])
    assert.equal(unfinished[0].reason, 'scroll-did-not-finish')
    const still = await run(fake({ run: scrolled(100, 0, 1) }), [])
    assert.equal(still[0].reason, 'grid-did-not-scroll')
    const empty = await run(fake({ run: stalled(null, [0, Number.NaN], 9) }), [])
    assert.equal(empty[0].reason, 'grid-did-not-scroll')
  })

  test('stopped by the player: the rest are skipped as aborted', async () => {
    const stop = new AbortController()
    const f = fake({})
    const scroll = f.deps.scroll
    f.deps.scroll = async (id, signal) => {
      const answer = await scroll(id, signal)
      stop.abort()
      return answer
    }
    const results = await run(f, ['balanced', 'performance'], stop.signal)
    assert.deepEqual(
      results.map((r) => [r.id, r.result, r.reason]),
      [
        [`${GRID_CHECK}@balanced`, 'skip', 'aborted-by-user'],
        [`${GRID_CHECK}@performance`, 'skip', 'aborted-by-user']
      ]
    )
  })

  test('a power reading that fails is an unknown profile', async () => {
    const f = fake({})
    f.deps.power = async () => Promise.reject(new Error('no sysfs'))
    const [result] = await run(f, ['performance'])
    assert.equal(result.reason, 'profile-not-set')
    assert.equal(result.metrics.profileObserved, 'unknown')
    const [plain] = await run(f, [])
    assert.equal(plain.metrics.profileObserved, 'unknown')
  })
})
