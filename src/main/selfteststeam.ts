import type { CheckResult, Scenario } from './selftest.ts'
import { isSteamTool, scanSteamGames, type SteamSources } from './steam/library.ts'
import { coverArt, nonSteamShortcuts, type ShortcutSources } from './steam/shortcuts.ts'

/**
 * `steam.list`: Steam's installed games and its non-Steam shortcuts read from
 * the owner's own Steam files, and how many of each have a cover.
 *
 * Only counts are published. Names, appids and paths say what the owner
 * plays, so they stay on the device.
 */

export const STEAM_LIST_CHECK = 'steam.list'

/**
 * The shortcut the harness adds before the app starts (docs/PLAN.md section
 * 5.3, step 6). It is on every device the app runs on, so finding it is what
 * shows the shortcut list was really read. The Steam checks' target shares
 * the prefix, and both are counted apart from the owner's.
 */
export const TEST_SHORTCUT = 'Galleon Device Test'

export type SteamListSources = SteamSources & ShortcutSources

/**
 * Fails when a library list, a game's manifest or a shortcut list Steam wrote
 * cannot be read, since that is a reader falling behind Steam's format, and
 * when the harness's shortcut is not among those read. An owner with no Steam
 * games of their own passes: the count says so.
 */
export function steamListScenario(sources: SteamListSources = {}): Scenario {
  return async () => {
    const started = performance.now()
    const scan = await scanSteamGames(sources)
    const games = scan.games.filter((game) => !isSteamTool(game))
    const { shortcuts, unreadable } = await nonSteamShortcuts(sources)
    const covers = await coverArt(sources)
    const listMs = Math.round(performance.now() - started)

    const isTest = (name: string): boolean => name.startsWith(TEST_SHORTCUT)
    const testShortcuts = shortcuts.filter((s) => isTest(s.name)).length
    const found = shortcuts.some((s) => s.name === TEST_SHORTCUT)
    const reason =
      scan.malformed > 0
        ? 'steam-files-unreadable'
        : unreadable > 0
          ? 'shortcuts-unreadable'
          : found
            ? null
            : 'test-shortcut-not-found'
    const result: CheckResult = {
      id: STEAM_LIST_CHECK,
      result: reason === null ? 'pass' : 'fail',
      metrics: {
        steamGames: games.length,
        steamGamesWithCover: games.filter((g) => covers.has(g.appid)).length,
        shortcuts: shortcuts.length - testShortcuts,
        shortcutsWithCover: shortcuts.filter((s) => !isTest(s.name) && covers.has(s.appid)).length,
        testShortcuts,
        steamFilesUnreadable: scan.malformed,
        shortcutListsUnreadable: unreadable,
        listMs
      },
      thresholds: { steamFilesUnreadable: 0, shortcutListsUnreadable: 0, testShortcuts: 1 },
      reason,
      evidence: []
    }
    return result
  }
}
