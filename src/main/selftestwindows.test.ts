import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { processGroup, windowFinder } from './selftestwindows.ts'
import type { Property, X11 } from './x11.ts'

/**
 * `findWindow` against an in-memory window tree: which of the session's
 * windows belong to the started group, and whether one of them is focused
 * and fullscreen, as gamescope, a desktop window manager, or bare X11 say it.
 */

const ROOT = 1
const GROUP = 4000

interface Tree {
  /** Atoms the display knows. */
  atoms?: string[]
  /** window -> property name -> 32-bit values, or atom names after `_NET_WM_STATE_` */
  props?: Record<number, Record<string, (number | string)[]>>
  children?: Record<number, number[]>
  focus?: number | null
}

function display(tree: Tree): X11 & { asked: string[] } {
  const names = tree.atoms ?? ['_NET_WM_PID', '_NET_WM_STATE', '_NET_WM_STATE_FULLSCREEN']
  const ids = new Map(names.map((n, i) => [n, 100 + i]))
  const asked: string[] = []
  return {
    root: ROOT,
    asked,
    internAtom: async (name, onlyIfExists) => {
      asked.push(name)
      assert.equal(onlyIfExists, true)
      return ids.get(name) ?? null
    },
    getProperty: async (window, atom): Promise<Property | null> => {
      const name = [...ids].find(([, id]) => id === atom)?.[0] ?? ''
      const values = tree.props?.[window]?.[name]
      if (!values) return null
      const value = Buffer.alloc(4 * values.length)
      values.forEach((v, i) =>
        value.writeUInt32LE(typeof v === 'string' ? (ids.get(`_NET_WM_STATE_${v}`) ?? 0) : v, 4 * i)
      )
      return { type: 6, format: 32, value }
    },
    queryTree: async (window) => tree.children?.[window] ?? [],
    inputFocus: async () => (tree.focus === undefined ? 0 : tree.focus),
    close: () => {}
  }
}

/** pid -> group: 41 and 42 are the started group's, 7 is Galleon's own. */
const groups: Record<number, number> = { 41: GROUP, 42: GROUP, 7: 7 }
const groupOf = (pid: number) => groups[pid] ?? null

const GAMESCOPE = [
  'GAMESCOPE_FOCUSED_WINDOW',
  '_NET_WM_PID',
  '_NET_WM_STATE',
  '_NET_WM_STATE_FULLSCREEN'
]
const DESKTOP = [
  '_NET_ACTIVE_WINDOW',
  '_NET_CLIENT_LIST',
  '_NET_WM_PID',
  '_NET_WM_STATE',
  '_NET_WM_STATE_FULLSCREEN'
]

