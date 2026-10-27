import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { NoticeGate } from './notices.ts'

function gate(): { gate: NoticeGate<string>; shown: string[] } {
  const shown: string[] = []
  return { gate: new NoticeGate<string>((notice) => shown.push(notice)), shown }
}

describe('a notice', () => {
  test('is shown at once while nothing covers RomMix', () => {
    const { gate: notices, shown } = gate()
    notices.offer('downloaded')
    assert.deepEqual(shown, ['downloaded'])
    assert.equal(notices.waiting, 0)
  })

  test('raised during play waits, and is shown once the game has gone, in order', () => {
    const { gate: notices, shown } = gate()
    notices.setCovered(true)
    notices.offer('downloaded')
    notices.offer('save failed')
    assert.deepEqual(shown, [], 'nothing should be shown behind the game')
    assert.equal(notices.waiting, 2)

    notices.setCovered(false)
    assert.deepEqual(shown, ['downloaded', 'save failed'])
    assert.equal(notices.waiting, 0)
  })

  test('is shown once only, however often the screen changes hands after', () => {
    const { gate: notices, shown } = gate()
    notices.setCovered(true)
    notices.offer('downloaded')
    notices.setCovered(false)
    notices.setCovered(true)
    notices.setCovered(false)
    assert.deepEqual(shown, ['downloaded'])
  })

  test('still waits while the game is told again that it has the screen', () => {
    const { gate: notices, shown } = gate()
    notices.setCovered(true)
    notices.offer('downloaded')
    notices.setCovered(true)
    assert.deepEqual(shown, [])
    assert.equal(notices.waiting, 1)
  })
})
