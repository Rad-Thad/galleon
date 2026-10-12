import type { CheckResult, Scenario } from './selftest.ts'

/**
 * `build.identity`: the app the harness started is the build it meant to test.
 * A nightly whose AppImage and bundle came from different commits would file
 * every other check under the wrong build, so this is the one that says so.
 */

export const IDENTITY_CHECK = 'build.identity'

export interface Identity {
  /** `app.getVersion()`. */
  version: string
  /** The commit stamped into the build, as `buildStamp` gives it. */
  commit: string
}

/**
 * Compares the running build with the `sha` and `version` the request copies
 * from `build-info.json`. The stamp has to equal the sha whole: a `-dirty`
 * build is not the commit it names. A request without a version cannot be
 * judged on it and is a skip, not a pass on the commit alone.
 */
export function identityScenario(running: Identity): Scenario {
  return async ({ request }) => {
    const metrics = {
      version: running.version,
      commit: running.commit || null,
      expectedVersion: request.version,
      expectedCommit: request.sha
    }
    const result = (outcome: CheckResult['result'], reason: string | null): CheckResult => ({
      id: IDENTITY_CHECK,
      result: outcome,
      metrics,
      thresholds: {},
      reason,
      evidence: []
    })
    if (!running.commit) return result('fail', 'commit-unstamped')
    if (running.commit !== request.sha) return result('fail', 'commit-mismatch')
    if (request.version === null) return result('skip', 'no-build-version')
    if (running.version !== request.version) return result('fail', 'version-mismatch')
    return result('pass', null)
  }
}
