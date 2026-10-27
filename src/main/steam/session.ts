import type { RunningState } from '@shared/api'
import type { SteamGameEntry } from '@shared/types'
import { log } from '../log.ts'
import { launchSteamGame } from './launch.ts'
import { installedSteamGames, isSteamTool } from './library.ts'
import type { SteamSources } from './library.ts'

/** The installed Steam games a player can start, Steam's own tools left out. */
export async function listSteamGames(sources: SteamSources = {}): Promise<SteamGameEntry[]> {
  return (await installedSteamGames(sources))
    .filter((game) => !isSteamTool(game))
    .map(({ appid, name, sizeOnDisk }) => ({ appid, name, sizeOnDisk }))
}

/**
 * A Steam game Galleon asked Steam to run, for as long as the screen is
 * taken to belong to it.
 *
 * Galleon starts no process of its own for one (see `launchSteamGame`), so
 * there is nothing to watch end: the session lasts until the player says they
 * are back. Ending it only lowers the overlay. Steam's game is never signalled,
 * since Galleon signals only processes it spawned.
 */
export class SteamSession {
  private current: SteamGameEntry | null = null

  constructor(
    private readonly send: (state: RunningState) => void,
    private readonly launch: (appid: string) => string[] | null = launchSteamGame
  ) {}

  /** The game handed to Steam, or null. */
  get playing(): SteamGameEntry | null {
    return this.current
  }

  /**
   * Hand `game` to Steam and raise the overlay for it. Says whether Steam was
   * asked; a refused appid raises nothing.
   *
   * The overlay goes up before Steam is asked, as a launch's does, so a notice
   * raised while Steam brings the game up already waits behind it.
   */
  start(game: SteamGameEntry): boolean {
    this.current = game
    this.send({ running: true, romId: null, emulator: null, steam: game.name, stage: null })
    if (this.launch(game.appid)) return true
    this.end()
    return false
  }

  /** Lower the overlay. Says whether a session was up. */
  end(): boolean {
    if (!this.current) return false
    log.info('steam', 'back from a Steam game', { appid: this.current.appid })
    this.current = null
    this.send({ running: false, romId: null, emulator: null, steam: null, stage: null })
    return true
  }
}
