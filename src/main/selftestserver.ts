import { log } from './log.ts'
import {
  RommError,
  type RommClient,
  UnreachableError,
  UnsupportedServerError,
  resolveBaseUrl
} from './romm/index.ts'
import type { CheckResult, Scenario } from './selftest.ts'

/**
 * The self-test's checks against the RomM server it was signed in to, which on
 * the Nova is the owner's own. Reads only: the guard refuses anything else
 * before it is sent, and these ask for nothing that needs more.
 */

export const HEARTBEAT_CHECK = 'server.heartbeat'
export const SCHEME_CHECK = 'server.scheme-probe'

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
 * `server.scheme-probe`: the imported address with its scheme taken off is
 * found again the way a typed one is (`resolveBaseUrl`), and the heartbeat
 * answers there. What is published is the scheme found beside the imported
 * one, never the address: a server that answers like RomM over both is found
 * over https, which is right, and is no failure.
 */
export function schemeProbeScenario(
  client: Pick<RommClient, 'probe' | 'heartbeat'>,
  address: () => string | null
): Scenario {
  return async () => {
    const result = (
      outcome: CheckResult['result'],
      reason: string | null,
      metrics: CheckResult['metrics']
    ): CheckResult => ({
      id: SCHEME_CHECK,
      result: outcome,
      metrics,
      thresholds: {},
      reason,
      evidence: []
    })
    const imported = address()
    if (imported === null) return result('fail', 'no-server', {})
    const bare = imported.replace(/^https?:\/\//i, '')
    let attempts = 0
    const started = performance.now()
    let found: string
    try {
      found = await resolveBaseUrl(bare, (url) => {
        attempts++
        return client.probe(url)
      })
    } catch (cause) {
      return result('fail', `probe-${failure(cause)}`, { attempts })
    }
    const probeMs = Math.round(performance.now() - started)
    const metrics = {
      scheme: schemeOf(found),
      importedScheme: schemeOf(imported),
      attempts,
      probeMs
    }
    try {
      await client.heartbeat(found)
    } catch (cause) {
      return result('fail', `heartbeat-${failure(cause)}`, metrics)
    }
    return result('pass', null, metrics)
  }
}

function schemeOf(url: string): string {
  return /^https:/i.test(url) ? 'https' : 'http'
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