describe('findWindow', () => {
  test('under gamescope: the group window it names as focused, fullscreen', async () => {
    const x11 = display({
      atoms: GAMESCOPE,
      children: { [ROOT]: [10, 20] },
      props: {
        [ROOT]: { GAMESCOPE_FOCUSED_WINDOW: [20] },
        10: { _NET_WM_PID: [7] },
        20: { _NET_WM_PID: [42], _NET_WM_STATE: ['FULLSCREEN'] }
      }
    })
    assert.deepEqual(await windowFinder(x11, groupOf).findWindow(GROUP), {
      focused: true,
      fullscreen: true
    })
  })

  test('a group window gamescope does not focus is seen but not focused', async () => {
    const x11 = display({
      atoms: GAMESCOPE,
      children: { [ROOT]: [10, 20] },
      props: {
        [ROOT]: { GAMESCOPE_FOCUSED_WINDOW: [10] },
        10: { _NET_WM_PID: [7] },
        20: { _NET_WM_PID: [41] }
      },
      focus: 20
    })
    assert.deepEqual(await windowFinder(x11, groupOf).findWindow(GROUP), {
      focused: false,
      fullscreen: null
    })
  })

  test('on a desktop: the client list and the active window', async () => {
    const x11 = display({
      atoms: DESKTOP,
      children: { [ROOT]: [99] },
      props: {
        [ROOT]: { _NET_CLIENT_LIST: [10, 20], _NET_ACTIVE_WINDOW: [20] },
        10: { _NET_WM_PID: [7] },
        20: { _NET_WM_PID: [41], _NET_WM_STATE: [] }
      }
    })
    assert.deepEqual(await windowFinder(x11, groupOf).findWindow(GROUP), {
      focused: true,
      fullscreen: false
    })
  })

  test('with no window manager: the tree, a level down, and the input focus', async () => {
    const x11 = display({
      children: { [ROOT]: [10, 30], 30: [31] },
      props: { 10: { _NET_WM_PID: [7] }, 31: { _NET_WM_PID: [42] } },
      focus: 31
    })
    assert.deepEqual(await windowFinder(x11, groupOf).findWindow(GROUP), {
      focused: true,
      fullscreen: null
    })
  })

  test('focus on a window inside the group window counts, and its state is read', async () => {
    const x11 = display({
      children: { [ROOT]: [10, 20, 30], 30: [31] },
      props: {
        10: { _NET_WM_PID: [7] },
        20: { _NET_WM_PID: [41] },
        30: { _NET_WM_PID: [42], _NET_WM_STATE: ['FULLSCREEN'] }
      },
      focus: 31
    })
    assert.deepEqual(await windowFinder(x11, groupOf).findWindow(GROUP), {
      focused: true,
      fullscreen: true
    })
  })

  test('no focus, or focus elsewhere, is not focused', async () => {
    for (const focus of [0, null, 10]) {
      const x11 = display({
        children: { [ROOT]: [10, 20] },
        props: { 10: { _NET_WM_PID: [7] }, 20: { _NET_WM_PID: [41] } },
        focus
      })
      assert.deepEqual(
        await windowFinder(x11, groupOf).findWindow(GROUP),
        { focused: false, fullscreen: null },
        String(focus)
      )
    }
  })

  test('none while no window belongs to the group', async () => {
    const x11 = display({
      atoms: GAMESCOPE,
      children: { [ROOT]: [10, 20, 30] },
      props: {
        [ROOT]: { GAMESCOPE_FOCUSED_WINDOW: [10] },
        10: { _NET_WM_PID: [7] },
        20: { _NET_WM_PID: [999] }
      }
    })
    assert.equal(await windowFinder(x11, groupOf).findWindow(GROUP), null)
  })

  test('none on a display without _NET_WM_PID, which cannot tie a window to a process', async () => {
    const x11 = display({ atoms: [], children: { [ROOT]: [20] }, focus: 20 })
    assert.equal(await windowFinder(x11, groupOf).findWindow(GROUP), null)
  })

  test('without the fullscreen atom, fullscreen is unknown', async () => {
    const x11 = display({
      atoms: ['_NET_WM_PID', '_NET_WM_STATE'],
      children: { [ROOT]: [20] },
      props: { 20: { _NET_WM_PID: [41], _NET_WM_STATE: [5] } },
      focus: 20
    })
    assert.deepEqual(await windowFinder(x11, groupOf).findWindow(GROUP), {
      focused: true,
      fullscreen: null
    })
  })

  test('atoms are interned once, however often it is asked', async () => {
    const x11 = display({ children: { [ROOT]: [] } })
    const finder = windowFinder(x11, groupOf)
    await finder.findWindow(GROUP)
    await finder.findWindow(GROUP)
    assert.equal(x11.asked.length, new Set(x11.asked).size)
  })
})

describe('processGroup', () => {
  const stat = (comm: string, group: string) =>
    `4242 (${comm}) S 1 ${group} 4000 0 -1 4194560 100 0 0 0`

  test('reads the group past the command name, whatever it holds', () => {
    assert.equal(
      processGroup(4242, () => stat('duckstation', '4000')),
      4000
    )
    assert.equal(
      processGroup(4242, () => stat('a) b (c', '4001')),
      4001
    )
  })

  test('reads the right file', () => {
    let path = ''
    processGroup(17, (p) => {
      path = p
      return stat('x', '17')
    })
    assert.equal(path, '/proc/17/stat')
  })

  test('none for a process that is gone or a stat it cannot read', () => {
    assert.equal(
      processGroup(4242, () => {
        throw Object.assign(new Error('gone'), { code: 'ENOENT' })
      }),
      null
    )
    assert.equal(
      processGroup(4242, () => 'garbage'),
      null
    )
    assert.equal(
      processGroup(4242, () => stat('x', '0')),
      null
    )
  })

  test('its own process is in a group', () => {
    assert.equal(processGroup(process.pid) !== null, true)
  })
})
