import type { WebContents } from 'electron'
import { log } from './log.ts'
import { SELF_TEST_PAD } from './selftestidle.ts'

/**
 * Abort on input: the self-test runs on the owner's handheld while it is on
 * the charger, and a person picking it up must get it back at once. Any
 * button pressed or stick moved on a real controller ends the run.
 *
 * Watched from inside the page, through the same Gamepad API the interface
 * reads, so nothing is injected or grabbed at the OS level and the test's
 * own simulated pad (test/app) is seen exactly as a real one is. The one pad
 * passed over is the self-test's own (`SELF_TEST_PAD`), which is the run
 * pressing, not a person.
 */

/** How often the page looks at the controllers. Well inside the one second the run has to stop in. */
export const INPUT_POLL_MS = 50

/**
 * How far a stick must move from where it rested to count. Sticks drift, and
 * a trigger exposed as an axis rests at one end, so it is the change that
 * counts, not the position.
 */
export const AXIS_MOVED = 0.5

/**
 * Run in the page: resolves with true at the first button held down or stick
 * moved.
 *
 * A button counts whenever it is down, even at the first look: Chromium
 * exposes a controller only once one of its buttons is pressed, so that first
 * appearance is itself a press, and a button held as the run starts is a
 * person wanting the device back as much as one pressed later. A stick counts
 * by how far it has moved from its first reading, not where it is.
 */
export function inputProbe(): string {
  return `new Promise((resolve) => {
    const rest = new Map()
    const pads = () => {
      try {
        return Array.from(navigator.getGamepads ? navigator.getGamepads() : []).filter(
          (pad) => pad && !pad.${SELF_TEST_PAD}
        )
      } catch {
        return []
      }
    }
    const touched = () => {
      for (const pad of pads()) {
        if (Array.from(pad.buttons).some((button) => Boolean(button && button.pressed))) return true
        const key = pad.index + ':' + pad.id
        const axes = Array.from(pad.axes, Number)
        const before = rest.get(key)
        if (!before) {
          rest.set(key, axes)
          continue
        }
        if (axes.some((value, i) => Math.abs(value - (before[i] ?? 0)) > ${AXIS_MOVED})) return true
      }
      return false
    }
    const timer = setInterval(() => {
      if (!touched()) return
      clearInterval(timer)
      resolve(true)
    }, ${INPUT_POLL_MS})
  })`
}

/**
 * Watch the page's controllers and call `onInput` once at the first press.
 * A page that goes away ends the watch without calling it: that is not a
 * person asking for their device back.
 */
export function watchInput(
  contents: Pick<WebContents, 'executeJavaScript'>,
  onInput: () => void
): Promise<void> {
  return contents.executeJavaScript(inputProbe(), true).then(
    (seen: unknown) => {
      if (seen !== true) return
      log.info('selftest', 'input from the controller, stopping')
      onInput()
    },
    (cause: unknown) => log.warn('selftest', 'watching the controller failed', { cause })
  )
}
