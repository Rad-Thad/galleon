import assert from 'node:assert/strict'
import { after, afterEach, beforeEach, describe, mock, test } from 'node:test'
import type { JSX } from 'react'
import type { Root } from 'react-dom/client'
import { installDom } from '../test/dom.ts'
import type { Action, Direction, InputKind } from './types.ts'

// Before React is loaded, because a window has to exist for it to render into.
const window = installDom()

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { gamepadPresent, useGamepad, useGamepadName } = await import('./gamepad.ts')

/**
 * What a pad does to the interface, one polled frame at a time.
 *
 * The Gamepad API is polled, so everything this hook decides (a tap fires once,
 * a held direction repeats, a pad Chromium cannot identify still works, a game
 * in front keeps the pad to itself) is a decision about successive frames.
 * Here the frames are stepped by hand and the clock is the test's, so each of
 * those is a fact about input rather than a race against a real animation loop.
 */

/** A frame's worth of time on the clock the hook reads. */
const FRAME_MS = 16

let clock = 0
let frames: FrameRequestCallback[] = []
let pads: (Gamepad | null)[] = []

Object.defineProperty(globalThis, 'requestAnimationFrame', {
  value: (callback: FrameRequestCallback) => frames.push(callback),
  configurable: true,
  writable: true
})
Object.defineProperty(globalThis, 'cancelAnimationFrame', {
  value: () => {
    frames = []
  },
  configurable: true,
  writable: true
})
Object.defineProperty(navigator, 'getGamepads', {
  value: () => pads,
  configurable: true,
  writable: true
})
mock.method(performance, 'now', () => clock)

/** Run the frames that are waiting, a frame's worth of time apart. */
function step(count = 1): void {
  for (let index = 0; index < count; index += 1) {
    clock += FRAME_MS
    const due = frames
    frames = []
    for (const frame of due) frame(clock)
  }
}

/** Hold for this long, polling every frame of it. */
function hold(ms: number): void {
  step(Math.ceil(ms / FRAME_MS))
}

/** A pad with these buttons down and its sticks where they are put. */
function pad(
  options: { pressed?: number[]; axes?: number[]; mapping?: GamepadMappingType; id?: string } = {}
): Gamepad {
  const pressed = new Set(options.pressed ?? [])
  return {
    id: options.id ?? 'Test Pad',
    mapping: options.mapping ?? 'standard',
    axes: options.axes ?? [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, (_, index) => ({
      pressed: pressed.has(index),
      touched: false,
      value: pressed.has(index) ? 1 : 0
    }))
  } as unknown as Gamepad
}

/** Standard-mapping indices, as the tests press them. */
const A = 0
const B = 1
const X = 2
const Y = 3
const LB = 4
const RB = 5
const RT = 7
const START = 9
const DOWN = 13

/** Everything the hook reported, in order. */
interface Heard {
  moves: Direction[]
  actions: Action[]
  activations: number
  kinds: InputKind[]
}

const roots: Root[] = []
let heard: Heard
let setSuspended: (suspended: boolean) => void = () => undefined

function Pad({ suspended }: { suspended: boolean }): null {
  useGamepad(
    (direction) => heard.moves.push(direction),
    (action) => heard.actions.push(action),
    () => {
      heard.activations += 1
    },
    (kind) => heard.kinds.push(kind),
    suspended
  )
  return null
}

function mount(element: JSX.Element): Root {
  const host = window.document.createElement('div')
  window.document.body.appendChild(host)
  const root = createRoot(host as unknown as HTMLElement)
  roots.push(root)
  act(() => root.render(element))
  return root
}

beforeEach(() => {
  clock = 0
  frames = []
  pads = []
  heard = { moves: [], actions: [], activations: 0, kinds: [] }
  const root = mount(<Pad suspended={false} />)
  setSuspended = (suspended) => act(() => root.render(<Pad suspended={suspended} />))
})

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
})

after(() => mock.restoreAll())

describe('a press', () => {
  test('of A activates once, however long it is held', () => {
    pads = [pad({ pressed: [A] })]

    hold(1000)

    assert.equal(heard.activations, 1)
  })

  test('fires again only after it has been let go', () => {
    pads = [pad({ pressed: [A] })]
    step(3)
    pads = [pad()]
    step()
    pads = [pad({ pressed: [A] })]
    step()

    assert.equal(heard.activations, 2)
  })

  test('of each face and shoulder button is the action the hint bar names', () => {
    for (const button of [B, X, Y, LB, RB, START]) {
      pads = [pad({ pressed: [button] })]
      step()
      pads = [pad()]
      step()
    }

    assert.deepEqual(heard.actions, ['back', 'menu', 'search', 'tabLeft', 'tabRight', 'menu'])
  })

  test('says it came from the pad, so the hints can show pad buttons', () => {
    pads = [pad({ pressed: [B] })]
    step()

    assert.deepEqual(heard.kinds, ['gamepad'])
  })

  test('says nothing while nothing is pressed, though the poll runs every frame', () => {
    pads = [pad()]

    hold(1000)

    assert.deepEqual(heard.kinds, [])
  })
})

