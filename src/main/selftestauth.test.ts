import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'
import { RommError, UnreachableError } from './romm/index.ts'
import { AUTH_STORAGE_CHECK, authStorageScenario, type AuthStorageDeps } from './selftestauth.ts'
import type { CheckResult, SelfTestRequest } from './selftest.ts'
import { Store } from './store.ts'

/**
 * `auth.storage` on the device: the imported token sits owner-only in the test
 * home, in the plain file, and a store made again from that folder signs in
 * without pairing. The summary is published, so the token and the paths must
 * never reach it.
 */

const TOKEN = 'rmm_owners-secret-token'

let home: string
let config: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'galleon-auth-'))
  config = join(home, 'config')
  mkdirSync(config, { mode: 0o700 })
  chmodSync(config, 0o700)
  writeCredentials('RAW1', { clientToken: TOKEN, accessToken: null })
})

afterEach(() => rmSync(home, { recursive: true, force: true }))

function writeCredentials(magic: string, tokens: object, mode = 0o600): void {
  const path = join(config, 'credentials.bin')
  writeFileSync(path, Buffer.concat([Buffer.from(magic), Buffer.from(JSON.stringify(tokens))]))
  chmodSync(path, mode)
}

function deps(overrides: Partial<AuthStorageDeps> = {}): AuthStorageDeps & { asked: string[] } {
  const asked: string[] = []
  return {
    asked,
    home,
    configDir: config,
    token: () => TOKEN,
    keyringAvailable: () => false,
    restart: () => {
      // The real store, so what is read back is what a start would read.
      const store = new Store(config, { decryptString: () => '' })
      return {
        credentials: store.credentials,
        me: async () => {
          asked.push('me')
          return { id: 1 }
        }
      }
    },
    ...overrides
  }
}

async function check(given: AuthStorageDeps): Promise<CheckResult> {
  const answered = await authStorageScenario(given)({
    request: {} as SelfTestRequest,
    safety: {} as never,
    signal: new AbortController().signal
  })
  assert.ok(!Array.isArray(answered))
  return answered
}

describe('auth.storage', () => {
  test('passes for the plain file, 0600 in a 0700 folder, read back by a new store', async () => {
    const given = deps()
    const result = await check(given)
    assert.equal(result.id, AUTH_STORAGE_CHECK)
    assert.equal(result.result, 'pass', String(result.reason))
    assert.equal(result.metrics.fileMode, '600')
    assert.equal(result.metrics.folderMode, '700')
    assert.equal(result.metrics.backend, 'file')
    assert.equal(result.metrics.keyringAvailable, 'no')
    assert.equal(result.metrics.tokenKind, 'client')
    assert.equal(typeof result.metrics.restartMs, 'number')
    assert.deepEqual(given.asked, ['me'])
    const published = JSON.stringify(result)
    assert.ok(!published.includes(TOKEN))
    assert.ok(!published.includes(home))
  })

  test('fails a file others can read, before a store could put it back', async () => {
    writeCredentials('RAW1', { clientToken: TOKEN }, 0o644)
    const given = deps()
    const result = await check(given)
    assert.equal(result.result, 'fail')
    assert.equal(result.reason, 'file-mode')
    assert.equal(result.metrics.fileMode, '644')
    assert.deepEqual(given.asked, [])
  })

  test('fails a folder others can enter', async () => {
    chmodSync(config, 0o755)
    const result = await check(deps())
    assert.equal(result.reason, 'folder-mode')
    assert.equal(result.metrics.folderMode, '755')
  })

  test('fails a token the keyring holds, which Game Mode could not open', async () => {
    writeCredentials('ENC1', {})
    const result = await check(deps())
    assert.equal(result.reason, 'backend-keyring')
    assert.equal(result.metrics.backend, 'keyring')
  })

  test('fails without a credential file', async () => {
    rmSync(join(config, 'credentials.bin'))
    const result = await check(deps())
    assert.equal(result.reason, 'no-credentials')
  })

  test('fails a folder outside the test home', async () => {
    const result = await check(deps({ configDir: join(tmpdir(), 'config') }))
    assert.equal(result.reason, 'outside-test-home')
  })

  test('fails when the new store reads no token, which would mean pairing again', async () => {
    writeCredentials('RAW1', { clientToken: null, accessToken: null })
    const result = await check(deps())
    assert.equal(result.reason, 'restart-signed-out')
    assert.equal(result.metrics.tokenKind, 'none')
  })

  test('fails when the new store reads another token than the running app holds', async () => {
    const result = await check(deps({ token: () => 'rmm_another' }))
    assert.equal(result.reason, 'restart-other-token')
    assert.ok(!JSON.stringify(result).includes(TOKEN))
  })

  test('names a refused or unanswered sign-in by code, not by its message', async () => {
    for (const [cause, reason] of [
      [new RommError('owners-server.example said no', 401), 'restart-users-me-http-401'],
      [new UnreachableError('owners-server.example'), 'restart-users-me-unreachable']
    ] as const) {
      const result = await check(
        deps({
          restart: () => ({
            credentials: { clientToken: TOKEN, accessToken: null },
            me: async () => {
              throw cause
            }
          })
        })
      )
      assert.equal(result.reason, reason)
      assert.ok(!JSON.stringify(result).includes('owners-server'))
    }
  })
})
