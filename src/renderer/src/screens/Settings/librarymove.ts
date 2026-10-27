import type { LibraryMovePlan } from '@shared/types'

/**
 * What the confirmation can offer for a plan.
 *
 * Decided here, from the plan alone, so the dialog and the main process agree
 * on which plans are refused: `changeLibraryFolder` refuses the same ones, and
 * a Move button that the main process then turned down would be a question
 * asked and answered with an error.
 *
 *  - `refused`: the new folder is inside the library, so nothing can be offered.
 *  - `no-room`: the games do not fit there; the dialog says how far short.
 *  - `setting-only`: nothing to carry (no games, or the same folder by another
 *    name), so agreeing changes the setting and nothing else.
 *  - `move`: the games are carried, then the setting changes.
 */
export type MoveVerdict = 'refused' | 'no-room' | 'setting-only' | 'move'

export function moveVerdict(plan: LibraryMovePlan): MoveVerdict {
  if (plan.refused === 'inside-library') return 'refused'
  if (!plan.fits) return 'no-room'
  if (plan.refused === 'same-folder' || carried(plan).length === 0) return 'setting-only'
  return 'move'
}

/**
 * The games that will actually move: a game whose place is already taken stays
 * where it is (`moveLibrary` skips it), so it is listed apart and its size is
 * not part of what moves.
 */
export function carried(plan: LibraryMovePlan): LibraryMovePlan['games'] {
  const taken = new Set(plan.taken)
  return plan.games.filter((game) => !taken.has(game.romId))
}

/** The size of what will move. See `carried`. */
export function carriedBytes(plan: LibraryMovePlan): number {
  return carried(plan).reduce((sum, game) => sum + game.sizeBytes, 0)
}

/**
 * How many games the confirmation names. The panel has no scrolling a pad can
 * reach, and a long list would push its buttons off the screen.
 */
export const LISTED_GAMES = 8

/**
 * The games the confirmation names, biggest first, and how many it leaves out.
 *
 * Biggest first because size is the question the list answers: what makes the
 * move long, and what the room is going on.
 */
export function listed(
  plan: LibraryMovePlan,
  limit = LISTED_GAMES
): { games: LibraryMovePlan['games']; more: number } {
  const games = [...plan.games].sort((a, b) => b.sizeBytes - a.sizeBytes)
  return { games: games.slice(0, limit), more: Math.max(0, games.length - limit) }
}
