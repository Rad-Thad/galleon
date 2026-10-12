import { mkdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { log } from './log.ts'
import type { CheckResult, Scenario } from './selftest.ts'
import type { Rehearsal } from './update.ts'

/**
 * `update.verify`: the updater, on the device, reads the live channel and its
 * `SHA256SUMS`, takes the image that matches and refuses one that does not,
 * all inside the test home. See `Updater.rehearse`.
 */

export const UPDATE_CHECK = 'update.verify'

/** Where in the test home the rehearsal writes, emptied after the check. */
export const REHEARSAL_DIR = 'update-verify'

export interface UpdateDeps {
  rehearse: (dir: string) => Promise<Rehearsal>
  /** The test home, `GALLEON_HOME`. */
  home: string
  /** The AppImage this run started from, `APPIMAGE`, or null outside one. */
  installed: string | null
}

/**
 * The installed image is looked at before and after: the rehearsal never
 * writes to it, and this is the check that would notice if it ever did.
 */
export function updateScenario(deps: UpdateDeps): Scenario {
  return async () => {
    const metrics: CheckResult['metrics'] = { image: null, bytes: 0 }
    const result = (outcome: CheckResult['result'], reason: string | null): CheckResult => ({
      id: UPDATE_CHECK,
      result: outcome,
      metrics,
      thresholds: {},
      reason,
      evidence: []
    })
    const before = await fingerprint(deps.installed)
    const dir = join(deps.home, REHEARSAL_DIR)
    let rehearsal: Rehearsal
    try {
      await mkdir(dir, { recursive: true })
      rehearsal = await deps.rehearse(dir)
    } catch (cause) {
      log.info('selftest', 'the update rehearsal failed', { cause })
      return result('fail', 'channel-unreadable')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
    metrics.image = rehearsal.name
    metrics.bytes = rehearsal.bytes
    if ((await fingerprint(deps.installed)) !== before) {
      return result('fail', 'installed-image-changed')
    }
    if (rehearsal.failure) return result('fail', rehearsal.failure)
    return result('pass', null)
  }
}

/** Size, change time and inode: what a write or a rename onto it changes. */
async function fingerprint(path: string | null): Promise<string | null> {
  if (!path) return null
  try {
    const { size, ctimeMs, ino } = await stat(path)
    return `${size}:${ctimeMs}:${ino}`
  } catch {
    return 'missing'
  }
}
