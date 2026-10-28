import { readFileSync, statSync } from 'node:fs'
import { join, relative, isAbsolute } from 'node:path'
import { log } from './log.ts'
import { RommError, UnreachableError, UnsupportedServerError } from './romm/index.ts'
import type { CheckResult, Scenario } from './selftest.ts'

export const AUTH_STORAGE_CHECK = 'auth.storage'

/** What the store holds the files to, so what this check asks of them. See ADR 0009. */
const FILE_MODE = 0o600
const FOLDER_MODE = 0o700

/** The tokens of a store that has just been made, as a start makes one. */
interface Restarted {
  credentials: { clientToken: string | null; accessToken: string | null }
  me(): Promise<unknown>
}

export interface AuthStorageDeps {
  /** The test home: the credentials have to be inside it, not the owner's. */
  home: string
  /** The store's folder, where `credentials.bin` is kept. */
  configDir: string
  /** The token the running app signed in with. Compared, never published. */
  token: () => string | null
  /** Whether this session offers a keyring, recorded beside the backend. */
  keyringAvailable: () => boolean
  /**
   * A store and client made afresh from the folder, as the next start makes
   * them, with the read-only guard on before it can send anything.
   */
  restart: () => Restarted
}

/**
 * `auth.storage`: the imported token is in the test home's credential file,
 * owner-only in an owner-only folder, in the plain backend ADR 0009 chose,
 * and a store made again from that folder reads it back and is let in.
 *
 * The modes are read before the restart, since making a store puts loosened
 * modes back and would hide what the running app left. What is published is
 * modes, the backend and the token's kind, never the token or a path.
 */
export function authStorageScenario(deps: AuthStorageDeps): Scenario {
  return async () => {
    const metrics: CheckResult['metrics'] = {
      keyringAvailable: deps.keyringAvailable() ? 'yes' : 'no'
    }
    const result = (outcome: CheckResult['result'], reason: string | null): CheckResult => ({
      id: AUTH_STORAGE_CHECK,
      result: outcome,
      metrics,
      thresholds: {},
      reason,
      evidence: []
    })
    if (!inside(deps.home, deps.configDir)) return result('fail', 'outside-test-home')
    const path = join(deps.configDir, 'credentials.bin')
    let fileMode: number
    let folderMode: number
    let magic: string
    try {
      folderMode = statSync(deps.configDir).mode & 0o777
      fileMode = statSync(path).mode & 0o777
      magic = readFileSync(path).subarray(0, 4).toString()
    } catch (cause) {
      log.info('selftest', 'the credential file could not be read', { cause })
      return result('fail', 'no-credentials')
    }
    metrics.folderMode = folderMode.toString(8)
    metrics.fileMode = fileMode.toString(8)
    metrics.backend = magic === 'RAW1' ? 'file' : magic === 'ENC1' ? 'keyring' : 'unknown'
    if (folderMode !== FOLDER_MODE) return result('fail', 'folder-mode')
    if (fileMode !== FILE_MODE) return result('fail', 'file-mode')
    if (metrics.backend !== 'file') return result('fail', `backend-${metrics.backend}`)

    const started = performance.now()
    const restarted = deps.restart()
    const { clientToken, accessToken } = restarted.credentials
    const token = clientToken ?? accessToken
    metrics.tokenKind = clientToken ? 'client' : accessToken ? 'access' : 'none'
    if (token === null) return result('fail', 'restart-signed-out')
    if (token !== deps.token()) return result('fail', 'restart-other-token')
    try {
      await restarted.me()
    } catch (cause) {
      return result('fail', `restart-users-me-${failure(cause)}`)
    }
    metrics.restartMs = Math.round(performance.now() - started)
    return result('pass', null)
  }
}

function inside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * Why the request failed, as a code. The error's message stays in the log: it
 * can name the server, and the reason is published.
 */
function failure(cause: unknown): string {
  log.info('selftest', 'the restarted sign-in was not let in', { cause })
  if (cause instanceof UnsupportedServerError) return 'unsupported'
  if (cause instanceof UnreachableError) return 'unreachable'
  if (cause instanceof RommError && cause.status !== null) return `http-${cause.status}`
  return 'error'
}
