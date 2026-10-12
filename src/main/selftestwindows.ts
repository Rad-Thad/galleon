import { readFileSync } from 'node:fs'
import type { WindowSighting } from './selftestlaunch.ts'
import type { X11 } from './x11.ts'

/**
 * `LaunchDeps.findWindow` on the device: the session's window list, read over
 * X11, narrowed to the windows of the process group the launch cycle started.
 *
 * gamescope is its own window manager and names the window it shows on the
 * root (`GAMESCOPE_FOCUSED_WINDOW`); a desktop session names it in
 * `_NET_ACTIVE_WINDOW`; with neither, the keyboard focus is what is left.
 * A window is the group's when its `_NET_WM_PID` is a process of that group.
 */

/** Atoms read from the root and from windows, interned once per display. */
const ATOMS = [
  'GAMESCOPE_FOCUSED_WINDOW',
  '_NET_ACTIVE_WINDOW',
  '_NET_CLIENT_LIST',
  '_NET_WM_PID',
  '_NET_WM_STATE',
  '_NET_WM_STATE_FULLSCREEN'
] as const
type Atom = (typeof ATOMS)[number]

/** The process group a pid belongs to, from `/proc/<pid>/stat`; null when gone. */
export function processGroup(
  pid: number,
  read: (path: string) => string = (p) => readFileSync(p, 'utf8')
): number | null {
  try {
    const stat = read(`/proc/${pid}/stat`)
    // The command name in brackets may itself hold spaces and brackets, so
    // the fields are counted from the last closing one.
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    const group = Number(fields[2])
    return Number.isInteger(group) && group > 0 ? group : null
  } catch {
    return null
  }
}

function uint32s(value: Buffer): number[] {
  return Array.from({ length: Math.floor(value.length / 4) }, (_, i) => value.readUInt32LE(4 * i))
}

export interface WindowFinder {
  findWindow: (group: number) => Promise<WindowSighting | null>
}

export function windowFinder(
  x11: X11,
  groupOf: (pid: number) => number | null = processGroup
): WindowFinder {
  let interned: Promise<Map<Atom, number | null>> | null = null
  const atoms = (): Promise<Map<Atom, number | null>> => {
    interned ??= Promise.all(
      ATOMS.map(async (name) => [name, await x11.internAtom(name, true)] as const)
    ).then((pairs) => new Map(pairs))
    return interned
  }

  const windows = async (atom: number | null | undefined): Promise<number[] | null> => {
    if (!atom) return null
    const property = await x11.getProperty(x11.root, atom)
    return property?.format === 32 ? uint32s(property.value) : null
  }

  const pidOf = async (window: number, atom: number | null | undefined): Promise<number | null> => {
    if (!atom) return null
    const property = await x11.getProperty(window, atom)
    return property?.format === 32 && property.value.length >= 4
      ? property.value.readUInt32LE(0)
      : null
  }

  /**
   * Top-level windows and their children: under a reparenting window manager
   * the client window carrying `_NET_WM_PID` sits one level below the frame.
   */
  const candidates = async (named: Map<Atom, number | null>): Promise<number[]> => {
    const listed = await windows(named.get('_NET_CLIENT_LIST'))
    if (listed && listed.length > 0) return listed
    const top = (await x11.queryTree(x11.root)) ?? []
    const below = await Promise.all(top.map(async (w) => (await x11.queryTree(w)) ?? []))
    return [...top, ...below.flat()]
  }

  const focusedWindow = async (named: Map<Atom, number | null>): Promise<number | null> => {
    for (const name of ['GAMESCOPE_FOCUSED_WINDOW', '_NET_ACTIVE_WINDOW'] as const) {
      const [window] = (await windows(named.get(name))) ?? []
      if (window) return window
    }
    return x11.inputFocus()
  }

  return {
    findWindow: async (group) => {
      const named = await atoms()
      const ours: number[] = []
      for (const window of await candidates(named)) {
        const pid = await pidOf(window, named.get('_NET_WM_PID'))
        if (pid !== null && groupOf(pid) === group) ours.push(window)
      }
      if (ours.length === 0) return null
      const focus = await focusedWindow(named)
      // The keyboard focus may sit in a window inside the emulator's own.
      let shown = focus && ours.includes(focus) ? focus : null
      if (focus && shown === null) {
        for (const window of ours)
          if ((await x11.queryTree(window))?.includes(focus)) shown ??= window
      }
      const focused = shown !== null
      shown ??= ours[0]
      const stateAtom = named.get('_NET_WM_STATE')
      const fullscreenAtom = named.get('_NET_WM_STATE_FULLSCREEN')
      const state = stateAtom ? await x11.getProperty(shown, stateAtom) : null
      return {
        focused,
        // Only a window that states its state says anything about fullscreen.
        fullscreen: state && fullscreenAtom ? uint32s(state.value).includes(fullscreenAtom) : null
      }
    }
  }
}
