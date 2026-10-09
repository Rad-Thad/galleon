/**
 * Whether a screen fits the window: every control can be seen and is not
 * drawn over another.
 *
 * Two halves, because only one of them can run in the page. `MEASURE_LAYOUT`
 * is sent into the renderer as source; it reads boxes and overflow and nothing
 * else. `layoutOffenders` judges what it read,
 * in Node, where it can be tested against boxes written by hand.
 *
 * A control is any focusable (it carries `data-focused`), since that is what a
 * player can reach. When an overlay is open, only the topmost one is judged:
 * the screen under it was judged on its own, and lies under it by design.
 */

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** An ancestor whose overflow is not visible, so it can hide part of a control. */
export interface Clip {
  handle: string
  box: Box
  clipsX: boolean
  clipsY: boolean
  /** Scrolls on this axis the way the focus engine scrolls (see `revealElement`). */
  scrollsX: boolean
  scrollsY: boolean
}

export interface Placed {
  handle: string
  box: Box
  /** Innermost first. */
  clips: Clip[]
  /** Indexes of the controls this one sits inside, which it may cover. */
  within: number[]
}

export interface Layout {
  viewport: Box
  placed: Placed[]
}

/**
 * How far a box may cross an edge before it counts.
 *
 * Boxes are fractional at any scale but one, and a border drawn half a pixel
 * past its neighbour's is not something a player can see.
 */
export const EDGE_TOLERANCE_PX = 1

/**
 * Read the boxes of every visible control on the page, as a `Layout`.
 *
 * Source for `app.read`, because it runs in the renderer: this tree is
 * typechecked without the DOM, and the expression closes over nothing.
 * `scrolling` is the focus engine's own test (see `scrollParentsOf`).
 */
export const MEASURE_LAYOUT = `(() => {
  // What a control is doing rather than which one it is, so never its name.
  const STATE = new Set(['data-focused', 'data-active', 'data-disabled', 'data-open'])
  const described = (element) => {
    const label = (element.textContent ?? '').trim().replace(/\\s+/g, ' ').slice(0, 30)
    return element.tagName.toLowerCase() + (label ? ' "' + label + '"' : '')
  }
  const handleOf = (element) => {
    for (let node = element; node && node !== document.body; node = node.parentElement) {
      const named = [...node.attributes].filter(
        (attribute) => attribute.name.startsWith('data-') && !STATE.has(attribute.name)
      )
      if (named.length > 0) {
        const own = named
          .map(({ name, value }) => (value === '' ? '[' + name + ']' : '[' + name + '="' + value + '"]'))
          .join('')
        return node === element ? own : own + ' ' + described(element)
      }
    }
    return described(element)
  }
  const boxOf = (element) => {
    const { left, top, right, bottom } = element.getBoundingClientRect()
    return { left, top, right, bottom }
  }
  const scrolling = (overflow) => overflow === 'auto' || overflow === 'scroll'

  const overlays = document.querySelectorAll('.overlay')
  const root = overlays.length > 0 ? overlays[overlays.length - 1] : document.body
  const controls = [...root.querySelectorAll('[data-focused]')].filter((element) => {
    const { width, height } = element.getBoundingClientRect()
    return (
      width > 0 &&
      height > 0 &&
      element.checkVisibility({ opacityProperty: true, visibilityProperty: true })
    )
  })

  const placed = controls.map((element) => {
    const clips = []
    // The page's own box is the window, judged below.
    for (
      let node = element.parentElement;
      node && node !== document.body;
      node = node.parentElement
    ) {
      const style = getComputedStyle(node)
      const clipsX = style.overflowX !== 'visible'
      const clipsY = style.overflowY !== 'visible'
      if (!clipsX && !clipsY) continue
      clips.push({
        handle: handleOf(node),
        box: boxOf(node),
        clipsX,
        clipsY,
        scrollsX: scrolling(style.overflowX) && node.scrollWidth > node.clientWidth,
        scrollsY: scrolling(style.overflowY) && node.scrollHeight > node.clientHeight
      })
    }
    return {
      handle: handleOf(element),
      box: boxOf(element),
      clips,
      within: controls.flatMap((other, index) =>
        other !== element && other.contains(element) ? [index] : []
      )
    }
  })

  return {
    viewport: { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight },
    placed
  }
})()`

