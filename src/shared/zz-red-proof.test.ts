import assert from 'node:assert/strict'
import { test } from 'node:test'

// Deliberately failing: the one-time proof that a red unit test turns the x64
// required check red (M0-05). This pull request is closed, never merged.
test('a deliberately failing test', () => {
  assert.equal(1, 2)
})
