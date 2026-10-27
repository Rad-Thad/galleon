import { spawn } from 'node:child_process'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { childEnvironment, environmentChanges } from '../childenv.ts'
import { log } from '../log.ts'

/**
 * Starting a Steam game, which Steam itself runs.
 *
 * Galleon does not start the game's process: it hands Steam a
 * `steam://rungameid/` link, and the Steam client already running the session
 * starts the game under its own tracking, overlay and Proton. The `steam`
 * command forwards the link to that client and exits, so nothing here waits on
 * it; how long the game runs is Steam's to know, not this process's.
 */

/** The Steam client's own launcher, where armadaOS installs it. */
export const STEAM_COMMAND = '/usr/bin/steam'

type Spawn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess

export interface SteamLaunchDeps {
  spawn?: Spawn
  parentEnv?: Readonly<Record<string, string | undefined>>
}

/** The command that asks Steam to run `appid`, or null for an appid that is not one. */
export function steamLaunchArgv(appid: string): string[] | null {
  // Digits only: the appid goes into a URL Steam acts on, and a manifest is a
  // file anyone with the card can write.
  if (!/^\d+$/.test(appid)) return null
  return [STEAM_COMMAND, `steam://rungameid/${appid}`]
}

/**
 * Ask Steam to run `appid`, and return the command used, or null when the
 * appid is not one and nothing was started.
 *
 * The child gets the clean environment every launch gets (`childEnvironment`),
 * so Galleon's AppImage variables and Steam's overlay preload do not reach the
 * `steam` command. It is let go at once: its output is not read and its exit
 * is not awaited, so a Steam that is slow to answer never holds the launcher.
 */
export function launchSteamGame(appid: string, deps: SteamLaunchDeps = {}): string[] | null {
  const argv = steamLaunchArgv(appid)
  if (!argv) {
    log.warn('steam', 'not a Steam appid; nothing launched', { appid })
    return null
  }
  const parentEnv = deps.parentEnv ?? process.env
  const env = childEnvironment(parentEnv)
  log.info('steam', 'launching through Steam', { argv })
  log.debug('steam', 'child environment', environmentChanges(parentEnv, env))
  const child = (deps.spawn ?? spawn)(argv[0], argv.slice(1), { stdio: 'ignore', env })
  child.on('error', (cause) => {
    log.warn('steam', 'the steam command could not be started', {
      argv,
      reason: cause.message
    })
  })
  child.unref()
  return argv
}