type Axis = 'x' | 'y'

const span = (box: Box, axis: Axis): [number, number] =>
  axis === 'x' ? [box.left, box.right] : [box.top, box.bottom]

const withSpan = (box: Box, axis: Axis, [from, to]: [number, number]): Box =>
  axis === 'x' ? { ...box, left: from, right: to } : { ...box, top: from, bottom: to }

const intersect = (a: Box, b: Box): Box => ({
  left: Math.max(a.left, b.left),
  top: Math.max(a.top, b.top),
  right: Math.min(a.right, b.right),
  bottom: Math.min(a.bottom, b.bottom)
})

const round = (value: number): number => Math.round(value * 10) / 10

/**
 * What is wrong with each control that does not fit, one line per problem,
 * each naming the control by its `data-*` handle.
 *
 * A control is out of reach when an ancestor that does not scroll cuts any of
 * it off, when it is larger than the scroller it lives in, or when the window
 * cuts it off. One inside a scroller is judged where scrolling would bring it,
 * since the focus engine scrolls it into view on arrival. Two controls overlap
 * when the parts of them on screen now share area, unless one sits inside the
 * other.
 */
export function layoutOffenders(layout: Layout): string[] {
  const problems: string[] = []
  const seen: (Box | null)[] = []

  for (const control of layout.placed) {
    let reach = control.box
    let visible = control.box
    let cut: string | null = null
    for (const clip of control.clips) {
      visible = intersect(visible, clip.box)
      for (const axis of ['x', 'y'] as const) {
        if (!(axis === 'x' ? clip.clipsX : clip.clipsY)) continue
        const [from, to] = span(reach, axis)
        const [start, end] = span(clip.box, axis)
        if (axis === 'x' ? clip.scrollsX : clip.scrollsY) {
          if (to - from > end - start + EDGE_TOLERANCE_PX) {
            cut ??= `larger than its scroller ${clip.handle}`
            continue
          }
          // Where scrolling this ancestor would put it.
          const shift = from < start ? start - from : to > end ? end - to : 0
          reach = withSpan(reach, axis, [from + shift, to + shift])
        } else if (from < start - EDGE_TOLERANCE_PX || to > end + EDGE_TOLERANCE_PX) {
          cut ??= `cut off by ${clip.handle}`
        }
      }
    }
    if (cut === null) {
      const { viewport } = layout
      const sides = [
        reach.left < viewport.left - EDGE_TOLERANCE_PX && `left ${round(reach.left)}`,
        reach.top < viewport.top - EDGE_TOLERANCE_PX && `top ${round(reach.top)}`,
        reach.right > viewport.right + EDGE_TOLERANCE_PX && `right ${round(reach.right)}`,
        reach.bottom > viewport.bottom + EDGE_TOLERANCE_PX && `bottom ${round(reach.bottom)}`
      ].filter(Boolean)
      if (sides.length > 0) cut = `outside the window (${sides.join(', ')})`
    }
    if (cut !== null) problems.push(`${control.handle}: ${cut}`)

    visible = intersect(visible, layout.viewport)
    seen.push(visible.right > visible.left && visible.bottom > visible.top ? visible : null)
  }

  layout.placed.forEach((control, index) => {
    const mine = seen[index]
    if (!mine) return
    for (let other = index + 1; other < layout.placed.length; other += 1) {
      const theirs = seen[other]
      if (!theirs) continue
      if (control.within.includes(other) || layout.placed[other].within.includes(index)) continue
      const shared = intersect(mine, theirs)
      if (
        shared.right - shared.left > EDGE_TOLERANCE_PX &&
        shared.bottom - shared.top > EDGE_TOLERANCE_PX
      )
        problems.push(`${control.handle}: overlaps ${layout.placed[other].handle}`)
    }
  })

  return problems
}
