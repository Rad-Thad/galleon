import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { LibraryMoveGame, LibraryMovePlan } from '@shared/types'
import { carried, carriedBytes, listed, LISTED_GAMES, moveVerdict } from './librarymove.ts'

/**
 * What the library-move confirmation offers for a plan, which has to be what
 * `changeLibraryFolder` would do with it: a Move button for a plan the main
 * process refuses is a question answered with an error.
 */

function game(romId: number, sizeBytes: number): LibraryMoveGame {
  return {
    romId,
    name: `Game ${romId}`,
    system: 'genesis',
    from: `/old/genesis/${romId}.md`,
    to: `/new/genesis/${romId}.md`,
    parts: [{ from: `/old/genesis/${romId}.md`, to: `/new/genesis/${romId}.md` }],
    sizeBytes
  }
}

function plan(overrides: Partial<LibraryMovePlan> = {}): LibraryMovePlan {
  return {
    from: '/old',
    to: '/new',
    refused: null,
    games: [game(1, 100), game(2, 50)],
    totalBytes: 150,
    missing: [],
    taken: [],
    sameDrive: false,
    freeBytes: 1000,
    fits: true,
    ...overrides
  }
}

describe('what the library-move confirmation offers', () => {
  test('a plan with games that fit moves them', () => {
    assert.equal(moveVerdict(plan()), 'move')
  })

  test('a folder inside the library is refused, whatever else the plan says', () => {
    assert.equal(moveVerdict(plan({ refused: 'inside-library', games: [], fits: true })), 'refused')
    assert.equal(moveVerdict(plan({ refused: 'inside-library', fits: false })), 'refused')
  })

  test('games that do not fit are not offered', () => {
    assert.equal(moveVerdict(plan({ fits: false })), 'no-room')
  })

  test('the same folder by another name changes only the setting', () => {
    assert.equal(
      moveVerdict(plan({ refused: 'same-folder', games: [], totalBytes: 0 })),
      'setting-only'
    )
  })

  test('nothing to carry changes only the setting', () => {
    assert.equal(moveVerdict(plan({ games: [], totalBytes: 0 })), 'setting-only')
    // Every game's place taken: each is skipped, so nothing moves.
    assert.equal(moveVerdict(plan({ taken: [1, 2] })), 'setting-only')
  })

  test('a game whose place is taken is not counted as moving', () => {
    const one = plan({ taken: [2] })
    assert.deepEqual(
      carried(one).map((entry) => entry.romId),
      [1]
    )
    assert.equal(carriedBytes(one), 100)
    assert.equal(carriedBytes(plan()), 150)
    assert.equal(moveVerdict(one), 'move')
  })

  test('names the biggest games, and counts the rest', () => {
    const many = plan({ games: [game(1, 10), game(2, 30), game(3, 20), game(4, 40)] })
    const two = listed(many, 2)
    assert.deepEqual(
      two.games.map((entry) => entry.romId),
      [4, 2]
    )
    assert.equal(two.more, 2)
    assert.deepEqual(listed(many), { games: listed(many, 4).games, more: 0 })
    assert.ok(LISTED_GAMES > 0)
  })
})
