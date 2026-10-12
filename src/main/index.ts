import { BrowserWindow, app, protocol } from 'electron'
import { IMAGE_SCHEME, RomMixApp } from './app.ts'
import { registerIpc } from './ipc/index.ts'
import { log, logSession } from './log.ts'
import { readPowerState } from './powerstate.ts'
import { ensureRoot, profilePath, resolveRoot } from './root.ts'
import { ReadOnlyGuard } from './romm/guard.ts'
import { reportRefusal, runAndReport, takeRequest } from './selftest.ts'
import { DOWNLOAD_CHECK, downloadScenario } from './selftestdownload.ts'
import { HEARTBEAT_CHECK, heartbeatScenario } from './selftestserver.ts'
import { watchInput } from './selftestinput.ts'
import { STARTUP_CHECK, startupScenario, startupStart, watchHome } from './selfteststartup.ts'

/** RomMix main process bootstrap. */

/**
 * Anything that escaped everywhere else.
 *
 * Neither handler stops the process: an unhandled rejection from a background
 * probe is not a reason to close a game the user is playing. What it is a
 * reason for is a line in the log, which is the only place such a failure has
 * ever been visible at all.
 */
process.on('uncaughtException', (cause) => log.error('app', 'uncaught exception', cause))
process.on('unhandledRejection', (cause) => log.error('app', 'unhandled rejection', cause))

// Must run before `app.ready`.
protocol.registerSchemesAsPrivileged([
  {
    scheme: IMAGE_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true }
  }
])

/**
 * The switches Chromium has to be given rather than told about later.
 *
 * These two land because Electron rebuilds the feature list once this file has
 * run. The display backend does not: Ozone is chosen in the browser process's
 * pre-sandbox start-up, before any of RomMix is loaded, and from
 * `XDG_SESSION_TYPE` alone — Wayland where it says so, X11 otherwise, with no
 * check that there is a compositor of that kind to connect to. Nothing
 * appended here can move it.
 *
 * That check is what a gamescope session needs, because it says Wayland and
 * then keeps its compositor on a socket name no generic application looks for,
 * leaving Chromium to connect to nothing and exit before it draws. The only
 * thing that answers it is `--ozone-platform` on the real command line, which
 * is why that decision belongs to the shell script the image execs before this
 * binary — see packaging/rommix-launcher.sh.
 */
function applyDisplayFlags(): void {
  app.commandLine.appendSwitch('enable-features', 'WaylandWindowDecorations')
  app.commandLine.appendSwitch('enable-smooth-scrolling')
}

// Before the single-instance lock, which starts enough of the browser process
// that later switches are read too late to matter.
applyDisplayFlags()

// Before the lock, which lives in the profile: a profile shared with stock
// RomMix, or between two Galleon homes, would let only one of them run at a
// time. See `profilePath`.
app.setPath('userData', profilePath())

// Only one instance may own the ROM tree and the download queue.
if (!app.requestSingleInstanceLock()) {
  // Nothing is written here and nothing is read: everything below touches the
  // *running* instance's files, and a second process writing a banner, a
  // rollover or a sweep into them splits one session across two files with no
  // marker in either.
  app.quit()
} else {
  // The root has to exist before the Store reads from it. Electron's own
  // userData stays outside it, in the profile above: it holds Chromium's
  // caches, cookies, GPU state and singleton locks, none of which belong in a
  // folder meant to hold the handful of files RomMix itself writes. A root
  // named by GALLEON_HOME is the exception, where everything stays inside it.
  ensureRoot()

  logSession({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  })

  // Before the app exists, so not one request goes out ahead of the guard.
  const selfTest = takeRequest()
  if (selfTest?.kind === 'refused') reportRefusal(selfTest, app.getVersion())
  const guard = selfTest?.kind === 'request' ? new ReadOnlyGuard() : null

  const rommix = new RomMixApp()
  if (guard) rommix.readOnly(guard)
  /** Set by the first quit, so the second one is let through. See below. */
  let quitting = false

  void app.whenReady().then(async () => {
    if (selfTest?.kind === 'refused') {
      app.exit(1)
      return
    }
    const took = log.since()
    rommix.registerImageProtocol()
    const pruned = rommix.store.pruneInstalled()
    if (pruned > 0) log.info('library', 'dropped index entries whose files are gone', { pruned })
    // After the prune, so a game that has just left the index takes what was
    // written about it, and before anything can write more: adoption and the
    // back-fill both add records, and a sweep running alongside one would
    // measure a folder that is still being filled. See `OfflineCache.sweep`.
    await rommix.offline.sweep(rommix.store.installed)
    await rommix.refreshEmulators()
    registerIpc(rommix)
    const window = rommix.createWindow()
    if (selfTest?.kind === 'request' && guard) {
      // Before anything else is run, so the time is Home's first arrival.
      const reached = watchHome(window.webContents)
      const stop = new AbortController()
      if (selfTest.request.abortOnInput) void watchInput(window.webContents, () => stop.abort())
      // None of what follows a normal start: an update check, the launcher
      // beside the image and the catch-up all write somewhere, and the
      // harness, not this app, decides what the run may touch.
      const code = await runAndReport({
        request: selfTest.request,
        scenarios: new Map([
          [
            STARTUP_CHECK,
            startupScenario({
              reached,
              start: startupStart(process.env, performance.timeOrigin),
              power: () => readPowerState()
            })
          ],
          [HEARTBEAT_CHECK, heartbeatScenario(rommix.client)],
          [
            DOWNLOAD_CHECK,
            downloadScenario({
              client: rommix.client,
              downloads: rommix.downloads,
              library: rommix.library,
              store: rommix.store,
              home: resolveRoot()
            })
          ]
        ]),
        guard,
        signal: stop.signal,
        version: app.getVersion()
      })
      quitting = true
      await rommix.shutdown()
      app.exit(code)
      return
    }
    // After the window, which is what the first result is announced to. The
    // check itself is delayed — see `Updater.schedule`.
    rommix.updates.schedule()
    // Not part of that schedule: the launcher beside the image is brought into
    // step whatever the update policy says. See `Updater.refreshSteamLauncher`.
    void rommix.updates.refreshSteamLauncher()
    // Likewise: both of these push to the renderer, and both are things the
    // interface should not be waiting on. The catch-up needs a server and is
    // run again by the watch the moment there is one. See `RomMixApp.catchUp`.
    rommix.connection.start()
    void rommix.catchUp()
    log.info('app', 'ready', { ms: took() })
  })

  app.on('second-instance', () => {
    log.info('app', 'second instance started, focusing this one')
    const [window] = BrowserWindow.getAllWindows()
    if (window) {
      if (window.isMinimized()) window.restore()
      window.focus()
    }
  })

  app.on('window-all-closed', () => {
    log.info('app', 'last window closed, quitting')
    app.quit()
  })

  /**
   * The quit waits for the shutdown, which is why it has to be stopped once.
   *
   * `before-quit` is synchronous and `app.quit()` does not wait for anything
   * started in it — but closing the emulator and sending the session's saves
   * up cannot be done synchronously. So the first quit is turned down, the
   * work is done, and the quit is asked for again: `shutdown` has already run
   * by then and returns the same promise, so the second pass falls straight
   * through.
   */
  app.on('before-quit', (event) => {
    if (quitting) return
    quitting = true
    event.preventDefault()
    void rommix.shutdown().finally(() => app.quit())
  })
}
