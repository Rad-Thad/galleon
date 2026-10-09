import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { startScenario, type Scenario } from './harness.ts'
import { layoutOffenders, MEASURE_LAYOUT, type Box, type Clip, type Layout } from './layout.ts'

/**
 * M1-15: the bounding-box check `shots:nova` runs on every screen.
 *
 * The judging half against boxes written by hand, then the measuring half in
 * the built app at the Nova's size, with controls planted where they do not
 * fit, so a check that measured nothing could not pass.
 */

const WINDOW: Box = { left: 0, top: 0, right: 1280, bottom: 960 }

const box = (left: number, top: number, right: number, bottom: number): Box => ({
  left,
  top,
  right,
  bottom
})

const clip = (handle: string, at: Box, scrolls: { x?: boolean; y?: boolean } = {}): Clip => ({
  handle,
  box: at,
  clipsX: true,
  clipsY: true,
  scrollsX: scrolls.x ?? false,
  scrollsY: scrolls.y ?? false
})

const layout = (...placed: Layout['placed']): Layout => ({ viewport: WINDOW, placed })

describe('layoutOffenders', () => {
  test('controls inside the window and apart from each other pass', () => {
    assert.deepEqual(
      layoutOffenders(
        layout(
          { handle: '[data-action="a"]', box: box(10, 10, 100, 50), clips: [], within: [] },
          { handle: '[data-action="b"]', box: box(110, 10, 200, 50), clips: [], within: [] }
        )
      ),
      []
    )
  })

  test('a control past an edge of the window is named with the sides it crosses', () => {
    assert.deepEqual(
      layoutOffenders(
        layout({
          handle: '[data-action="far"]',
          box: box(1200, 900, 1320.04, 1000),
          clips: [],
          within: []
        })
      ),
      ['[data-action="far"]: outside the window (right 1320, bottom 1000)']
    )
  })

  test('a control below the fold of a scroller is judged where scrolling puts it', () => {
    const page = clip('[data-screen="settings"]', box(0, 100, 1280, 960), { y: true })
    assert.deepEqual(
      layoutOffenders(
        layout({
          handle: '[data-setting="x"]',
          box: box(40, 1800, 400, 1850),
          clips: [page],
          within: []
        })
      ),
      []
    )
  })

  test('a control taller than its scroller cannot be brought into view', () => {
    const page = clip('[data-screen="game"]', box(0, 100, 1280, 400), { y: true })
    assert.deepEqual(
      layoutOffenders(
        layout({
          handle: '[data-action="tall"]',
          box: box(0, 120, 300, 520),
          clips: [page],
          within: []
        })
      ),
      ['[data-action="tall"]: larger than its scroller [data-screen="game"]']
    )
  })

  test('an ancestor that hides overflow without scrolling cuts the control off', () => {
    const shelf = clip('[data-shelf="recent"]', box(0, 0, 640, 300))
    assert.deepEqual(
      layoutOffenders(
        layout({
          handle: '[data-rom="9"]',
          box: box(600, 10, 700, 200),
          clips: [shelf],
          within: []
        })
      ),
      ['[data-rom="9"]: cut off by [data-shelf="recent"]']
    )
  })

  test('a scroller that itself hangs out of the window still fails what is in it', () => {
    const list = clip('[data-list]', box(0, 0, 1400, 960), { y: true })
    assert.deepEqual(
      layoutOffenders(
        layout({
          handle: '[data-action="edge"]',
          box: box(1300, 10, 1390, 60),
          clips: [list],
          within: []
        })
      ),
      ['[data-action="edge"]: outside the window (right 1390)']
    )
  })

  test('overflow on one axis does not clip the other', () => {
    const row = { ...clip('[data-row]', box(0, 0, 1280, 50), { x: true }), clipsY: false }
    assert.deepEqual(
      layoutOffenders(
        layout({
          handle: '[data-action="pop"]',
          box: box(10, 30, 100, 90),
          clips: [row],
          within: []
        })
      ),
      []
    )
  })

  test('two controls drawn over each other are both named', () => {
    assert.deepEqual(
      layoutOffenders(
        layout(
          { handle: '[data-action="a"]', box: box(10, 10, 100, 50), clips: [], within: [] },
          { handle: '[data-action="b"]', box: box(90, 40, 200, 80), clips: [], within: [] }
        )
      ),
      ['[data-action="a"]: overlaps [data-action="b"]']
    )
  })

  test('a control inside another, or touching it by a pixel, is no overlap', () => {
    assert.deepEqual(
      layoutOffenders(
        layout(
          { handle: '[data-download="1"]', box: box(0, 0, 600, 80), clips: [], within: [] },
          { handle: '[data-action="pause"]', box: box(400, 10, 500, 70), clips: [], within: [0] },
          { handle: '[data-action="next"]', box: box(599.5, 0, 700, 80), clips: [], within: [] }
        )
      ),
      []
    )
  })

  test('only the parts on screen can overlap', () => {
    const list = clip('[data-list]', box(0, 0, 1280, 800), { y: true })
    assert.deepEqual(
      layoutOffenders(
        layout(
          // Scrolled below the list, under the hint bar but not drawn there.
          { handle: '[data-rom="7"]', box: box(10, 820, 200, 1000), clips: [list], within: [] },
          { handle: '[data-action="hint"]', box: box(0, 900, 300, 960), clips: [], within: [] }
        )
      ),
      []
    )
  })
})

describe('MEASURE_LAYOUT in the app at 1280x960', () => {
  let scenario: Scenario

  before(async () => {
    scenario = await startScenario({ viewport: { width: 1280, height: 960 } })
  })

  after(async () => {
    await scenario?.stop()
  })

  test('the home screen as it is has no offenders', async () => {
    const measured = await scenario.app.read<Layout>(MEASURE_LAYOUT)
    assert.ok(measured.placed.length > 0, 'measured no controls at all')
    assert.deepEqual(measured.viewport, WINDOW)
    assert.deepEqual(layoutOffenders(measured), [])
  })

  test('planted controls past the edge, cut off and overlapping are named by handle', async () => {
    const { app } = scenario
    await app.read(`(() => {
      // In an overlay of their own, so only they are judged.
      const layer = document.createElement('div')
      layer.className = 'overlay'
      document.body.append(layer)
      const plant = (html) => layer.insertAdjacentHTML('beforeend', html)
      plant('<button data-focused="false" data-action="planted-edge" style="position:fixed;left:1250px;top:10px;width:80px;height:40px">x</button>')
      plant('<div data-planted-shelf style="position:fixed;left:0;top:100px;width:200px;height:60px;overflow:hidden"><button data-focused="false" data-action="planted-cut" style="position:absolute;left:150px;top:0;width:100px;height:40px">x</button></div>')
      plant('<button data-focused="false" data-action="planted-a" style="position:fixed;left:400px;top:300px;width:100px;height:40px">x</button>')
      plant('<button data-focused="false" data-active="true" style="position:fixed;left:450px;top:320px;width:100px;height:40px">nameless</button>')
      plant('<button data-focused="false" data-action="planted-hidden" style="position:fixed;left:2000px;top:10px;width:80px;height:40px;visibility:hidden">x</button>')
      return true
    })()`)
    const offenders = layoutOffenders(await app.read<Layout>(MEASURE_LAYOUT))
    assert.deepEqual(offenders, [
      '[data-action="planted-edge"]: outside the window (right 1330)',
      '[data-action="planted-cut"]: cut off by [data-planted-shelf]',
      '[data-action="planted-a"]: overlaps button "nameless"'
    ])
  })
})
