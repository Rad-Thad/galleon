import assert from 'node:assert/strict'
import { after, beforeEach, describe, test } from 'node:test'
import { revealElement, scrollToEnd } from './scroll.ts'

/**
 * Where the page scrolls when focus moves.
 *
 * Every function in `scroll.ts` reads layout, and there is no layout in a test
 * DOM, so the elements here are stand-ins that report the geometry each test
 * sets and record every scroll asked of them. What is checked is the decision:
 * which ancestor scrolls on which axis, when the page snaps to an end instead
 * of to the element, and when a press at the bottom of a page has nothing left
 * to show.
 */

interface Box {
  top: number
  bottom: number
  left: number
  right: number
  width: number
}

/** A stand-in element: its box, its scroll extent, and what was asked of it. */
interface Fake {
  parentElement: Fake | null
  style: { overflowX: string; overflowY: string }
  box: Box
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  scrollWidth: number
  clientWidth: number
  offsetHeight: number
  asked: { call: string; options: Record<string, unknown> }[]
  getBoundingClientRect: () => Box
  scrollBy: (options: Record<string, unknown>) => void
  scrollTo: (options: Record<string, unknown>) => void
  scrollIntoView: (options: Record<string, unknown>) => void
}

function box(top: number, height: number, left = 0, width = 100): Box {
  return { top, bottom: top + height, left, right: left + width, width }
}

function fake(fields: Partial<Omit<Fake, 'asked'>> = {}): Fake {
  const element: Fake = {
    parentElement: null,
    style: { overflowX: 'visible', overflowY: 'visible' },
    box: box(0, 100),
    scrollTop: 0,
    scrollHeight: 100,
    clientHeight: 100,
    scrollWidth: 100,
    clientWidth: 100,
    offsetHeight: 100,
    asked: [],
    getBoundingClientRect: () => element.box,
    scrollBy: (options) => element.asked.push({ call: 'scrollBy', options }),
    scrollTo: (options) => element.asked.push({ call: 'scrollTo', options }),
    scrollIntoView: (options) => element.asked.push({ call: 'scrollIntoView', options }),
    ...fields
  }
  return element
}

/** A page that scrolls down, a long way, with the viewport at its top. */
function page(scrollTop = 0): Fake {
  return fake({
    style: { overflowX: 'hidden', overflowY: 'auto' },
    box: box(0, 1000),
    scrollTop,
    scrollHeight: 5000,
    clientHeight: 1000
  })
}

/** A shelf that scrolls sideways inside it. */
function shelf(parent: Fake): Fake {
  return fake({
    parentElement: parent,
    style: { overflowX: 'auto', overflowY: 'hidden' },
    box: box(0, 300, 0, 1000),
    scrollWidth: 4000,
    clientWidth: 1000
  })
}

