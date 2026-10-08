import assert from 'node:assert/strict'
import { after, beforeEach, describe, test } from 'node:test'

/**
 * The three cues, against a stand-in for Web Audio.
 *
 * What matters is what the module asks the audio system for, not what comes
 * out of a speaker: nothing before the setting has been read, one context
 * built on the first press and kept, a tone per cue pitched so the three can be
 * told apart, and silence rather than an error on a machine with no audio at
 * all. A fake `AudioContext` records exactly that.
 */

/** One tone as it was asked for. */
interface Tone {
  type: string
  hz: number
  started: number | null
  stopped: number | null
  connected: boolean
}

let built = 0
let resumed = 0
let tones: Tone[] = []
let startSuspended = false

class FakeAudioContext {
  currentTime = 10
  state: AudioContextState = startSuspended ? 'suspended' : 'running'
  destination = { destination: true }

  constructor() {
    built += 1
  }

  resume(): Promise<void> {
    resumed += 1
    this.state = 'running'
    return Promise.resolve()
  }

  createOscillator(): unknown {
    const tone: Tone = { type: '', hz: 0, started: null, stopped: null, connected: false }
    tones.push(tone)
    return {
      set type(value: string) {
        tone.type = value
      },
      frequency: {
        setValueAtTime: (hz: number) => {
          tone.hz = hz
        }
      },
      connect: () => {
        tone.connected = true
      },
      start: (at: number) => {
        tone.started = at
      },
      stop: (at: number) => {
        tone.stopped = at
      }
    }
  }

  createGain(): unknown {
    return {
      gain: {
        setValueAtTime: () => undefined,
        linearRampToValueAtTime: () => undefined,
        exponentialRampToValueAtTime: () => undefined
      },
      connect: () => undefined
    }
  }
}

const realAudioContext = (globalThis as { AudioContext?: unknown }).AudioContext
Object.defineProperty(globalThis, 'AudioContext', {
  value: FakeAudioContext,
  configurable: true,
  writable: true
})
after(() => {
  Object.defineProperty(globalThis, 'AudioContext', {
    value: realAudioContext,
    configurable: true,
    writable: true
  })
})

const { playCue, setSoundEnabled } = await import('./sound.ts')

beforeEach(() => {
  tones = []
})

describe('the cues', () => {
  test('stay silent until the setting has been read', () => {
    playCue('move')

    assert.equal(built, 0, 'no audio should be built before the answer is known')
    assert.deepEqual(tones, [])
  })

  test('build one context on the first press, start it, and keep it', () => {
    startSuspended = true
    setSoundEnabled(true)

    playCue('move')
    playCue('select')

    assert.equal(built, 1)
    // Built suspended under the autoplay rules, and started by the press that
    // built it.
    assert.equal(resumed, 1)
    assert.equal(tones.length, 2)
  })

  test('each play one short tone, out through the speakers', () => {
    playCue('back')

    const [tone] = tones
    assert.equal(tone.type, 'triangle')
    assert.equal(tone.connected, true)
    assert.ok(tone.started !== null && tone.stopped !== null)
    assert.ok(tone.stopped > tone.started, 'the tone should end after it starts')
  })

  test('are pitched apart: choosing above the tick, leaving below it', () => {
    playCue('move')
    playCue('select')
    playCue('back')

    const [move, select, back] = tones.map((tone) => tone.hz)
    assert.ok(select > move, 'choosing should rise above moving')
    assert.ok(back < move, 'leaving should fall below moving')
  })

  test('stop when the setting is turned off', () => {
    setSoundEnabled(false)

    playCue('select')

    assert.deepEqual(tones, [])
  })
})
