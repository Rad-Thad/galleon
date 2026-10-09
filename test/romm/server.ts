/**
 * What the `*.real.ts` suites share: the provisioned server, RomMix's client
 * signed in to it, and a record of every request that client sends, held to
 * the server version's OpenAPI document in `schema/`.
 */
import { afterEach, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { RommClient } from '../../src/main/romm/client.ts'
import type { Store } from '../../src/main/store.ts'
import type { RommRom } from '../../src/shared/types/romm.ts'
import { statePath, type State } from './lib.mjs'
import { requestProblems, type OpenApiDocument } from './schema.mjs'

const profile = process.env.ROMM_PROFILE ?? 'v520'

function readState(): State {
  try {
    return JSON.parse(readFileSync(statePath(profile), 'utf8')) as State
  } catch {
    throw new Error(
      `no provisioned ${profile}: run node test/romm/provision.mjs --profile ${profile}`
    )
  }
}

export const state = readState()

/** The OpenAPI document of the version under test. */
const document = JSON.parse(
  readFileSync(`schema/romm-${state.version}.json`, 'utf8')
) as OpenApiDocument

/**
 * The slice of `Store` the client reads, signed in with the provisioned token.
 *
 * `identifier` is the machine identifier RomMix pairs and registers under.
 * Signed out, it is an app that has not paired yet.
 */
export function client(
  identifier = 'galleon-test-romm',
  { signedIn = true }: { signedIn?: boolean } = {}
): RommClient {
  const credentials = {
    accessToken: null,
    refreshToken: null,
    clientToken: signedIn ? state.clientToken : null,
    deviceId: null
  }
  const store = {
    server: { baseUrl: state.baseUrl },
    settings: { deviceId: identifier, deviceName: 'Galleon test:romm' },
    credentials,
    setCredentials: (patch: object) => Object.assign(credentials, patch),
    clearCredentials: () => undefined
  } as unknown as Store
  return new RommClient(store)
}

/** One request the client sent. */
export interface Sent {
  url: string
  method: string
  range: string | null
  body: string | FormData | URLSearchParams | null
}

// The version a registration reports. Out here `electron` is the stub in
// scripts/test-resolve.mjs, which refuses it, as `romm.test.ts` also works round.
app.getVersion = () => '0.0.0-test-romm'

export const realFetch = globalThis.fetch

/**
 * Record what goes out, and let a test break the body of one reply.
 *
 * Broken in the middle of the body, after the server has answered, which is
 * the interruption a transfer meets in practice: a proxy cutting the response
 * or a link dropping mid-copy.
 */
export function watch(breakAt?: { path: string; fraction: number }): Sent[] {
  const sent: Sent[] = []
  let broken = false
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    const headers = new Headers(init?.headers)
    sent.push({
      url,
      method: init?.method ?? 'GET',
      range: headers.get('range'),
      body: (init?.body ?? null) as Sent['body']
    })
    const res = await realFetch(input, init)
    if (!breakAt || broken || !url.includes(breakAt.path) || headers.has('range')) return res
    broken = true
    const bytes = new Uint8Array(await res.arrayBuffer())
    const cut = Math.floor(bytes.length * breakAt.fraction)
    // Ended cleanly at the cut, still declaring the whole length: what a
    // proxy closing the response looks like, and unlike a stream that errors,
    // it cannot lose the half on its way to the disk.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, cut))
        controller.close()
      }
    })
    return new Response(body, { status: res.status, headers: res.headers })
  }) as typeof fetch
  return sent
}

// Put back after every test, so one that fails mid-way leaves no wrapper.
afterEach(() => {
  globalThis.fetch = realFetch
})

export const md5 = (path: string): string =>
  createHash('md5').update(readFileSync(path)).digest('hex')

export function scratch(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'galleon-test-romm-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

export async function romNamed(fsName: string): Promise<RommRom> {
  const page = await client().roms({ search_term: fsName.replace(/\.[^.]+$/, ''), limit: 50 })
  const rom = page.items.find((item) => item.fs_name === fsName)
  assert.ok(rom, `${fsName} is not in the library`)
  return rom
}

/**
 * Every request in `sent` fits the document of the version it went to: the
 * operation exists, its query names are declared, its body has the shape.
 */
export function assertFitsSchema(sent: readonly Sent[]): void {
  assert.ok(sent.length > 0, 'no requests were recorded')
  const problems = sent.flatMap((request) => requestProblems(document, request))
  assert.deepEqual(problems, [], `RomM ${state.version}:\n${problems.join('\n')}`)
}
