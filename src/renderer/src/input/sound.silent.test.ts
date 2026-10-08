import assert from 'node:assert/strict'
import { after, test } from 'node:test'

/**
 * The cues on a machine with no audio at all.
 *
 * A file of its own because the module remembers that there was no audio and
 * never asks again, which is the behaviour under test and would silence every
 * cue in `sound.test.ts` after it. Each test file runs in a process of its own,
 * so this one starts with the module fresh.
 */

let attempts = 0
function NoAudio(): never {
  attempts += 1
  throw new Error('no audio device')
}

const realAudioContext = (globalThis as { AudioContext?: unknown }).AudioContext
Object.defineProperty(globalThis, 'AudioContext', {
  value: NoAudio,
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

test('nothing plays, nothing throws, and nothing is tried again', () => {
  setSoundEnabled(true)

  playCue('move')
  playCue('select')

  assert.equal(attempts, 1, 'a machine with no audio should be asked once')
})
