import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { t } from '../i18n.ts'
import type { GalleonShortcut } from './addshortcut.ts'
import { type AddToSteamResult, addToSteam } from './registersteam.ts'

/**
 * `--add-to-steam`: the app run once from a terminal, as `install.sh
 * --add-to-steam` runs it, to put its own shortcut into Steam and quit. It
 * opens no window and touches nothing of the app's own.
 *
 * What it prints never names a Steam user folder: each is the owner's Steam
 * account number.
 */

export const ADD_TO_STEAM_FLAG = '--add-to-steam'

/** Where install.sh puts the script Steam starts, and the icon beside its menu entry. */
const APPLICATIONS = 'Applications'
const STEAM_SCRIPT = 'galleon-steam.sh'
const ICON = join('.local', 'share', 'applications', 'io.github.Rad-Thad.Galleon.svg')
/** armadaOS's wrapper for a game started from Steam; only there on armadaOS. */
export const ARMADA_LAUNCH = '/usr/libexec/armada/armada-game-launch'

export function galleonShortcut(home: string, armada: boolean): GalleonShortcut {
  const apps = join(home, APPLICATIONS)
  return {
    name: 'Galleon',
    exe: `"${join(apps, STEAM_SCRIPT)}"`,
    startDir: `"${apps}/"`,
    launchOptions: armada ? `${ARMADA_LAUNCH} %command%` : '',
    icon: join(home, ICON)
  }
}

export const EXIT = { done: 0, unreadable: 1, steamRunning: 2, noSteamUser: 3, failed: 4 } as const

export interface AddToSteamCommandOptions {
  print: (line: string) => void
  home?: string
  exists?: (path: string) => Promise<boolean>
  add?: (shortcut: GalleonShortcut) => Promise<AddToSteamResult>
}

/** Runs the step, says what happened, and returns the exit code. */
export async function addToSteamCommand(options: AddToSteamCommandOptions): Promise<number> {
  const home = options.home ?? homedir()
  const exists =
    options.exists ??
    ((path: string) =>
      access(path).then(
        () => true,
        () => false
      ))
  const add = options.add ?? ((shortcut: GalleonShortcut) => addToSteam(shortcut, { home }))
  const { print } = options

  let result: AddToSteamResult
  try {
    result = await add(galleonShortcut(home, await exists(ARMADA_LAUNCH)))
  } catch (error) {
    print(t('steam.addFailed', { reason: (error as Error).message }))
    return EXIT.failed
  }
  if (result.outcome === 'steam-running') {
    print(t('steam.addSteamRunning'))
    return EXIT.steamRunning
  }
  if (result.outcome === 'no-steam-user') {
    print(t('steam.addNoSteamUser'))
    return EXIT.noSteamUser
  }

  const count = (change: string) => result.users.filter((user) => user.change === change).length
  const changed = count('added') + count('updated') + count('unchanged')
  const unreadable = count('unreadable')
  if (changed > 0) print(t('steam.addDone', { count: changed }))
  if (unreadable > 0) print(t('steam.addUnreadable', { count: unreadable }))
  if (result.users.some((user) => user.backup)) print(t('steam.addBackups'))
  if (changed > 0) print(t('steam.addNext'))
  return unreadable > 0 ? EXIT.unreadable : EXIT.done
}
