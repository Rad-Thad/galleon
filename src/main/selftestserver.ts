import { log } from './log.ts'
import {
  RommError,
  type RommClient,
  UnreachableError,
  UnsupportedServerError
} from './romm/index.ts'
import type { CheckResult, Scenario } from './selftest.ts'

/**
 * The self-test's checks against the RomM server it was signed in to, which on
 * the Nova is the owner's own. Reads only: the guard refuses anything else
 * before it is sent, and these ask for nothing that needs more.
 */

export const HEARTBEAT_CHECK = 'server.heartbeat'

/**
 * A version as RomM reports one. Anything else is replaced before it reaches
 * the summary, which is published: the field is the server's to fill, and a
 * build string can carry a host name as easily as a number.
 */
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,31}$/

/**
 * `server.heartbeat`: the imported sign-in still reads the server. Both
 * requests have to answer, since the heartbeat needs no sign-in at all and
 * `users/me` is the cheapest read that does. Nothing of the account it names
 * is kept, only that it answered.
 */
export function heartbeatScenario(client: Pick<RommClient, 'heartbeat' | 'me'>): Scenario {
  return async () => {
    const result = (
      outcome: CheckResult['result'],
      reason: string | null,
      metrics: CheckResult['metrics']
    ): CheckResult => ({
      id: HEARTBEAT_CHECK,
      result: outcome,
      metrics,
      thresholds: {},
      reason,
      evidence: []
    })
    let version: string | null
    const heartbeatStarted = performance.now()
    try {
      ;({ version } = await client.heartbeat())
    } catch (cause) {
      return result('fail', `heartbeat-${failure(cause)}`, {})
    }
    const heartbeatMs = Math.round(performance.now() - heartbeatStarted)
    const serverVersion = version === null ? null : VERSION.test(version) ? version : 'unrecognised'
    const meStarted = performance.now()
    try {
      await client.me()
    } catch (cause) {
      return result('fail', `users-me-${failure(cause)}`, { serverVersion, heartbeatMs })
    }
    const meMs = Math.round(performance.now() - meStarted)
    return result('pass', null, { serverVersion, heartbeatMs, meMs })
  }
}

/**
 * Why a request failed, as a code. The error's message stays in the log: it
 * can name the server, and the reason is published.
 */
function failure(cause: unknown): string {
  log.info('selftest', 'a server check failed', { cause })
  if (cause instanceof UnsupportedServerError) return 'unsupported'
  if (cause instanceof UnreachableError) return 'unreachable'
  if (cause instanceof RommError && cause.status !== null) return `http-${cause.status}`
  return 'error'
}
