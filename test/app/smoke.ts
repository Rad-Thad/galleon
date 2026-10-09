import assert from 'node:assert/strict'
import { test } from 'node:test'
import { atHome, startApp } from './driver.ts'
import { startFakeRomm } from './server.ts'

/**
 * The package, not the bundle: `npm run smoke:app`.
 *
 * `test:app` drives `out/` under the development Electron, which proves the
 * code. This proves the AppImage built from it: the runtime extracts, the
 * launcher script in front of the binary execs it, the application reaches
 * Home against the fake server, and it quits through its own quit with the
 * runtime following it out. It is what the arm64 leg runs, since that leg
 * exists to prove the image the Nova gets (docs/PLAN.md section 4).
 *
 * Not a `.test.ts`, so `test:app`'s glob leaves it to this command.
 */

/** The whole round trip's allowance, from the acceptance line of M0-05. */
const BUDGET_MS = 60_000

/** How long the quit alone may take before the run says it hung there. */
const QUIT_MS = 15_000

const appImage = process.env.GALLEON_APPIMAGE

test('the packaged app starts, reaches Home and quits', async () => {
  assert.ok(appImage, 'GALLEON_APPIMAGE names the AppImage to run; scripts/smoke-app.sh sets it')
  const started = Date.now()
  const server = await startFakeRomm()
  try {
    const app = await startApp({
      executable: appImage,
      baseUrl: server.baseUrl,
      token: server.token
    })
    try {
      await atHome(app)
      await app.quit(QUIT_MS)
    } finally {
      await app.stop()
    }
    const took = Date.now() - started
    assert.ok(took <= BUDGET_MS, `start to quit took ${took} ms, over ${BUDGET_MS} ms`)
  } finally {
    await server.close().catch(() => undefined)
  }
})
