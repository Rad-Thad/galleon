import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SKIP, type CheckResult, type Scenario } from './selftest.ts'
import { isSteamTool, scanSteamGames, type SteamSources } from './steam/library.ts'
import { launchSteamGame } from './steam/launch.ts'
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

export const STEAM_LAUNCH_CHECK = 'steam.launch'

/**
 * Handshake files in the request's `handshakeDir` (docs/TESTING.md). The app
 * says it has asked Steam; run.sh, which can read Steam's windows through its
 * debugger, answers with what it saw. The target shortcut marks its own start
 * and end.
 */
export const STEAM_LAUNCHED = 'steam-launched'
export const STEAM_PROMPT = 'steam-prompt'
export const TARGET_STARTED = 'target-started'
export const TARGET_ENDED = 'target-ended'

/** What run.sh may answer: no prompt, one shown and gone, or one still up. */
export const PROMPT_ANSWERS = ['none', 'shown', 'left'] as const
export type PromptAnswer = (typeof PROMPT_ANSWERS)[number] | 'no-answer'

/** How long run.sh is given to watch Steam and answer. */
export const PROMPT_WAIT_MS = 60_000

/** How long the target, once started, is given to end. */
export const TARGET_END_MS = 60_000

const POLL_MS = 200

export interface SteamLaunchScenarioDeps {
  launch?: (gameid: string) => string[] | null
  promptWaitMs?: number
  targetEndMs?: number
  pollMs?: number
}

/**
 * `steam.launch`: Galleon asks Steam to start the harness's target shortcut
 * the way it starts a Steam game, and records what happened, since Steam's
 * 'Launch Multiple Games' prompt may hold the start, or close Galleon, which
 * is itself a running shortcut.
 *
 * Any recorded outcome passes, the prompt included: what to do about it is
 * M5-03's. A prompt still on screen when run.sh stops watching is
 * `needs-attended`, since a person has to answer it. Galleon was killed when
 * this check never reports; the harness records that.
 */
export function steamLaunchScenario(deps: SteamLaunchScenarioDeps = {}): Scenario {
  const launch = deps.launch ?? launchSteamGame
  const pollMs = deps.pollMs ?? POLL_MS
  return async ({ request, signal }) => {
    const answer = (
      result: CheckResult['result'],
      reason: string | null,
      metrics: CheckResult['metrics'] = {}
    ): CheckResult => ({
      id: STEAM_LAUNCH_CHECK,
      result,
      metrics,
      thresholds: {},
      reason,
      evidence: []
    })
    const dir = request.handshakeDir
    if (!request.steamTarget) return answer('skip', 'no-steam-target')
    if (!dir) return answer('skip', 'no-handshake')
    const file = (name: string): string => join(dir, name)
    const names = [STEAM_LAUNCHED, STEAM_PROMPT, TARGET_STARTED, TARGET_ENDED]
    const clear = (): Promise<unknown> =>
      Promise.all(names.map((name) => rm(file(name), { force: true })))
    const there = (name: string): Promise<boolean> =>
      stat(file(name)).then(
        () => true,
        () => false
      )
    const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, pollMs))

    // A mark left by an earlier run would read as this one's.
    await clear()
    try {
      const started = performance.now()
      if (!launch(request.steamTarget)) return answer('fail', 'launch-refused')
      await writeFile(`${file(STEAM_LAUNCHED)}.tmp`, `${request.steamTarget}\n`)
      await rename(`${file(STEAM_LAUNCHED)}.tmp`, file(STEAM_LAUNCHED))

      let prompt: PromptAnswer = 'no-answer'
      let startMs: number | null = null
      const promptUntil = Date.now() + (deps.promptWaitMs ?? PROMPT_WAIT_MS)
      while (Date.now() < promptUntil && !signal.aborted) {
        if (startMs === null && (await there(TARGET_STARTED))) {
          startMs = Math.round(performance.now() - started)
        }
        const said = (await readFile(file(STEAM_PROMPT), 'utf8').catch(() => null))?.trim()
        if (said !== undefined) {
          prompt = (PROMPT_ANSWERS as readonly string[]).includes(said)
            ? (said as PromptAnswer)
            : 'no-answer'
          break
        }
        await pause()
      }
      if (startMs === null && (await there(TARGET_STARTED))) {
        startMs = Math.round(performance.now() - started)
      }

      let ended = false
      if (startMs !== null) {
        const endUntil = Date.now() + (deps.targetEndMs ?? TARGET_END_MS)
        while (!signal.aborted && !(ended = await there(TARGET_ENDED)) && Date.now() < endUntil) {
          await pause()
        }
      }
      if (signal.aborted) return answer('skip', SKIP.aborted)

      const metrics = {
        started: startMs === null ? 0 : 1,
        startMs,
        prompt,
        targetEnded: ended ? 1 : 0,
        // This process is the one answering, after the target has had its run.
        galleonSurvived: 1
      }
      if (prompt === 'left') return answer('skip', 'needs-attended', metrics)
      if (prompt === 'no-answer') return answer('fail', 'no-prompt-answer', metrics)
      if (startMs === null && prompt === 'none') return answer('fail', 'not-started', metrics)
      return answer('pass', null, metrics)
    } finally {
      await clear()
    }
  }
}
