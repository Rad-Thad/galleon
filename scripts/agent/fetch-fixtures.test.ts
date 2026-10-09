import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  DEFAULT_MANIFEST,
  DEFAULT_OUT,
  MAX_BYTES,
  fetchFixtures,
  loadManifest,
  parseArgs,
  sha256,
  validateManifest,
  type Fixture
} from './fetch-fixtures.mjs'

const GOOD = Buffer.from('a small homebrew program')
const TAMPERED = Buffer.from('a small homebrew program, altered')

/** Serves /good and /tampered; anything else is a 404. Counts requests. */
async function serve(): Promise<{ server: Server; base: string; hits: string[] }> {
  const hits: string[] = []
  const server = createServer((req, res) => {
    hits.push(req.url ?? '')
    if (req.url === '/good') res.end(GOOD)
    else if (req.url === '/tampered') res.end(TAMPERED)
    else {
      res.statusCode = 404
      res.end()
    }
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address() as AddressInfo
  return { server, base: `http://127.0.0.1:${port}`, hits }
}

function entry(overrides: Partial<Fixture> = {}): Fixture {
  return {
    path: 'roms/gba/test.gba',
    url: 'https://example.invalid/test.gba',
    sha256: sha256(GOOD),
    bytes: GOOD.length,
    licence: 'MIT',
    attribution: 'Someone',
    ...overrides
  }
}

async function withServer(
  run: (ctx: { base: string; out: string; hits: string[] }) => Promise<void>
): Promise<void> {
  const { server, base, hits } = await serve()
  const out = mkdtempSync(join(tmpdir(), 'galleon-fixtures-'))
  try {
    await run({ base, out, hits })
  } finally {
    rmSync(out, { recursive: true, force: true })
    await new Promise((done) => server.close(done))
  }
}

test('a file matching its pinned hash is written under its path', async () => {
  await withServer(async ({ base, out }) => {
    const result = await fetchFixtures([entry({ url: `${base}/good` })], out)
    assert.deepEqual(result, [{ path: 'roms/gba/test.gba', status: 'fetched' }])
    assert.deepEqual(readFileSync(join(out, 'roms/gba/test.gba')), GOOD)
  })
})

test('a file whose hash differs is refused and nothing is written', async () => {
  await withServer(async ({ base, out }) => {
    await assert.rejects(
      fetchFixtures([entry({ url: `${base}/tampered` })], out),
      new RegExp(
        `roms/gba/test.gba: refused, .* gave sha256 ${sha256(TAMPERED)} .*pins ${sha256(GOOD)}`
      )
    )
    assert.equal(existsSync(join(out, 'roms/gba/test.gba')), false)
    assert.equal(existsSync(join(out, 'roms/gba/test.gba.partial')), false)
  })
})

test('a refusal stops the run before later entries', async () => {
  await withServer(async ({ base, out, hits }) => {
    await assert.rejects(
      fetchFixtures(
        [
          entry({ url: `${base}/tampered` }),
          entry({ path: 'roms/gba/later.gba', url: `${base}/good` })
        ],
        out
      )
    )
    assert.deepEqual(hits, ['/tampered'])
    assert.equal(existsSync(join(out, 'roms/gba/later.gba')), false)
  })
})

test('a file whose size differs from the pin is refused', async () => {
  await withServer(async ({ base, out }) => {
    await assert.rejects(
      fetchFixtures([entry({ url: `${base}/good`, bytes: GOOD.length + 1 })], out),
      /refused/
    )
    assert.equal(existsSync(join(out, 'roms/gba/test.gba')), false)
  })
})

test('an HTTP error is refused with its status', async () => {
  await withServer(async ({ base, out }) => {
    await assert.rejects(fetchFixtures([entry({ url: `${base}/gone` })], out), /answered 404/)
  })
})

test('a file already present with the right hash is kept without a download', async () => {
  await withServer(async ({ base, out, hits }) => {
    mkdirSync(join(out, 'roms/gba'), { recursive: true })
    writeFileSync(join(out, 'roms/gba/test.gba'), GOOD)
    const result = await fetchFixtures([entry({ url: `${base}/good` })], out)
    assert.deepEqual(result, [{ path: 'roms/gba/test.gba', status: 'kept' }])
    assert.deepEqual(hits, [])
  })
})

test('a file already present with the wrong bytes is replaced', async () => {
  await withServer(async ({ base, out }) => {
    mkdirSync(join(out, 'roms/gba'), { recursive: true })
    writeFileSync(join(out, 'roms/gba/test.gba'), TAMPERED)
    const result = await fetchFixtures([entry({ url: `${base}/good` })], out)
    assert.equal(result[0].status, 'fetched')
    assert.deepEqual(readFileSync(join(out, 'roms/gba/test.gba')), GOOD)
  })
})

test('the manifest refuses entries without provenance, a pin or a safe path', () => {
  assert.throws(() => validateManifest({}), /no files/)
  assert.throws(() => validateManifest({ files: [] }), /no files/)
  const bad: [Partial<Fixture> | Record<string, unknown>, RegExp][] = [
    [{ path: '../escape.gba' }, /path must be relative/],
    [{ path: '/abs/escape.gba' }, /path must be relative/],
    [{ path: 'roms//double.gba' }, /path must be relative/],
    [{ path: 'bios/real.bin' }, /under roms\//],
    [{ url: 'http://example.invalid/x' }, /url must be https/],
    [{ url: 'not a url' }, /url must be https/],
    [{ sha256: 'ABC' }, /sha256 must be/],
    [{ bytes: 0 }, /bytes must be/],
    [{ bytes: MAX_BYTES + 1 }, /bytes must be/],
    [{ licence: ' ' }, /licence is required/],
    [{ attribution: undefined }, /attribution is required/]
  ]
  for (const [overrides, message] of bad) {
    assert.throws(() => validateManifest({ files: [{ ...entry(), ...overrides }] }), message)
  }
  assert.throws(() => validateManifest({ files: [entry(), entry()] }), /listed twice/)
  assert.throws(() => validateManifest({ files: [null] }), /files\[0\]: path/)
})

test('the committed manifest is valid and pins every file with its licence', () => {
  const files = loadManifest()
  assert.ok(files.length > 0)
  for (const f of files) {
    assert.match(
      f.url,
      /^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[0-9a-f]{40}\//,
      f.path
    )
  }
  assert.deepEqual(loadManifest(DEFAULT_MANIFEST), files)
})

test('arguments: defaults, --out and --manifest, and nothing else', () => {
  assert.deepEqual(parseArgs([]), { out: DEFAULT_OUT, manifest: DEFAULT_MANIFEST })
  assert.equal(dirname(DEFAULT_OUT).endsWith(join('test', 'romm')), true)
  assert.deepEqual(parseArgs(['--out', 'x', '--manifest', 'm.json']), {
    out: resolve('x'),
    manifest: resolve('m.json')
  })
  assert.throws(() => parseArgs(['--out']), /usage/)
  assert.throws(() => parseArgs(['--force', 'yes']), /usage/)
})