let reducedMotion = false
const realWindow = (globalThis as { window?: unknown }).window
const realStyle = (globalThis as { getComputedStyle?: unknown }).getComputedStyle
Object.defineProperty(globalThis, 'window', {
  value: { matchMedia: () => ({ matches: reducedMotion }) },
  configurable: true,
  writable: true
})
Object.defineProperty(globalThis, 'getComputedStyle', {
  value: (element: Fake) => element.style,
  configurable: true,
  writable: true
})
after(() => {
  for (const [key, value] of [
    ['window', realWindow],
    ['getComputedStyle', realStyle]
  ] as const) {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
})

beforeEach(() => {
  reducedMotion = false
})

/** Hand a stand-in to code that expects an element. */
const el = (element: Fake): HTMLElement => element as unknown as HTMLElement

describe('a newly focused element', () => {
  test('in the middle of a page is brought into view by the least movement', () => {
    const scroller = page(1000)
    const card = fake({ parentElement: scroller, box: box(400, 200) })

    revealElement(el(card))

    assert.deepEqual(scroller.asked, [])
    assert.equal(card.asked[0].call, 'scrollIntoView')
    assert.equal(card.asked[0].options.block, 'nearest')
    // The sideways axis is settled by the shelf, so this never re-centres it.
    assert.equal(card.asked[0].options.inline, 'nearest')
  })

  test('near the top of a page takes the page all the way to its top', () => {
    // So the title above the first row is shown, which `scrollIntoView` alone
    // would leave hidden.
    const scroller = page(100)
    const card = fake({ parentElement: scroller, box: box(50, 200) })

    revealElement(el(card))

    assert.deepEqual(scroller.asked, [
      { call: 'scrollTo', options: { top: 0, behavior: 'smooth' } }
    ])
    assert.deepEqual(card.asked, [])
  })

  test('near the bottom of a page takes the page all the way to its bottom', () => {
    const scroller = page(3900)
    const card = fake({ parentElement: scroller, box: box(950, 100), offsetHeight: 100 })

    revealElement(el(card))

    assert.deepEqual(scroller.asked, [
      { call: 'scrollTo', options: { top: 5000, behavior: 'smooth' } }
    ])
  })

  test('off the right of its shelf scrolls the shelf, leaving room for the next card', () => {
    const scroller = page(1000)
    const row = shelf(scroller)
    const card = fake({ parentElement: row, box: box(400, 200, 950, 100) })

    revealElement(el(card))

    const [asked] = row.asked
    assert.equal(asked.call, 'scrollBy')
    // Past the card's own right edge: the card after it shows too.
    assert.ok((asked.options.left as number) > 50, `scrolled by ${asked.options.left}`)
  })

  test('off the left of its shelf scrolls the shelf back', () => {
    const scroller = page(1000)
    const row = shelf(scroller)
    const card = fake({ parentElement: row, box: box(400, 200, -50, 100) })

    revealElement(el(card))

    assert.ok((row.asked[0].options.left as number) < 0)
  })

  test('well inside its shelf leaves the shelf where it is', () => {
    const scroller = page(1000)
    const row = shelf(scroller)
    const card = fake({ parentElement: row, box: box(400, 200, 400, 100) })

    revealElement(el(card))

    assert.deepEqual(row.asked, [])
  })

  test('arrives rather than travels for someone who asked for reduced motion', () => {
    reducedMotion = true
    const scroller = page(100)
    const card = fake({ parentElement: scroller, box: box(50, 200) })

    revealElement(el(card))

    assert.equal(scroller.asked[0].options.behavior, 'auto')
  })

  test('with nothing scrolling above it is simply scrolled into view', () => {
    const card = fake({ parentElement: fake() })

    revealElement(el(card))

    assert.equal(card.asked[0].call, 'scrollIntoView')
  })
})

describe('a press past the last thing to focus', () => {
  test('shows the rest of the page below it', () => {
    const scroller = page(1000)
    const last = fake({ parentElement: scroller })

    assert.equal(scrollToEnd(el(last), 'down'), true)
    assert.deepEqual(scroller.asked, [
      { call: 'scrollTo', options: { top: 5000, behavior: 'smooth' } }
    ])
  })

  test('shows the rest of the page above it', () => {
    const scroller = page(1000)
    const first = fake({ parentElement: scroller })

    assert.equal(scrollToEnd(el(first), 'up'), true)
    assert.equal(scroller.asked[0].options.top, 0)
  })

  test('does nothing, and says so, when the page is already at that end', () => {
    const atTop = page(0)
    assert.equal(scrollToEnd(el(fake({ parentElement: atTop })), 'up'), false)

    const atBottom = page(4000)
    assert.equal(scrollToEnd(el(fake({ parentElement: atBottom })), 'down'), false)

    assert.deepEqual([...atTop.asked, ...atBottom.asked], [])
  })

  test('does nothing on a page that does not scroll', () => {
    assert.equal(scrollToEnd(el(fake({ parentElement: fake() })), 'down'), false)
  })
})
