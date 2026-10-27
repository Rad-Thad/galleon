import type { BrowserWindow } from 'electron'

/**
 * Galleon's window brought to the front and drawn once, for when a game it
 * started has gone.
 *
 * While the game had the screen the renderer drew nothing (see
 * `useGamepad`), and the compositor need not hand the focus back to the
 * window that was under the game: without this a player who quits a game
 * can be left on a stale frame, with the pad going nowhere.
 */
export function reclaimScreen(
  window: Pick<BrowserWindow, 'isDestroyed' | 'isMinimized' | 'restore' | 'focus'> & {
    webContents: Pick<BrowserWindow['webContents'], 'invalidate'>
  }
): void {
  if (window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.focus()
  window.webContents.invalidate()
}