describe('a held direction', () => {
  test('moves once at once, and only starts repeating after a pause', () => {
    // A tap is a step and a hold is a scroll; repeating straight away would
    // turn every tap into two.
    pads = [pad({ pressed: [DOWN] })]

    step()
    assert.deepEqual(heard.moves, ['down'])

    hold(200)
    assert.equal(heard.moves.length, 1, 'it should not repeat during the pause')

    hold(1000)
    assert.ok(heard.moves.length > 3, `it should repeat while held, moved ${heard.moves.length}`)
    assert.ok(heard.moves.every((direction) => direction === 'down'))
  })

  test('comes from the stick past its dead zone, and not from a stick at rest', () => {
    pads = [pad({ axes: [0.2, -0.3] })]
    step()
    assert.deepEqual(heard.moves, [], 'a stick resting slightly off centre is not a press')

    pads = [pad({ axes: [0.9, 0] })]
    step()
    pads = [pad({ axes: [0, -0.9] })]
    step()
    pads = [pad({ axes: [-0.9, 0] })]
    step()

    assert.deepEqual(heard.moves, ['right', 'up', 'left'])
  })
})

describe('a pad Chromium could not identify', () => {
  test('steers with the hat it reports as a second pair of axes', () => {
    pads = [pad({ mapping: '', axes: [0, 0, 0, 0, 0, 0, 0, 1] })]
    step()
    pads = [pad({ mapping: '', axes: [0, 0, 0, 0, 0, 0, -1, 0] })]
    step()

    assert.deepEqual(heard.moves, ['down', 'left'])
  })

  test('opens the menu from Start where the joystick driver puts it', () => {
    pads = [pad({ mapping: '', pressed: [RT] })]
    step()

    assert.deepEqual(heard.actions, ['menu'])
  })

  test('while on a pad that is mapped, that button is the right trigger and opens nothing', () => {
    pads = [pad({ pressed: [RT], axes: [0, 0, 0, 0, 0, 0, 1, 1] })]
    step()

    assert.deepEqual(heard.actions, [])
    assert.deepEqual(heard.moves, [], 'a mapped pad has no hat axes to read')
  })
})

describe('with more than one pad', () => {
  test('the first connected one drives, so no press is read twice', () => {
    pads = [null, pad({ pressed: [A] }), pad({ pressed: [A] })]
    step()

    assert.equal(heard.activations, 1)
  })
})

describe('while a game has the screen', () => {
  test("the pad is the game's, and nothing reaches the interface", () => {
    setSuspended(true)
    pads = [pad({ pressed: [A, B, DOWN] })]

    hold(1000)

    assert.equal(heard.activations, 0)
    assert.deepEqual(heard.moves, [])
    assert.deepEqual(heard.actions, [])
  })

  test('only Start, held down, comes back to the interface, and once', () => {
    setSuspended(true)
    pads = [pad({ pressed: [START] })]

    hold(500)
    assert.deepEqual(heard.actions, [], 'a press any game might use is not enough')

    hold(5000)
    assert.deepEqual(heard.actions, ['menu'])
    assert.deepEqual(heard.kinds, ['gamepad'])
  })

  test('letting go of Start starts the hold over', () => {
    setSuspended(true)
    pads = [pad({ pressed: [START] })]
    hold(1000)
    pads = [pad()]
    step()
    pads = [pad({ pressed: [START] })]
    hold(1000)

    assert.deepEqual(heard.actions, [], 'two short holds are not one long one')
  })

  test('a direction still down when the game ends does not carry on into the library', () => {
    pads = [pad({ pressed: [DOWN] })]
    step()
    setSuspended(true)
    hold(1000)
    setSuspended(false)
    step()

    // Down again, as a fresh press once the game is gone, and no repeat
    // inherited from before it.
    assert.deepEqual(heard.moves, ['down', 'down'])
  })
})

describe('whether a pad is there', () => {
  test('is a yes for any pad, and a no for empty slots', () => {
    pads = [null, null]
    assert.equal(gamepadPresent(), false)

    pads = [null, pad()]
    assert.equal(gamepadPresent(), true)
  })

  test('names the pad for the pre-flight check, and says when it has no mapping', () => {
    const names: (string | null)[] = []
    function Name(): null {
      names.push(useGamepadName())
      return null
    }

    pads = [pad({ id: 'Xbox Wireless Controller', mapping: '' })]
    mount(<Name />)

    assert.equal(names.at(-1), 'Xbox Wireless Controller (unmapped)')
  })

  test('is nothing at all before a pad has been seen', () => {
    const names: (string | null)[] = []
    function Name(): null {
      names.push(useGamepadName())
      return null
    }

    pads = [null]
    mount(<Name />)

    assert.equal(names.at(-1), null)
  })
})
