import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { reclaimScreen } from './reclaim.ts'

function fakeWindow(state: { destroyed?: boolean; minimized?: boolean } = {}) {
  const calls: string[] = []
  return {
    calls,
    window: {
      isDestroyed: () => state.destroyed ?? false,
      isMinimized: () => state.minimized ?? false,
      restore: () => calls.push('restore'),
      focus: () => calls.push('focus'),
      webContents: { invalidate: () => calls.push('invalidate') }
    }
  }
}

describe('reclaimScreen', () => {
  test('focuses the window and asks for one redraw', () => {
    const { window, calls } = fakeWindow()
    reclaimScreen(window)
    assert.deepEqual(calls, ['focus', 'invalidate'])
  })

  test('a minimised window is restored first', () => {
    const { window, calls } = fakeWindow({ minimized: true })
    reclaimScreen(window)
    assert.deepEqual(calls, ['restore', 'focus', 'invalidate'])
  })

  test('a window already gone is left alone', () => {
    const { window, calls } = fakeWindow({ destroyed: true })
    reclaimScreen(window)
    assert.deepEqual(calls, [])
  })
})
