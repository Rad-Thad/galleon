import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { AXIS_MOVED, inputProbe, watchInput } from './selftestinput.ts'

/**
 * Abort on input. The probe is run here against a scripted `navigator`, one
 * look per interval tick, so what counts as a person touching the controller
 * is pinned without a page. test:app drives it through the built app.
 */

interface FakePad {
  index: number
  id: string
  buttons: { pressed: boolean }[]
  axes: number[]
}

function pad(pressed: number[] = [], axes: number[] = [0, 0, 0, 0]): FakePad {
  return {
    index: 0,
    id: 'pad',
    buttons: Array.from({ length: 4 }, (_, i) => ({ pressed: pressed.includes(i) })),
    axes
  }
}

/**
 * Run the probe over a sequence of looks, each being what `getGamepads`
 * returns on that tick. Resolves with the tick it fired on, or null.
 */
async function looks(sequence: (FakePad | null)[][]): Promise<number | null> {
  let tick = -1
  const state: { fired: number | null } = { fired: null }
  const ticks: (() => void)[] = []
  const probe = runInNewContext(inputProbe(), {
    navigator: { getGamepads: () => sequence[Math.min(tick, sequence.length - 1)] ?? [] },
    setInterval: (callback: () => void) => {
      ticks.push(callback)
      return ticks.length
    },
    clearInterval: () => ticks.splice(0),
    Promise,
    Map,
    Array,
    Math,
    Number,
    Boolean
  }) as Promise<boolean>
  void probe.then(() => (state.fired = tick))
  for (tick = 0; tick < sequence.length && state.fired === null; tick += 1) {
    for (const callback of ticks) callback()
    await Promise.resolve()
    await Promise.resolve()
  }
  return state.fired
}

describe('inputProbe', () => {
  test('a pad at rest never fires', async () => {
    assert.equal(await looks([[pad()], [pad()], [pad([], [0.1, -0.1, 0, 0])]]), null)
  })

  test('a button pressed fires', async () => {
    assert.equal(await looks([[pad()], [pad()], [pad([2])]]), 2)
  })

  test('a button already down at the first look fires too', async () => {
    assert.equal(await looks([[pad([0])]]), 0)
  })

  test('a pad appearing with a button down fires: that is how Chromium reveals one', async () => {
    assert.equal(await looks([[], [null], [pad([1])]]), 2)
  })

  test('a stick counts by how far it moved, not where it rests', async () => {
    const trigger = [0, 0, -1, 0]
    assert.equal(await looks([[pad([], trigger)], [pad([], trigger)]]), null)
    const moved = [AXIS_MOVED + 0.01, 0, -1, 0]
    assert.equal(await looks([[pad([], trigger)], [pad([], moved)]]), 1)
  })

  test('no Gamepad API, or one that throws, is no input', async () => {
    const quiet = runInNewContext(inputProbe(), {
      navigator: {
        getGamepads: () => {
          throw new Error('denied')
        }
      },
      setInterval: (callback: () => void) => {
        callback()
        return 1
      },
      clearInterval: () => undefined,
      Promise,
      Map,
      Array,
      Math,
      Number,
      Boolean
    }) as Promise<boolean>
    const outcome = await Promise.race([quiet, new Promise((done) => setTimeout(done, 20, 'none'))])
    assert.equal(outcome, 'none')
  })
})

describe('watchInput', () => {
  test('calls back once the page reports input', async () => {
    let called = 0
    await watchInput({ executeJavaScript: async () => true } as never, () => (called += 1))
    assert.equal(called, 1)
  })

  test('a page that went away is not input', async () => {
    let called = 0
    await watchInput(
      { executeJavaScript: () => Promise.reject(new Error('destroyed')) } as never,
      () => (called += 1)
    )
    await watchInput({ executeJavaScript: async () => null } as never, () => (called += 1))
    assert.equal(called, 0)
  })
})
