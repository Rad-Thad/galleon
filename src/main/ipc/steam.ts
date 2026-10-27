import type { SteamGameEntry } from '@shared/types'
import type { RomMixApp } from '../app.ts'
import { t } from '../i18n.ts'
import { log } from '../log.ts'
import { RommError } from '../romm/index.ts'
import { listSteamGames } from '../steam/session.ts'
import type { Handle } from './handler.ts'

/** The Steam games on this machine, and handing one to Steam. */
export function registerSteamIpc(rommix: RomMixApp, handle: Handle): void {
  handle('steam:games', (): Promise<SteamGameEntry[]> => listSteamGames())

  handle('steam:launch', async (appid: string): Promise<void> => {
    // The overlay already covers the library while either runs; this is for a
    // call that arrives anyway, which must not raise a second overlay.
    if (rommix.steam.playing || rommix.launcher.playing !== null) {
      log.warn('steam', 'a Steam launch asked for while something runs', { appid })
      return
    }
    // Only a game the list offers: the appid is the renderer's word, and the
    // list is what was read from Steam's own files.
    const game = (await listSteamGames()).find((entry) => entry.appid === appid)
    if (!game) throw new RommError(t('steam.notInstalled'))
    log.info('steam', 'launch requested', { appid, name: game.name })
    rommix.steam.start(game)
  })
}
