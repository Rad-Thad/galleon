import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { app } from 'electron'
import { startFakeRomm, type FakeRomm } from '../../test/device/fake-romm/server.ts'
import { RommClient } from './romm/client.ts'
import { ReadOnlyGuard } from './romm/guard.ts'
import {
  parseRequest,
  RUN_CHECKS,
  runSelfTest,
  type CheckResult,
  type SelfTestRequest
} from './selftest.ts'
import { FAKE_ROM_ID, FAKE_SERVER_CHECK, fakeServerScenario } from './selftestfakeromm.ts'

const TOKEN = 'fake-romm-test-token'

let work: string
let fake: FakeRomm
let tokenFile: string

beforeEach(async () => {
  work = mkdtempSync(join(tmpdir(), 'galleon-fake-server-'))
  fake = await startFakeRomm({ token: TOKEN, romIds: [FAKE_ROM_ID], scratch: work })
  tokenFile = join(work, 'token')
  writeFileSync(tokenFile, `${TOKEN}\n`, { mode: 0o600 })
})
afterEach(async () => {
  await fake.close()
  rmSync(work, { recursive: true, force: true })
})

function request(fakeRomm: unknown): SelfTestRequest {
  const taken = parseRequest({
    schema: 1,
    sha: 'a'.repeat(40),
    budgetSeconds: 60,
    resultsDir: join(work, 'results'),
    checks: [FAKE_SERVER_CHECK],
    fakeRomm,
    readOnlyServer: true,
    privacy: true
  })
  assert.equal(taken.kind, 'request')
  return taken.request
}

async function run(
  req: SelfTestRequest,
  client?: (store: ConstructorParameters<typeof RommClient>[0]) => RommClient
): Promise<CheckResult> {
  const answered = await fakeServerScenario({ work, client })({
    request: req,
    safety: {
      serverWritesAttempted: 0,
      deviceIdOnSaveRequests: 0,
      ownerStateChanged: [],
      romsDownloadedBytes: 0,
      romsLeft: 0
    },
    signal: new AbortController().signal
  })
  assert.ok(!Array.isArray(answered))
  return answered
}

function scratchLeft(): string[] {
  return readdirSync(work).filter((name) => name.startsWith('fake-romm-client-'))
}

describe('saves.fake-server', () => {
  // A registration names the version it registers, which the Electron stub
  // refuses to answer (see `scripts/test-resolve.mjs`); as in `romm.test.ts`.
  const refuses = app.getVersion
  before(() => {
    app.getVersion = () => '0.0.0-test'
  })
  after(() => {
    app.getVersion = refuses
  })

  test('one save goes up to the fake and comes back byte for byte', async () => {
    const result = await run(request({ baseUrl: fake.baseUrl, tokenFile }))
    assert.equal(result.result, 'pass', String(result.reason))
    assert.equal(result.id, FAKE_SERVER_CHECK)
    assert.equal(result.metrics.bytes, 32 * 1024)
    assert.deepEqual(scratchLeft(), [], 'the scratch folder, with its copy of the token, is gone')
  })

  test('the owner guard sees no write, so safety.server-readonly still passes', async () => {
    const guard = new ReadOnlyGuard()
    const summary = await runSelfTest({
      request: request({ baseUrl: fake.baseUrl, tokenFile }),
      scenarios: new Map([[FAKE_SERVER_CHECK, fakeServerScenario({ work })]]),
      guard,
      version: '0.0.0'
    })
    const byId = new Map(summary.checks.map((c) => [c.id, c]))
    assert.equal(byId.get(FAKE_SERVER_CHECK)?.result, 'pass')
    assert.equal(byId.get(RUN_CHECKS.serverReadOnly)?.result, 'pass')
    assert.equal(guard.serverWritesAttempted, 0)
  })

  test('without a fake it fails rather than skips: run.sh asked for it', async () => {
    const result = await run(request(null))
    assert.equal(result.result, 'fail')
    assert.equal(result.reason, 'no-fake-romm')
  })

  test('a wrong token is not taken for a round trip', async () => {
    writeFileSync(tokenFile, 'not-the-token')
    const result = await run(request({ baseUrl: fake.baseUrl, tokenFile }))
    assert.equal(result.result, 'fail')
    assert.equal(result.reason, 'not-registered')
    assert.deepEqual(scratchLeft(), [])
  })

  test('a save the fake refuses throws, and the scratch folder still goes', async () => {
    await fake.close()
    fake = await startFakeRomm({ token: TOKEN, romIds: [FAKE_ROM_ID + 1], scratch: work })
    await assert.rejects(run(request({ baseUrl: fake.baseUrl, tokenFile })))
    assert.deepEqual(scratchLeft(), [])
  })

  test('an empty token file fails the check', async () => {
    writeFileSync(tokenFile, '\n')
    const result = await run(request({ baseUrl: fake.baseUrl, tokenFile }))
    assert.equal(result.reason, 'no-token')
  })

  test('a client that registers no device fails it', async () => {
    const result = await run(request({ baseUrl: fake.baseUrl, tokenFile }), (store) => {
      const client = new RommClient(store)
      client.deviceId = () => Promise.resolve(null)
      return client
    })
    assert.equal(result.reason, 'not-registered')
  })

  test('a download that changes the bytes fails it', async () => {
    const result = await run(request({ baseUrl: fake.baseUrl, tokenFile }), (store) => {
      const client = new RommClient(store)
      const download = client.downloadSave.bind(client)
      client.downloadSave = async (id, destination) => {
        await download(id, destination)
        const bytes = readFileSync(destination)
        bytes[0] ^= 0xff
        await writeFile(destination, bytes)
      }
      return client
    })
    assert.equal(result.reason, 'bytes-differ')
  })

  test('an upload the device cannot list back fails it', async () => {
    const result = await run(request({ baseUrl: fake.baseUrl, tokenFile }), (store) => {
      const client = new RommClient(store)
      client.savesForDevice = () => Promise.resolve([])
      return client
    })
    assert.equal(result.reason, 'not-listed')
  })

  test('a hash the server disagrees with fails it', async () => {
    const result = await run(request({ baseUrl: fake.baseUrl, tokenFile }), (store) => {
      const client = new RommClient(store)
      const upload = client.uploadSave.bind(client)
      client.uploadSave = async (...args) => ({ ...(await upload(...args)), content_hash: 'x' })
      return client
    })
    assert.equal(result.reason, 'hash-differs')
  })

  test('run.sh gives the fake the ROM the check saves under', () => {
    const runSh = readFileSync(join(import.meta.dirname, '../../test/device/run.sh'), 'utf8')
    const ids = /^FAKE_ROMM_ROM_IDS=(\S+)$/m.exec(runSh)?.[1].split(',').map(Number)
    assert.ok(ids?.includes(FAKE_ROM_ID))
  })
})
